//! External OS config-directory storage and integrity verification for Prompter Authority.
//!
//! Authoritative state lives outside the repository:
//! - Windows: `%APPDATA%\afwe\authority\<project-id>.json`
//! - Linux: `~/.config/afwe/authority/<project-id>.json`
//! - macOS: `~/Library/Application Support/afwe/authority/<project-id>.json`
//!
//! State is signed with a keyed HMAC (keyed BLAKE3 MAC) derived from a machine/user secret.
//! If missing, unreadable, expired, unsigned or tampered, AFWE fails closed to `human_only`.

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use crate::authority::{AuthorityRecord, AuthorityMode};

pub const AUTHORITY_STORE_DIR: &str = "afwe";
pub const AUTHORITY_SUBDIR: &str = "authority";

/// Computes a stable project ID from the repository's root commit hash (or fallback).
pub fn compute_project_id(repo_root: &Path) -> String {
    // If git is present, obtain root commit hash
    let out = std::process::Command::new("git")
        .args(["rev-list", "--max-parents=0", "HEAD"])
        .current_dir(repo_root)
        .output();
    if let Ok(output) = out {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !s.is_empty() {
                let first = s.lines().next().unwrap_or("").trim();
                if !first.is_empty() {
                    return blake3::hash(first.as_bytes()).to_hex().to_string();
                }
            }
        }
    }
    // Fallback: stable canonical path hash
    let canon = repo_root.canonicalize().unwrap_or_else(|_| repo_root.to_path_buf());
    blake3::hash(canon.to_string_lossy().as_bytes()).to_hex().to_string()
}

/// Returns the platform-specific user config directory for AFWE authority.
pub fn get_user_authority_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join(AUTHORITY_STORE_DIR).join(AUTHORITY_SUBDIR);
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(AUTHORITY_STORE_DIR)
                .join(AUTHORITY_SUBDIR);
        }
    }
    // Linux / Unix fallback
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        PathBuf::from(xdg).join(AUTHORITY_STORE_DIR).join(AUTHORITY_SUBDIR)
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".config").join(AUTHORITY_STORE_DIR).join(AUTHORITY_SUBDIR)
    } else {
        PathBuf::from(".afwe_authority_fallback")
    }
}

/// Derives a stable 32-byte machine/user secret for signing authority records.
pub fn get_machine_secret() -> [u8; 32] {
    let mut salt = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Ok(user) = std::env::var("USERNAME") {
            salt.extend_from_slice(user.as_bytes());
        }
        if let Ok(domain) = std::env::var("USERDOMAIN") {
            salt.extend_from_slice(domain.as_bytes());
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(user) = std::env::var("USER") {
            salt.extend_from_slice(user.as_bytes());
        }
    }
    salt.extend_from_slice(b"afwe-authority-secret-v1");
    *blake3::hash(&salt).as_bytes()
}

/// Computes the HMAC for an authority payload using the machine secret.
pub fn sign_payload(payload: &str) -> String {
    let secret = get_machine_secret();
    blake3::keyed_hash(&secret, payload.as_bytes()).to_hex().to_string()
}

/// Verifies whether the HMAC signature matches the payload.
pub fn verify_signature(payload: &str, hmac: &str) -> bool {
    let expected = sign_payload(payload);
    expected == hmac
}

/// Path to authoritative state file for a project.
pub fn authority_file_path(project_id: &str) -> PathBuf {
    get_user_authority_dir().join(format!("{project_id}.json"))
}

/// Path to in-repo display metadata (`.afwe/state/authority.active`).
pub fn repo_authority_display_path(repo_root: &Path) -> PathBuf {
    repo_root.join(".afwe").join("state").join("authority.active")
}

/// In-repo display record (never trusted for enforcement).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoAuthorityDisplay {
    pub mode: AuthorityMode,
    pub holder: Option<String>,
    pub expires_at: Option<String>,
}

/// Loads the authoritative state for a project, verifying its signature and expiry.
/// If missing, unreadable, expired, unsigned or tampered, returns a default `human_only` record.
pub fn load_authority(project_id: &str) -> AuthorityRecord {
    let path = authority_file_path(project_id);
    if !path.exists() {
        return AuthorityRecord::human_only(project_id);
    }

    let contents = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return AuthorityRecord::human_only(project_id),
    };

    let record: AuthorityRecord = match serde_json::from_str(&contents) {
        Ok(r) => r,
        Err(_) => return AuthorityRecord::human_only(project_id),
    };

    // Check project_id match
    if record.project_id != project_id {
        return AuthorityRecord::human_only(project_id);
    }

    // Verify HMAC
    let canonical = match record.canonical_signable_payload() {
        Ok(p) => p,
        Err(_) => return AuthorityRecord::human_only(project_id),
    };

    if !verify_signature(&canonical, &record.hmac) {
        eprintln!("[AFWE] Warning: authority state signature mismatch for project {project_id} (tamper detected)");
        return AuthorityRecord::human_only(project_id);
    }

    // If delegated, verify expiry
    if record.mode == AuthorityMode::PrompterDelegated {
        if let Some(ref del) = record.delegation {
            if del.is_expired() {
                return AuthorityRecord::human_only(project_id);
            }
        } else {
            return AuthorityRecord::human_only(project_id);
        }
    }

    record
}

/// Saves the authoritative state with strict permissions and updates the in-repo display file.
pub fn save_authority(repo_root: &Path, record: &mut AuthorityRecord) -> anyhow::Result<()> {
    let dir = get_user_authority_dir();
    std::fs::create_dir_all(&dir)?;

    let path = authority_file_path(&record.project_id);

    // Sign the record
    let canonical = record.canonical_signable_payload()?;
    record.hmac = sign_payload(&canonical);

    let json = serde_json::to_string_pretty(record)?;
    std::fs::write(&path, &json)?;

    // Update in-repo display metadata
    let display_path = repo_authority_display_path(repo_root);
    if let Some(parent) = display_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let display = RepoAuthorityDisplay {
        mode: record.mode,
        holder: record.delegation.as_ref().map(|d| d.holder.agent_id.clone()),
        expires_at: record.delegation.as_ref().map(|d| d.validity.expires_at.clone()),
    };
    if let Ok(d_json) = serde_json::to_string_pretty(&display) {
        let _ = std::fs::write(display_path, d_json);
    }

    Ok(())
}
