//! Escalation queue for unpermitted loosening actions.
//!
//! When an autonomous agent attempts to modify or retire human-locked pins,
//! constraints, or baseline rules, an Escalation is created and added to the Board.

use crate::engine::Engine;
use crate::util::{now, short_id};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Escalation {
    pub id: String,
    pub created_at: String,
    pub op: String,
    pub description: String,
    pub params: Value,
    pub origin: String,
    pub turn: Option<String>,
    pub status: String, // pending | approved | rejected
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<String>,
}

pub fn list(engine: &Engine) -> Result<Vec<Escalation>> {
    let text = match engine.store.read_text("state/escalations.json")? {
        Some(t) => t,
        None => return Ok(vec![]),
    };
    let items: Vec<Escalation> = serde_json::from_str(&text).unwrap_or_default();
    Ok(items)
}

pub fn save_all(engine: &Engine, items: &[Escalation]) -> Result<()> {
    let json = serde_json::to_string_pretty(items)?;
    engine.store.write_text("state/escalations.json", &json)
}

pub fn request(engine: &Engine, op: &str, params: &Value, origin: &str, description: &str, turn: Option<&str>) -> Result<Escalation> {
    let mut items = list(engine)?;
    let esc = Escalation {
        id: short_id("esc"),
        created_at: now(),
        op: op.to_string(),
        description: description.to_string(),
        params: params.clone(),
        origin: origin.to_string(),
        turn: turn.map(|s| s.to_string()),
        status: "pending".into(),
        decided_by: None,
        decided_at: None,
    };
    items.push(esc.clone());
    save_all(engine, &items)?;
    engine.log(origin, "escalation_request", format!("Escalation {} requested for `{}`: {}", esc.id, op, description), None)?;
    Ok(esc)
}

pub fn approve(engine: &Engine, id: &str, human_origin: &str) -> Result<Escalation> {
    let mut items = list(engine)?;
    let esc = items.iter_mut().find(|e| e.id == id).ok_or_else(|| anyhow::anyhow!("escalation `{id}` not found"))?;
    if esc.status != "pending" {
        return Err(anyhow::anyhow!("escalation `{id}` is already {}", esc.status));
    }
    esc.status = "approved".into();
    esc.decided_by = Some(human_origin.to_string());
    esc.decided_at = Some(now());
    let res = esc.clone();
    save_all(engine, &items)?;
    engine.log(human_origin, "escalation_approved", format!("Escalation {} approved by {human_origin}", res.id), None)?;
    Ok(res)
}

pub fn reject(engine: &Engine, id: &str, human_origin: &str) -> Result<Escalation> {
    let mut items = list(engine)?;
    let esc = items.iter_mut().find(|e| e.id == id).ok_or_else(|| anyhow::anyhow!("escalation `{id}` not found"))?;
    if esc.status != "pending" {
        return Err(anyhow::anyhow!("escalation `{id}` is already {}", esc.status));
    }
    esc.status = "rejected".into();
    esc.decided_by = Some(human_origin.to_string());
    esc.decided_at = Some(now());
    let res = esc.clone();
    save_all(engine, &items)?;
    engine.log(human_origin, "escalation_rejected", format!("Escalation {} rejected by {human_origin}", res.id), None)?;
    Ok(res)
}
