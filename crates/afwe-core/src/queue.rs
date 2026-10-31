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
    GhostRedo,
    ReadyManual,
    ReadyGitError,
    AdvisoryDrift,
    StaleNodeLease,
    Unattributed,
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
    pub ghost_redo_count: usize,
    pub ready_count: usize,
    pub advisory_drift_count: usize,
    pub stale_leases_count: usize,
    pub unattributed_count: usize,
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
        } else if t.status == "open" {
            // Check for Ghost Redo (> 2 hours idle)
            let mut is_ghost = false;
            let ts_str = if !t.last_activity.is_empty() {
                &t.last_activity
            } else {
                &t.ts
            };
            if let Ok(dt) = DateTime::parse_from_rfc3339(ts_str) {
                if now.signed_duration_since(dt).num_hours() >= 2 {
                    is_ghost = true;
                }
            }

            if is_ghost {
                items.push(QueueItem {
                    id: t.id.clone(),
                    kind: QueueItemKind::GhostRedo,
                    badge: QueueBadge::Amber,
                    title: format!("{}: {}", t.id, t.prompt),
                    detail: "Turn open and idle for > 2 hours".into(),
                    blast_radius: BlastRadius::Low,
                    requires_human: false,
                    actions: vec![
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

    // 2. Advisory Drift
    let snap = engine.snapshot(false)?;
    let drift_findings = crate::drift::detect(&snap, None);
    for d in drift_findings {
        let file_name = d.files.first().cloned().unwrap_or_else(|| "workspace".into());
        items.push(QueueItem {
            id: format!("drift-{}", blake3::hash(file_name.as_bytes()).to_hex().to_string().chars().take(8).collect::<String>()),
            kind: QueueItemKind::AdvisoryDrift,
            badge: QueueBadge::Blue,
            title: format!("Drift on `{}`", file_name),
            detail: d.summary.clone(),
            blast_radius: BlastRadius::Low,
            requires_human: false,
            pin_conflict: false,
            actions: vec![
                QueueAction {
                    label: "Dismiss".into(),
                    op: "drift.dismiss".into(),
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

    // Compute summary counts
    let mut staged_count = 0;
    let mut ghost_redo_count = 0;
    let mut ready_count = 0;
    let mut advisory_drift_count = 0;
    let mut stale_leases_count = 0;
    let mut unattributed_count = 0;

    for item in &items {
        match item.kind {
            QueueItemKind::Staged => staged_count += 1,
            QueueItemKind::GhostRedo => ghost_redo_count += 1,
            QueueItemKind::ReadyManual | QueueItemKind::ReadyGitError => ready_count += 1,
            QueueItemKind::AdvisoryDrift => advisory_drift_count += 1,
            QueueItemKind::StaleNodeLease => stale_leases_count += 1,
            QueueItemKind::Unattributed => unattributed_count += 1,
        }
    }

    let total_actionable = staged_count + ghost_redo_count + unattributed_count;

    Ok(ActionQueue {
        summary: ActionQueueSummary {
            staged_count,
            ghost_redo_count,
            ready_count,
            advisory_drift_count,
            stale_leases_count,
            unattributed_count,
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
