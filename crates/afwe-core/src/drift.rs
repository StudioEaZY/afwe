//! Drift detection: AFWE detects disagreement between the blueprint and the code;
//! it does not invent agreement. Confidence decides how much intervention is needed.

use crate::engine::{Engine, Snapshot};
use crate::mapping::{find_node_mut, NodeTable};
use crate::model::*;
use crate::util::{clamp01, hash_str, now};
use anyhow::{anyhow, Result};
use std::collections::{BTreeMap, HashMap, HashSet};

fn dir_of(f: &str) -> &str {
    match f.rfind('/') {
        Some(i) => &f[..i],
        None => "",
    }
}

fn basename(f: &str) -> &str {
    f.rsplit('/').next().unwrap_or(f)
}

fn fid(kind: &str, key: &str) -> String {
    format!("{kind}:{}", &hash_str(key)[..10])
}

/// Files that are code‑like enough to expect an architectural home.
fn expects_home(f: &FileInfo) -> bool {
    !matches!(f.language.as_str(), "other" | "json" | "yaml" | "toml" | "markdown" | "shell")
        && !basename(&f.path).starts_with('.')
}

pub fn detect(snap: &Snapshot, only_files: Option<&[String]>) -> Vec<Finding> {
    let mut out = vec![];
    let table = &snap.table;
    let only: Option<HashSet<&str>> = only_files.map(|v| v.iter().map(|s| s.as_str()).collect());
    let file_set: HashSet<&str> = snap.code.files.iter().map(|f| f.path.as_str()).collect();

    // ── 1. unmapped files ──
    let by_dir: HashMap<&str, Vec<&FileInfo>> = {
        let mut m: HashMap<&str, Vec<&FileInfo>> = HashMap::new();
        for f in &snap.code.files {
            m.entry(dir_of(&f.path)).or_default().push(f);
        }
        m
    };
    if !table.nodes.is_empty() {
        for f in &snap.code.files {
            if let Some(o) = &only {
                if !o.contains(f.path.as_str()) {
                    continue;
                }
            }
            if !expects_home(f) || snap.mapping.primary(&f.path).is_some() {
                continue;
            }
            let (change, conf, evidence) = suggest_home(snap, f, &by_dir);
            out.push(Finding {
                id: fid("unmapped", &f.path),
                kind: "unmapped_file".into(),
                severity: "warn".into(),
                confidence: conf,
                summary: match &change {
                    Some(Change::MapFile { node, .. }) => format!("`{}` has no blueprint home; best fit: {}", f.path, table.path_of(node)),
                    Some(Change::CreateNode { name, .. }) => format!("`{}` has no blueprint home; maybe a new node `{}`", f.path, name),
                    _ => format!("`{}` has no blueprint home", f.path),
                },
                evidence,
                change,
                nodes: vec![],
                files: vec![f.path.clone()],
            });
        }
    }

    // ── 2. dangling explicit file mappings (moved / deleted / renamed) ──
    let fp_index: HashMap<&str, Vec<&SymbolInfo>> = {
        let mut m: HashMap<&str, Vec<&SymbolInfo>> = HashMap::new();
        for f in &snap.code.files {
            for s in &f.symbols {
                m.entry(s.fingerprint.as_str()).or_default().push(s);
            }
        }
        m
    };
    for (node, entry) in &snap.mapping.dangling_files {
        // find rename candidates: same basename, or files sharing symbol fingerprints previously indexed
        let base = basename(entry);
        let mut cands: BTreeMap<String, (f64, Vec<String>)> = BTreeMap::new();
        for f in &snap.code.files {
            if basename(&f.path) == base && !file_set.contains(entry.as_str()) {
                let e = cands.entry(f.path.clone()).or_insert((0.0, vec![]));
                e.0 += 0.55;
                e.1.push("same file name".into());
                if dir_of(&f.path).split('/').last() == dir_of(entry).split('/').last() {
                    e.0 += 0.15;
                    e.1.push("same parent directory name".into());
                }
            }
        }
        // previously indexed symbols of the old path (from the last persisted index)
        if let Some(old_syms) = snap_prev_symbols(snap, entry) {
            for (fp, q) in old_syms {
                if let Some(hits) = fp_index.get(fp.as_str()) {
                    for h in hits {
                        let e = cands.entry(h.file.clone()).or_insert((0.0, vec![]));
                        e.0 += 0.2;
                        e.1.push(format!("symbol `{q}` moved here (fingerprint match)"));
                    }
                }
            }
        }
        let best = cands.into_iter().max_by(|a, b| a.1 .0.partial_cmp(&b.1 .0).unwrap());
        match best {
            Some((to, (score, ev))) if score >= 0.5 => out.push(Finding {
                id: fid("missing", &format!("{node}:{entry}")),
                kind: "missing_file".into(),
                severity: "warn".into(),
                confidence: clamp01(score),
                summary: format!("`{entry}` (mapped to {}) is gone; looks like it moved to `{to}`", table.path_of(node)),
                evidence: ev,
                change: Some(Change::RemapFile { node: node.clone(), from: entry.clone(), to }),
                nodes: vec![node.clone()],
                files: vec![entry.clone()],
            }),
            _ => out.push(Finding {
                id: fid("missing", &format!("{node}:{entry}")),
                kind: "missing_file".into(),
                severity: "warn".into(),
                confidence: 0.4,
                summary: format!("`{entry}` (mapped to {}) no longer exists", table.path_of(node)),
                evidence: vec!["no rename candidate found".into()],
                change: Some(Change::UnmapFile { node: node.clone(), file: entry.clone() }),
                nodes: vec![node.clone()],
                files: vec![entry.clone()],
            }),
        }
    }

    // ── 3. dangling symbol mappings ──
    for (node, sym) in &snap.mapping.dangling_symbols {
        let q = sym.split("::").last().unwrap_or(sym);
        let same_name: Vec<&SymbolInfo> = snap.index.symbols.values().filter(|s| s.qualified == q).collect();
        if same_name.len() == 1 {
            out.push(Finding {
                id: fid("missing_symbol", &format!("{node}:{sym}")),
                kind: "missing_symbol".into(),
                severity: "warn".into(),
                confidence: 0.75,
                summary: format!("symbol `{sym}` (mapped to {}) not found; `{}` has the same identity", table.path_of(node), same_name[0].id),
                evidence: vec![format!("structural identity {}", same_name[0].structural)],
                change: Some(Change::RemapSymbol { node: node.clone(), from: sym.clone(), to: same_name[0].id.clone() }),
                nodes: vec![node.clone()],
                files: vec![],
            });
        } else {
            out.push(Finding {
                id: fid("missing_symbol", &format!("{node}:{sym}")),
                kind: "missing_symbol".into(),
                severity: "warn".into(),
                confidence: 0.4,
                summary: format!("symbol `{sym}` (mapped to {}) not found in code", table.path_of(node)),
                evidence: if same_name.is_empty() { vec!["no symbol with that name exists".into()] } else { same_name.iter().map(|s| format!("candidate {}", s.id)).collect() },
                change: Some(Change::UnmapSymbol { node: node.clone(), symbol: sym.clone() }),
                nodes: vec![node.clone()],
                files: vec![],
            });
        }
    }

    // ── 4. undeclared relations (import edges without a declared relation) ──
    let declared: HashSet<(String, String)> = snap
        .sources
        .relations
        .relations
        .iter()
        .filter_map(|r| Some((table.resolve(&r.from)?, table.resolve(&r.to)?)))
        .collect();
    let covers = |declared_from: &str, declared_to: &str, a: &str, b: &str| table.is_ancestor_or_same(declared_from, a) && table.is_ancestor_or_same(declared_to, b);
    for (a, m) in &snap.index.node_edges {
        for (b, count) in m {
            if let Some(o) = &only {
                // only report when one of the touched files participates
                let touched = snap.code.files.iter().filter(|f| o.contains(f.path.as_str())).any(|f| snap.mapping.primary(&f.path) == Some(a.as_str()) || f.resolved_imports.iter().any(|i| snap.mapping.primary(i) == Some(b.as_str())));
                if !touched {
                    continue;
                }
            }
            if declared.iter().any(|(df, dt)| covers(df, dt, a, b)) {
                continue;
            }
            if violates_constraint(snap, a, b).is_some() {
                continue; // reported by verify as a violation, never auto‑reconciled
            }
            let conf = clamp01(0.55 + 0.1 * (*count as f64)).min(0.95);
            let evidence = edge_evidence(snap, a, b, 5);
            out.push(Finding {
                id: fid("undeclared", &format!("{a}->{b}")),
                kind: "undeclared_relation".into(),
                severity: "info".into(),
                confidence: conf,
                summary: format!("code shows {} → {} ({} import edge{}) but the blueprint does not declare it", table.path_of(a), table.path_of(b), count, if *count == 1 { "" } else { "s" }),
                evidence,
                change: Some(Change::AddRelation { from: a.clone(), to: b.clone(), kind: "depends_on".into() }),
                nodes: vec![a.clone(), b.clone()],
                files: vec![],
            });
        }
    }

    // ── 5. declared relations without evidence (only when both sides have code) ──
    if only.is_none() {
        for r in &snap.sources.relations.relations {
            let (Some(f), Some(t)) = (table.resolve(&r.from), table.resolve(&r.to)) else {
                out.push(Finding { id: fid("broken_rel", &format!("{}->{}", r.from, r.to)), kind: "broken_reference".into(), severity: "warn".into(), confidence: 1.0, summary: format!("relation {} → {} references an unknown node", r.from, r.to), evidence: vec![], change: None, nodes: vec![], files: vec![] });
                continue;
            };
            if r.kind != "depends_on" && r.kind != "uses" && r.kind != "calls" {
                continue;
            }
            let has_files = |id: &str| snap.index.nodes.get(id).map(|n| !n.files.is_empty()).unwrap_or(false) || table.descendants(id).iter().any(|d| snap.index.nodes.get(d).map(|n| !n.files.is_empty()).unwrap_or(false));
            if !has_files(&f) || !has_files(&t) {
                continue;
            }
            // containment is structural, not a dependency edge: never flag parent ↔ child relations
            if table.is_ancestor_or_same(&f, &t) || table.is_ancestor_or_same(&t, &f) {
                continue;
            }
            let evidence: usize = snap.index.node_edges.iter().filter(|(a, _)| table.is_ancestor_or_same(&f, a)).flat_map(|(_, m)| m.iter()).filter(|(b, _)| table.is_ancestor_or_same(&t, b)).map(|(_, c)| *c).sum();
            if evidence == 0 && r.status == "declared" {
                out.push(Finding {
                    id: fid("unsupported", &format!("{f}->{t}")),
                    kind: "unsupported_relation".into(),
                    severity: "info".into(),
                    confidence: 0.3,
                    summary: format!("blueprint declares {} → {} but no import edge supports it (planned, or stale?)", table.path_of(&f), table.path_of(&t)),
                    evidence: vec![],
                    change: Some(Change::RemoveRelation { from: f.clone(), to: t.clone() }),
                    nodes: vec![f.clone(), t.clone()],
                    files: vec![],
                });
            }
        }
        // ── 6. empty active nodes ──
        for id in table.ids() {
            let n = &table.nodes[id];
            let status = n.status.as_deref().unwrap_or("active");
            if status != "active" || !n.children.is_empty() {
                continue;
            }
            let has_files = snap.index.nodes.get(id).map(|e| !e.files.is_empty()).unwrap_or(false);
            if !has_files && !n.implements.is_empty() {
                continue; // dangling handled above
            }
            if !has_files && n.implements.is_empty() && n.depth > 0 {
                out.push(Finding { id: fid("empty", id), kind: "empty_node".into(), severity: "info".into(), confidence: 1.0, summary: format!("{} is active but nothing implements it (mark it `planned` or map files)", n.path), evidence: vec![], change: None, nodes: vec![id.clone()], files: vec![] });
            }
        }
        // ── 7. stale memory references ──
        for m in &snap.sources.memory {
            let mut problems = vec![];
            for r in &m.meta.applies_to {
                if table.resolve(r).is_none() {
                    problems.push(format!("unknown node `{r}`"));
                }
            }
            for f in &m.meta.files {
                if !crate::util::is_glob(f) && !file_set.contains(f.trim_start_matches("./")) && !snap.code.files.iter().any(|x| x.path.starts_with(&format!("{}/", f.trim_end_matches('/')))) {
                    problems.push(format!("missing file `{f}`"));
                }
            }
            for s in &m.meta.symbols {
                if !snap.index.symbols.contains_key(s) {
                    problems.push(format!("missing symbol `{s}`"));
                }
            }
            if !problems.is_empty() {
                out.push(Finding { id: fid("stale_memory", &m.meta.id), kind: "stale_memory".into(), severity: "info".into(), confidence: 1.0, summary: format!("memory `{}` references things that no longer exist", m.meta.id), evidence: problems, change: None, nodes: vec![], files: vec![m.path.clone()] });
            }
        }
        // ── 8. guardrail / constraint references ──
        for g in &snap.sources.guardrails {
            for r in &g.scope.nodes {
                if table.resolve(r).is_none() {
                    out.push(Finding { id: fid("broken_guardrail", &format!("{}:{r}", g.id)), kind: "broken_reference".into(), severity: "warn".into(), confidence: 1.0, summary: format!("guardrail `{}` scope references unknown node `{r}`", g.id), evidence: vec![], change: None, nodes: vec![], files: vec![] });
                }
            }
        }
        for c in &snap.sources.constraints.constraints {
            for r in std::iter::once(&c.from).chain(c.to.iter()).chain(c.except.iter()) {
                if table.resolve(r).is_none() {
                    out.push(Finding { id: fid("broken_constraint", &format!("{}:{r}", c.id)), kind: "broken_reference".into(), severity: "warn".into(), confidence: 1.0, summary: format!("constraint `{}` references unknown node `{r}`", c.id), evidence: vec![], change: None, nodes: vec![], files: vec![] });
                }
            }
        }
    }
    out
}

