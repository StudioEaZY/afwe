//! MCP server (stdio, JSON-RPC 2.0, newline delimited).
//!
//! Exposes the engine as tools (`afwe_context`, `afwe_verify`, …) and a few `.afwe/`
//! resources. Works with Claude Code, Codex, Cursor and any other MCP client.

use afwe_core::api;
use afwe_core::engine::Engine;
use anyhow::Result;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;

const PROTOCOL: &str = "2024-11-05";

pub fn serve(start: PathBuf, origin_name: Option<String>) -> Result<()> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let mut origin = origin_name.map(|n| if n.contains(':') { n } else { format!("llm:{n}") }).unwrap_or("llm:mcp".into());
    let mut engine: Option<Engine> = Engine::open(&start).ok();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                write(&mut stdout, &json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": format!("parse error: {e}")}}));
                continue;
            }
        };
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("").to_string();
        let params = msg.get("params").cloned().unwrap_or(json!({}));
        if id.is_none() {
            // notification
            if method == "notifications/initialized" || method.starts_with("notifications/") {
                continue;
            }
            continue;
        }
        let id = id.unwrap();
        let result: Result<Value, (i64, String)> = match method.as_str() {
            "initialize" => {
                if let Some(name) = params.pointer("/clientInfo/name").and_then(|v| v.as_str()) {
                    if origin == "llm:mcp" {
                        origin = format!("llm:{}", name.to_lowercase().replace(' ', "-"));
                    }
                }
                let requested = params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or(PROTOCOL);
                Ok(json!({
                    "protocolVersion": requested,
                    "capabilities": {"tools": {"listChanged": false}, "resources": {"listChanged": false, "subscribe": false}},
                    "serverInfo": {"name": "afwe", "version": afwe_core::ENGINE_VERSION},
                    "instructions": instructions(engine.as_ref()),
                }))
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({"tools": api::tool_specs().iter().map(|t| json!({"name": t.name, "description": t.description, "inputSchema": t.schema})).collect::<Vec<_>>()})),
            "tools/call" => {
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                match call_tool(&mut engine, &start, &origin, name, args) {
                    Ok(v) => Ok(v),
                    Err(e) => Ok(json!({"content": [{"type": "text", "text": format!("AFWE error: {e:#}")}], "isError": true})),
                }
            }
            "resources/list" => Ok(resources_list(engine.as_ref())),
            "resources/read" => {
                let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
                match resource_read(engine.as_ref(), uri) {
                    Ok(text) => Ok(json!({"contents": [{"uri": uri, "mimeType": "text/plain", "text": text}]})),
                    Err(e) => Err((-32002, format!("{e:#}"))),
                }
            }
            "prompts/list" => Ok(json!({"prompts": []})),
            "completion/complete" => Ok(json!({"completion": {"values": []}})),
            other => Err((-32601, format!("method not found: {other}"))),
        };
        let response = match result {
            Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
            Err((code, message)) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}),
        };
        write(&mut stdout, &response);
    }
    Ok(())
}

fn write(out: &mut std::io::Stdout, v: &Value) {
    let _ = writeln!(out, "{}", serde_json::to_string(v).unwrap());
    let _ = out.flush();
}

fn instructions(engine: Option<&Engine>) -> String {
    let name = engine.and_then(|e| e.store.manifest().ok()).map(|m| m.project.name).unwrap_or("this project".into());
    format!(
        "AFWE keeps a persistent architectural model of `{name}` in .afwe/. Contract: (1) before editing call afwe_context with the files you will touch and respect the decisions/exceptions/guardrails it returns; (2) reuse existing nodes before creating new ones; (3) after editing call afwe_verify on the changed files and fix errors instead of silencing them; (4) record decisions/exceptions with afwe_memory_add, capture feature intent as a workflow with afwe_workflow_upsert; (5) call afwe_sync, then afwe_task_done. The blueprint is the structural reality of the project – verify your work against it; if code and blueprint disagree, say so rather than silently reinterpreting the architecture."
    )
}

