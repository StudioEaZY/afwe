//! Evidence-based confidence rubric, probing guides (85%..90%), blast-radius-filtered
//! ambiguity questions (<85%), and graduation engine (>=90%).
//!
//! Core invariants:
//! 1. Confidence is computed from a deterministic additive rubric, never taken from raw LLM-emitted floats.
//! 2. `ModelCalibrationProfile.trust_factor` moves only on human adjudications (and stays 1.0 until >=10 outcomes).
//! 3. Probe credit requires an actual AST touch of the governed symbol/import in a distinct session.
//! 4. Graduation requires independent evidence (including at least one hold-out probe) plus human confirmation
//!    by default (`policy.graduation.require_human = true`, configurable to `false` for Option B).
//! 5. Below 0.85, only high-blast-radius ambiguities (exported symbol, cross-subsystem edge, or contradiction)
//!    ask the human, capped at 3 open questions per session.

use crate::claims;
use crate::engine::{Engine, Snapshot};
use crate::model::*;
use crate::util::{now, short_id, slug};
use anyhow::{anyhow, Result};
use std::collections::BTreeSet;

pub const ASK_THRESHOLD: f64 = 0.85;
pub const GRADUATE_THRESHOLD: f64 = 0.90;
pub const MAX_OPEN_QUESTIONS_PER_SESSION: usize = 3;

/// Inputs to the deterministic additive confidence rubric.
#[derive(Debug, Clone, Default)]
pub struct RubricEvidence {
    /// Backed by an AST, symbol, or import claim (not a bare regex or unbacked text).
    pub high_quality_claim: bool,
    /// Consistent with sibling modules in the same subsystem.
    pub sibling_consistent: bool,
    /// Contradicts an active pin, constraint, intent, or prior human answer.
    pub contradicts_history: bool,
    /// Number of qualifying probes across distinct sessions.
    pub qualifying_probes: usize,
}

/// Computes the deterministic rubric score:
/// - Floor: 0.50
/// - High-quality AST/import/symbol claim: +0.25
/// - Consistent with sibling modules: +0.10
/// - Qualifying probes: +0.02 each (max +0.10)
/// - Any contradiction caps the score at 0.40.
pub fn compute_rubric_score(ev: &RubricEvidence) -> f64 {
    if ev.contradicts_history {
        return 0.40;
    }
    let mut score = 0.50;
    if ev.high_quality_claim {
        score += 0.25;
    }
    if ev.sibling_consistent {
        score += 0.10;
    }
    let probe_bonus = (ev.qualifying_probes.min(5) as f64) * 0.02;
    score += probe_bonus;
    ((score * 100.0).round() / 100.0).clamp(0.0, 1.0)
}

/// Checks whether a claim is consistent with sibling modules under the same parent in the blueprint.
pub fn is_sibling_consistent(snap: &Snapshot, target_nodes: &[String], claim: Option<&AssumptionClaim>) -> bool {
    let Some(c) = claim else { return false };
    if target_nodes.is_empty() {
        return false;
    }
    for n in target_nodes {
        let Some(node_id) = snap.table.resolve(n) else { continue };
        let Some(entry) = snap.table.nodes.get(&node_id) else { continue };
        if let Some(parent_id) = &entry.parent {
            let Some(parent) = snap.table.nodes.get(parent_id) else { continue };
            if parent.children.len() >= 1 {
                if c.kind == "forbid_import" {
                    // Check that sibling modules also do not import the forbidden target
                    let forbidden: Vec<String> = c.to_nodes.iter().filter_map(|t| snap.table.resolve(t)).collect();
                    let sibling_violates = parent.children.iter().any(|sib| {
                        snap.index
                            .node_edges
                            .get(sib)
                            .map(|edges| forbidden.iter().any(|f| edges.get(f).copied().unwrap_or(0) > 0))
                            .unwrap_or(false)
                    });
                    if !sibling_violates {
                        return true;
                    }
                } else {
                    return true;
                }
            }
        } else {
            return true;
        }
    }
    false
}

