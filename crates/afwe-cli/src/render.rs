//! Human readable rendering of engine JSON for the terminal.

use afwe_core::model::{Blueprint, BlueprintNode};
use serde_json::Value;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}

pub fn compact(v: &Value) -> String {
    match v {
        Value::Object(m) => m.iter().filter(|(k, _)| !matches!(k.as_str(), "children")).map(|(k, v)| format!("  {k}: {}", short(v))).collect::<Vec<_>>().join("\n"),
        other => short(other),
    }
}
fn short(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) => format!("[{}]", a.iter().map(short).collect::<Vec<_>>().join(", ")),
        Value::Object(_) => serde_json::to_string(v).unwrap_or_default(),
        other => other.to_string(),
    }
}

pub fn tree_from_blueprint(bp: &Blueprint) -> String {
    let mut out = String::new();
    fn rec(n: &BlueprintNode, prefix: &str, last: bool, root: bool, out: &mut String) {
        let branch = if root { "" } else if last { "└── " } else { "├── " };
        let mut meta = vec![];
        if !n.implements.files.is_empty() {
            meta.push(format!("files: {}", n.implements.files.join(", ")));
        }
        if !n.implements.symbols.is_empty() {
            meta.push(format!("{} symbol(s)", n.implements.symbols.len()));
        }
        if let Some(st) = &n.status {
            if st != "active" {
                meta.push(format!("[{st}]"));
            }
        }
        out.push_str(&format!("{prefix}{branch}{} ({}) `{}`{}\n", n.name, n.kind, n.id, if meta.is_empty() { String::new() } else { format!("  — {}", meta.join("; ")) }));
        let child_prefix = if root { String::new() } else { format!("{prefix}{}", if last { "    " } else { "│   " }) };
        for (i, c) in n.children.iter().enumerate() {
            rec(c, &child_prefix, i + 1 == n.children.len(), false, out);
        }
    }
    for (i, n) in bp.nodes.iter().enumerate() {
        rec(n, "", i + 1 == bp.nodes.len(), true, &mut out);
    }
    out
}

pub fn status(v: &Value) -> String {
    let mut o = String::new();
    o.push_str(&format!("AFWE {} — {}\n", s(&v["project"], "name"), s(&v["project"], "description")));
    o.push_str(&format!("sync:       {}{}\n", s(&v["sync"], "status"), v["sync"]["last_sync"].as_str().map(|t| format!(" (last {t})")).unwrap_or_default()));
    o.push_str(&format!("blueprint:  {} nodes, {} relations, {} constraints\n", v["blueprint"]["nodes"], v["blueprint"]["relations"], v["blueprint"]["constraints"]));
    o.push_str(&format!("code:       {} files ({} code), {} mapped, {} code files without a home, {} symbols\n", v["code"]["files"], v["code"]["code_files"], v["code"]["mapped_files"], v["code"]["unmapped_code_files"], v["code"]["symbols"]));
    o.push_str(&format!("languages:  {}\n", v["code"]["languages"].as_object().map(|m| m.iter().map(|(k, c)| format!("{k}={c}")).collect::<Vec<_>>().join(" ")).unwrap_or_default()));
    o.push_str(&format!("memory:     {} ({})\n", v["memory"]["total"], v["memory"]["by_kind"].as_object().map(|m| m.iter().map(|(k, c)| format!("{k}={c}")).collect::<Vec<_>>().join(" ")).unwrap_or_default()));
    o.push_str(&format!("guardrails: {} passive, {} active\n", v["guardrails"]["passive"], v["guardrails"]["active"]));
    o.push_str(&format!("workflows:  {}   lenses: {}\n", v["workflows"], v["lenses"]));
    o.push_str(&format!("board:      {} open item(s), {} open task(s)   proposals: {}\n", v["board"]["open"], v["board"]["open_tasks"], v["proposals"]));
    o
}