/// Symbols of a path as recorded in the last persisted index (fingerprint, qualified).
fn snap_prev_symbols(snap: &Snapshot, path: &str) -> Option<Vec<(String, String)>> {
    let _ = snap;
    PREV_INDEX.with(|p| p.borrow().as_ref().and_then(|idx| idx.files.get(path).map(|e| e.symbols.iter().filter_map(|s| idx.symbols.get(s)).map(|s| (s.fingerprint.clone(), s.qualified.clone())).collect())))
}

thread_local! {
    static PREV_INDEX: std::cell::RefCell<Option<Index>> = const { std::cell::RefCell::new(None) };
}

/// Provide the previously persisted index so rename detection can use old fingerprints.
pub fn set_previous_index(idx: Option<Index>) {
    PREV_INDEX.with(|p| *p.borrow_mut() = idx);
}

fn suggest_home(snap: &Snapshot, f: &FileInfo, by_dir: &HashMap<&str, Vec<&FileInfo>>) -> (Option<Change>, f64, Vec<String>) {
    let table = &snap.table;
    let dir = dir_of(&f.path);
    let mut evidence = vec![];
    // siblings
    let siblings: Vec<&FileInfo> = by_dir.get(dir).map(|v| v.iter().copied().filter(|s| s.path != f.path).collect()).unwrap_or_default();
    let mut votes: BTreeMap<String, usize> = BTreeMap::new();
    let mut mapped_siblings = 0;
    for s in &siblings {
        if let Some(n) = snap.mapping.primary(&s.path) {
            *votes.entry(n.to_string()).or_default() += 1;
            mapped_siblings += 1;
        }
    }
    if mapped_siblings > 0 {
        let (best, n) = votes.iter().max_by_key(|(_, c)| **c).map(|(k, c)| (k.clone(), *c)).unwrap();
        let share = n as f64 / mapped_siblings as f64;
        if share >= 0.999 {
            evidence.push(format!("all {n} mapped sibling file(s) in `{dir}/` belong to {}", table.path_of(&best)));
            let conf = if n >= 3 { 0.92 } else if n == 2 { 0.85 } else { 0.78 };
            return (Some(Change::MapFile { node: best, file: f.path.clone() }), conf, evidence);
        } else if share > 0.6 {
            evidence.push(format!("{n}/{mapped_siblings} mapped siblings belong to {}", table.path_of(&best)));
            return (Some(Change::MapFile { node: best, file: f.path.clone() }), 0.62, evidence);
        }
        evidence.push(format!("siblings are split across {} nodes", votes.len()));
    }
    // imports / importers
    let mut ivotes: BTreeMap<String, usize> = BTreeMap::new();
    for i in &f.resolved_imports {
        if let Some(n) = snap.mapping.primary(i) {
            *ivotes.entry(n.to_string()).or_default() += 1;
        }
    }
    for other in &snap.code.files {
        if other.resolved_imports.iter().any(|i| i == &f.path) {
            if let Some(n) = snap.mapping.primary(&other.path) {
                *ivotes.entry(n.to_string()).or_default() += 1;
            }
        }
    }
    if let Some((best, n)) = ivotes.iter().max_by_key(|(_, c)| **c) {
        let total: usize = ivotes.values().sum();
        if *n as f64 / total as f64 > 0.6 {
            evidence.push(format!("{n}/{total} import edges connect it to {}", table.path_of(best)));
            return (Some(Change::MapFile { node: best.clone(), file: f.path.clone() }), 0.55, evidence);
        }
    }
    // directory name resembles a node
    let dirname = dir.rsplit('/').next().unwrap_or("");
    if !dirname.is_empty() {
        if let Some(id) = table.resolve(dirname) {
            evidence.push(format!("directory `{dirname}` matches node {}", table.path_of(&id)));
            return (Some(Change::MapFile { node: id, file: f.path.clone() }), 0.6, evidence);
        }
    }
    // propose a new node under the closest mapped ancestor directory
    let mut parent = None;
    let mut d = dir.to_string();
    while !d.is_empty() {
        if let Some(files) = by_dir.get(d.as_str()) {
            if let Some(n) = files.iter().find_map(|x| snap.mapping.primary(&x.path)) {
                parent = Some(n.to_string());
                break;
            }
        }
        d = dir_of(&d).to_string();
    }
    if parent.is_none() {
        // a product tree has one root: new nodes belong under it, never beside it
        let roots: Vec<&String> = table.ids().iter().filter(|id| table.nodes[*id].parent.is_none()).collect();
        if roots.len() == 1 {
            parent = Some(roots[0].clone());
        }
    }
    let name = if dirname.is_empty() { basename(&f.path).split('.').next().unwrap_or("new").to_string() } else { dirname.to_string() };
    evidence.push("no sibling, import or name evidence".into());
    (Some(Change::CreateNode { parent, name, files: vec![format!("{}/**", dir).trim_start_matches('/').to_string()] }), 0.3, evidence)
}

