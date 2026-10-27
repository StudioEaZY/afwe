//! Deterministic conflict detection: what a turn touches versus what pins protect, and collateral
//! loss of features. Pins attach to nodes (and their subtrees), files (globs) or symbol ids.

use crate::analyze::build_globset;
use crate::mapping::NodeTable;
use crate::model::{Pin, PinOverride, SymbolInfo};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize)]
pub struct PinConflict {
    pub pin: String,
    pub severity: String,
    pub statement: String,
    pub matched: Vec<String>,
    /// The reason given for an explicit override, if any.
    pub overridden: Option<String>,
}

/// A node and everything beneath it.
pub fn subtree(table: &NodeTable, node: &str) -> Vec<String> {
    let mut v = vec![node.to_string()];
    v.extend(table.descendants(node));
    v
}

/// Active pins that the given touches fall under. `touched_nodes` should already include
/// declared-destructive targets when checking an intent.
pub fn pin_conflicts(
    pins: &[Pin],
    table: &NodeTable,
    touched_nodes: &[String],
    changed_files: &[String],
    changed_symbols: &[String],
    overrides: &[PinOverride],
) -> Vec<PinConflict> {
    let mut out = vec![];
    for p in pins.iter().filter(|p| p.status == "active") {
        let mut matched: BTreeSet<String> = BTreeSet::new();
        for n in &p.attaches.nodes {
            if let Some(id) = table.resolve(n) {
                let cover = subtree(table, &id);
                for t in touched_nodes {
                    if cover.contains(t) {
                        matched.insert(format!("node {t}"));
                    }
                }
            }
        }
        for g in &p.attaches.files {
            if let Ok(gs) = build_globset(&[g.clone()]) {
                for f in changed_files {
                    if gs.is_match(f) {
                        matched.insert(format!("file {f}"));
                    }
                }
            }
        }
        for s in &p.attaches.symbols {
            if changed_symbols.contains(s) {
                matched.insert(format!("symbol {s}"));
            }
        }
        if matched.is_empty() {
            continue;
        }
        let overridden = overrides.iter().find(|o| o.pin == p.id).map(|o| o.reason.clone());
        out.push(PinConflict {
            pin: p.id.clone(),
            severity: p.severity.clone(),
            statement: p.statement.clone(),
            matched: matched.into_iter().collect(),
            overridden,
        });
    }
    out
}

/// Nodes that had a realisation before and have none now, unless the turn declared them removed
/// (or an ancestor of theirs was declared removed). These are the silent collateral losses.
pub fn collateral_loss(before: &BTreeSet<String>, after: &BTreeSet<String>, removed: &[String], table: &NodeTable) -> Vec<String> {
    let declared: Vec<String> = removed.iter().map(|r| table.resolve(r).unwrap_or_else(|| r.clone())).collect();
    before
        .iter()
        .filter(|n| !after.contains(*n))
        .filter(|n| !declared.iter().any(|r| r == *n || table.is_ancestor_or_same(r, n)))
        .cloned()
        .collect()
}