/// Updates a model's calibration profile ONLY on human-adjudicated outcomes.
/// Trust factor remains 1.0 until at least 10 human outcomes are recorded, and is clamped to [0.8, 1.1].
pub fn record_human_adjudication(profile: &mut ModelCalibrationProfile, accepted: bool) {
    if accepted {
        profile.human_accepted += 1;
    } else {
        profile.human_rejected += 1;
    }
    let total = profile.human_accepted + profile.human_rejected;
    if total < 10 {
        profile.trust_factor = 1.0;
    } else {
        let ratio = (profile.human_accepted as f64) / (total as f64);
        let raw = 0.8 + ratio * 0.3;
        profile.trust_factor = ((raw * 100.0).round() / 100.0).clamp(0.8, 1.1);
    }
    profile.updated_at = Some(now());
}

/// Records a human adjudication in the persistent store if the origin is human.
pub fn record_human_outcome_in_store(engine: &Engine, model_id: &str, origin: &str, accepted: bool) -> Result<ModelCalibrationProfile> {
    if crate::authority::authority_of(origin) != crate::authority::Authority::Human {
        let cal = engine.store.calibration()?;
        return Ok(cal.models.get(model_id).cloned().unwrap_or_else(|| ModelCalibrationProfile {
            model_id: model_id.to_string(),
            ..Default::default()
        }));
    }
    let mut cal = engine.store.calibration()?;
    let key = model_id.trim_start_matches("llm:").to_string();
    let entry = cal.models.entry(key.clone()).or_insert_with(|| ModelCalibrationProfile {
        model_id: key,
        ..Default::default()
    });
    record_human_adjudication(entry, accepted);
    let out = entry.clone();
    engine.store.save_calibration(&cal)?;
    Ok(out)
}

/// Determines whether a turn actually modified or touched the exact symbol or import category governed by a guide.
pub fn touches_governed_target(
    guide: &GuideState,
    changed_symbols: &[String],
    changed_files: &[String],
    snap: &Snapshot,
) -> Option<String> {
    // 1. If the guide specifies a symbol in its claim or attachment, require that exact symbol in `changed_symbols`.
    if let Some(target_sym) = &guide.claim.symbol {
        for cs in changed_symbols {
            let short = cs.rsplit("::").next().unwrap_or(cs);
            let method = short.rsplit('.').next().unwrap_or(short);
            if cs == target_sym || short == target_sym || method == target_sym {
                return Some(cs.clone());
            }
        }
        return None;
    }
    if !guide.attaches.symbols.is_empty() {
        for cs in changed_symbols {
            if guide.attaches.symbols.iter().any(|s| s == cs || cs.ends_with(&format!("::{s}"))) {
                return Some(cs.clone());
            }
        }
        return None;
    }

    // 2. For `forbid_import`, require that a changed symbol or import in a governed node's file was modified.
    if guide.claim.kind == "forbid_import" {
        let governed_nodes: BTreeSet<String> = guide
            .attaches
            .nodes
            .iter()
            .filter_map(|n| snap.table.resolve(n))
            .collect();
        for cs in changed_symbols {
            let file = cs.split("::").next().unwrap_or("");
            if governed_nodes.is_empty() {
                if changed_files.iter().any(|f| f == file) {
                    return Some(cs.clone());
                }
            } else if snap.mapping.nodes_of(file).iter().any(|n| governed_nodes.contains(n)) {
                return Some(cs.clone());
            }
        }
        return None;
    }

    // 3. For pattern claims, require at least one changed AST symbol in a matching file (not a comment-only edit).
    let globs = if guide.claim.files.is_empty() {
        None
    } else {
        crate::analyze::build_globset(&guide.claim.files).ok()
    };
    for cs in changed_symbols {
        let file = cs.split("::").next().unwrap_or("");
        let file_matches = match &globs {
            Some(g) => g.is_match(file),
            None => changed_files.iter().any(|f| f == file),
        };
        if file_matches {
            return Some(cs.clone());
        }
    }
    None
}