fn edge_evidence(snap: &Snapshot, a: &str, b: &str, limit: usize) -> Vec<String> {
    let mut ev = vec![];
    for f in &snap.code.files {
        if snap.mapping.primary(&f.path) != Some(a) {
            continue;
        }
        for i in &f.resolved_imports {
            if snap.mapping.primary(i) == Some(b) {
                ev.push(format!("{} → {}", f.path, i));
                if ev.len() >= limit {
                    return ev;
                }
            }
        }
    }
    ev
}

/// Returns the violated constraint id if `a` depending on `b` breaks a rule.
pub fn violates_constraint<'s>(snap: &'s Snapshot, a: &str, b: &str) -> Option<&'s Constraint> {
    let table = &snap.table;
    for c in &snap.sources.constraints.constraints {
        let Some(from) = table.resolve(&c.from) else { continue };
        if !table.is_ancestor_or_same(&from, a) {
            continue;
        }
        let exempt = c.except.iter().filter_map(|r| table.resolve(r)).any(|e| table.is_ancestor_or_same(&e, a) || table.is_ancestor_or_same(&e, b));
        match c.rule.as_str() {
            "must_not_depend" => {
                let forbidden = c.to.iter().filter_map(|r| table.resolve(r)).any(|t| table.is_ancestor_or_same(&t, b));
                if forbidden && !exempt {
                    return Some(c);
                }
            }
            "may_depend_only" => {
                let allowed = c.except.iter().chain(c.to.iter()).filter_map(|r| table.resolve(r)).any(|t| table.is_ancestor_or_same(&t, b));
                // dependencies inside the same subtree are always allowed
                let internal = table.is_ancestor_or_same(&from, b);
                if !allowed && !internal {
                    return Some(c);
                }
            }
            _ => {}
        }
    }
    None
}

