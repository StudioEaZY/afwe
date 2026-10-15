//! Shared node leases / concurrency lock for multi-agent workflows.
//!
//! Stored in `.git/afwe/leases.json` (or `.afwe/leases.json` if non-git).
//! All git worktrees share the root `.git` folder, ensuring a unified locking
//! surface across concurrently executing subagents.

use crate::engine::Engine;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeLease {
    pub node_id: String,
    pub mission_id: String,
    pub agent_id: String,
    pub acquired_at: String,
    pub expires_at: u64, // unix timestamp in seconds
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LeasesFile {
    #[serde(default)]
    pub leases: Vec<NodeLease>,
}

fn current_time_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn leases_path(engine: &Engine) -> PathBuf {
    let git_dir = engine.store.project_root.join(".git");
    if git_dir.is_dir() {
        git_dir.join("afwe").join("leases.json")
    } else if git_dir.is_file() {
        // In a worktree, .git is a file containing "gitdir: <common_git_dir>/worktrees/<name>"
        if let Ok(content) = std::fs::read_to_string(&git_dir) {
            if let Some(rest) = content.trim().strip_prefix("gitdir:") {
                let target = rest.trim();
                let p = PathBuf::from(target);
                if let Some(git_common) = p.ancestors().find(|a| a.ends_with(".git")) {
                    return git_common.join("afwe").join("leases.json");
                }
            }
        }
        engine.store.afwe_dir.join("leases.json")
    } else {
        engine.store.afwe_dir.join("leases.json")
    }
}

pub fn load_leases(engine: &Engine) -> Result<Vec<NodeLease>> {
    let p = leases_path(engine);
    if !p.exists() {
        return Ok(vec![]);
    }
    let data = std::fs::read_to_string(&p)?;
    let parsed: LeasesFile = serde_json::from_str(&data).unwrap_or_default();
    let now = current_time_secs();
    // Filter expired leases
    Ok(parsed.leases.into_iter().filter(|l| l.expires_at > now).collect())
}

pub fn save_leases(engine: &Engine, leases: &[NodeLease]) -> Result<()> {
    let p = leases_path(engine);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = LeasesFile {
        leases: leases.to_vec(),
    };
    let data = serde_json::to_string_pretty(&file)?;
    std::fs::write(&p, data)?;
    Ok(())
}

pub fn acquire(
    engine: &Engine,
    node_id: &str,
    mission_id: &str,
    agent_id: &str,
    purpose: &str,
    ttl_secs: u64,
) -> Result<NodeLease> {
    let now = current_time_secs();
    let mut leases = load_leases(engine)?;

    // Check if node is currently leased
    if let Some(existing) = leases.iter().find(|l| l.node_id == node_id) {
        if existing.mission_id != mission_id || existing.agent_id != agent_id {
            return Err(anyhow!(
                "Node `{}` is currently locked by agent `{}` of mission `{}` (expires in {}s)",
                node_id,
                existing.agent_id,
                existing.mission_id,
                existing.expires_at.saturating_sub(now)
            ));
        }
    }

    // Retain leases except the one for this node
    leases.retain(|l| l.node_id != node_id);

    let lease = NodeLease {
        node_id: node_id.to_string(),
        mission_id: mission_id.to_string(),
        agent_id: agent_id.to_string(),
        acquired_at: crate::util::now(),
        expires_at: now + ttl_secs.max(60),
        purpose: purpose.to_string(),
    };

    leases.push(lease.clone());
    save_leases(engine, &leases)?;
    Ok(lease)
}

pub fn release(
    engine: &Engine,
    node_id: &str,
    mission_id: &str,
    agent_id: &str,
) -> Result<bool> {
    let mut leases = load_leases(engine)?;
    let before = leases.len();
    leases.retain(|l| !(l.node_id == node_id && l.mission_id == mission_id && l.agent_id == agent_id));
    let removed = leases.len() < before;
    if removed {
        save_leases(engine, &leases)?;
    }
    Ok(removed)
}

pub fn release_all_for_agent(
    engine: &Engine,
    mission_id: &str,
    agent_id: &str,
) -> Result<usize> {
    let mut leases = load_leases(engine)?;
    let before = leases.len();
    leases.retain(|l| !(l.mission_id == mission_id && l.agent_id == agent_id));
    let count = before - leases.len();
    if count > 0 {
        save_leases(engine, &leases)?;
    }
    Ok(count)
}

pub fn list_active(engine: &Engine) -> Result<Vec<NodeLease>> {
    load_leases(engine)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init::{init, InitOptions};

    #[test]
    fn test_lease_acquire_and_conflict() {
        let dir = std::env::temp_dir().join(format!("afwe-lease-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = init(&dir, InitOptions { name: Some("lease-test".into()), description: None, root: None, force: true }).unwrap();
        let engine = Engine { store };

        // Agent 1 acquires node auth
        let l1 = acquire(&engine, "auth", "m1", "agent-1", "refactor auth", 3600).unwrap();
        assert_eq!(l1.node_id, "auth");
        assert_eq!(l1.agent_id, "agent-1");

        // Agent 2 attempts to acquire node auth -> conflict error
        let err = acquire(&engine, "auth", "m1", "agent-2", "fix auth", 3600);
        assert!(err.is_err());
        assert!(err.unwrap_err().to_string().contains("locked by agent `agent-1`"));

        // Agent 1 acquires another node
        acquire(&engine, "billing", "m1", "agent-1", "billing updates", 3600).unwrap();
        let active = list_active(&engine).unwrap();
        assert_eq!(active.len(), 2);

        // Agent 1 releases auth
        let released = release(&engine, "auth", "m1", "agent-1").unwrap();
        assert!(released);

        // Now Agent 2 can acquire auth
        let l2 = acquire(&engine, "auth", "m1", "agent-2", "fix auth", 3600).unwrap();
        assert_eq!(l2.agent_id, "agent-2");

        let _ = std::fs::remove_dir_all(&dir);
    }
}

