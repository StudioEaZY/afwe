//! `afwe sync`: analyse → index → detect drift → reconcile by confidence → persist state.

use crate::contract::{resolve_system_items, upsert_system_item};
use crate::drift;
use crate::engine::{Engine, Snapshot};
use crate::model::*;
use crate::util::now;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncReport {
    pub files: usize,
    pub symbols: usize,
    pub mapped_files: usize,
    pub unmapped_code_files: usize,
    pub nodes: usize,
    pub findings: usize,
    pub applied: Vec<Finding>,
    pub uncertain: Vec<Finding>,
    pub proposed: Vec<Finding>,
    pub informational: Vec<Finding>,
    pub languages: std::collections::BTreeMap<String, usize>,
    pub duration_ms: u128,
}

pub struct SyncOptions {
    /// detect + report only; do not reconcile or write
    pub dry_run: bool,
    pub origin: String,
}

pub fn sync(engine: &Engine, opts: &SyncOptions) -> Result<(SyncReport, Snapshot)> {
    let started = std::time::Instant::now();
    let manifest = engine.store.manifest()?;
    let code = engine.analyzer(&manifest).analyze()?;
    drift::set_previous_index(engine.store.index()?);
    let snap = engine.snapshot_with_code(code.clone())?;
    let findings = drift::detect(&snap, None);

    let (report_findings, snap) = if opts.dry_run {
        let r = DriftReport { generated: now(), findings: findings.clone(), ..Default::default() };
        (r, snap)
    } else {
        // Reconcile in passes: applying a confident change (e.g. a rename) can make other
        // findings obsolete or reveal new ones (e.g. an import edge of a newly mapped file).
        let mut report = DriftReport { generated: now(), ..Default::default() };
        let mut snap_cur = snap;
        let mut findings_cur = findings;
        for _pass in 0..3 {
            let outcome = drift::reconcile(engine, &snap_cur, findings_cur, &opts.origin)?;
            report.applied.extend(outcome.report.applied.clone());
            report.uncertain.extend(outcome.report.uncertain.clone());
            snap_cur = engine.snapshot_with_code(code.clone())?;
            findings_cur = drift::detect(&snap_cur, None);
            let applied_ids: std::collections::HashSet<String> = report.applied.iter().map(|f| f.id.clone()).collect();
            findings_cur.retain(|f| !applied_ids.contains(&f.id));
            if outcome.report.applied.is_empty() {
                break;
            }
        }
        // whatever is left after the passes is the truth: proposals (<soft) and informational
        let policy = snap_cur.manifest.policy.clone();
        let mut proposals = engine.store.proposals()?;
        let mut live = vec![];
        for f in findings_cur {
            let structural = matches!(f.change, Some(Change::CreateNode { .. }) | Some(Change::RemoveRelation { .. }) | Some(Change::UnmapFile { .. }) | Some(Change::UnmapSymbol { .. }));
            if f.change.is_some() && (f.confidence < policy.soft_reconcile_min || structural) && policy.create_proposals {
                if !proposals.proposals.iter().any(|p| p.finding.id == f.id && p.status == "pending") {
                    proposals.proposals.push(Proposal { id: f.id.clone(), created: now(), finding: f.clone(), status: "pending".into() });
                }
                live.push(f.id.clone());
                report.proposed.push(f);
            } else {
                report.findings.push(f);
            }
        }
        proposals.proposals.retain(|p| p.status != "pending" || live.contains(&p.id));
        engine.store.save_proposals(&proposals)?;
        let snap2 = snap_cur;
        engine.persist_derived(&snap2)?;
        engine.store.save_drift(&report)?;
        let st = SyncState { last_sync: Some(now()), code_fingerprint: snap2.code.fingerprint.clone(), afwe_fingerprint: engine.store.afwe_fingerprint(), engine_version: crate::ENGINE_VERSION.into(), files_analyzed: snap2.code.files.len() };
        engine.store.save_sync_state(&st)?;
        update_board(engine, &report)?;
        engine.log(&format!("{}:sync", opts.origin), "sync", format!("Synced {} files; applied {}, proposed {}, uncertain {}", snap2.code.files.len(), report.applied.len(), report.proposed.len(), report.uncertain.len()), None)?;
        (report, snap2)
    };
    drift::set_previous_index(None);

    let mapped = snap.code.files.iter().filter(|f| snap.mapping.primary(&f.path).is_some()).count();
    let unmapped_code = snap.code.files.iter().filter(|f| snap.mapping.primary(&f.path).is_none() && !matches!(f.language.as_str(), "other" | "json" | "yaml" | "toml" | "markdown" | "shell")).count();
    let report = SyncReport {
        files: snap.code.files.len(),
        symbols: snap.index.symbols.len(),
        mapped_files: mapped,
        unmapped_code_files: unmapped_code,
        nodes: snap.table.nodes.len(),
        findings: report_findings.findings.len() + report_findings.applied.len() + report_findings.proposed.len(),
        applied: report_findings.applied.clone(),
        uncertain: report_findings.uncertain.clone(),
        proposed: report_findings.proposed.clone(),
        informational: report_findings.findings.clone(),
        languages: snap.code.languages.clone(),
        duration_ms: started.elapsed().as_millis(),
    };
    Ok((report, snap))
}

fn update_board(engine: &Engine, report: &DriftReport) -> Result<()> {
    let mut board = engine.store.board()?;
    let mut keep_prop = vec![];
    for f in &report.proposed {
        keep_prop.push(f.id.clone());
        upsert_system_item(&mut board, "proposal", &f.id, &format!("Proposal ({:.0}%): {}", f.confidence * 100.0, f.summary), Some("accept / revert / review with `afwe proposals`".into()));
    }
    resolve_system_items(&mut board, "proposal", &keep_prop);
    // Uncertainty markers (50–70% auto-reconciliations) are *not* auto-resolved on the next sync:
    // the whole point is that a human glances at them at leisure (`afwe board dismiss <id>` / Studio).
    for f in &report.uncertain {
        upsert_system_item(&mut board, "uncertain", &f.id, &format!("Auto-reconciled with {:.0}% confidence: {}", f.confidence * 100.0, f.summary), Some("review at leisure; dismiss with `afwe board dismiss <id>`; revert via the change log if wrong".into()));
    }
    let mut keep_info = vec![];
    for f in report.findings.iter().filter(|f| f.kind == "stale_memory" || f.kind == "broken_reference" || f.kind == "empty_node") {
        keep_info.push(f.id.clone());
        upsert_system_item(&mut board, "drift", &f.id, &f.summary, Some(f.evidence.join("; ")));
    }
    // Check if AGENTS.md references AFWE and skill file is present
    let agents_md = engine.store.project_root.join("AGENTS.md");
    if agents_md.exists() {
        if let Ok(text) = std::fs::read_to_string(&agents_md) {
            if !text.contains("afwe") {
                keep_info.push("agents_md_missing_afwe".into());
                upsert_system_item(&mut board, "drift", "agents_md_missing_afwe", "AGENTS.md missing AFWE contract instruction", Some("Run `afwe onboard` or add the AFWE skill contract block to AGENTS.md".into()));
            }
        }
    }
    resolve_system_items(&mut board, "drift", &keep_info);
    engine.store.save_board(&board)
}