/// Nodes that are still realised but lost some of their files this turn (reported, not blocking).
pub fn partial_loss(before: &BTreeMap<String, Vec<String>>, after: &BTreeMap<String, Vec<String>>, touched: &[String]) -> Vec<String> {
    let mut out = vec![];
    for n in touched {
        if let (Some(b), Some(a)) = (before.get(n), after.get(n)) {
            let gone: Vec<&String> = b.iter().filter(|f| !a.contains(f)).collect();
            if !gone.is_empty() {
                out.push(format!("{n} no longer realised by {}", gone.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
            }
        }
    }
    out
}

/// Recognized entrypoint and root files exempt from orphan and dead-on-arrival checks.
pub fn is_entrypoint_file(f: &str) -> bool {
    let clean = f.trim_start_matches("./");
    let base = clean.rsplit('/').next().unwrap_or(clean);
    matches!(
        base,
        "main.rs"
            | "lib.rs"
            | "main.tsx"
            | "main.ts"
            | "main.jsx"
            | "main.js"
            | "index.tsx"
            | "index.ts"
            | "index.jsx"
            | "index.js"
            | "App.tsx"
            | "App.jsx"
            | "app.py"
            | "__main__.py"
            | "__init__.py"
    ) || clean.starts_with("scripts/")
        || clean.starts_with("tests/")
        || clean.contains("/tests/")
        || clean.starts_with("benches/")
        || clean.contains("/benches/")
        || clean.starts_with("examples/")
        || clean.contains("/examples/")
        || clean.contains("/pages/")
        || clean.ends_with(".astro")
        || clean.ends_with("_test.rs")
        || clean.ends_with(".test.ts")
        || clean.ends_with(".spec.ts")
        || clean.ends_with(".test.js")
        || clean.ends_with(".spec.js")
        || clean.ends_with(".config.js")
        || clean.ends_with(".config.ts")
        || clean.ends_with(".config.mjs")
}

/// Generic identifier names excluded from inbound reference ratcheting to guarantee 0% false positives.
pub const GENERIC_IDENTIFIERS: &[&str] = &[
    "new", "len", "default", "init", "run", "get", "set", "from", "into",
    "as_str", "to_string", "as_ref", "as_mut", "clone", "fmt", "eq", "test",
    "build", "create", "delete", "update", "list", "call", "handle", "execute",
    "start", "stop", "open", "close", "read", "write", "parse", "format",
    "render", "match", "find", "check", "verify", "drop", "clear", "reset",
    "push", "pop", "insert", "remove", "next", "iter", "into_iter", "ok", "err",
    "value", "name", "id", "kind", "status", "path", "root", "file", "data",
    "type", "self", "super", "crate",
];

/// Fast ASCII identifier scanner for over-approximated reference collection.
/// Extracts any identifier sequence [a-zA-Z_][a-zA-Z0-9_]* of length >= 2.
pub fn tokenize_identifiers(src: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let bytes = src.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        let b = bytes[i];
        if b.is_ascii_alphabetic() || b == b'_' {
            let start = i;
            i += 1;
            while i < len && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
            if i - start >= 2 {
                if let Ok(s) = std::str::from_utf8(&bytes[start..i]) {
                    tokens.insert(s.to_string());
                }
            }
        } else {
            i += 1;
        }
    }
    tokens
}

/// Computes inbound reference counts across files using token maps.
pub fn compute_inbound_reference_counts_from_tokens(
    files: &[crate::model::FileInfo],
    file_tokens: &HashMap<String, HashSet<String>>,
) -> BTreeMap<String, usize> {
    let mut out: BTreeMap<String, usize> = BTreeMap::new();
    for f in files {
        for s in &f.symbols {
            if !s.exported {
                continue;
            }
            if GENERIC_IDENTIFIERS.contains(&s.name.as_str()) {
                out.insert(s.id.clone(), 999);
                continue;
            }
            let mut count = 0usize;
            for (path, tokens) in file_tokens {
                if path != &f.path && (tokens.contains(&s.name) || tokens.contains(&s.qualified)) {
                    count += 1;
                }
            }
            out.insert(s.id.clone(), count);
        }
    }
    out
}

/// Computes inbound reference counts across all project files on disk.
pub fn compute_inbound_reference_counts(
    files: &[crate::model::FileInfo],
    root: &Path,
) -> BTreeMap<String, usize> {
    let mut file_tokens: HashMap<String, HashSet<String>> = HashMap::new();
    for f in files {
        let abs = root.join(&f.path);
        if let Ok(src) = std::fs::read_to_string(&abs) {
            file_tokens.insert(f.path.clone(), tokenize_identifiers(&src));
        }
    }
    compute_inbound_reference_counts_from_tokens(files, &file_tokens)
}

/// Files that had incoming imports before this turn and now have 0, without an explicit declaration
/// (either in `removes` or an intent with `action: remove` or `replace`).
/// Entrypoints (main, lib, index, App) are exempt.
pub fn newly_orphaned_files(
    before_importers: &BTreeMap<String, usize>,
    after_importers: &BTreeMap<String, usize>,
    declared_removes: &[String],
    intents: &[crate::model::TurnIntent],
) -> Vec<String> {
    let mut out = vec![];
    let is_declared = |f: &str| -> bool {
        if declared_removes.iter().any(|r| r == f || f.ends_with(r) || r.ends_with(f)) {
            return true;
        }
        for it in intents {
            if matches!(it.action.as_str(), "remove" | "replace") {
                if it.targets.iter().any(|t| t == f || f.ends_with(t) || t.ends_with(f)) {
                    return true;
                }
            }
        }
        false
    };

    for (file, &count) in before_importers {
        if count > 0 && !is_entrypoint_file(file) {
            let now_count = after_importers.get(file).copied().unwrap_or(0);
            if now_count == 0 && !is_declared(file) {
                out.push(file.clone());
            }
        }
    }
    out
}

/// Intra-file capability drops: exported symbols that were in `before` but disappeared in `after`,
/// without an explicit intent targeting that symbol or file with `action: remove` or `replace`.
pub fn dropped_intrafile_capabilities(
    before_exported: &BTreeMap<String, Vec<String>>,
    after_exported: &BTreeMap<String, Vec<String>>,
    touched_files: &[String],
    declared_removes: &[String],
    intents: &[crate::model::TurnIntent],
) -> Vec<String> {
    let mut out = vec![];
    for f in touched_files {
        let clean_f = f.trim_start_matches("./");
        if let Some(before_syms) = before_exported.get(clean_f) {
            let after_syms = after_exported.get(clean_f).cloned().unwrap_or_default();
            for sym in before_syms {
                if !after_syms.contains(sym) {
                    let sym_short = sym.rsplit("::").next().unwrap_or(sym);
                    let is_declared = declared_removes.iter().any(|r| r == sym || r == sym_short || r == clean_f)
                        || intents.iter().any(|it| {
                            matches!(it.action.as_str(), "remove" | "replace")
                                && it.targets.iter().any(|t| t == sym || t == sym_short || t == clean_f)
                        });
                    if !is_declared {
                        out.push(format!("{clean_f}::{sym_short}"));
                    }
                }
            }
        }
    }
    out
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SeveredCapability {
    pub symbol_id: String,
    pub name: String,
    pub file: String,
    pub before_count: usize,
    pub after_count: usize,
    pub reason: String, // "caller_severed" | "dead_on_arrival"
}

/// Cross-module capability severance and dead-on-arrival ratchet.
/// Catches:
/// 1. Symbols whose inbound references dropped from >0 to 0 (e.g. caller removed in another file)
/// 2. Newly added exported symbols born with 0 inbound references (dead on arrival)
/// Excludes generic identifiers (new, len, run, etc.) and declared intent removals.
pub fn severed_capabilities(
    before_inbound: &BTreeMap<String, usize>,
    after_inbound: &BTreeMap<String, usize>,
    current_symbols: &[SymbolInfo],
    touched_files: &[String],
    declared_removes: &[String],
    intents: &[crate::model::TurnIntent],
) -> Vec<SeveredCapability> {
    let mut out = vec![];
    let is_declared = |sym_id: &str, sym_name: &str, file: &str| -> bool {
        if declared_removes.iter().any(|r| r == sym_id || r == sym_name || r == file || file.ends_with(r)) {
            return true;
        }
        for it in intents {
            if matches!(it.action.as_str(), "remove" | "replace") {
                if it.targets.iter().any(|t| t == sym_id || t == sym_name || t == file || file.ends_with(t)) {
                    return true;
                }
            }
        }
        false
    };

    // 1. Shrinking inbound reference (>0 to 0) -> caller severed in this turn
    // This is cross-workspace: caller may have been removed from any touched file.
    for (sym_id, &before_count) in before_inbound {
        if before_count > 0 && before_count < 900 {
            let after_count = after_inbound.get(sym_id).copied().unwrap_or(0);
            if after_count == 0 {
                let (file, name) = sym_id.split_once("::").unwrap_or(("", sym_id.as_str()));
                if !is_declared(sym_id, name, file) {
                    out.push(SeveredCapability {
                        symbol_id: sym_id.clone(),
                        name: name.to_string(),
                        file: file.to_string(),
                        before_count,
                        after_count: 0,
                        reason: "caller_severed".to_string(),
                    });
                }
            }
        }
    }

    // 2. Dead-on-Arrival (newly introduced exported symbol born with 0 callers)
    // Only applies if before_inbound was captured (ratchet against baseline)
    // and only checks symbols in files touched in this turn.
    if !before_inbound.is_empty() {
        let touched_set: HashSet<&str> = touched_files.iter().map(|s| s.trim_start_matches("./")).collect();
        for s in current_symbols {
            let clean_file = s.file.trim_start_matches("./");
            if !touched_set.contains(clean_file) {
                continue; // Untouched files cannot introduce newly born symbols
            }
            if !s.exported || is_entrypoint_file(&s.file) || GENERIC_IDENTIFIERS.contains(&s.name.as_str()) {
                continue;
            }
            // If it was already in baseline before_inbound, it's grandfathered (not newly born)
            if before_inbound.contains_key(&s.id) {
                continue;
            }
            let after_count = after_inbound.get(&s.id).copied().unwrap_or(0);
            if after_count == 0 {
                let is_declared_new = intents.iter().any(|it| {
                    it.id == s.name
                        || it.id == s.qualified
                        || it.id.starts_with("restore-")
                        || it.targets.iter().any(|t| {
                            t == &s.id
                                || t == &s.name
                                || t == &s.qualified
                                || t == &s.file
                                || s.file.ends_with(t)
                                || s.file.contains(t)
                                || t.contains(&s.name)
                        })
                });
                if !is_declared_new && !is_declared(&s.id, &s.name, &s.file) {
                    out.push(SeveredCapability {
                        symbol_id: s.id.clone(),
                        name: s.name.clone(),
                        file: s.file.clone(),
                        before_count: 0,
                        after_count: 0,
                        reason: "dead_on_arrival".to_string(),
                    });
                }
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Attachment, Blueprint, BlueprintNode, Implementation};

    fn node(id: &str, children: Vec<BlueprintNode>) -> BlueprintNode {
        BlueprintNode { id: id.into(), name: id.into(), kind: "module".into(), purpose: None, description: None, implements: Implementation::default(), tags: vec![], status: None, origin: None, children }
    }

    fn table() -> NodeTable {
        NodeTable::from_blueprint(&Blueprint { nodes: vec![node("product", vec![node("payments", vec![node("checkout", vec![])]), node("ui", vec![])])] })
    }

    fn pin(id: &str, nodes: &[&str], severity: &str) -> Pin {
        Pin {
            id: id.into(),
            statement: format!("keep {id}"),
            kind: "decision".into(),
            attaches: Attachment { nodes: nodes.iter().map(|s| s.to_string()).collect(), ..Default::default() },
            severity: severity.into(),
            status: "active".into(),
            origin: "human".into(),
            created: "now".into(),
            created_from: None,
            reason: None,
            retired: None,
            intentional: false,
        }
    }

    #[test]
    fn pin_covers_its_subtree() {
        let t = table();
        let pins = [pin("p1", &["payments"], "block")];
        let hit = pin_conflicts(&pins, &t, &["checkout".into()], &[], &[], &[]);
        assert_eq!(hit.len(), 1, "child of a pinned node is covered");
        let miss = pin_conflicts(&pins, &t, &["ui".into()], &[], &[], &[]);
        assert!(miss.is_empty());
    }

    #[test]
    fn override_is_recorded_not_dropped() {
        let t = table();
        let pins = [pin("p1", &["payments"], "block")];
        let ov = [PinOverride { pin: "p1".into(), reason: "customer asked".into() }];
        let hit = pin_conflicts(&pins, &t, &["payments".into()], &[], &[], &ov);
        assert_eq!(hit[0].overridden.as_deref(), Some("customer asked"));
    }

    #[test]
    fn retired_pins_never_conflict() {
        let t = table();
        let mut p = pin("p1", &["payments"], "block");
        p.status = "retired".into();
        assert!(pin_conflicts(&[p], &t, &["payments".into()], &[], &[], &[]).is_empty());
    }

    #[test]
    fn collateral_loss_needs_a_declaration() {
        let t = table();
        let before: BTreeSet<String> = ["checkout", "ui"].iter().map(|s| s.to_string()).collect();
        let after: BTreeSet<String> = ["ui"].iter().map(|s| s.to_string()).collect();
        assert_eq!(collateral_loss(&before, &after, &[], &t), vec!["checkout".to_string()]);
        // declaring an ancestor removed covers the child on purpose
        assert!(collateral_loss(&before, &after, &["payments".into()], &t).is_empty());
    }

    #[test]
    fn partial_loss_reports_dropped_files() {
        let before = BTreeMap::from([("ui".to_string(), vec!["a.tsx".to_string(), "b.tsx".to_string()])]);
        let after = BTreeMap::from([("ui".to_string(), vec!["a.tsx".to_string()])]);
        let out = partial_loss(&before, &after, &["ui".to_string()]);
        assert_eq!(out.len(), 1);
        assert!(out[0].contains("b.tsx"));
    }

    #[test]
    fn test_caller_deletion_in_different_file_flags_severed_callee() {
        // t0022 reproduction test:
        // api.rs calls contract.rs::task_start.
        // turn touches api.rs and deletes the call; contract.rs is UNTOUCHED.
        let sym_id = "crates/afwe-core/src/contract.rs::task_start".to_string();
        let before_inbound = BTreeMap::from([(sym_id.clone(), 1usize)]);
        let after_inbound = BTreeMap::from([(sym_id.clone(), 0usize)]);

        let sym = SymbolInfo {
            id: sym_id.clone(),
            file: "crates/afwe-core/src/contract.rs".into(),
            name: "task_start".into(),
            qualified: "task_start".into(),
            kind: "function".into(),
            structural: "function:task_start".into(),
            fingerprint: "fp1".into(),
            start_line: 10,
            end_line: 20,
            exported: true,
        };

        // Without declaration -> BLOCKED
        let severed = severed_capabilities(&before_inbound, &after_inbound, &[sym.clone()], &["crates/afwe-core/src/api.rs".into()], &[], &[]);
        assert_eq!(severed.len(), 1);
        assert_eq!(severed[0].symbol_id, sym_id);
        assert_eq!(severed[0].reason, "caller_severed");
        assert_eq!(severed[0].before_count, 1);
        assert_eq!(severed[0].after_count, 0);

        // With explicit intent -> PASSES
        let declared_intent = vec![crate::model::TurnIntent {
            id: "prune".into(),
            action: "replace".into(),
            targets: vec!["crates/afwe-core/src/contract.rs".into()],
            ..Default::default()
        }];
        let passed = severed_capabilities(&before_inbound, &after_inbound, &[sym], &["crates/afwe-core/src/api.rs".into()], &[], &declared_intent);
        assert!(passed.is_empty(), "declared intent bypasses severed capability ratchet");
    }

    #[test]
    fn test_new_uncalled_exported_function_blocked() {
        let sym_id = "crates/afwe-core/src/zombie.rs::dead_capability".to_string();
        let before_inbound = BTreeMap::from([("crates/afwe-core/src/other.rs::live".to_string(), 1usize)]);
        let after_inbound = BTreeMap::from([
            ("crates/afwe-core/src/other.rs::live".to_string(), 1usize),
            (sym_id.clone(), 0usize),
        ]);

        let sym = SymbolInfo {
            id: sym_id.clone(),
            file: "crates/afwe-core/src/zombie.rs".into(),
            name: "dead_capability".into(),
            qualified: "dead_capability".into(),
            kind: "function".into(),
            structural: "function:dead_capability".into(),
            fingerprint: "fp2".into(),
            start_line: 1,
            end_line: 5,
            exported: true,
        };

        let touched = vec!["crates/afwe-core/src/zombie.rs".into()];
        let severed = severed_capabilities(&before_inbound, &after_inbound, &[sym], &touched, &[], &[]);
        assert_eq!(severed.len(), 1);
        assert_eq!(severed[0].reason, "dead_on_arrival");
    }

    #[test]
    fn test_generic_names_are_unflaggable() {
        let sym_id = "crates/afwe-core/src/engine.rs::new".to_string();
        let before_inbound = BTreeMap::from([(sym_id.clone(), 999usize)]);
        let after_inbound = BTreeMap::from([(sym_id.clone(), 999usize)]);

        let sym = SymbolInfo {
            id: sym_id,
            file: "crates/afwe-core/src/engine.rs".into(),
            name: "new".into(),
            qualified: "new".into(),
            kind: "function".into(),
            structural: "function:new".into(),
            fingerprint: "fp3".into(),
            start_line: 1,
            end_line: 5,
            exported: true,
        };

        let touched = vec!["crates/afwe-core/src/engine.rs".into()];
        let severed = severed_capabilities(&before_inbound, &after_inbound, &[sym], &touched, &[], &[]);
        assert!(severed.is_empty(), "generic names are never flagged");
    }

    #[test]
    fn test_preexisting_dead_code_is_grandfathered() {
        let sym_id = "crates/afwe-core/src/legacy.rs::old_unused".to_string();
        // Was already 0 in baseline!
        let before_inbound = BTreeMap::from([(sym_id.clone(), 0usize)]);
        let after_inbound = BTreeMap::from([(sym_id.clone(), 0usize)]);

        let sym = SymbolInfo {
            id: sym_id,
            file: "crates/afwe-core/src/legacy.rs".into(),
            name: "old_unused".into(),
            qualified: "old_unused".into(),
            kind: "function".into(),
            structural: "function:old_unused".into(),
            fingerprint: "fp4".into(),
            start_line: 1,
            end_line: 5,
            exported: true,
        };

        let touched = vec!["crates/afwe-core/src/legacy.rs".into()];
        let severed = severed_capabilities(&before_inbound, &after_inbound, &[sym], &touched, &[], &[]);
        assert!(severed.is_empty(), "pre-existing dead code in baseline is grandfathered");
    }

    #[test]
    fn test_tokenize_identifiers() {
        let src = "pub fn task_start(engine: &Engine) -> Result<()> { contract::task_start(); 123 }";
        let tokens = tokenize_identifiers(src);
        assert!(tokens.contains("pub"));
        assert!(tokens.contains("task_start"));
        assert!(tokens.contains("Engine"));
        assert!(tokens.contains("contract"));
        assert!(tokens.contains("Result"));
        assert!(!tokens.contains("123"));
    }
}
