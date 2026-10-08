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

// ───────────────────────────── v2: turns, pins, timeline, gate, onboarding ─────────────────────────────

fn list_of<'a>(v: &'a Value) -> Vec<&'a Value> {
    v.as_array().map(|a| a.iter().collect()).unwrap_or_default()
}

fn strings(v: &Value) -> String {
    list_of(v).iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", ")
}

/// The briefing a harness receives at turn.begin, for people reading it in a terminal.
pub fn turn_briefing(v: &Value) -> String {
    let mut out = format!("Turn {} open (task {})\n", s(v, "turn"), s(v, "task"));
    let scope = strings(&v["scope"]["nodes"]);
    out.push_str(&format!("  scope: {}\n", if scope.is_empty() { "no node named — pass --target for precise context".to_string() } else { scope }));
    if !list_of(&v["unresolved_targets"]).is_empty() {
        out.push_str(&format!("  unknown targets: {}\n", strings(&v["unresolved_targets"])));
    }
    if !list_of(&v["pins"]).is_empty() {
        out.push_str("PINS — do not change what these protect without an explicit override:\n");
        for p in list_of(&v["pins"]) {
            out.push_str(&format!("  • {} [{}] {}\n", s(p, "id"), s(p, "severity"), s(p, "statement")));
        }
    }
    if !list_of(&v["intentional"]).is_empty() {
        out.push_str("INTENTIONAL — deliberate, do not 'fix':\n");
        for p in list_of(&v["intentional"]) {
            out.push_str(&format!("  • {} {}\n", s(p, "id"), s(p, "statement")));
        }
    }
    if !list_of(&v["intents"]).is_empty() {
        out.push_str("INTENTS:\n");
        for i in list_of(&v["intents"]) {
            out.push_str(&format!("  • {} ({}) {}\n", s(i, "id"), s(i, "status"), s(i, "statement")));
        }
    }
    if !list_of(&v["memory"]).is_empty() {
        out.push_str("MEMORY:\n");
        for m in list_of(&v["memory"]) {
            out.push_str(&format!("  • [{}] {} — {}\n", s(m, "kind"), s(m, "title"), s(m, "excerpt")));
        }
    }
    if !list_of(&v["constraints"]).is_empty() {
        out.push_str("CONSTRAINTS:\n");
        for c in list_of(&v["constraints"]) {
            out.push_str(&format!("  • {} {} {} {}\n", s(c, "id"), s(c, "rule"), s(c, "from"), strings(&c["to"])));
        }
    }
    if !list_of(&v["checks"]).is_empty() {
        out.push_str("CHECKS the gate will run for this scope:\n");
        for c in list_of(&v["checks"]) {
            out.push_str(&format!("  • {} ({}, by {})\n", s(c, "id"), s(c, "trust"), s(c, "authored_by")));
        }
    }
    if !list_of(&v["unresolved_proposals"]).is_empty() {
        out.push_str("PROPOSALS STAGED (not committed):\n");
        for p in list_of(&v["unresolved_proposals"]) {
            out.push_str(&format!("  • {} {:.0}% — {}\n", s(p, "turn"), p["confidence"].as_f64().unwrap_or(0.0) * 100.0, s(p, "summary")));
        }
    }
    if let Some(f) = v["footer"].as_str() {
        out.push_str(&format!("\n{f}\n"));
    }
    out.push_str("\nNext: declare intents and claims (turn assume --file <json>) BEFORE writing code.\n");
    out
}

