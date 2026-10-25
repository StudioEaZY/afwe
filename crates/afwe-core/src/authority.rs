//! Ownership-scoped authority model.
//!
//! Enforces the rule:
//! - Human-authored guards (pins, constraints, baseline items, guardrails) can only be loosened by humans.
//! - Autonomous agents/missions have full control to mutate or loosen guards they authored themselves.
//! - Loosening of human or foreign-tier rules triggers an Escalation instead of silently dropping checks.
//! - Known agent harness environment variables (`CLAUDECODE`, `CURSOR_TRACE_ID`, `CODEX_SANDBOX`,
//!   `DELTA_THREAD_ID`, `AIDER_*`, `AFWE_AGENT_SESSION`, `CI`) automatically downgrade `--origin human`
//!   to `Authority::Agent` so an agent with shell access cannot spoof human authority, while GUI git
//!   clients, Studio HTTP, Tauri IPC, and `cargo test` (without TTY and without agent env vars) remain
//!   `Authority::Human`.

use serde_json::Value;

pub const KNOWN_AGENT_ENV_VARS: &[&str] = &[
    "CLAUDECODE",
    "CURSOR_TRACE_ID",
    "CODEX_SANDBOX",
    "DELTA_THREAD_ID",
    "AIDER_MODEL",
    "AFWE_AGENT_SESSION",
    "CI",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Authority {
    Human,
    MissionOrchestrator { mission_id: String },
    Agent { agent_id: String, mission_id: Option<String> },
}

/// Detects whether the current process environment carries a known agent harness marker.
pub fn detected_agent_env() -> Option<String> {
    for &var in KNOWN_AGENT_ENV_VARS {
        if let Ok(val) = std::env::var(var) {
            let trimmed = val.trim();
            if !trimmed.is_empty() && trimmed != "0" && !trimmed.eq_ignore_ascii_case("false") {
                return Some(format!("env:{var}"));
            }
        }
    }
    for (k, v) in std::env::vars() {
        if k.starts_with("AIDER_") && !v.trim().is_empty() && v.trim() != "0" {
            return Some(format!("env:{k}"));
        }
    }
    None
}

/// Pure helper for testing authority resolution with an explicit environment detector.
pub fn authority_of_with_env(origin: &str, agent_env_marker: Option<&str>) -> Authority {
    if origin == "human" || origin.starts_with("human:") {
        if let Some(marker) = agent_env_marker {
            Authority::Agent {
                agent_id: marker.to_string(),
                mission_id: None,
            }
        } else {
            Authority::Human
        }
    } else if let Some(m) = origin.strip_prefix("mission:") {
        Authority::MissionOrchestrator { mission_id: m.to_string() }
    } else if let Some(a) = origin.strip_prefix("llm:") {
        Authority::Agent { agent_id: a.to_string(), mission_id: None }
    } else {
        Authority::Agent { agent_id: origin.to_string(), mission_id: None }
    }
}

pub fn authority_of(origin: &str) -> Authority {
    let marker = detected_agent_env();
    authority_of_with_env(origin, marker.as_deref())
}

/// Detects whether an operation represents loosening/weakening of an architectural guard
/// or requires out-of-band human authority.
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
        "guide.confirm" => {
            let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
            Some(format!("Graduating probing guide `{id}` to an active blocking check"))
        }
        "unlock" => {
            Some("Enabling Explore Mode (`afwe unlock`) to downgrade blocking checks to warnings".into())
        }
        "materialize" if params.get("remove").and_then(|v| v.as_bool()).unwrap_or(false) => {
            Some("Removing materialized tripwires (`afwe materialize --remove`)".into())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gui_invocation_without_tty_or_agent_env_stays_human() {
        // GUI git clients, VS Code Source Control, Studio HTTP, and Tauri IPC have no agent env marker
        assert_eq!(authority_of_with_env("human", None), Authority::Human);
        assert_eq!(authority_of_with_env("human:studio", None), Authority::Human);
    }

    #[test]
    fn agent_env_vars_downgrade_human_origin_to_agent() {
        for &var in KNOWN_AGENT_ENV_VARS {
            let marker = format!("env:{var}");
            let auth = authority_of_with_env("human", Some(&marker));
            assert_eq!(
                auth,
                Authority::Agent {
                    agent_id: marker,
                    mission_id: None
                }
            );
            assert!(!can_loosen(&auth, None));
        }
    }
}