fn call_tool(engine: &mut Option<Engine>, start: &PathBuf, origin: &str, name: &str, args: Value) -> Result<Value> {
    if engine.is_none() {
        *engine = Some(Engine::open(start)?);
    }
    let eng = engine.as_ref().unwrap();
    let spec = api::tool_specs().into_iter().find(|t| t.name == name).ok_or_else(|| anyhow::anyhow!("unknown tool `{name}`"))?;
    let mut params = args;
    if params.get("origin").is_none() {
        params["origin"] = json!(origin);
    }
    let result = api::call(eng, spec.op, params, origin)?;
    let mut content = vec![];
    let mut is_error = false;
    match spec.op {
        "context" => {
            content.push(json!({"type": "text", "text": result["markdown"].as_str().unwrap_or("")}));
            let mut structured = result.clone();
            structured.as_object_mut().map(|m| m.remove("markdown"));
            content.push(json!({"type": "text", "text": format!("```json\n{}\n```", serde_json::to_string(&structured)?)}));
        }
        "verify" => {
            let report: afwe_core::model::VerifyReport = serde_json::from_value(result.clone())?;
            is_error = !report.ok;
            content.push(json!({"type": "text", "text": afwe_core::verify::render_report(&report)}));
        }
        "contract.render" => content.push(json!({"type": "text", "text": result["markdown"].as_str().unwrap_or("")})),
        _ => content.push(json!({"type": "text", "text": serde_json::to_string_pretty(&result)?})),
    }
    Ok(json!({"content": content, "isError": is_error, "structuredContent": result}))
}

fn resources_list(engine: Option<&Engine>) -> Value {
    let mut res = vec![
        json!({"uri": "afwe://readme", "name": "AFWE folder guide", "mimeType": "text/markdown"}),
        json!({"uri": "afwe://blueprint", "name": "Blueprint (yaml)", "mimeType": "text/yaml"}),
        json!({"uri": "afwe://relations", "name": "Relations (yaml)", "mimeType": "text/yaml"}),
        json!({"uri": "afwe://constraints", "name": "Constraints (yaml)", "mimeType": "text/yaml"}),
        json!({"uri": "afwe://contract", "name": "Contract block for AGENTS.md", "mimeType": "text/markdown"}),
    ];
    if let Some(e) = engine {
        if let Ok(mem) = e.store.memory() {
            for m in mem {
                res.push(json!({"uri": format!("afwe://memory/{}", m.meta.id), "name": format!("[{}] {}", m.meta.kind, m.meta.title), "mimeType": "text/markdown"}));
            }
        }
    }
    json!({"resources": res})
}

fn resource_read(engine: Option<&Engine>, uri: &str) -> Result<String> {
    let e = engine.ok_or_else(|| anyhow::anyhow!("no project open"))?;
    match uri {
        "afwe://readme" => Ok(e.store.read_text("README.md")?.unwrap_or(afwe_core::init::AFWE_README.into())),
        "afwe://blueprint" => Ok(e.store.read_text("blueprint/blueprint.yaml")?.unwrap_or_default()),
        "afwe://relations" => Ok(e.store.read_text("blueprint/relations.yaml")?.unwrap_or_default()),
        "afwe://constraints" => Ok(e.store.read_text("blueprint/constraints.yaml")?.unwrap_or_default()),
        "afwe://contract" => Ok(api::call(e, "contract.render", json!({}), "llm")?["markdown"].as_str().unwrap_or("").to_string()),
        other => {
            if let Some(id) = other.strip_prefix("afwe://memory/") {
                let m = e.store.memory()?.into_iter().find(|m| m.meta.id == id).ok_or_else(|| anyhow::anyhow!("memory not found"))?;
                return Ok(format!("{}\n\n{}", afwe_core::store::to_yaml(&m.meta)?, m.body));
            }
            Err(anyhow::anyhow!("unknown resource {other}"))
        }
    }
}