/// Result of turn.assume / turn.commit / turn.confirm / turn.revert.
pub fn turn_result(v: &Value) -> String {
    let id = s(v, "turn");
    match s(v, "status") {
        "committed" => {
            let sha = v["commit"]["sha"].as_str().map(|x| x.chars().take(7).collect::<String>());
            let mut out = format!(
                "✔ AFWE Turn {id} committed{}  [Confidence: {:.0}% · Strength: {}]\n",
                sha.map(|x| format!(" as {x}")).unwrap_or_else(|| " (recorded, no git commit)".into()),
                v["confidence"].as_f64().unwrap_or(0.0) * 100.0,
                s(v, "strength").replace("llm_judged", "LLM-judged")
            );
            if !s(v, "summary").is_empty() {
                out.push_str(&format!("  {}\n", s(v, "summary")));
            }
            for n in list_of(&v["implicitly_accepted"]) {
                out.push_str(&format!("  ↪ implicitly accepted proposal {}: {}\n", s(n, "turn"), s(n, "why")));
            }
            for r in list_of(&v["notices"]) {
                out.push_str(&format!("  • {}\n", r.as_str().unwrap_or("")));
            }
            out
        }
        "staged" => format!(
            "⚠ {id} staged as a proposal — NOT committed [Confidence: {:.0}%]\n{}\n  {}\n",
            v["confidence"].as_f64().unwrap_or(0.0) * 100.0,
            list_of(&v["reasons"]).iter().map(|r| format!("  • {}", r.as_str().unwrap_or(""))).collect::<Vec<_>>().join("\n"),
            s(v, "next")
        ),
        "ready" => format!("{id} is ready: the gate passed; commit with git using the trailer AFWE-Turn: {id}\n"),
        "redo" => {
            let mut out = format!("REDO — {id} NOT committed\n");
            let failures = v["failures"].clone();
            let errors = v["errors"].clone();
            for f in list_of(&failures).into_iter().chain(list_of(&errors)) {
                let text = f.as_str().map(|x| x.to_string()).unwrap_or_else(|| format!("{} {}", s(f, "code"), s(f, "message")));
                out.push_str(&format!("  ✖ {text}\n"));
            }
            for n in list_of(&v["notices"]) {
                out.push_str(&format!("  • {}\n", n.as_str().unwrap_or("")));
            }
            out.push_str(&format!("  → {}\n", s(v, "required_action")));
            out
        }
        "accepted" => {
            let mut out = format!("{id}: assumptions and intents registered\n");
            for n in list_of(&v["notices"]) {
                out.push_str(&format!("  • {}\n", n.as_str().unwrap_or("")));
            }
            for n in list_of(&v["needs_confirmation"]) {
                out.push_str(&format!("  ⚠ {}\n", n.as_str().unwrap_or("")));
            }
            out.push_str(&format!("  → {}\n", s(v, "next")));
            out
        }
        "empty" => format!("{id}: nothing changed since turn begin — nothing to commit\n"),
        "reverted" => format!(
            "{id} reverted: {} restored, {} removed{}\n",
            list_of(&v["restored"]).len(),
            list_of(&v["removed"]).len(),
            if list_of(&v["manual"]).is_empty() { String::new() } else { format!(", {} need a manual revert: {}", list_of(&v["manual"]).len(), strings(&v["manual"])) }
        ),
        _ => serde_json::to_string_pretty(v).unwrap_or_default(),
    }
}

pub fn turn_list(v: &Value) -> String {
    let rows: Vec<String> = list_of(v).iter().map(|t| format!("{:<7} {:<10} {}", s(t, "id"), s(t, "status"), truncate_line(s(t, "prompt"), 90))).collect();
    if rows.is_empty() {
        "no turns yet — start one with `afwe turn begin \"<prompt>\"`".into()
    } else {
        rows.join("\n")
    }
}

fn truncate_line(x: &str, n: usize) -> String {
    let t: String = x.chars().take(n).collect();
    if x.chars().count() > n {
        format!("{t}…")
    } else {
        t
    }
}

pub fn pins(v: &Value) -> String {
    let rows: Vec<String> = list_of(v)
        .iter()
        .map(|p| {
            let nodes = strings(&p["attaches"]["nodes"]);
            format!("{:<12} {:<9} {:<8} {}{}", s(p, "id"), s(p, "status"), s(p, "severity"), s(p, "statement"), if nodes.is_empty() { String::new() } else { format!("  [{nodes}]") })
        })
        .collect();
    if rows.is_empty() {
        "no pins".into()
    } else {
        rows.join("\n")
    }
}

pub fn budget(v: &Value) -> String {
    format!(
        "pins: {} active of {} allowed (auto {} for {} nodes × slider {} = ×{})",
        v["active"], v["limit"], v["auto_limit"], v["blueprint_nodes"], v["slider"], v["multiplier"]
    )
}

pub fn checks(v: &Value) -> String {
    let rows: Vec<String> = list_of(v)
        .iter()
        .map(|c| format!("{:<26} {:<14} {:<12} {}", s(c, "id"), c["trust"].as_str().unwrap_or(""), s(c, "authored_by"), s(c, "title")))
        .collect();
    if rows.is_empty() {
        "no registered checks".into()
    } else {
        rows.join("\n")
    }
}

pub fn intents(v: &Value) -> String {
    let rows: Vec<String> = list_of(v)
        .iter()
        .map(|i| format!("{:<26} {:<12} {}", s(i, "id"), s(i, "status"), truncate_line(i["statement"].as_str().unwrap_or(i["title"].as_str().unwrap_or("")), 90)))
        .collect();
    if rows.is_empty() {
        "no intents yet".into()
    } else {
        rows.join("\n")
    }
}

pub fn timeline_list(v: &Value) -> String {
    let mut rows = vec![format!("history via {} · {} turn(s)", s(v, "vcs"), v["count"].as_u64().unwrap_or(0))];
    for t in list_of(&v["turns"]) {
        let conf = t["confidence"].as_f64().map(|c| format!("{:.0}%", c * 100.0)).unwrap_or_default();
        let folded = t["folded_into"].as_str().map(|f| format!(" → folded into {f}")).unwrap_or_default();
        rows.push(format!(
            "{:<7} {:<10} {:<8} {:<13} {:<5} {}{}",
            s(t, "turn"),
            s(t, "status"),
            t["sha"].as_str().unwrap_or("-"),
            t["strength"].as_str().unwrap_or(""),
            conf,
            truncate_line(t["prompt"].as_str().unwrap_or(""), 70),
            folded
        ));
    }
    rows.join("\n")
}

