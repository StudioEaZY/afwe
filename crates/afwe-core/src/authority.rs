//! Ownership-scoped authority model.
//!
//! Enforces the rule:
//! - Human-authored guards (pins, constraints, baseline items, guardrails) can only be loosened by humans.
//! - Autonomous agents/missions have full control to mutate or loosen guards they authored themselves.
//! - Loosening of human or foreign-tier rules triggers an Escalation instead of silently dropping checks.

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Authority {
    Human,
    MissionOrchestrator { mission_id: String },
    Agent { agent_id: String, mission_id: Option<String> },
}

pub fn authority_of(origin: &str) -> Authority {
    if origin == "human" || origin.starts_with("human:") {
        Authority::Human
    } else if let Some(m) = origin.strip_prefix("mission:") {
        Authority::MissionOrchestrator { mission_id: m.to_string() }
    } else if let Some(a) = origin.strip_prefix("llm:") {
        Authority::Agent { agent_id: a.to_string(), mission_id: None }
    } else {
        Authority::Agent { agent_id: origin.to_string(), mission_id: None }
    }
}

/// Detects whether an operation represents loosening/weakening of an architectural guard.
/// Returns Some(description) if the operation weakens an active safeguard.
pub fn is_loosening_op(op: &str, params: &Value) -> Option<String> {
    match op {
        "pin.retire" => {
            let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
            Some(format!("Retiring pin `{id}`"))
        }
        "check.remove" => {
            let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
            Some(format!("Removing check `{id}`"))
        }
        "blueprint.unconstrain" => {
            let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
            Some(format!("Removing structural constraint `{id}`"))
        }
        "guardrail.remove" => {
            let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
            Some(format!("Removing guardrail `{id}`"))
        }
        "memory.remove" => {
            let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
            Some(format!("Deleting architectural memory `{id}`"))
        }
        "turn.confirm" => {
            Some("Confirming a staged proposal or override".into())
        }
        _ => None,
    }
}

/// Verifies whether the caller's authority is allowed to loosen the specified target guard.
/// Agents can only loosen resources they created themselves.
pub fn can_loosen(auth: &Authority, guard_origin: Option<&str>) -> bool {
    match auth {
        Authority::Human => true,
        Authority::MissionOrchestrator { mission_id } => {
            match guard_origin {
                Some(o) if o.starts_with(&format!("mission:{mission_id}")) => true,
                Some(o) if o.starts_with("llm:") => true,
                _ => false,
            }
        }
        Authority::Agent { agent_id, .. } => {
            match guard_origin {
                Some(o) if o == &format!("llm:{agent_id}") => true,
                _ => false,
            }
        }
    }
}