/// Evaluates a candidate probe against a `GuideState`.
/// Returns `true` if the probe was counted (or if a contradiction occurred).
pub fn evaluate_probe_for_guide(
    guide: &mut GuideState,
    turn_id: &str,
    session_id: &str,
    touched_symbol: Option<String>,
    check_passed: bool,
    held_out: bool,
    policy: &GraduationPolicy,
    has_sibling_consistency: bool,
) -> bool {
    let Some(symbol) = touched_symbol else {
        return false; // Did not touch the governed symbol/import category
    };

    if !check_passed {
        guide.contradictions += 1;
        guide.status = "demoted".into();
        guide.score = compute_rubric_score(&RubricEvidence {
            high_quality_claim: claims::is_structural_claim(&guide.claim),
            sibling_consistent: has_sibling_consistency,
            contradicts_history: true,
            qualifying_probes: guide.probes.len(),
        });
        return true;
    }

    // Must be a distinct session from previous probes
    if guide.probes.iter().any(|p| p.session_id == session_id) {
        return false;
    }

    guide.probes.push(ProbeRecord {
        turn: turn_id.to_string(),
        session_id: session_id.to_string(),
        symbol,
        held_out,
    });

    guide.score = compute_rubric_score(&RubricEvidence {
        high_quality_claim: claims::is_structural_claim(&guide.claim),
        sibling_consistent: has_sibling_consistency,
        contradicts_history: guide.contradictions > 0,
        qualifying_probes: guide.probes.len(),
    });

    let enough_sessions = guide.probes.len() >= policy.min_probe_sessions;
    let hold_out_ok = !policy.require_hold_out || guide.probes.iter().any(|p| p.held_out);

    if guide.contradictions == 0 && guide.score >= GRADUATE_THRESHOLD && enough_sessions && hold_out_ok {
        if policy.require_human {
            guide.status = "ready_to_graduate".into();
        } else {
            guide.status = "graduated".into();
            guide.provenance = "graduated".into();
        }
    }

    true
}

/// Determines which probing guides should be held out (omitted) from `turn.begin` so the agent's
/// compliance can be tested independently without prompt injection.
pub fn select_guides_for_briefing(guides: &[GuideState], next_turn_number: usize) -> (Vec<GuideState>, Vec<String>) {
    let mut shown = vec![];
    let mut held_out = vec![];
    for g in guides.iter().filter(|g| g.status == "probing") {
        let has_hold_out = g.probes.iter().any(|p| p.held_out);
        // Hold out on every 2nd probe or when a guide needs its hold-out probe to graduate
        if !has_hold_out && (g.probes.len() >= 1 || next_turn_number % 2 == 0) {
            held_out.push(g.id.clone());
        } else {
            shown.push(g.clone());
        }
    }
    (shown, held_out)
}

/// Blast-radius evaluation for `< 0.85` items.
#[derive(Debug, Clone, Default)]
pub struct BlastAssessment {
    pub exported_symbol: bool,
    pub cross_subsystem: bool,
    pub contradicts_history: bool,
}

impl BlastAssessment {
    pub fn is_high_blast(&self) -> bool {
        self.exported_symbol || self.cross_subsystem || self.contradicts_history
    }

    pub fn reasons(&self) -> Vec<String> {
        let mut r = vec![];
        if self.contradicts_history {
            r.push("contradicts_history".into());
        }
        if self.cross_subsystem {
            r.push("cross_subsystem".into());
        }
        if self.exported_symbol {
            r.push("exported_symbol".into());
        }
        r
    }

    pub fn score(&self) -> usize {
        (if self.contradicts_history { 4 } else { 0 })
            + (if self.cross_subsystem { 2 } else { 0 })
            + (if self.exported_symbol { 1 } else { 0 })
    }
}