// ───────────────────────────── reconciliation ─────────────────────────────

pub struct ReconcileOutcome {
    pub report: DriftReport,
}

/// Apply the confidence policy to findings, mutating the blueprint/relations on disk.
pub fn reconcile(engine: &Engine, snap: &Snapshot, findings: Vec<Finding>, origin: &str) -> Result<ReconcileOutcome> {
    let policy = &snap.manifest.policy;
    let mut blueprint = engine.store.blueprint()?;
    let mut relations = engine.store.relations()?;
    let mut report = DriftReport { generated: now(), ..Default::default() };
    let mut touched_bp = false;
    let mut touched_rel = false;
    for f in findings {
        let Some(change) = f.change.clone() else {
            report.findings.push(f);
            continue;
        };
        let auto = f.confidence >= policy.auto_reconcile_min;
        let soft = !auto && f.confidence >= policy.soft_reconcile_min;
        // CreateNode / RemoveRelation are never applied automatically: structural interpretation
        let structural = matches!(change, Change::CreateNode { .. } | Change::RemoveRelation { .. } | Change::UnmapFile { .. } | Change::UnmapSymbol { .. });
        if (auto || soft) && !structural {
            let applied = apply_change(&mut blueprint, &mut relations, &snap.table, &change, f.confidence, origin)?;
            if applied {
                match &change {
                    Change::AddRelation { .. } | Change::RemoveRelation { .. } => touched_rel = true,
                    _ => touched_bp = true,
                }
                engine.log_entry(LogEntry { ts: now(), origin: format!("{origin}:reconcile"), kind: change_kind(&change).into(), summary: f.summary.clone(), confidence: Some(f.confidence), uncertain: soft, task: None, details: Some(serde_json::to_value(&change)?) })?;
                if soft {
                    report.uncertain.push(f.clone());
                }
                report.applied.push(f);
                continue;
            }
        }
        if policy.create_proposals {
            report.proposed.push(f);
        } else {
            report.findings.push(f);
        }
    }
    if touched_bp {
        engine.store.save_blueprint(&blueprint)?;
    }
    if touched_rel {
        engine.store.save_relations(&relations)?;
    }
    Ok(ReconcileOutcome { report })
}

