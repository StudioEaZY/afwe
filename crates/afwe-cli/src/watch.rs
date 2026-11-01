//! Live terminal dashboard monitor (`afwe watch`).
//!
//! Renders invariant status, prompter authority, active turns, and the 6-state
//! Action Queue in real-time.

use std::path::Path;
use std::time::Duration;
use anyhow::Result;
use afwe_core::Engine;

pub fn run_watch(project_dir: &Path, interval_secs: u64, once: bool) -> Result<()> {
    loop {
        // Re-instantiate engine to pick up disk state accurately on each tick
        let mut engine = Engine::open(project_dir)?;
        render_dashboard(&mut engine)?;

        if once {
            break;
        }

        std::thread::sleep(Duration::from_secs(interval_secs));
    }
    Ok(())
}

fn render_dashboard(engine: &mut Engine) -> Result<()> {
    let project_id = afwe_core::authority_store::compute_project_id(&engine.store.project_root);
    let auth = afwe_core::authority_store::load_authority(&project_id);
    let q = afwe_core::queue::get_action_queue(engine, auth.delegation.as_ref())?;
    let turns = engine.store.turns().unwrap_or_default();
    let active_turn = turns.iter().find(|t| t.status == "open");

    // ANSI escape code: clear screen and move cursor to home position
    print!("\x1B[2J\x1B[H");

    println!("┌──────────────────────────────────────────────────────────────────────────────┐");
    println!("│ ⛨ AFWE TERMINAL SURFACE · LIVE GOVERNANCE MONITOR                            │");
    println!("└──────────────────────────────────────────────────────────────────────────────┘");

    // 1. Prompter Authority Section
    match auth.mode {
        afwe_core::authority::AuthorityMode::HumanOnly => {
            println!("  GOVERNANCE: \x1B[32;1mHUMAN-ONLY\x1B[0m (Deterministic default · Direct human presence required)");
        }
        afwe_core::authority::AuthorityMode::PrompterDelegated => {
            if let Some(del) = &auth.delegation {
                let door_str = match del.holder.door {
                    afwe_core::authority::Door::Ui => "UI",
                    afwe_core::authority::Door::Mcp => "MCP",
                };
                let ttl_remaining = del.validity.remaining_seconds();
                let hours = ttl_remaining / 3600;
                let mins = (ttl_remaining % 3600) / 60;
                println!(
                    "  GOVERNANCE: \x1B[35;1mPROMPTER DELEGATED\x1B[0m (Holder: \x1B[1m{}\x1B[0m · Door: {} · TTL: {}h {}m)",
                    del.holder.agent_id, door_str, hours, mins
                );
                println!(
                    "  BUDGET:     Approvals: {}/{} · Self-Heals: {}/{} · Auto-Merge: {}",
                    del.budget.auto_approvals_used,
                    del.budget.auto_approvals_max,
                    del.budget.self_heals_used,
                    del.budget.self_heals_max,
                    if del.budget.auto_merge { "ON" } else { "OFF" }
                );
            }
        }
    }
    println!("  PROJECT:    {}", engine.store.project_root.display());
    println!("────────────────────────────────────────────────────────────────────────────────");

    // 2. Active Turn Section
    if let Some(turn) = active_turn {
        println!(
            "  ACTIVE TURN: \x1B[33;1m{}\x1B[0m · Origin: {} · Pins: {}",
            turn.id, turn.origin, turn.targets.len()
        );
        let prompt_trunc: String = turn.prompt.chars().take(70).collect();
        println!("  PROMPT:      \"{prompt_trunc}\"");
    } else {
        println!("  ACTIVE TURN: None (\x1B[32mReady for turn.begin\x1B[0m)");
    }
    println!("────────────────────────────────────────────────────────────────────────────────");

    // 3. Action Queue Counters Bar
    let s = &q.summary;
    println!(
        "  ACTION QUEUE: \x1B[1m{} Actionable\x1B[0m",
        s.total_actionable
    );
    println!(
        "  \x1B[32mSTAGED: {}\x1B[0m │ \x1B[33mGHOST REDO: {}\x1B[0m │ \x1B[34mREADY: {}\x1B[0m │ \x1B[36mDRIFT: {}\x1B[0m │ \x1B[35mSTALE LEASES: {}\x1B[0m │ \x1B[31mUNATTRIBUTED: {}\x1B[0m",
        s.staged_count,
        s.ghost_redo_count,
        s.ready_count,
        s.advisory_drift_count,
        s.stale_leases_count,
        s.unattributed_count
    );
    println!("────────────────────────────────────────────────────────────────────────────────");

    // 4. Action Queue Items Detail Table
    if q.items.is_empty() {
        println!("  \x1B[90m(Action queue is empty — all invariants satisfied)\x1B[0m");
    } else {
        println!("  {:<14} {:<12} {:<24} {:<26}", "KIND", "ITEM", "TITLE / SCOPE", "ALLOWED ACTIONS");
        println!("  {:-<14} {:-<12} {:-<24} {:-<26}", "", "", "", "");
        for item in &q.items {
            let (kind_color, kind_str) = match item.kind {
                afwe_core::queue::QueueItemKind::Staged => ("\x1B[32m", "STAGED"),
                afwe_core::queue::QueueItemKind::PausedTurn => ("\x1B[33m", "PAUSED"),
                afwe_core::queue::QueueItemKind::GhostRedo => ("\x1B[33m", "GHOST REDO"),
                afwe_core::queue::QueueItemKind::ReadyManual | afwe_core::queue::QueueItemKind::ReadyGitError => ("\x1B[34m", "READY"),
                afwe_core::queue::QueueItemKind::AdvisoryDrift => ("\x1B[36m", "DRIFT"),
                afwe_core::queue::QueueItemKind::ToleratedDriftExpired => ("\x1B[33m", "EXPIRED DRIFT"),
                afwe_core::queue::QueueItemKind::StaleNodeLease => ("\x1B[35m", "STALE LEASE"),
                afwe_core::queue::QueueItemKind::Unattributed => ("\x1B[31m", "UNATTRIBUTED"),
            };
            let title_trunc: String = item.title.chars().take(22).collect();
            let actions = item.actions.iter().map(|a| a.label.as_str()).collect::<Vec<_>>().join(", ");
            println!(
                "  {}{:<14}\x1B[0m {:<12} {:<24} {:<26}",
                kind_color, kind_str, item.id, title_trunc, actions
            );
            if !item.detail.is_empty() {
                let detail_trunc: String = item.detail.chars().take(72).collect();
                println!("    \x1B[90m↳ {}\x1B[0m", detail_trunc);
            }
        }
    }
    println!("────────────────────────────────────────────────────────────────────────────────");
    println!("  Commands: `afwe queue act <id> <act>` │ `afwe authority revoke` │ Ctrl+C to exit");

    Ok(())
}
