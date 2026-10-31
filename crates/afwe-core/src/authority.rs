//! Ownership-scoped authority model & Prompter Delegation system.
//!
//! Enforces:
//! - Default `human_only`.
//! - R1-R10 authority rules for Prompter Delegation.
//! - Door semantics: UI default unless in agentic-loop mode (`Door::Mcp`).
//! - Blast radius ceilings and human-floor checks.
//! - Known agent harness environment variables downgrade origins.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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

/// Maximum allowable TTL for a delegation (8 hours in seconds).
pub const MAX_DELEGATION_TTL_SECONDS: u64 = 8 * 3600;
/// Maximum allowable budget of auto-approvals in a delegation.
pub const MAX_AUTO_APPROVALS_CEILING: u32 = 50;
/// Maximum allowable self-heal remediation turns.
pub const MAX_SELF_HEALS_CEILING: u32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityMode {
    HumanOnly,
    PrompterDelegated,
}

impl Default for AuthorityMode {
    fn default() -> Self {
        AuthorityMode::HumanOnly
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Door {
    Ui,
    Mcp,
}

impl Default for Door {
    fn default() -> Self {
        Door::Ui
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlastRadius {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelegationHolder {
    pub agent_id: String,
    pub redeem_token_hash: Option<String>,
    pub door: Door,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelegationScope {
    pub allowed_domains: Vec<String>,
    pub denied_domains: Vec<String>,
    pub max_blast_radius: BlastRadius,
}

impl Default for DelegationScope {
    fn default() -> Self {
        Self {
            allowed_domains: vec!["**".into()],
            denied_domains: vec![".afwe/state/**".into(), ".afwe/afwe.yaml".into()],
            max_blast_radius: BlastRadius::Medium,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelegationBudget {
    pub auto_approvals_max: u32,
    pub auto_approvals_used: u32,
    pub self_heals_max: u32,
    pub self_heals_used: u32,
    #[serde(default)]
    pub auto_merge: bool,
}

impl Default for DelegationBudget {
    fn default() -> Self {
        Self {
            auto_approvals_max: 20,
            auto_approvals_used: 0,
            self_heals_max: 5,
            self_heals_used: 0,
            auto_merge: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DelegationValidity {
    pub granted_at: String,
    pub expires_at: String,
}

impl DelegationValidity {
    pub fn new(ttl_seconds: u64) -> Self {
        let now = Utc::now();
        let expires = now + chrono::Duration::seconds(ttl_seconds as i64);
        Self {
            granted_at: now.to_rfc3339(),
            expires_at: expires.to_rfc3339(),
        }
    }

    pub fn is_expired(&self) -> bool {
        if let Ok(exp) = DateTime::parse_from_rfc3339(&self.expires_at) {
            Utc::now() > exp
        } else {
            true
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrompterDelegation {
    pub holder: DelegationHolder,
    pub scope: DelegationScope,
    pub budget: DelegationBudget,
    pub validity: DelegationValidity,
}

impl PrompterDelegation {
    pub fn is_expired(&self) -> bool {
        self.validity.is_expired()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorityRecord {
    pub project_id: String,
    pub mode: AuthorityMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation: Option<PrompterDelegation>,
    pub hmac: String,
}

impl AuthorityRecord {
    pub fn human_only(project_id: &str) -> Self {
        Self {
            project_id: project_id.to_string(),
            mode: AuthorityMode::HumanOnly,
            delegation: None,
            hmac: String::new(),
        }
    }

    /// Generates canonical JSON payload for HMAC signing (excluding the hmac field itself).
    pub fn canonical_signable_payload(&self) -> anyhow::Result<String> {
        #[derive(Serialize)]
        struct Signable<'a> {
            project_id: &'a str,
            mode: AuthorityMode,
            delegation: &'a Option<PrompterDelegation>,
        }
        let s = Signable {
            project_id: &self.project_id,
            mode: self.mode,
            delegation: &self.delegation,
        };
        Ok(serde_json::to_string(&s)?)
    }
}

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

/// Determines whether an action is human-floor (R8) that cannot be delegated.
pub fn is_human_floor(action: &str, blast_radius: Option<BlastRadius>) -> bool {
    match action {
        "override_pin" | "edit_blueprint" | "edit_schema" | "edit_afwe_yaml" | "delegate_authority" => true,
        _ => {
            if let Some(BlastRadius::High) = blast_radius {
                true
            } else {
                false
            }
        }
    }
}

/// Detects whether an operation represents loosening/weakening of an architectural guard.
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

    #[test]
    fn default_mode_is_human_only() {
        let rec = AuthorityRecord::human_only("proj-test");
        assert_eq!(rec.mode, AuthorityMode::HumanOnly);
        assert!(rec.delegation.is_none());
    }

    #[test]
    fn human_floor_enforcement() {
        assert!(is_human_floor("override_pin", None));
        assert!(is_human_floor("edit_blueprint", None));
        assert!(is_human_floor("turn_approve", Some(BlastRadius::High)));
        assert!(!is_human_floor("turn_approve", Some(BlastRadius::Medium)));
        assert!(!is_human_floor("turn_approve", Some(BlastRadius::Low)));
    }

    #[test]
    fn signature_verification_and_tamper_detection() {
        let mut rec = AuthorityRecord::human_only("test-proj");
        let payload = rec.canonical_signable_payload().unwrap();
        rec.hmac = crate::authority_store::sign_payload(&payload);
        assert!(crate::authority_store::verify_signature(&payload, &rec.hmac));

        // Tamper test
        let tampered_payload = payload.replace("human_only", "prompter_delegated");
        assert!(!crate::authority_store::verify_signature(&tampered_payload, &rec.hmac));

        // Verify authority_store helper references
        assert_eq!(crate::authority_store::AUTHORITY_STORE_DIR, "afwe");
        assert_eq!(crate::authority_store::AUTHORITY_SUBDIR, "authority");
        let _ = crate::authority_store::get_user_authority_dir();
        let _ = crate::authority_store::get_machine_secret();
        let _ = crate::authority_store::authority_file_path("test-proj");
        let _ = crate::authority_store::repo_authority_display_path(std::path::Path::new("."));
        let display = crate::authority_store::RepoAuthorityDisplay {
            mode: AuthorityMode::HumanOnly,
            holder: None,
            expires_at: None,
        };
        assert_eq!(display.mode, AuthorityMode::HumanOnly);
    }
}