pub fn change_kind(c: &Change) -> &'static str {
    match c {
        Change::MapFile { .. } => "map_file",
        Change::RemapFile { .. } => "remap_file",
        Change::UnmapFile { .. } => "unmap_file",
        Change::RemapSymbol { .. } => "remap_symbol",
        Change::UnmapSymbol { .. } => "unmap_symbol",
        Change::AddRelation { .. } => "add_relation",
        Change::RemoveRelation { .. } => "remove_relation",
        Change::CreateNode { .. } => "create_node",
        Change::Note { .. } => "note",
    }
}

/// Apply a change to in‑memory blueprint/relations. Returns false if nothing changed.
pub fn apply_change(blueprint: &mut Blueprint, relations: &mut Relations, table: &NodeTable, change: &Change, confidence: f64, origin: &str) -> Result<bool> {
    match change {
        Change::MapFile { node, file } => {
            let n = find_node_mut(&mut blueprint.nodes, node).ok_or_else(|| anyhow!("node {node} not found"))?;
            if n.implements.files.iter().any(|f| f == file) {
                return Ok(false);
            }
            n.implements.files.push(file.clone());
            Ok(true)
        }
        Change::RemapFile { node, from, to } => {
            let n = find_node_mut(&mut blueprint.nodes, node).ok_or_else(|| anyhow!("node {node} not found"))?;
            let mut changed = false;
            for f in n.implements.files.iter_mut() {
                if f == from {
                    *f = to.clone();
                    changed = true;
                }
            }
            n.implements.files.dedup();
            Ok(changed)
        }
        Change::UnmapFile { node, file } => {
            let n = find_node_mut(&mut blueprint.nodes, node).ok_or_else(|| anyhow!("node {node} not found"))?;
            let before = n.implements.files.len();
            n.implements.files.retain(|f| f != file);
            Ok(n.implements.files.len() != before)
        }
        Change::RemapSymbol { node, from, to } => {
            let n = find_node_mut(&mut blueprint.nodes, node).ok_or_else(|| anyhow!("node {node} not found"))?;
            let mut changed = false;
            for s in n.implements.symbols.iter_mut() {
                if s == from {
                    *s = to.clone();
                    changed = true;
                }
            }
            Ok(changed)
        }
        Change::UnmapSymbol { node, symbol } => {
            let n = find_node_mut(&mut blueprint.nodes, node).ok_or_else(|| anyhow!("node {node} not found"))?;
            let before = n.implements.symbols.len();
            n.implements.symbols.retain(|s| s != symbol);
            Ok(n.implements.symbols.len() != before)
        }
        Change::AddRelation { from, to, kind } => {
            if relations.relations.iter().any(|r| table.resolve(&r.from).as_deref() == Some(from) && table.resolve(&r.to).as_deref() == Some(to)) {
                return Ok(false);
            }
            relations.relations.push(Relation { id: None, from: from.clone(), to: to.clone(), kind: kind.clone(), rationale: None, status: "inferred".into(), origin: Some(origin.to_string()), evidence: vec![], confidence: Some(confidence) });
            Ok(true)
        }
        Change::RemoveRelation { from, to } => {
            let before = relations.relations.len();
            relations.relations.retain(|r| !(table.resolve(&r.from).as_deref() == Some(from) && table.resolve(&r.to).as_deref() == Some(to)));
            Ok(relations.relations.len() != before)
        }
        Change::CreateNode { parent, name, files } => {
            let mut ids = vec![];
            crate::mapping::all_ids(&blueprint.nodes, &mut ids);
            let id = crate::mapping::unique_id(&ids, name);
            let node = BlueprintNode { id, name: name.clone(), kind: "module".into(), purpose: None, description: None, implements: Implementation { files: files.clone(), symbols: vec![] }, tags: vec![], status: Some("active".into()), origin: Some(format!("{origin}:inferred")), children: vec![] };
            match parent {
                Some(p) => {
                    let pn = find_node_mut(&mut blueprint.nodes, p).ok_or_else(|| anyhow!("parent {p} not found"))?;
                    pn.children.push(node);
                }
                None => blueprint.nodes.push(node),
            }
            Ok(true)
        }
        Change::Note { .. } => Ok(false),
    }
}

