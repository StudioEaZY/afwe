//! The gate: pure decision logic over check results, pin conflicts and confidence. No I/O here,
//! so every rule is unit-testable and the same inputs always give the same decision.
//!
//! Rules (in order):
//!  1. Any blocking failure (verify error, block-level pin, collateral loss, failing registered
//!     deterministic/generated check or claim, footer missing, …)            → REDO
//!  2. No attributed change at all                                            → EMPTY
//!  3. A confirm-level pin conflict is unresolved                             → STAGE (proposal)
//!  4. Confidence below the commit threshold                                  → STAGE (proposal)
//!  5. Engineer manual-commit mode                                            → READY
//!  6. Otherwise                                                              → COMMIT

use crate::model::{CheckResult, CheckTrust};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Commit,
    Ready,
    Stage,
    Redo,
    Empty,
}

impl Decision {
    pub fn as_str(&self) -> &'static str {
        match self {
            Decision::Commit => "commit",
            Decision::Ready => "ready",
            Decision::Stage => "stage",
            Decision::Redo => "redo",
            Decision::Empty => "empty",
        }
    }
}

pub struct GateInput<'a> {
    /// Failures that stop the commit, each already prefixed with an error code.
    pub blocking: Vec<String>,
    /// Confirm-level pin conflicts that need a human.
    pub confirm: Vec<String>,
    /// Non-blocking notices (warnings, overrides, partial losses, …).
    pub notices: Vec<String>,
    pub checks: &'a [CheckResult],
    pub confidence: f64,
    pub min_confidence: f64,
    pub has_changes: bool,
    pub auto_commit: bool,
    /// A human confirmed a staged turn: confidence and confirm-level rules are already settled.
    pub confirmed: bool,
}

#[derive(Debug, Clone)]
pub struct GateOutcome {
    pub decision: Decision,
    pub reasons: Vec<String>,
    pub strength: CheckTrust,
}

/// How strong the overall verification is: the weakest trust among the checks that ran.
/// Nothing ran → Unverified (shown as such, never as "deterministic").
pub fn strength_of(checks: &[CheckResult]) -> CheckTrust {
    checks.iter().map(|c| c.trust).min().unwrap_or(CheckTrust::Unverified)
}

pub fn decide(i: &GateInput) -> GateOutcome {
    let strength = strength_of(i.checks);
    let mut reasons: Vec<String> = i.blocking.clone();
    reasons.extend(i.confirm.iter().map(|c| format!("NEEDS_CONFIRMATION: {c}")));
    reasons.extend(i.notices.iter().cloned());
    let decision = if !i.blocking.is_empty() {
        Decision::Redo
    } else if !i.has_changes {
        Decision::Empty
    } else if !i.confirm.is_empty() && !i.confirmed {
        Decision::Stage
    } else if i.confidence + 1e-9 < i.min_confidence && !i.confirmed {
        reasons.push(format!(
            "LOW_CONFIDENCE: {:.0}% is below the {:.0}% commit threshold — kept as a proposal",
            i.confidence * 100.0,
            i.min_confidence * 100.0
        ));
        Decision::Stage
    } else if !i.auto_commit {
        Decision::Ready
    } else {
        Decision::Commit
    };
    GateOutcome { decision, reasons, strength }
}

/// Inputs to the confidence score. Every factor is in [0, 1] and shown to the user.
pub struct ConfidenceInput {
    pub touched_code: usize,
    pub mapped_code: usize,
    pub strength: CheckTrust,
    pub intents_declared: usize,
    pub intents_resolved: usize,
    pub warn_conflicts: usize,
}

