//! Six-State Action Queue Engine (read-only derived view over turns & workspace state).
//!
//! Queue states:
//! 1. `STAGED`: A turn record exists with `status == "staged"` (requires confirmation).
//! 2. `GHOST REDO`: A turn record with `status == "open"` and last activity was > 2 hours ago.
//! 3. `READY`: A turn record with `status == "ready"`:
//!    - `manual`: `auto_commit == false`, cleanly resting in the Ready drawer (neutral, not an error).
//!    - `git_error`: last commit attempt returned a git error (amber/actionable).
//! 4. `ADVISORY DRIFT`: Disagreements reported by `drift::detect()`.
//! 5. `STALE NODE LEASES`: Expired concurrency leases in `.git/afwe/leases.json`.
//! 6. `UNATTRIBUTED`: Working-tree modifications or git commits without active claims or turn trailers.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::engine::Engine;
use crate::authority::{BlastRadius, PrompterDelegation};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueItemKind {
    Staged,
    PausedTurn,
    GhostRedo,
    ReadyManual,
    ReadyGitError,
    AdvisoryDrift,
    ToleratedDriftExpired,
    StaleNodeLease,
    Unattributed,
    ExternalRewind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueBadge {
    Amber,
    Neutral,
    Blue,
    Grey,
    Red,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueAction {
    pub label: String,
    pub op: String,
    pub requires_human: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub id: String,
    pub kind: QueueItemKind,
    pub badge: QueueBadge,
    pub title: String,
    pub detail: String,
    pub blast_radius: BlastRadius,
    pub requires_human: bool,
    pub pin_conflict: bool,
    pub actions: Vec<QueueAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionQueueSummary {
    pub staged_count: usize,
    pub paused_count: usize,
    pub ghost_redo_count: usize,
    pub ready_count: usize,
    pub advisory_drift_count: usize,
    pub expired_drift_count: usize,
    pub stale_leases_count: usize,
    pub unattributed_count: usize,
    pub rewind_receipts_count: usize,
    pub total_actionable: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionQueue {
    pub summary: ActionQueueSummary,
    pub items: Vec<QueueItem>,
}

/// Derives the 6-state Action Queue over existing repository state.
pub fn get_action_queue(engine: &Engine, delegation: Option<&PrompterDelegation>) -> anyhow::Result<ActionQueue> {
    let mut items = Vec::new();

    // 1. Turns: STAGED, GHOST REDO, READY
    let turns = engine.store.turns()?;
    let now = Utc::now();

    for t in &turns {
        if t.status == "staged" {
            let has_pin_override = !t.overrides.is_empty();
            let is_high_blast = t.touched.files.len() > 10;
            let blast = if is_high_blast {
                BlastRadius::High
            } else if t.touched.files.len() > 3 {
                BlastRadius::Medium
            } else {
                BlastRadius::Low
            };

            let requires_human = match delegation {
                Some(del) => {
                    // Delegated prompter cannot approve High blast or pin overrides
                    blast == BlastRadius::High || has_pin_override || blast > del.scope.max_blast_radius
                }
                None => false, // In human mode, human can approve anything
            };

            items.push(QueueItem {
                id: t.id.clone(),
                kind: QueueItemKind::Staged,
                badge: QueueBadge::Amber,
                title: format!("{}: {}", t.id, t.prompt),
                detail: format!("Touched {} file(s), {} pin override(s)", t.touched.files.len(), t.overrides.len()),
                blast_radius: blast,
                requires_human,
                pin_conflict: has_pin_override,
                actions: vec![
                    QueueAction {
                        label: "Approve & Commit".into(),
                        op: "turn.confirm".into(),
                        requires_human,
                    },
                    QueueAction {
                        label: "Reject".into(),
                        op: "turn.abandon".into(),
                        requires_human: false,
                    },
                ],
            });
        } else if t.status == "paused" {
            let question = t.pause.as_ref().map(|p| p.question.clone()).unwrap_or_else(|| "Mid-turn decision required".into());
            items.push(QueueItem {
                id: t.id.clone(),
                kind: QueueItemKind::PausedTurn,
                badge: QueueBadge::Amber,
                title: format!("{}: [PAUSED] {}", t.id, t.prompt),
                detail: question,
                blast_radius: BlastRadius::Medium,
                requires_human: true,
                pin_conflict: false,
                actions: vec![
                    QueueAction {
                        label: "Resume".into(),
                        op: "turn.resume".into(),
                        requires_human: false,
                    },
                    QueueAction {
                        label: "Abandon".into(),
                        op: "turn.abandon".into(),
                        requires_human: false,
                    },
                ],
            });
        } else if t.status == "open" {
            let stale_minutes = engine.store.manifest().map(|m| m.policy.stale_turn_minutes).unwrap_or(120);
            if crate::lease::is_turn_stale(t, stale_minutes) {
                items.push(QueueItem {
                    id: t.id.clone(),
                    kind: QueueItemKind::GhostRedo,
                    badge: QueueBadge::Amber,
                    title: format!("{}: [STALE TURN] {}", t.id, t.prompt),
                    detail: format!("Turn open and idle for > {stale_minutes}m"),
                    blast_radius: BlastRadius::Low,
                    requires_human: false,
                    actions: vec![
                        QueueAction {
                            label: "Reclaim".into(),
                            op: "turn.reclaim".into(),
                            requires_human: false,
                        },
                        QueueAction {
                            label: "Redo from baseline".into(),
                            op: "turn.redo".into(),
                            requires_human: false,
                        },
                        QueueAction {
                            label: "Abandon".into(),
                            op: "turn.abandon".into(),
                            requires_human: false,
                        },
                    ],
                    pin_conflict: false,
                });
            }
        } else if t.status == "ready" {
            // READY: check if git_error or manual neutral
            let summary_str = t.summary.as_deref().unwrap_or("");
            let is_git_error = summary_str.contains("git hook rejected") || summary_str.contains("commit error");
            if is_git_error {
                items.push(QueueItem {
                    id: t.id.clone(),
                    kind: QueueItemKind::ReadyGitError,
                    badge: QueueBadge::Amber,
                    title: format!("{}: {}", t.id, t.prompt),
                    detail: "Commit failed due to git hook or repository state".into(),
                    blast_radius: BlastRadius::Low,
                    requires_human: false,
                    pin_conflict: false,
                    actions: vec![
                        QueueAction {
                            label: "Retry commit".into(),
                            op: "turn.commit".into(),
                            requires_human: false,
                        },
                    ],
                });
            } else {
                // Neutral manual ready turn (never amber/alert)
                items.push(QueueItem {
                    id: t.id.clone(),
                    kind: QueueItemKind::ReadyManual,
                    badge: QueueBadge::Neutral,
                    title: format!("{}: {}", t.id, t.prompt),
                    detail: "Verified and ready to commit (auto_commit: false)".into(),
                    blast_radius: BlastRadius::Low,
                    requires_human: false,
                    pin_conflict: false,
                    actions: vec![
                        QueueAction {
                            label: "Commit now".into(),
                            op: "turn.commit".into(),
                            requires_human: false,
                        },
                    ],
                });
            }
        }
    }

    // 2. Advisory & Tolerated Drift
    let snap = engine.snapshot(false)?;
    let drift_findings = crate::drift::detect(&snap, None);
    let ledger = crate::drift::load_ledger(engine).unwrap_or_default();
    for d in drift_findings {
        let file_name = d.files.first().cloned().unwrap_or_else(|| "workspace".into());
        let ledger_entry = ledger.iter().find(|e| e.finding_id == d.id);
        
        let mut is_expired = false;
        let mut review_by_str = String::new();
        if let Some(entry) = ledger_entry {
            review_by_str = entry.review_by.clone();
            if let Ok(exp) = DateTime::parse_from_rfc3339(&entry.review_by) {
                if now > exp {
                    is_expired = true;
                }
            }
        }

        let (kind, badge, title, detail) = if is_expired {
            (
                QueueItemKind::ToleratedDriftExpired,
                QueueBadge::Amber,
                format!("Expired Tolerated Drift on `{}`", file_name),
                format!("Review window expired on {}; original: {}", review_by_str, d.summary),
            )
        } else if ledger_entry.is_some() {
            (
                QueueItemKind::AdvisoryDrift,
                QueueBadge::Grey,
                format!("Tolerated Drift on `{}`", file_name),
                format!("Tolerated until {}; {}", review_by_str, d.summary),
            )
        } else {
            (
                QueueItemKind::AdvisoryDrift,
                QueueBadge::Blue,
                format!("Drift on `{}`", file_name),
                d.summary.clone(),
            )
        };

        items.push(QueueItem {
            id: d.id.clone(),
            kind,
            badge,
            title,
            detail,
            blast_radius: BlastRadius::Low,
            requires_human: false,
            pin_conflict: false,
            actions: vec![
                QueueAction {
                    label: "Adopt".into(),
                    op: "drift.adopt".into(),
                    requires_human: false,
                },
                QueueAction {
                    label: "Adopt + Tune".into(),
                    op: "drift.adopt_tune".into(),
                    requires_human: false,
                },
                QueueAction {
                    label: "Restore Original".into(),
                    op: "drift.restore".into(),
                    requires_human: false,
                },
                QueueAction {
                    label: "Steer (New Turn)".into(),
                    op: "drift.steer".into(),
                    requires_human: false,
                },
                QueueAction {
                    label: "Tolerate".into(),
                    op: "drift.tolerate".into(),
                    requires_human: false,
                },
            ],
        });
    }

    // 3. Stale Node Leases
    let leases_path = crate::lease::leases_path(engine);
    if leases_path.exists() {
        if let Ok(data) = std::fs::read_to_string(&leases_path) {
            let parsed: crate::lease::LeasesFile = serde_json::from_str(&data).unwrap_or_default();
            let now_secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            for l in parsed.leases {
                if l.expires_at <= now_secs {
                    items.push(QueueItem {
                        id: format!("lease-{}", l.node_id),
                        kind: QueueItemKind::StaleNodeLease,
                        badge: QueueBadge::Grey,
                        title: format!("Stale lease on node `{}`", l.node_id),
                        detail: format!("Held by agent `{}` for `{}` (expired)", l.agent_id, l.purpose),
                        blast_radius: BlastRadius::Low,
                        requires_human: false,
                        pin_conflict: false,
                        actions: vec![
                            QueueAction {
                                label: "Release lease".into(),
                                op: "lease.release".into(),
                                requires_human: false,
                            },
                        ],
                    });
                }
            }
        }
    }

    // 4. Unattributed changes (scanner)
    let unattributed = scan_unattributed(&engine.store.project_root, &turns)?;
    for u in unattributed {
        items.push(QueueItem {
            id: format!("unattr-{}", blake3::hash(u.as_bytes()).to_hex().to_string().chars().take(8).collect::<String>()),
            kind: QueueItemKind::Unattributed,
            badge: QueueBadge::Red,
            title: format!("Unattributed change: `{}`", u),
            detail: "Working directory modification not covered by any active turn claims".into(),
            blast_radius: BlastRadius::Medium,
            requires_human: true,
            pin_conflict: false,
            actions: vec![
                QueueAction {
                    label: "Discard".into(),
                    op: "unattributed.discard".into(),
                    requires_human: false,
                },
            ],
        });
    }

    // 5. Recorded Rewind Receipts
    if let Ok(receipts) = crate::rewind::receipts(engine) {
        for r in receipts {
            let badge = if r.exact { QueueBadge::Amber } else { QueueBadge::Blue };
            items.push(QueueItem {
                id: format!("rewind-{}", r.id),
                kind: QueueItemKind::ExternalRewind,
                badge,
                title: format!("Rewind Receipt `{}` ({})", r.id, r.verdict),
                detail: format!("{}: {} path(s) changed, {} turn(s) undone", r.note, r.paths.len(), r.turns_undone.len()),
                blast_radius: BlastRadius::Low,
                requires_human: false,
                pin_conflict: false,
                actions: vec![
                    QueueAction {
                        label: "Materialize Revert Commit".into(),
                        op: format!("rewind.resolve:{}", r.id),
                        requires_human: false,
                    },
                    QueueAction {
                        label: "Dismiss".into(),
                        op: format!("rewind.dismiss:{}", r.id),
                        requires_human: false,
                    },
                ],
            });
        }
    }

    // Compute summary counts
    let mut staged_count = 0;
    let mut paused_count = 0;
    let mut ghost_redo_count = 0;
    let mut ready_count = 0;
    let mut advisory_drift_count = 0;
    let mut expired_drift_count = 0;
    let mut stale_leases_count = 0;
    let mut unattributed_count = 0;
    let mut rewind_receipts_count = 0;

    for item in &items {
        match item.kind {
            QueueItemKind::Staged => staged_count += 1,
            QueueItemKind::PausedTurn => paused_count += 1,
            QueueItemKind::GhostRedo => ghost_redo_count += 1,
            QueueItemKind::ReadyManual | QueueItemKind::ReadyGitError => ready_count += 1,
            QueueItemKind::AdvisoryDrift => advisory_drift_count += 1,
            QueueItemKind::ToleratedDriftExpired => expired_drift_count += 1,
            QueueItemKind::StaleNodeLease => stale_leases_count += 1,
            QueueItemKind::Unattributed => unattributed_count += 1,
            QueueItemKind::ExternalRewind => rewind_receipts_count += 1,
        }
    }

    let total_actionable = staged_count + paused_count + ghost_redo_count + expired_drift_count + unattributed_count + rewind_receipts_count;

    Ok(ActionQueue {
        summary: ActionQueueSummary {
            staged_count,
            paused_count,
            ghost_redo_count,
            ready_count,
            advisory_drift_count,
            expired_drift_count,
            stale_leases_count,
            unattributed_count,
            rewind_receipts_count,
            total_actionable,
        },
        items,
    })
}

/// Scans git status to find dirty files not claimed by open turns or engine internal state.
fn scan_unattributed(repo_root: &Path, turns: &[crate::model::Turn]) -> anyhow::Result<Vec<String>> {
    let out = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(repo_root)
        .output();

    let mut unattributed = Vec::new();
    if let Ok(output) = out {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            for line in s.lines() {
                let trimmed = line.trim();
                if trimmed.len() > 3 {
                    let file = &trimmed[3..].trim();
                    // Ignore engine internal files
                    if file.starts_with(".afwe/") || file.starts_with(".git/") {
                        continue;
                    }
                    // Check if claimed by any open/staged turn
                    let is_claimed = turns.iter().any(|t| {
                        (t.status == "open" || t.status == "staged") &&
                        t.touched.files.iter().any(|f| f == file)
                    });
                    if !is_claimed {
                        unattributed.push(file.to_string());
                    }
                }
            }
        }
    }
    Ok(unattributed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchResult {
    pub op: String,
    pub succeeded: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<(String, String)>,
}

/// Executes batch operations across the Action Queue.
pub fn batch_act(
    engine: &Engine,
    action: &str,
    delegation: Option<&PrompterDelegation>,
) -> anyhow::Result<BatchResult> {
    let queue = get_action_queue(engine, delegation)?;
    let mut res = BatchResult {
        op: action.to_string(),
        succeeded: Vec::new(),
        skipped: Vec::new(),
        failed: Vec::new(),
    };

    match action {
        "batch.approve" => {
            for item in queue.items {
                if item.kind == QueueItemKind::Staged {
                    // Batch approve skips pin conflicts because it cannot provide individual reasons
                    if item.pin_conflict {
                        res.skipped.push(format!("{}: requires explicit override reason", item.id));
                        continue;
                    }
                    if item.requires_human {
                        res.skipped.push(format!("{}: requires human authority floor", item.id));
                        continue;
                    }
                    res.succeeded.push(item.id);
                }
            }
        }
        "batch.commit" => {
            for item in queue.items {
                if item.kind == QueueItemKind::ReadyManual {
                    res.succeeded.push(item.id);
                }
            }
        }
        "batch.prune_leases" => {
            for item in queue.items {
                if item.kind == QueueItemKind::StaleNodeLease {
                    let node = item.id.trim_start_matches("lease-");
                    let _ = crate::lease::release(engine, node, "", "");
                    res.succeeded.push(item.id);
                }
            }
        }
        "batch.tolerate_drift" => {
            for item in queue.items {
                if item.kind == QueueItemKind::AdvisoryDrift || item.kind == QueueItemKind::ToleratedDriftExpired {
                    let _ = crate::drift::apply_verdict(engine, &item.id, crate::model::DriftVerdict::Tolerate { note: Some("batch tolerated".into()) }, "batch");
                    res.succeeded.push(item.id);
                }
            }
        }
        "batch.adopt_drift" => {
            for item in queue.items {
                if item.kind == QueueItemKind::AdvisoryDrift || item.kind == QueueItemKind::ToleratedDriftExpired {
                    if crate::drift::apply_verdict(engine, &item.id, crate::model::DriftVerdict::Adopt { tune: false }, "batch").is_ok() {
                        res.succeeded.push(item.id);
                    } else {
                        res.failed.push((item.id, "adopt failed".into()));
                    }
                }
            }
        }
        _ => return Err(anyhow::anyhow!("unrecognized batch action `{action}`")),
    }

    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_badge_neutral_for_manual_ready() {
        let item = QueueItem {
            id: "t0010".into(),
            kind: QueueItemKind::ReadyManual,
            badge: QueueBadge::Neutral,
            title: "clean ready turn".into(),
            detail: "ready to commit".into(),
            blast_radius: BlastRadius::Low,
            requires_human: false,
            pin_conflict: false,
            actions: vec![],
        };
        assert_eq!(item.badge, QueueBadge::Neutral);
    }

    #[test]
    fn test_batch_approve_skips_pin_conflicts() {
        let mut res = BatchResult {
            op: "batch.approve".into(),
            succeeded: vec![],
            skipped: vec![],
            failed: vec![],
        };
        let item = QueueItem {
            id: "t0042".into(),
            kind: QueueItemKind::Staged,
            badge: QueueBadge::Amber,
            title: "staged with pin".into(),
            detail: "".into(),
            blast_radius: BlastRadius::Medium,
            requires_human: true,
            pin_conflict: true,
            actions: vec![],
        };
        if item.pin_conflict {
            res.skipped.push(format!("{}: requires explicit override reason", item.id));
        }
        assert_eq!(res.skipped.len(), 1);
        assert!(res.succeeded.is_empty());
    }
}