/// Accept / revert / review a pending proposal.
pub fn resolve_proposal(engine: &Engine, snap: &Snapshot, id: &str, action: &str, origin: &str) -> Result<serde_json::Value> {
    let mut proposals = engine.store.proposals()?;
    let idx = proposals.proposals.iter().position(|p| p.id == id || p.id.starts_with(id)).ok_or_else(|| anyhow!("proposal `{id}` not found"))?;
    let p = proposals.proposals[idx].clone();
    match action {
        "accept" => {
            let change = p.finding.change.clone().ok_or_else(|| anyhow!("proposal has no change"))?;
            let mut bp = engine.store.blueprint()?;
            let mut rel = engine.store.relations()?;
            let applied = apply_change(&mut bp, &mut rel, &snap.table, &change, p.finding.confidence, origin)?;
            engine.store.save_blueprint(&bp)?;
            engine.store.save_relations(&rel)?;
            proposals.proposals[idx].status = "accepted".into();
            engine.store.save_proposals(&proposals)?;
            engine.log_entry(LogEntry { ts: now(), origin: origin.into(), kind: change_kind(&change).into(), summary: format!("Accepted proposal: {}", p.finding.summary), confidence: Some(p.finding.confidence), uncertain: false, task: None, details: Some(serde_json::to_value(&change)?) })?;
            Ok(serde_json::json!({"id": p.id, "status": "accepted", "applied": applied}))
        }
        "revert" | "reject" | "dismiss" => {
            proposals.proposals[idx].status = "reverted".into();
            engine.store.save_proposals(&proposals)?;
            engine.log(origin, "proposal_reverted", format!("Reverted proposal: {}", p.finding.summary), None)?;
            Ok(serde_json::json!({"id": p.id, "status": "reverted"}))
        }
        "review" => Ok(review_impact(snap, &p.finding)),
        other => Err(anyhow!("unknown action `{other}` (accept|revert|review)")),
    }
}

