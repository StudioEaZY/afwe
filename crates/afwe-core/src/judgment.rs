//! Phase 2: Sequential Leaf-to-Root Validator Engine & Pure-Mechanism `TurnJudgment`.
//!
//! AFWE-Core is pure mechanism: it never imports external LLM SDKs or holds API keys.
//! Validators run sequentially from leaf modules (`depth >= 2`) up through subsystems (`depth == 1`)
//! to product-level invariants (`depth == 0`), producing a structured `TurnJudgment` with
//! `agent_reask_prompt` and structural telemetry (`ast_files_parsed`, `duration_us`).

use crate::mapping::NodeTable;
use crate::model::{AmbiguityQuestion, CheckResult, VerifyIssue};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JudgmentAction {
    Block,
    Reask,
    /// Reserved for future deterministic codemods (`fix-reask-patcher` roadmap item).
    FixReask,
    Log,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JudgmentTelemetry {
    pub ast_files_parsed: usize,
    pub duration_us: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatorJudgment {
    pub validator_id: String,
    /// `"module"` | `"subsystem"` | `"product"`
    pub scope_level: String,
    #[serde(default)]
    pub target_nodes: Vec<String>,
    pub passed: bool,
    pub action: JudgmentAction,
    #[serde(default)]
    pub findings: Vec<String>,
    #[serde(default)]
    pub telemetry: JudgmentTelemetry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnJudgment {
    pub turn: String,
    pub passed: bool,
    pub action: JudgmentAction,
    #[serde(default)]
    pub judgments: Vec<ValidatorJudgment>,
    #[serde(default)]
    pub probing_guides: Vec<String>,
    #[serde(default)]
    pub questions: Vec<AmbiguityQuestion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_reask_prompt: Option<String>,
    pub telemetry: JudgmentTelemetry,
}

fn scope_rank(level: &str) -> u8 {
    match level {
        "module" => 0,
        "subsystem" => 1,
        "product" => 2,
        _ => 3,
    }
}

pub fn scope_level_for_nodes(table: &NodeTable, nodes: &[String]) -> String {
    if nodes.is_empty() {
        return "product".into();
    }
    let max_depth = nodes
        .iter()
        .filter_map(|id| table.resolve(id).and_then(|rid| table.nodes.get(&rid)))
        .map(|n| n.depth)
        .max()
        .unwrap_or(0);
    match max_depth {
        0 => "product".into(),
        1 => "subsystem".into(),
        _ => "module".into(),
    }
}

pub struct BuildJudgmentInput<'a> {
    pub turn_id: &'a str,
    pub table: &'a NodeTable,
    pub touched_nodes: &'a [String],
    pub verify_issues: &'a [VerifyIssue],
    pub check_results: &'a [CheckResult],
    pub blocking_failures: &'a [String],
    pub probing_guides: Vec<String>,
    pub questions: Vec<AmbiguityQuestion>,
    pub ast_files_parsed: usize,
    pub duration_us: u64,
    pub explore_mode: bool,
}

/// Builds a deterministic, leaf-to-root ordered `TurnJudgment`.
pub fn build_judgment(inp: BuildJudgmentInput<'_>) -> TurnJudgment {
    let mut judgments: Vec<ValidatorJudgment> = Vec::new();

    // 1. Convert verify issues into scoped validator judgments
    for issue in inp.verify_issues {
        let target_nodes: Vec<String> = issue.nodes.clone();
        let scope_level = if target_nodes.is_empty() {
            scope_level_for_nodes(inp.table, inp.touched_nodes)
        } else {
            scope_level_for_nodes(inp.table, &target_nodes)
        };
        let is_blocking = issue.severity == "error" && !inp.explore_mode;
        judgments.push(ValidatorJudgment {
            validator_id: format!("verify:{}", issue.id),
            scope_level,
            target_nodes,
            passed: !is_blocking,
            action: if is_blocking { JudgmentAction::Reask } else { JudgmentAction::Log },
            findings: vec![issue.message.clone()],
            telemetry: JudgmentTelemetry {
                ast_files_parsed: inp.ast_files_parsed,
                duration_us: 0,
            },
        });
    }

    // 2. Convert check results into scoped validator judgments
    for chk in inp.check_results {
        let scope_level = if chk.id.starts_with("claim:") {
            scope_level_for_nodes(inp.table, inp.touched_nodes)
        } else if chk.id == "project-tests" || chk.id == "afwe-verify" {
            "product".into()
        } else {
            scope_level_for_nodes(inp.table, inp.touched_nodes)
        };
        let is_blocking = !chk.passed && chk.blocking && !inp.explore_mode;
        let action = if chk.passed || !is_blocking {
            JudgmentAction::Log
        } else {
            JudgmentAction::Reask
        };
        let findings = chk.message.iter().cloned().collect();
        judgments.push(ValidatorJudgment {
            validator_id: chk.id.clone(),
            scope_level,
            target_nodes: inp.touched_nodes.to_vec(),
            passed: !is_blocking,
            action,
            findings,
            telemetry: JudgmentTelemetry {
                ast_files_parsed: inp.ast_files_parsed,
                duration_us: 0,
            },
        });
    }

    // Order leaf-to-root: module (0) -> subsystem (1) -> product (2)
    judgments.sort_by_key(|j| scope_rank(&j.scope_level));

    let passed = inp.blocking_failures.is_empty() || inp.explore_mode;
    let overall_action = if passed {
        JudgmentAction::Log
    } else {
        JudgmentAction::Reask
    };

    let agent_reask_prompt = if passed {
        None
    } else {
        let mut prompt = format!(
            "AFWE Turn `{}` blocked by {} architectural invariant(s) (leaf-to-root order):\n",
            inp.turn_id,
            inp.blocking_failures.len()
        );
        for (idx, f) in inp.blocking_failures.iter().enumerate() {
            prompt.push_str(&format!("  {}. {}\n", idx + 1, f));
        }
        prompt.push_str("Repair the violations in the affected leaf/subsystem modules first, then re-run `afwe turn commit`.");
        Some(prompt)
    };

    TurnJudgment {
        turn: inp.turn_id.to_string(),
        passed,
        action: overall_action,
        judgments,
        probing_guides: inp.probing_guides,
        questions: inp.questions,
        agent_reask_prompt,
        telemetry: JudgmentTelemetry {
            ast_files_parsed: inp.ast_files_parsed,
            duration_us: inp.duration_us,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Blueprint, BlueprintNode, CheckTrust, Implementation};

    #[test]
    fn leaf_to_root_ordering_and_structural_telemetry() {
        let bp = Blueprint {
            nodes: vec![BlueprintNode {
                id: "prod".into(),
                name: "Product".into(),
                kind: "system".into(),
                purpose: None,
                description: None,
                implements: Implementation::default(),
                tags: vec![],
                status: Some("active".into()),
                origin: None,
                children: vec![BlueprintNode {
                    id: "sub".into(),
                    name: "Subsystem".into(),
                    kind: "subsystem".into(),
                    purpose: None,
                    description: None,
                    implements: Implementation::default(),
                    tags: vec![],
                    status: Some("active".into()),
                    origin: None,
                    children: vec![BlueprintNode {
                        id: "leaf".into(),
                        name: "Leaf".into(),
                        kind: "module".into(),
                        purpose: None,
                        description: None,
                        implements: Implementation::default(),
                        tags: vec![],
                        status: Some("active".into()),
                        origin: None,
                        children: vec![],
                    }],
                }],
            }],
        };
        let table = NodeTable::from_blueprint(&bp);
        let issues = vec![
            VerifyIssue {
                severity: "error".into(),
                source: "constraint".into(),
                id: "prod-rule".into(),
                message: "product violation".into(),
                nodes: vec!["prod".into()],
                files: vec![],
                hint: None,
            },
            VerifyIssue {
                severity: "error".into(),
                source: "constraint".into(),
                id: "leaf-rule".into(),
                message: "leaf violation".into(),
                nodes: vec!["leaf".into()],
                files: vec![],
                hint: None,
            },
            VerifyIssue {
                severity: "error".into(),
                source: "constraint".into(),
                id: "sub-rule".into(),
                message: "subsystem violation".into(),
                nodes: vec!["sub".into()],
                files: vec![],
                hint: None,
            },
        ];
        let checks = vec![CheckResult::new("project-tests", "cargo test", CheckTrust::Deterministic, "human", true, None, true)];
        let blocking = vec!["leaf violation".to_string(), "subsystem violation".to_string(), "product violation".to_string()];

        let j = build_judgment(BuildJudgmentInput {
            turn_id: "t0001",
            table: &table,
            touched_nodes: &["leaf".into()],
            verify_issues: &issues,
            check_results: &checks,
            blocking_failures: &blocking,
            probing_guides: vec!["g1".into()],
            questions: vec![],
            ast_files_parsed: 2,
            duration_us: 100,
            explore_mode: false,
        });

        assert!(!j.passed);
        assert_eq!(j.action, JudgmentAction::Reask);
        assert_eq!(j.telemetry.ast_files_parsed, 2);
        assert!(j.agent_reask_prompt.is_some());
        // Leaf-to-root ordering: module -> subsystem -> product
        let scopes: Vec<&str> = j.judgments.iter().map(|v| v.scope_level.as_str()).collect();
        assert_eq!(scopes, vec!["module", "subsystem", "product", "product"]);
        assert_eq!(j.judgments[0].validator_id, "verify:leaf-rule");
        assert_eq!(j.judgments[1].validator_id, "verify:sub-rule");
        assert_eq!(j.judgments[2].validator_id, "verify:prod-rule");
    }
}