/// Deterministic, explainable score. A turn that touches only mapped code, passes deterministic
/// checks and declares resolvable intents scores 1.0. Each weakness multiplies it down.
pub fn confidence(i: &ConfidenceInput) -> (f64, BTreeMap<String, f64>) {
    let mapping = if i.touched_code == 0 { 1.0 } else { 0.5 + 0.5 * (i.mapped_code as f64 / i.touched_code as f64) };
    let verification = match i.strength {
        CheckTrust::Deterministic => 1.0,
        CheckTrust::Generated => 0.9,
        CheckTrust::LlmJudged => 0.8,
        CheckTrust::Unverified => 0.75,
    };
    let clarity = if i.intents_declared == 0 {
        0.85
    } else if i.intents_resolved >= i.intents_declared {
        1.0
    } else {
        0.7
    };
    let pins = 0.9f64.powi(i.warn_conflicts as i32).max(0.5);
    let total = (mapping * verification * clarity * pins).clamp(0.0, 1.0);
    let mut parts = BTreeMap::new();
    parts.insert("mapping".to_string(), round2(mapping));
    parts.insert("verification".to_string(), round2(verification));
    parts.insert("clarity".to_string(), round2(clarity));
    parts.insert("pins".to_string(), round2(pins));
    (round2(total), parts)
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(trust: CheckTrust, passed: bool) -> CheckResult {
        CheckResult { id: "c".into(), title: "c".into(), trust, authored_by: "human".into(), passed, message: None, blocking: true }
    }

    fn input<'a>(checks: &'a [CheckResult]) -> GateInput<'a> {
        GateInput { blocking: vec![], confirm: vec![], notices: vec![], checks, confidence: 1.0, min_confidence: 0.7, has_changes: true, auto_commit: true, confirmed: false }
    }

    #[test]
    fn blocking_failure_redoes() {
        let mut i = input(&[]);
        i.blocking.push("VERIFY_FAILED: x".into());
        assert_eq!(decide(&i).decision, Decision::Redo);
    }

    #[test]
    fn no_changes_is_empty() {
        let mut i = input(&[]);
        i.has_changes = false;
        assert_eq!(decide(&i).decision, Decision::Empty);
    }

    #[test]
    fn confirm_pin_stages_until_confirmed() {
        let mut i = input(&[]);
        i.confirm.push("pin-1".into());
        assert_eq!(decide(&i).decision, Decision::Stage);
        i.confirmed = true;
        assert_eq!(decide(&i).decision, Decision::Commit);
    }

    #[test]
    fn low_confidence_stages_with_reason() {
        let mut i = input(&[]);
        i.confidence = 0.5;
        let out = decide(&i);
        assert_eq!(out.decision, Decision::Stage);
        assert!(out.reasons.iter().any(|r| r.starts_with("LOW_CONFIDENCE")));
    }

    #[test]
    fn manual_mode_ends_ready_and_happy_path_commits() {
        let mut i = input(&[]);
        i.auto_commit = false;
        assert_eq!(decide(&i).decision, Decision::Ready);
        i.auto_commit = true;
        assert_eq!(decide(&i).decision, Decision::Commit);
    }

    #[test]
    fn strength_is_weakest_check_that_ran() {
        let checks = [check(CheckTrust::Deterministic, true), check(CheckTrust::Generated, true)];
        assert_eq!(strength_of(&checks), CheckTrust::Generated);
        let checks = [check(CheckTrust::Deterministic, true), check(CheckTrust::LlmJudged, true)];
        assert_eq!(strength_of(&checks), CheckTrust::LlmJudged);
        assert_eq!(strength_of(&[]), CheckTrust::Unverified);
        assert!(CheckTrust::Deterministic > CheckTrust::Generated);
    }

    #[test]
    fn confidence_components_multiply() {
        let base = ConfidenceInput { touched_code: 2, mapped_code: 2, strength: CheckTrust::Deterministic, intents_declared: 1, intents_resolved: 1, warn_conflicts: 0 };
        assert_eq!(confidence(&base).0, 1.0);
        let unmapped = ConfidenceInput { mapped_code: 1, ..base };
        let (score, parts) = confidence(&unmapped);
        assert_eq!(score, 0.75);
        assert_eq!(parts["mapping"], 0.75);
        let none = ConfidenceInput { touched_code: 1, mapped_code: 0, strength: CheckTrust::Unverified, intents_declared: 0, intents_resolved: 0, warn_conflicts: 2 };
        assert!(confidence(&none).0 < 0.5);
    }
}