/// Computes the blast radius of a turn's low-confidence assumption or change from the graph.
pub fn assess_blast_radius(
    snap: &Snapshot,
    touched_nodes: &[String],
    changed_symbols: &[String],
    contradicts_history: bool,
) -> BlastAssessment {
    let exported_symbol = changed_symbols.iter().any(|sid| {
        snap.index.symbols.get(sid).map(|s| s.exported).unwrap_or(false)
    });

    // Cross-subsystem if touched_nodes span more than one top-level child under the product root
    let mut subsystems = BTreeSet::new();
    for n in touched_nodes {
        if let Some(resolved) = snap.table.resolve(n) {
            let mut chain = vec![resolved.clone()];
            chain.extend(snap.table.ancestors(&resolved));
            // Subsystem is the node directly below root (depth 1), or the node itself if depth 1
            if let Some(sub) = chain.into_iter().find(|id| snap.table.nodes.get(id).map(|e| e.depth == 1).unwrap_or(false)) {
                subsystems.insert(sub);
            }
        }
    }
    let cross_subsystem = subsystems.len() > 1;

    BlastAssessment {
        exported_symbol,
        cross_subsystem,
        contradicts_history,
    }
}

/// Routes a `< 0.85` item by blast radius:
/// - High blast radius: queues an `AmbiguityQuestion` (capped at `MAX_OPEN_QUESTIONS_PER_SESSION` open per session;
///   excess questions are marked `status = "deferred"`).
/// - Low blast radius (private/leaf, no contradiction): returns `None` and records silently as `agent_zone_rationale`.
pub fn route_low_confidence_item(
    existing_questions: &mut Vec<AmbiguityQuestion>,
    turn_id: &str,
    session_id: &str,
    text: &str,
    claim: Option<AssumptionClaim>,
    attaches: Attachment,
    blast: &BlastAssessment,
) -> Option<AmbiguityQuestion> {
    if !blast.is_high_blast() {
        return None;
    }
    let open_in_session = existing_questions
        .iter()
        .filter(|q| q.session_id == session_id && q.status == "open")
        .count();
    let status = if open_in_session < MAX_OPEN_QUESTIONS_PER_SESSION {
        "open".to_string()
    } else {
        "deferred".to_string()
    };
    let reasons = blast.reasons();
    let q = AmbiguityQuestion {
        id: short_id("ask"),
        turn: turn_id.to_string(),
        session_id: session_id.to_string(),
        question: format!("Is `{text}` an intentional architectural invariant that should be enforced?"),
        why_asking: format!("High blast radius ({})", reasons.join(", ")),
        blast_reasons: reasons,
        blast_score: blast.score(),
        proposed_claim: claim,
        attaches,
        status,
        answer: None,
        created: now(),
        resolved: None,
    };
    existing_questions.push(q.clone());
    Some(q)
}

/// Human confirmation of a `ready_to_graduate` (or `probing`) guide (`afwe guide confirm <id>`).
/// Promotes the guide to `graduated`, creates an active standing check in `.afwe/checks/`,
/// and updates the originating model's calibration profile.
pub fn confirm_guide(engine: &Engine, guide_id: &str, origin: &str) -> Result<CheckSpec> {
    if crate::authority::authority_of(origin) != crate::authority::Authority::Human {
        return Err(anyhow!("only human authority can confirm a guide for graduation"));
    }
    let mut cal = engine.store.calibration()?;
    let idx = cal
        .guides
        .iter()
        .position(|g| g.id == guide_id)
        .ok_or_else(|| anyhow!("guide `{guide_id}` not found"))?;

    let check_id = slug(&format!("grad-{}", cal.guides[idx].id));
    let spec = CheckSpec {
        id: check_id.clone(),
        title: cal.guides[idx].title.clone(),
        trust: CheckTrust::Deterministic,
        authored_by: "checkgen:graduated".into(),
        attaches: cal.guides[idx].attaches.clone(),
        command: None,
        claim: Some(cal.guides[idx].claim.clone()),
        timeout_s: None,
        status: "active".into(),
        origin: Some(origin.to_string()),
        created: Some(now()),
        created_from: cal.guides[idx].created_from.clone(),
        superseded_by: None,
        provenance: Some("graduated".into()),
    };
    engine.store.save_check(&spec)?;

    let model_origin = cal.guides[idx].origin.clone();
    cal.guides[idx].status = "graduated".into();
    cal.guides[idx].provenance = "graduated".into();
    cal.guides[idx].graduated_check_id = Some(check_id.clone());
    cal.guides[idx].confirmed_by = Some(origin.to_string());
    cal.guides[idx].confirmed_at = Some(now());

    let model_key = model_origin.trim_start_matches("llm:").to_string();
    if !model_key.is_empty() && model_key != "human" {
        let profile = cal.models.entry(model_key.clone()).or_insert_with(|| ModelCalibrationProfile {
            model_id: model_key,
            ..Default::default()
        });
        record_human_adjudication(profile, true);
    }

    engine.store.save_calibration(&cal)?;
    engine.log(
        origin,
        "guide_confirm",
        format!("Graduated guide `{guide_id}` to active check `{check_id}`"),
        None,
    )?;
    Ok(spec)
}