pub fn sync(v: &Value) -> String {
    let mut o = String::new();
    o.push_str(&format!("synced {} files / {} symbols in {} ms — {} nodes, {} mapped, {} code files without a home\n", v["files"], v["symbols"], v["duration_ms"], v["nodes"], v["mapped_files"], v["unmapped_code_files"]));
    let uncertain_ids: Vec<&str> = v["uncertain"].as_array().map(|a| a.iter().filter_map(|f| f["id"].as_str()).collect()).unwrap_or_default();
    for (label, key) in [("applied (confident)", "applied"), ("applied (uncertain — review at leisure)", "uncertain"), ("proposed (needs you)", "proposed"), ("informational", "informational")] {
        if let Some(a) = v[key].as_array() {
            let a: Vec<&Value> = a.iter().filter(|f| key != "applied" || !uncertain_ids.contains(&f["id"].as_str().unwrap_or(""))).collect();
            if !a.is_empty() {
                o.push_str(&format!("\n{label}: {}\n", a.len()));
                for f in a.iter().take(25) {
                    o.push_str(&format!("  {:>3}%  {}\n", (f["confidence"].as_f64().unwrap_or(0.0) * 100.0).round(), s(f, "summary")));
                }
                if a.len() > 25 {
                    o.push_str(&format!("  … {} more\n", a.len() - 25));
                }
            }
        }
    }
    o
}

pub fn drift(v: &Value) -> String {
    let mut o = format!("{} finding(s)\n", v["count"]);
    for it in v["findings"].as_array().unwrap_or(&vec![]) {
        let f = &it["finding"];
        o.push_str(&format!("{:>3}%  [{}] {}  → {}\n", (f["confidence"].as_f64().unwrap_or(0.0) * 100.0).round(), s(it, "bucket"), s(f, "summary"), it["describe"].as_str().unwrap_or("(no change)")));
        for e in f["evidence"].as_array().unwrap_or(&vec![]).iter().take(3) {
            o.push_str(&format!("        · {}\n", e.as_str().unwrap_or("")));
        }
    }
    o.push_str("\nbuckets: auto ≥70% applied by `afwe sync`; soft 50–70% applied + marked uncertain; proposal <50% waits for you.\n");
    o
}

