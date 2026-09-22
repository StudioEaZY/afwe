//! Passive guardrails: micro‑context retrieval.
//!
//! "I'm working on widget.tsx; what project context applies here?"
//! → nodes, memories, guardrails, constraints, relations, contract – nothing else.

use crate::analyze::build_globset;
use crate::engine::Snapshot;
use crate::model::*;
use crate::util::truncate;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ContextQuery {
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub symbol: Option<String>,
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub task: Option<String>,
    /// code | bugfix | refactor | architecture | workflow | feature
    #[serde(default)]
    pub task_kind: Option<String>,
    /// include full memory bodies (default: trimmed)
    #[serde(default)]
    pub full: bool,
    #[serde(default)]
    pub include_superseded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CtxNode {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: String,
    pub purpose: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    /// direct | inherited
    pub relation: String,
    pub via: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CtxMemory {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub status: Option<String>,
    pub path: String,
    pub why: Vec<String>,
    pub body: String,
    pub tags: Vec<String>,
    pub rank: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CtxGuardrail {
    pub id: String,
    pub mode: String,
    pub statement: String,
    pub reason: Option<String>,
    pub exceptions: Vec<String>,
    pub exception_applies_here: bool,
    pub scope: Vec<String>,
    pub checks: Vec<String>,
    pub memory: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CtxRelation {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub status: String,
    pub rationale: Option<String>,
    pub evidence_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CtxConstraint {
    pub id: String,
    pub rule: String,
    pub from: String,
    pub to: Vec<String>,
    pub except: Vec<String>,
    pub severity: String,
    pub description: Option<String>,
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CtxCode {
    pub imports: Vec<String>,
    pub imported_by: Vec<String>,
    pub externals: Vec<String>,
    pub symbols: Vec<String>,
    pub node_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextBundle {
    pub query: ContextQuery,
    pub sync: String,
    pub nodes: Vec<CtxNode>,
    pub memory: Vec<CtxMemory>,
    pub guardrails: Vec<CtxGuardrail>,
    pub relations: Vec<CtxRelation>,
    pub constraints: Vec<CtxConstraint>,
    pub code: CtxCode,
    pub contract: Option<Contract>,
    pub workflows: Vec<String>,
    pub warnings: Vec<String>,
    pub markdown: String,
}

fn glob_match(patterns: &[String], file: &str) -> Option<String> {
    for p in patterns {
        let p = p.trim_start_matches("./");
        if p == file {
            return Some(p.to_string());
        }
        if crate::util::is_glob(p) {
            if let Ok(gs) = build_globset(&[p.to_string()]) {
                if gs.is_match(file) {
                    return Some(p.to_string());
                }
            }
        } else if file.starts_with(&format!("{}/", p.trim_end_matches('/'))) {
            return Some(p.to_string());
        }
    }
    None
}

fn scope_matches(scope: &Scope, snap: &Snapshot, chain: &[String], files: &[String]) -> Option<String> {
    if scope.global {
        return Some("global".into());
    }
    for r in &scope.nodes {
        if let Some(id) = snap.table.resolve(r) {
            if chain.contains(&id) {
                return Some(format!("node {}", snap.table.path_of(&id)));
            }
        }
    }
    for l in &scope.lenses {
        if let Some(lens) = snap.sources.lenses.iter().find(|x| &x.id == l || &x.name == l) {
            let ids = crate::lens::lens_node_ids(lens, &snap.table);
            if chain.iter().any(|c| ids.contains(c)) {
                return Some(format!("lens {}", lens.name));
            }
        }
    }
    for f in files {
        if let Some(p) = glob_match(&scope.files, f) {
            return Some(format!("file {p}"));
        }
    }
    for t in &scope.tags {
        if chain.iter().any(|c| snap.table.nodes.get(c).map(|n| n.tags.contains(t)).unwrap_or(false)) {
            return Some(format!("tag {t}"));
        }
    }
    None
}

pub fn build_context(snap: &Snapshot, q: ContextQuery, sync: &str) -> ContextBundle {
    let mut warnings = vec![];
    let mut direct: Vec<(String, Vec<String>)> = vec![]; // node id, via
    let mut files: Vec<String> = q.files.iter().map(|f| f.trim_start_matches("./").to_string()).collect();

    if let Some(sym) = &q.symbol {
        // symbol may be `file::Q` or just `Q`
        let hits: Vec<&SymbolInfo> = snap.index.symbols.values().filter(|s| &s.id == sym || &s.qualified == sym || s.qualified.ends_with(&format!(".{sym}")) || &s.name == sym).collect();
        if hits.is_empty() {
            warnings.push(format!("symbol `{sym}` not found in index"));
        }
        for h in hits {
            if !files.contains(&h.file) {
                files.push(h.file.clone());
            }
            if let Some(n) = snap.mapping.symbols.get(&h.id) {
                direct.push((n.clone(), vec![format!("symbol {}", h.id)]));
            }
        }
    }
    for f in &files {
        match snap.mapping.files.get(f) {
            Some(claims) if !claims.is_empty() => {
                for c in claims {
                    direct.push((c.node.clone(), vec![format!("{} via {}", f, c.via)]));
                }
            }
            _ => {
                if snap.index.files.contains_key(f) {
                    warnings.push(format!("`{f}` is not mapped to any blueprint node yet (unmapped file: architecture has no home for it). Run `afwe drift` or map it with `afwe blueprint map <node> {f}`."));
                } else {
                    warnings.push(format!("`{f}` is not in the code index (new file? run `afwe sync`)."));
                }
            }
        }
    }
    if let Some(nref) = &q.node {
        match snap.table.resolve(nref) {
            Some(id) => direct.push((id, vec!["requested".into()])),
            None => warnings.push(format!("unknown node `{nref}`")),
        }
    }
    // merge duplicates
    let mut merged: Vec<(String, Vec<String>)> = vec![];
    for (id, via) in direct {
        if let Some(e) = merged.iter_mut().find(|(i, _)| *i == id) {
            e.1.extend(via);
        } else {
            merged.push((id, via));
        }
    }
    // chain = direct nodes + ancestors
    let mut chain: Vec<String> = vec![];
    let mut nodes: Vec<CtxNode> = vec![];
    for (id, via) in &merged {
        if let Some(n) = snap.table.get(id) {
            chain.push(id.clone());
            nodes.push(CtxNode { id: n.id.clone(), path: n.path.clone(), name: n.name.clone(), kind: n.kind.clone(), purpose: n.purpose.clone(), description: n.description.clone(), status: n.status.clone(), relation: "direct".into(), via: via.clone() });
        }
    }
    for (id, _) in &merged {
        for a in snap.table.ancestors(id) {
            if !chain.contains(&a) {
                chain.push(a.clone());
                let n = &snap.table.nodes[&a];
                nodes.push(CtxNode { id: n.id.clone(), path: n.path.clone(), name: n.name.clone(), kind: n.kind.clone(), purpose: n.purpose.clone(), description: n.description.clone(), status: n.status.clone(), relation: "inherited".into(), via: vec![format!("ancestor of {}", snap.table.path_of(id))] });
            }
        }
    }
    let direct_ids: Vec<String> = merged.iter().map(|(i, _)| i.clone()).collect();

    // memory
    let mut memory: Vec<CtxMemory> = vec![];
    for m in &snap.sources.memory {
        if !q.include_superseded && m.meta.status.as_deref() == Some("superseded") {
            continue;
        }
        let mut why = vec![];
        let mut rank = 9u8;
        for s in &m.meta.symbols {
            if let Some(sym) = &q.symbol {
                if s == sym || s.ends_with(&format!("::{sym}")) || s.ends_with(&format!(".{sym}")) {
                    why.push(format!("symbol {s}"));
                    rank = rank.min(0);
                }
            }
            if let Some((sf, _)) = s.split_once("::") {
                if files.iter().any(|f| f == sf) && why.is_empty() {
                    why.push(format!("symbol in file: {s}"));
                    rank = rank.min(2);
                }
            }
        }
        for f in &files {
            if let Some(p) = glob_match(&m.meta.files, f) {
                why.push(format!("file {p}"));
                rank = rank.min(1);
            }
        }
        for r in &m.meta.applies_to {
            if let Some(id) = snap.table.resolve(r) {
                if direct_ids.contains(&id) {
                    why.push(format!("applies to {}", snap.table.path_of(&id)));
                    rank = rank.min(3);
                } else if chain.contains(&id) {
                    why.push(format!("inherited from {}", snap.table.path_of(&id)));
                    rank = rank.min(4);
                }
            }
        }
        if why.is_empty() {
            continue;
        }
        why.dedup();
        let body = if q.full { m.body.trim().to_string() } else { truncate(m.body.trim(), 700) };
        memory.push(CtxMemory { id: m.meta.id.clone(), kind: m.meta.kind.clone(), title: m.meta.title.clone(), status: m.meta.status.clone(), path: format!(".afwe/{}", m.path), why, body, tags: m.meta.tags.clone(), rank });
    }
    memory.sort_by(|a, b| a.rank.cmp(&b.rank).then(a.kind.cmp(&b.kind)).then(a.id.cmp(&b.id)));

    // guardrails
    let mut guardrails = vec![];
    for g in &snap.sources.guardrails {
        if g.status.as_deref() == Some("retired") {
            continue;
        }
        let Some(hit) = scope_matches(&g.scope, snap, &chain, &files) else { continue };
        let exception_applies_here = scope_matches(&g.exception_scope, snap, &chain, &files).is_some();
        let checks = g
            .checks
            .iter()
            .map(|c| match c.kind.as_str() {
                "command" => format!("command `{}`{}", c.run.clone().unwrap_or_default(), c.when.as_ref().map(|w| format!(" ({w})")).unwrap_or_default()),
                "forbid_import" => format!("forbid imports into {:?}", c.to_nodes),
                "forbid_pattern" => format!("forbid pattern /{}/ in {:?}", c.pattern.clone().unwrap_or_default(), c.files),
                "require_pattern" => format!("require pattern /{}/ in {:?}", c.pattern.clone().unwrap_or_default(), c.files),
                "require_file" => format!("require file {}", c.path.clone().unwrap_or_default()),
                other => other.to_string(),
            })
            .collect();
        let mut scope = vec![hit];
        scope.extend(g.scope.nodes.iter().filter_map(|r| snap.table.resolve(r)).map(|id| snap.table.path_of(&id)));
        scope.dedup();
        guardrails.push(CtxGuardrail { id: g.id.clone(), mode: g.mode.clone(), statement: g.statement.clone(), reason: g.reason.clone(), exceptions: g.exceptions.clone(), exception_applies_here, scope, checks, memory: g.memory.clone() });
    }

    // relations (declared) + inferred edges
    let mut relations = vec![];
    for r in &snap.sources.relations.relations {
        let (Some(f), Some(t)) = (snap.table.resolve(&r.from), snap.table.resolve(&r.to)) else { continue };
        if chain.contains(&f) || chain.contains(&t) {
            let ev = snap.index.node_edges.get(&f).and_then(|m| m.get(&t)).copied().unwrap_or(0);
            relations.push(CtxRelation { from: snap.table.path_of(&f), to: snap.table.path_of(&t), kind: r.kind.clone(), status: r.status.clone(), rationale: r.rationale.clone(), evidence_count: ev });
        }
    }
    for (a, m) in &snap.index.node_edges {
        for (b, c) in m {
            if direct_ids.contains(a) || direct_ids.contains(b) {
                let declared = snap.sources.relations.relations.iter().any(|r| snap.table.resolve(&r.from).as_deref() == Some(a) && snap.table.resolve(&r.to).as_deref() == Some(b));
                if !declared {
                    relations.push(CtxRelation { from: snap.table.path_of(a), to: snap.table.path_of(b), kind: "depends_on".into(), status: "undeclared".into(), rationale: None, evidence_count: *c });
                }
            }
        }
    }

    // constraints touching the chain
    let mut constraints = vec![];
    for c in &snap.sources.constraints.constraints {
        let from = snap.table.resolve(&c.from);
        let tos: Vec<String> = c.to.iter().filter_map(|r| snap.table.resolve(r)).collect();
        let touches = from.as_ref().map(|f| chain.contains(f)).unwrap_or(false) || tos.iter().any(|t| chain.contains(t));
        if touches {
            constraints.push(CtxConstraint { id: c.id.clone(), rule: c.rule.clone(), from: from.map(|f| snap.table.path_of(&f)).unwrap_or(c.from.clone()), to: tos.iter().map(|t| snap.table.path_of(t)).collect(), except: c.except.clone(), severity: c.severity.clone(), description: c.description.clone(), rationale: c.rationale.clone() });
        }
    }

    // code neighbourhood
    let mut code = CtxCode::default();
    for f in &files {
        if let Some(e) = snap.index.files.get(f) {
            code.imports.extend(e.imports.iter().cloned());
            code.externals.extend(e.externals.iter().cloned());
            code.symbols.extend(e.symbols.iter().cloned());
        }
        for (other, e) in &snap.index.files {
            if e.imports.iter().any(|i| i == f) {
                code.imported_by.push(other.clone());
            }
        }
    }
    for id in &direct_ids {
        if let Some(n) = snap.index.nodes.get(id) {
            code.node_files.extend(n.files.iter().take(25).cloned());
        }
    }
    for v in [&mut code.imports, &mut code.imported_by, &mut code.externals, &mut code.symbols, &mut code.node_files] {
        v.sort();
        v.dedup();
    }

    // workflows targeting these nodes
    let workflows: Vec<String> = snap
        .sources
        .workflows
        .iter()
        .filter(|w| w.targets.iter().filter_map(|t| snap.table.resolve(t)).any(|t| chain.contains(&t)) || w.nodes.iter().any(|n| n.maps_to.as_ref().map(|m| m.files.iter().any(|f| files.contains(f)) || m.nodes.iter().filter_map(|r| snap.table.resolve(r)).any(|r| direct_ids.contains(&r))).unwrap_or(false)))
        .map(|w| format!("{} ({}, {})", w.title, w.id, w.status))
        .collect();

    let contract = crate::contract::select_contract(&snap.sources.contracts, q.task_kind.as_deref().unwrap_or("code"));

    let mut bundle = ContextBundle { query: q, sync: sync.to_string(), nodes, memory, guardrails, relations, constraints, code, contract, workflows, warnings, markdown: String::new() };
    bundle.markdown = render_markdown(&bundle);
    bundle
}

pub fn render_markdown(b: &ContextBundle) -> String {
    let mut s = String::new();
    let subject = if !b.query.files.is_empty() {
        b.query.files.join(", ")
    } else if let Some(sym) = &b.query.symbol {
        sym.clone()
    } else if let Some(n) = &b.query.node {
        n.clone()
    } else {
        "project".into()
    };
    s.push_str(&format!("# AFWE context — {subject}\n"));
    s.push_str(&format!("_sync: {}_\n\n", b.sync));
    if let Some(t) = &b.query.task {
        s.push_str(&format!("Task: {t}\n\n"));
    }
    for w in &b.warnings {
        s.push_str(&format!("> ⚠ {w}\n"));
    }
    if !b.warnings.is_empty() {
        s.push('\n');
    }
    s.push_str("## Where this lives\n");
    if b.nodes.is_empty() {
        s.push_str("- (no blueprint node) — this code has no architectural home yet.\n");
    }
    for n in &b.nodes {
        let tag = if n.relation == "direct" { "" } else { " _(inherited)_" };
        s.push_str(&format!("- **{}** `{}` ({}){}", n.path, n.id, n.kind, tag));
        if let Some(st) = &n.status {
            s.push_str(&format!(" [{st}]"));
        }
        s.push('\n');
        if let Some(p) = &n.purpose {
            s.push_str(&format!("  - why: {p}\n"));
        }
        if let Some(d) = &n.description {
            s.push_str(&format!("  - what: {}\n", truncate(d, 300)));
        }
    }
    s.push('\n');
    if !b.memory.is_empty() {
        s.push_str("## Relevant architectural context\n");
        for kind in ["decision", "exception", "constraint", "terminology", "problem"] {
            let items: Vec<&CtxMemory> = b.memory.iter().filter(|m| m.kind == kind).collect();
            if items.is_empty() {
                continue;
            }
            s.push_str(&format!("### {}\n", crate::store::plural(kind)));
            for m in items {
                s.push_str(&format!("- **{}** `{}`{} — {}\n", m.title, m.id, m.status.as_ref().map(|x| format!(" [{x}]")).unwrap_or_default(), m.why.join("; ")));
                for line in m.body.lines().filter(|l| !l.trim().is_empty()) {
                    s.push_str(&format!("  > {}\n", line.trim()));
                }
            }
        }
        s.push('\n');
    }
    if !b.guardrails.is_empty() {
        s.push_str("## Guardrails in scope\n");
        for g in &b.guardrails {
            s.push_str(&format!("- [{}] **{}** — {}\n", g.mode, g.id, g.statement));
            if let Some(r) = &g.reason {
                s.push_str(&format!("  - reason: {r}\n"));
            }
            if !g.exceptions.is_empty() {
                s.push_str(&format!("  - exception{}: {}\n", if g.exception_applies_here { " (APPLIES HERE)" } else { "" }, g.exceptions.join("; ")));
            }
            if !g.checks.is_empty() {
                s.push_str(&format!("  - enforced by: {}\n", g.checks.join("; ")));
            }
        }
        s.push('\n');
    }
    if !b.constraints.is_empty() {
        s.push_str("## Structural rules\n");
        for c in &b.constraints {
            let rule = match c.rule.as_str() {
                "must_not_depend" => format!("**{}** must not depend on {}", c.from, c.to.join(", ")),
                "may_depend_only" => format!("**{}** may only depend on {}", c.from, c.except.join(", ")),
                other => format!("{other}: {} → {}", c.from, c.to.join(", ")),
            };
            s.push_str(&format!("- {rule} (`{}`, {})", c.id, c.severity));
            if let Some(d) = c.description.as_ref().or(c.rationale.as_ref()) {
                s.push_str(&format!(" — {d}"));
            }
            s.push('\n');
        }
        s.push('\n');
    }
    if !b.relations.is_empty() {
        s.push_str("## Relationships\n");
        for r in &b.relations {
            let mut line = format!("- {} → {} → {} [{}]", r.from, r.kind, r.to, r.status);
            if r.evidence_count > 0 {
                line.push_str(&format!(" ({} import edge{})", r.evidence_count, if r.evidence_count == 1 { "" } else { "s" }));
            }
            if let Some(why) = &r.rationale {
                line.push_str(&format!(" — {why}"));
            }
            s.push_str(&line);
            s.push('\n');
        }
        s.push('\n');
    }
    if !b.code.imports.is_empty() || !b.code.imported_by.is_empty() || !b.code.symbols.is_empty() {
        s.push_str("## Code neighbourhood\n");
        if !b.code.symbols.is_empty() {
            s.push_str(&format!("- symbols: {}\n", b.code.symbols.iter().map(|x| x.split("::").last().unwrap_or(x)).take(30).collect::<Vec<_>>().join(", ")));
        }
        if !b.code.imports.is_empty() {
            s.push_str(&format!("- imports: {}\n", b.code.imports.join(", ")));
        }
        if !b.code.imported_by.is_empty() {
            s.push_str(&format!("- imported by: {}\n", b.code.imported_by.join(", ")));
        }
        if !b.code.externals.is_empty() {
            s.push_str(&format!("- external packages: {}\n", b.code.externals.join(", ")));
        }
        s.push('\n');
    }
    if !b.workflows.is_empty() {
        s.push_str("## Related workflows\n");
        for w in &b.workflows {
            s.push_str(&format!("- {w}\n"));
        }
        s.push('\n');
    }
    if let Some(c) = &b.contract {
        s.push_str(&format!("## Contract: {} (`{}`)\n", c.name, c.id));
        for (i, st) in c.steps.iter().enumerate() {
            s.push_str(&format!("{}. [{}] {}{}\n", i + 1, st.phase, st.instruction, if st.optional { " _(optional)_" } else { "" }));
        }
    }
    s
}

/// Nodes touched by a set of files (used by verify/board).
pub fn nodes_for_files(snap: &Snapshot, files: &[String]) -> Vec<String> {
    let mut set = BTreeSet::new();
    for f in files {
        for n in snap.mapping.nodes_of(f) {
            set.insert(n);
        }
    }
    set.into_iter().collect()
}
