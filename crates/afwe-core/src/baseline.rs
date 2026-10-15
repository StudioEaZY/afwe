//! Ratchet baseline for pre-existing architectural debt.
//!
//! Captures current constraint and guardrail violations into `.afwe/baseline/violations.yaml`.
//! Pre-existing violations do not block turns, but as violations are fixed, the baseline
//! ratchets down automatically upon turn commit. Reintroducing fixed debt triggers a gate REDO.

use crate::engine::Engine;
use crate::model::VerifyIssue;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct BaselineViolation {
    pub source: String,
    pub rule_id: String,
    pub file: String,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ViolationBaseline {
    #[serde(default)]
    pub violations: Vec<BaselineViolation>,
}

pub fn path() -> &'static str {
    "baseline/violations.yaml"
}

pub fn load(engine: &Engine) -> Result<ViolationBaseline> {
    match engine.store.read_text(path())? {
        Some(t) => Ok(serde_yaml::from_str(&t).unwrap_or_default()),
        None => Ok(ViolationBaseline::default()),
    }
}

pub fn save(engine: &Engine, b: &ViolationBaseline) -> Result<()> {
    let y = serde_yaml::to_string(b)?;
    engine.store.write_text(path(), &y)
}

pub fn capture(engine: &Engine) -> Result<usize> {
    let snap = engine.snapshot(true)?;
    let root = engine.store.project_root.clone();
    let report = crate::verify::verify(&snap, &root, &crate::verify::VerifyOptions {
        changed: vec![],
        run_commands: false,
        include_drift: false,
    });
    let mut entries = vec![];
    for issue in &report.issues {
        if issue.severity == "error" {
            entries.push(BaselineViolation {
                source: issue.source.clone(),
                rule_id: issue.id.clone(),
                file: issue.files.first().cloned().unwrap_or_default(),
                target: issue.files.get(1).cloned(),
            });
        }
    }
    entries.sort();
    entries.dedup();
    let count = entries.len();
    save(engine, &ViolationBaseline { violations: entries })?;
    engine.log("human", "baseline_capture", format!("Captured {count} baseline violations"), None)?;
    Ok(count)
}

pub fn is_covered(base: &ViolationBaseline, issue: &VerifyIssue) -> bool {
    let file = issue.files.first().cloned().unwrap_or_default();
    let target = issue.files.get(1).cloned();
    base.violations.iter().any(|v| {
        v.source == issue.source
            && v.rule_id == issue.id
            && v.file == file
            && (v.target.is_none() || v.target == target)
    })
}
