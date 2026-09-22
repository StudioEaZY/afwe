//! `afwe studio` — web host for the Studio UI.
//!
//! Serves the built frontend (embedded at compile time from `apps/studio/web-dist`, or
//! any directory passed with `--dist`) and a single JSON endpoint `POST /api/call`
//! `{ "op": "...", "params": {...} }` that maps 1:1 onto the engine API. The Tauri
//! desktop shell talks to the very same engine through `invoke("call", …)`.

use afwe_core::api;
use afwe_core::engine::Engine;
use anyhow::Result;
use include_dir::{include_dir, Dir};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Response, Server, StatusCode};

static EMBEDDED: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../apps/studio/web-dist");

pub fn serve(start: PathBuf, host: &str, port: u16, open_browser: bool, dist: Option<PathBuf>) -> Result<()> {
    let engine = Engine::open(&start)?;
    let project = engine.store.manifest()?.project.name;
    let engine = Arc::new(Mutex::new(engine));
    let dist = dist.or_else(|| std::env::var("AFWE_STUDIO_DIST").ok().map(PathBuf::from));
    let server = Server::http(format!("{host}:{port}")).map_err(|e| anyhow::anyhow!("cannot bind {host}:{port}: {e}"))?;
    let url = format!("http://{}:{port}", if host == "0.0.0.0" { "localhost" } else { host });
    eprintln!("AFWE Studio for `{project}` → {url}   (API: POST {url}/api/call)   Ctrl-C to stop");
    if open_browser {
        let _ = open::that(&url);
    }
    for mut req in server.incoming_requests() {
        let path = req.url().split('?').next().unwrap_or("/").to_string();
        let method = req.method().clone();
        let resp = if path.starts_with("/api/") {
            let mut body = String::new();
            let _ = req.as_reader().read_to_string(&mut body);
            let (status, value) = handle_api(&engine, &method, &path, &body);
            let mut r = Response::from_string(serde_json::to_string(&value).unwrap()).with_status_code(StatusCode(status));
            r.add_header(Header::from_bytes("Content-Type", "application/json").unwrap());
            r.add_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());
            r.add_header(Header::from_bytes("Access-Control-Allow-Headers", "content-type").unwrap());
            r.add_header(Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap());
            r
        } else {
            serve_static(&path, dist.as_ref())
        };
        let _ = req.respond(resp);
    }
    Ok(())
}

fn handle_api(engine: &Arc<Mutex<Engine>>, method: &Method, path: &str, body: &str) -> (u16, Value) {
    if *method == Method::Options {
        return (204, json!({}));
    }
    match path {
        "/api/health" => (200, json!({"ok": true, "engine": afwe_core::ENGINE_VERSION})),
        "/api/ops" => (200, json!(api::OPS)),
        "/api/call" => {
            let req: Value = match serde_json::from_str(body) {
                Ok(v) => v,
                Err(e) => return (400, json!({"ok": false, "error": format!("invalid json: {e}")})),
            };
            let op = req.get("op").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let params = req.get("params").cloned().unwrap_or(json!({}));
            let origin = req.get("origin").and_then(|v| v.as_str()).unwrap_or("human").to_string();
            let eng = engine.lock().unwrap();
            match api::call(&eng, &op, params, &origin) {
                Ok(v) => (200, json!({"ok": true, "result": v})),
                Err(e) => (200, json!({"ok": false, "error": format!("{e:#}")})),
            }
        }
        _ => (404, json!({"ok": false, "error": "not found"})),
    }
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "json" | "map" => "application/json",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "application/octet-stream",
    }
}

fn serve_static(path: &str, dist: Option<&PathBuf>) -> Response<std::io::Cursor<Vec<u8>>> {
    let rel = path.trim_start_matches('/');
    let candidates = if rel.is_empty() { vec!["index.html".to_string()] } else { vec![rel.to_string(), "index.html".to_string()] };
    for c in &candidates {
        if let Some(d) = dist {
            let p = d.join(c);
            if p.is_file() {
                if let Ok(bytes) = std::fs::read(&p) {
                    return with_mime(Response::from_data(bytes), c);
                }
            }
        } else if let Some(f) = EMBEDDED.get_file(c) {
            return with_mime(Response::from_data(f.contents().to_vec()), c);
        }
    }
    Response::from_string("not found").with_status_code(StatusCode(404))
}

fn with_mime(mut r: Response<std::io::Cursor<Vec<u8>>>, name: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    r.add_header(Header::from_bytes("Content-Type", mime(name)).unwrap());
    if name != "index.html" {
        r.add_header(Header::from_bytes("Cache-Control", "public, max-age=3600").unwrap());
    }
    r
}
