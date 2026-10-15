//! Standardized invariant status header generator.
//!
//! Emits the dedicated single source of truth symbol: ⛨
//! Formats:
//! - `⛨ AFWE · <turn> · COMMIT <confidence>% · <pins> pin(s) held`
//! - `⛨ AFWE · <turn> · STAGED <confidence>% · <escalations> escalation(s) pending`
//! - `⛨ AFWE · <turn> · REDO x<n> -> committed`
//! - `⛨ AFWE · read-only · in-sync`

use crate::engine::Engine;
use crate::model::Turn;
use anyhow::Result;

pub const SHIELD_SYMBOL: &str = "⛨";

pub fn render(engine: &Engine, turn_id: Option<&str>) -> Result<String> {
    let t = match turn_id {
        Some(id) => engine.store.turn(id).ok().flatten(),
        None => None,
    };
    render_turn(engine, t.as_ref())
}

pub fn render_turn(engine: &Engine, turn: Option<&Turn>) -> Result<String> {
    let pins = engine.store.pins()?;
    let active_pins = pins.iter().filter(|p| p.status == "active").count();
    let escalations = crate::escalation::list(engine)?;
    let pending_esc = escalations.iter().filter(|e| e.status == "pending").count();

    match turn {
        Some(t) => {
            let id = &t.id;
            let status = match t.status.as_str() {
                "committed" => "COMMIT".to_string(),
                "staged" => "STAGED".to_string(),
                "ready" => "READY".to_string(),
                "open" => "OPEN".to_string(),
                other => other.to_uppercase(),
            };
            let conf = (t.confidence * 100.0).round() as u64;
            let mut parts = vec![
                format!("{SHIELD_SYMBOL} AFWE"),
                id.clone(),
                format!("{status} {conf}%"),
            ];

            if pending_esc > 0 {
                parts.push(format!("{pending_esc} escalation(s) pending"));
            } else if active_pins > 0 {
                parts.push(format!("{active_pins} pin(s) held"));
            } else {
                parts.push("active".into());
            }

            Ok(parts.join(" · "))
        }
        None => {
            let mut parts = vec![format!("{SHIELD_SYMBOL} AFWE"), "read-only".into()];
            if pending_esc > 0 {
                parts.push(format!("{pending_esc} escalation(s) pending"));
            } else {
                parts.push("in-sync".into());
            }
            Ok(parts.join(" · "))
        }
    }
}