pub fn node_detail(v: &Value) -> String {
    let mut o = String::new();
    o.push_str(&format!("{} `{}` ({}){}\n", s(v, "path"), s(v, "id"), s(v, "kind"), v["status"].as_str().map(|x| format!(" [{x}]")).unwrap_or_default()));
    if let Some(p) = v["purpose"].as_str() {
        o.push_str(&format!("why:   {p}\n"));
    }
    if let Some(d) = v["description"].as_str() {
        o.push_str(&format!("what:  {d}\n"));
    }
    let children: Vec<String> = v["children"].as_array().map(|a| a.iter().map(|c| s(c, "name").to_string()).collect()).unwrap_or_default();
    if !children.is_empty() {
        o.push_str(&format!("contains: {}\n", children.join(", ")));
    }
    o.push_str(&format!("implements: files={} symbols={}\n", v["implements"]["files"], v["implements"]["symbols"]));
    let files: Vec<String> = v["files"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
    o.push_str(&format!("mapped files ({}): {}\n", files.len(), files.iter().take(15).cloned().collect::<Vec<_>>().join(", ")));
    for (label, key, dir) in [("depends on", "out", "to_path"), ("depended on by", "in", "from_path")] {
        if let Some(a) = v["relations"][key].as_array() {
            if !a.is_empty() {
                o.push_str(&format!("{label}: {}\n", a.iter().map(|r| format!("{} ({}{})", r[dir].as_str().unwrap_or(""), s(r, "kind"), if s(r, "status") != "declared" { format!(", {}", s(r, "status")) } else { String::new() })).collect::<Vec<_>>().join(", ")));
            }
        }
    }
    for (label, key, dir) in [("code edges out", "out", "to_path"), ("code edges in", "in", "from_path")] {
        if let Some(a) = v["code_edges"][key].as_array() {
            if !a.is_empty() {
                o.push_str(&format!("{label}: {}\n", a.iter().map(|r| format!("{} ×{}", r[dir].as_str().unwrap_or(""), r["count"])).collect::<Vec<_>>().join(", ")));
            }
        }
    }
    if let Some(a) = v["constraints"].as_array() {
        for c in a {
            o.push_str(&format!("constraint: {} {} {} {}\n", s(c, "id"), s(c, "from"), s(c, "rule"), c["to"]));
        }
    }
    if let Some(a) = v["memory"].as_array() {
        for m in a {
            o.push_str(&format!("memory: [{}] {} `{}`\n", s(m, "kind"), s(m, "title"), s(m, "id")));
        }
    }
    if let Some(a) = v["inherited_memory"].as_array() {
        for m in a {
            o.push_str(&format!("memory (inherited from {}): [{}] {}\n", s(m, "from"), s(m, "kind"), s(m, "title")));
        }
    }
    if let Some(a) = v["guardrails"].as_array() {
        for g in a {
            o.push_str(&format!("guardrail [{}]: {}\n", s(g, "mode"), s(g, "statement")));
        }
    }
    if let Some(a) = v["workflows"].as_array() {
        for w in a {
            o.push_str(&format!("workflow: {} ({})\n", s(w, "title"), s(w, "status")));
        }
    }
    o
}

pub fn memory_list(v: &Value) -> String {
    v["memory"].as_array().map(|a| a.iter().map(|m| format!("{:<12} {:<32} {:<10} {}  → {}", s(m, "kind"), s(m, "id"), s(m, "status"), s(m, "title"), m["applies_to"].as_array().map(|x| x.iter().filter_map(|y| y.as_str()).collect::<Vec<_>>().join(",")).unwrap_or_default())).collect::<Vec<_>>().join("\n")).unwrap_or_default()
}

pub fn guardrails(v: &Value) -> String {
    v.as_array().map(|a| a.iter().map(|g| format!("[{}] {:<28} {}  scope={} exceptions={}", s(g, "mode"), s(g, "id"), s(g, "statement"), g["scope"]["nodes"], g["exceptions"].as_array().map(|x| x.len()).unwrap_or(0))).collect::<Vec<_>>().join("\n")).unwrap_or_default()
}

pub fn workflow(v: &Value) -> String {
    let mut o = format!("{} `{}` [{}] origin={}\n", s(v, "title"), s(v, "id"), s(v, "status"), v["origin"].as_str().unwrap_or("?"));
    if let Some(d) = v["description"].as_str() {
        o.push_str(&format!("{d}\n"));
    }
    o.push_str(&format!("targets: {}\n\nnodes:\n", v["targets"]));
    for n in v["nodes"].as_array().unwrap_or(&vec![]) {
        o.push_str(&format!("  [{:<9}] {:<24} {}{}\n", s(n, "kind"), s(n, "id"), s(n, "title"), n["status"].as_str().map(|x| format!(" ({x})")).unwrap_or_default()));
        if let Some(t) = n["text"].as_str() {
            for line in t.lines().take(6) {
                o.push_str(&format!("               {line}\n"));
            }
        }
        if let Some(m) = n.get("maps_to") {
            if !m.is_null() {
                o.push_str(&format!("               maps_to: {m}\n"));
            }
        }
    }
    o.push_str("edges:\n");
    for e in v["edges"].as_array().unwrap_or(&vec![]) {
        o.push_str(&format!("  {} —{}→ {}\n", s(e, "from"), s(e, "kind"), s(e, "to")));
    }
    o
}

pub fn lens_view(v: &Value) -> String {
    let mut o = format!("{} `{}`\n", s(v, "name"), s(v, "id"));
    fn rec(n: &Value, depth: usize, o: &mut String) {
        let virt = n["virtual"].as_bool().unwrap_or(false);
        o.push_str(&format!("{}{}{}\n", "  ".repeat(depth), if virt { "▣ " } else { "· " }, s(n, "name")));
        for w in n["workflows"].as_array().unwrap_or(&vec![]) {
            o.push_str(&format!("{}  ⤷ workflow {}\n", "  ".repeat(depth), s(w, "title")));
        }
        for c in n["children"].as_array().unwrap_or(&vec![]) {
            rec(c, depth + 1, o);
        }
    }
    for g in v["groups"].as_array().unwrap_or(&vec![]) {
        rec(g, 0, &mut o);
    }
    o
}

pub fn contract(v: &Value) -> String {
    let mut o = format!("{} `{}` — tasks: {}\n", s(v, "name"), s(v, "id"), v["task_kinds"]);
    for (i, st) in v["steps"].as_array().unwrap_or(&vec![]).iter().enumerate() {
        o.push_str(&format!("{:>2}. [{:<6}] {:<15} {}\n", i + 1, s(st, "phase"), s(st, "action"), s(st, "instruction")));
    }
    o
}

pub fn board(v: &Value) -> String {
    let mut o = format!("Board — {} open item(s)\n", v["open"]);
    let tasks = v["tasks"].as_array().cloned().unwrap_or_default();
    let items = v["items"].as_array().cloned().unwrap_or_default();
    for t in tasks.iter().filter(|t| s(t, "status") == "open") {
        o.push_str(&format!("\n▶ task {} — {} [{}] contract={}\n", s(t, "id"), s(t, "title"), s(t, "kind"), s(t, "contract")));
        for it in items.iter().filter(|i| i["task"].as_str() == Some(s(t, "id"))) {
            o.push_str(&format!("   {} {:<14} {}\n", if s(it, "status") == "open" { "☐" } else { "☑" }, it["action"].as_str().unwrap_or(""), it["detail"].as_str().unwrap_or("")));
        }
    }
    let system: Vec<&Value> = items.iter().filter(|i| i["task"].is_null() && s(i, "status") == "open").collect();
    if !system.is_empty() {
        o.push_str("\n▶ from AFWE\n");
        for it in system {
            o.push_str(&format!("   [{}] {}\n", s(it, "kind"), s(it, "title")));
        }
    }
    o
}

pub fn proposals(v: &Value) -> String {
    let a = v.as_array().cloned().unwrap_or_default();
    if a.is_empty() {
        return "no pending proposals".into();
    }
    let mut o = String::new();
    for p in a {
        let f = &p["finding"];
        o.push_str(&format!("{}  {:>3}%  {}\n", s(&p, "id"), (f["confidence"].as_f64().unwrap_or(0.0) * 100.0).round(), s(f, "summary")));
        for e in f["evidence"].as_array().unwrap_or(&vec![]).iter().take(3) {
            o.push_str(&format!("      · {}\n", e.as_str().unwrap_or("")));
        }
    }
    o.push_str("\nafwe proposals accept <id> | revert <id> | review <id>\n");
    o
}

pub fn review(v: &Value) -> String {
    let mut o = format!("impact of: {}\n", s(&v["finding"], "summary"));
    o.push_str(&format!("nodes: {}\n", v["nodes"]));
    for (label, key) in [("memory", "memory"), ("guardrails", "guardrails"), ("constraints", "constraints")] {
        if let Some(a) = v[key].as_array() {
            if !a.is_empty() {
                o.push_str(&format!("{label}:\n"));
                for x in a {
                    o.push_str(&format!("  - {}\n", x["title"].as_str().or(x["statement"].as_str()).or(x["id"].as_str()).unwrap_or("")));
                }
            }
        }
    }
    o.push_str(&format!("files touched: {}\n", v["files"].as_array().map(|a| a.len()).unwrap_or(0)));
    o
}

pub fn log(v: &Value) -> String {
    v.as_array().map(|a| a.iter().map(|e| format!("{}  {:<22} {:<16} {}{}", s(e, "ts"), s(e, "origin"), s(e, "kind"), s(e, "summary"), e["confidence"].as_f64().map(|c| format!("  ({:.0}%{})", c * 100.0, if e["uncertain"].as_bool().unwrap_or(false) { ", uncertain" } else { "" })).unwrap_or_default())).collect::<Vec<_>>().join("\n")).unwrap_or_default()
}