/// "Review impact": what would this change touch – memory, guardrails, constraints, files.
pub fn review_impact(snap: &Snapshot, f: &Finding) -> serde_json::Value {
    let mut nodes: Vec<String> = f.nodes.clone();
    if let Some(c) = &f.change {
        match c {
            Change::MapFile { node, .. } | Change::RemapFile { node, .. } | Change::UnmapFile { node, .. } | Change::RemapSymbol { node, .. } | Change::UnmapSymbol { node, .. } => nodes.push(node.clone()),
            Change::AddRelation { from, to, .. } | Change::RemoveRelation { from, to } => {
                nodes.push(from.clone());
                nodes.push(to.clone());
            }
            Change::CreateNode { parent: Some(p), .. } => nodes.push(p.clone()),
            _ => {}
        }
    }
    nodes.sort();
    nodes.dedup();
    let mut chain: Vec<String> = nodes.clone();
    for n in &nodes {
        chain.extend(snap.table.ancestors(n));
    }
    let memory: Vec<_> = snap.sources.memory.iter().filter(|m| m.meta.applies_to.iter().filter_map(|r| snap.table.resolve(r)).any(|id| chain.contains(&id))).map(|m| serde_json::json!({"id": m.meta.id, "kind": m.meta.kind, "title": m.meta.title})).collect();
    let guardrails: Vec<_> = snap.sources.guardrails.iter().filter(|g| g.scope.global || g.scope.nodes.iter().filter_map(|r| snap.table.resolve(r)).any(|id| chain.contains(&id))).map(|g| serde_json::json!({"id": g.id, "mode": g.mode, "statement": g.statement})).collect();
    let constraints: Vec<_> = snap.sources.constraints.constraints.iter().filter(|c| std::iter::once(&c.from).chain(c.to.iter()).filter_map(|r| snap.table.resolve(r)).any(|id| chain.contains(&id))).map(|c| serde_json::json!({"id": c.id, "rule": c.rule, "from": c.from, "to": c.to})).collect();
    let files: Vec<String> = nodes.iter().filter_map(|n| snap.index.nodes.get(n)).flat_map(|n| n.files.iter().cloned()).take(50).collect();
    serde_json::json!({
        "finding": f,
        "nodes": nodes.iter().map(|n| snap.table.path_of(n)).collect::<Vec<_>>(),
        "memory": memory, "guardrails": guardrails, "constraints": constraints, "files": files,
    })
}