/// Derives a session ID for a turn from harness environment variables or recent turn activity.
pub fn derive_session_id(engine: &Engine, agent: Option<&str>, explicit: Option<String>) -> String {
    if let Some(s) = explicit.filter(|s| !s.is_empty()) {
        return s;
    }
    for env_key in ["DELTA_THREAD_ID", "AFWE_SESSION_ID", "CLAUDE_SESSION_ID", "CURSOR_TRACE_ID"] {
        if let Ok(val) = std::env::var(env_key) {
            if !val.trim().is_empty() {
                return format!("{}:{}", env_key.to_lowercase(), val.trim());
            }
        }
    }
    if let Ok(turns) = engine.store.turns() {
        if let Some(last) = turns.last() {
            if last.agent.as_deref() == agent {
                if let Some(existing) = &last.session_id {
                    return existing.clone();
                }
            }
        }
    }
    short_id("sess")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rubric_produces_documented_scores_and_caps_contradictions() {
        // Unverified floor
        assert_eq!(compute_rubric_score(&RubricEvidence::default()), 0.50);

        // High-quality structural claim only: 0.50 + 0.25 = 0.75
        assert_eq!(
            compute_rubric_score(&RubricEvidence {
                high_quality_claim: true,
                ..Default::default()
            }),
            0.75
        );

        // Structural claim + sibling consistency: 0.50 + 0.25 + 0.10 = 0.85 (enters ProbingGuide band)
        assert_eq!(
            compute_rubric_score(&RubricEvidence {
                high_quality_claim: true,
                sibling_consistent: true,
                ..Default::default()
            }),
            0.85
        );

        // + 3 qualifying probes: 0.85 + 0.06 = 0.91 (>= 0.90 graduation band)
        assert_eq!(
            compute_rubric_score(&RubricEvidence {
                high_quality_claim: true,
                sibling_consistent: true,
                contradicts_history: false,
                qualifying_probes: 3,
            }),
            0.91
        );

        // Contradiction caps at 0.40 regardless of other evidence
        assert_eq!(
            compute_rubric_score(&RubricEvidence {
                high_quality_claim: true,
                sibling_consistent: true,
                contradicts_history: true,
                qualifying_probes: 5,
            }),
            0.40
        );
    }

    #[test]
    fn obeyed_guide_only_without_hold_out_does_not_graduate_and_same_session_counts_once() {
        let mut guide = GuideState {
            id: "g1".into(),
            title: "Payments must not import UI".into(),
            status: "probing".into(),
            score: 0.85,
            claim: AssumptionClaim {
                kind: "forbid_import".into(),
                to_nodes: vec!["ui".into()],
                ..Default::default()
            },
            attaches: Attachment {
                nodes: vec!["payments".into()],
                ..Default::default()
            },
            ..Default::default()
        };
        let policy = GraduationPolicy {
            require_human: false, // Even in Option B (auto), hold-out is required!
            min_probe_sessions: 3,
            require_hold_out: true,
        };

        // Probe 1 in sess-1 (not held out)
        assert!(evaluate_probe_for_guide(
            &mut guide,
            "t0001",
            "sess-1",
            Some("src/payments/a.rs::charge".into()),
            true,
            false,
            &policy,
            true,
        ));
        assert_eq!(guide.probes.len(), 1);

        // Second turn in the SAME session sess-1 -> must NOT count!
        assert!(!evaluate_probe_for_guide(
            &mut guide,
            "t0002",
            "sess-1",
            Some("src/payments/a.rs::charge".into()),
            true,
            false,
            &policy,
            true,
        ));
        assert_eq!(guide.probes.len(), 1);

        // Turn touching an unrelated symbol (None) -> must NOT count!
        assert!(!evaluate_probe_for_guide(
            &mut guide,
            "t0003",
            "sess-2",
            None,
            true,
            true,
            &policy,
            true,
        ));
        assert_eq!(guide.probes.len(), 1);

        // Probes 2 and 3 in sess-2 and sess-3, both with held_out = false (obeyed-guide-only echo chamber)
        evaluate_probe_for_guide(
            &mut guide,
            "t0004",
            "sess-2",
            Some("src/payments/a.rs::charge".into()),
            true,
            false,
            &policy,
            true,
        );
        evaluate_probe_for_guide(
            &mut guide,
            "t0005",
            "sess-3",
            Some("src/payments/a.rs::charge".into()),
            true,
            false,
            &policy,
            true,
        );
        assert_eq!(guide.probes.len(), 3);
        assert!(guide.score >= 0.90);
        // Must STILL be "probing" because there was no hold-out probe!
        assert_eq!(guide.status, "probing");

        // Now a hold-out probe in sess-4:
        // First test Option A (require_human = true): transitions to ready_to_graduate
        let policy_a = GraduationPolicy {
            require_human: true,
            min_probe_sessions: 3,
            require_hold_out: true,
        };
        evaluate_probe_for_guide(
            &mut guide,
            "t0006",
            "sess-4",
            Some("src/payments/a.rs::charge".into()),
            true,
            true,
            &policy_a,
            true,
        );
        assert_eq!(guide.status, "ready_to_graduate");

        // And with Option B (require_human = false) on a fresh session sess-5: transitions to graduated
        evaluate_probe_for_guide(
            &mut guide,
            "t0007",
            "sess-5",
            Some("src/payments/a.rs::charge".into()),
            true,
            true,
            &policy,
            true,
        );
        assert_eq!(guide.status, "graduated");
    }

    #[test]
    fn trust_factor_unchanged_under_10_human_outcomes_and_clamped() {
        let mut prof = ModelCalibrationProfile::default();
        for _ in 0..9 {
            record_human_adjudication(&mut prof, true);
        }
        // Fewer than 10 outcomes -> stays at 1.0
        assert_eq!(prof.trust_factor, 1.0);

        // 10th human acceptance -> moves to 1.1
        record_human_adjudication(&mut prof, true);
        assert_eq!(prof.trust_factor, 1.1);

        // All rejections -> clamped to 0.8
        let mut bad = ModelCalibrationProfile::default();
        for _ in 0..12 {
            record_human_adjudication(&mut bad, false);
        }
        assert_eq!(bad.trust_factor, 0.8);
    }

    #[test]
    fn blast_radius_filters_leaf_items_and_caps_session_questions_at_3() {
        let mut questions = vec![];
        let low_blast = BlastAssessment {
            exported_symbol: false,
            cross_subsystem: false,
            contradicts_history: false,
        };
        // Low-blast item creates no question
        assert!(route_low_confidence_item(
            &mut questions,
            "t0001",
            "sess-1",
            "local helper naming",
            None,
            Attachment::default(),
            &low_blast
        )
        .is_none());
        assert!(questions.is_empty());

        // High-blast items: first 3 in sess-1 are "open", 4th is "deferred"
        let high_blast = BlastAssessment {
            exported_symbol: true,
            cross_subsystem: true,
            contradicts_history: false,
        };
        for i in 1..=4 {
            let q = route_low_confidence_item(
                &mut questions,
                &format!("t000{i}"),
                "sess-1",
                &format!("rule {i}"),
                None,
                Attachment::default(),
                &high_blast,
            )
            .unwrap();
            if i <= 3 {
                assert_eq!(q.status, "open");
            } else {
                assert_eq!(q.status, "deferred");
            }
        }
        assert_eq!(questions.iter().filter(|q| q.status == "open").count(), 3);
        assert_eq!(questions.iter().filter(|q| q.status == "deferred").count(), 1);
    }
}
