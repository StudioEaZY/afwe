//! Deterministic conflict detection: what a turn touches versus what pins protect, and collateral
//! loss of features. Pins attach to nodes (and their subtrees), files (globs) or symbol ids.

use crate::analyze::build_globset;
use crate::mapping::NodeTable;
use crate::model::{Pin, PinOverride};
use std::collections::{BTreeMap, BTreeSet};

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
    let is_exempt = |f: &str| -> bool {
        let base = f.rsplit('/').next().unwrap_or(f);
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
        )
    };

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
        if count > 0 && !is_exempt(file) {
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
}