pub fn timeline_show(v: &Value) -> String {
    let t = &v["turn"];
    let mut out = format!("{} · {} · {}\n", s(t, "id"), s(t, "status"), s(t, "origin"));
    out.push_str(&format!("prompt: {}\n", truncate_line(s(t, "prompt"), 400)));
    if let Some(c) = v["commit"]["sha"].as_str() {
        out.push_str(&format!("commit: {} (AFWE-Turn: {})\n", c.chars().take(7).collect::<String>(), s(t, "id")));
    }
    out.push_str(&format!("strength: {} · confidence: {:.0}%\n", s(t, "strength"), t["confidence"].as_f64().unwrap_or(0.0) * 100.0));
    for c in list_of(&t["checks"]) {
        out.push_str(&format!("  {} {} ({}, by {})\n", if c["passed"].as_bool().unwrap_or(false) { "✔" } else { "✖" }, s(c, "id"), s(c, "trust"), s(c, "authored_by")));
    }
    for r in list_of(&t["gate"]["reasons"]) {
        out.push_str(&format!("  • {}\n", r.as_str().unwrap_or("")));
    }
    if !v["stat"].as_str().unwrap_or("").is_empty() {
        out.push_str(&format!("\n{}\n", v["stat"].as_str().unwrap_or("")));
    }
    out
}

pub fn losses(v: &Value) -> String {
    let mut out = String::new();
    let missing = list_of(&v["currently_missing"]);
    if missing.is_empty() {
        out.push_str("no feature is missing compared with the last committed turn\n");
    } else {
        out.push_str("features that are gone:\n");
        for m in missing {
            out.push_str(&format!(
                "  • {} — lost in {} {}\n",
                m["name"].as_str().unwrap_or(s(m, "node")),
                s(m, "lost_in"),
                if m["on_purpose"].as_bool().unwrap_or(false) { "(declared removed)" } else { "(NOT declared — collateral)" }
            ));
        }
        out.push_str("restore one with `afwe timeline restore <feature>`\n");
    }
    out
}

pub fn restore(v: &Value) -> String {
    let mut out = match s(v, "status") {
        "present" => "the feature is realised now; nothing to restore\n".to_string(),
        "plan" => format!("restore plan for `{}` from {} (lost in {})\n", s(v, "feature"), s(v, "from_turn"), s(v, "lost_turn")),
        "applied" => format!("restore turn {} opened for `{}` from {} — commit it with `afwe turn commit {}`\n", s(v, "turn"), s(v, "feature"), s(v, "from_turn"), s(v, "turn")),
        _ => String::new(),
    };
    for f in list_of(&v["files"]) {
        out.push_str(&format!("  {} ({} conflict region(s))\n", s(f, "path"), f["conflicts"].as_u64().unwrap_or(0)));
    }
    if !s(v, "next").is_empty() {
        out.push_str(&format!("→ {}\n", s(v, "next")));
    }
    out
}

pub fn gate(v: &Value, ci: bool) -> String {
    if v["ok"].as_bool().unwrap_or(false) {
        return if ci { "gate: ok".into() } else { "gate passed: constraints, guardrails, registered checks and project tests hold\n".into() };
    }
    let mut out = String::from("gate FAILED:\n");
    for f in list_of(&v["failures"]) {
        out.push_str(&format!("  ✖ {}\n", f.as_str().unwrap_or("")));
    }
    out
}

pub fn onboard_detect(v: &Value) -> String {
    let stacks: Vec<String> = list_of(&v["stacks"]).iter().map(|x| s(x, "stack").to_string()).collect();
    format!(
        "stacks: {}\ngit repository: {}\nafwe initialised: {} · configured: {}\ntest command suggestion: {}\nCI gate: {} · AGENTS.md: {}\n",
        if stacks.is_empty() { "none detected".into() } else { stacks.join(", ") },
        v["git"]["repo"],
        v["initialised"],
        v["configured"],
        v["test_command_suggestion"].as_str().unwrap_or("none"),
        if v["ci_present"].as_bool().unwrap_or(false) { "present" } else { "absent" },
        if v["agents_md"].as_bool().unwrap_or(false) { "present" } else { "absent" },
    )
}

pub fn onboard_apply(v: &Value) -> String {
    let mut out = format!("configured with profile `{}`\n", s(v, "profile"));
    for a in list_of(&v["actions"]) {
        out.push_str(&format!("  ✔ {}\n", a.as_str().unwrap_or("")));
    }
    out.push_str("Next: `afwe studio` to see the board, or start a turn with `afwe turn begin \"…\"`.\n");
    out
}
