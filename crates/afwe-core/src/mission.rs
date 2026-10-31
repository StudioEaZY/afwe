//! Multi-agent autonomous missions and worktree coordination.
//!
//! Stored in `.afwe/missions/<id>.yaml`.
//! Manages subagent worktrees, node lease allocations, and merge gating back to main.

use crate::engine::Engine;
use crate::lease;
use crate::vcs::git::GitProvider;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MissionStatus {
    Active,
    Paused,
    Completed,
    Aborted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionAgent {
    pub agent_id: String,
    pub role: String,
    pub branch: String,
    pub worktree_path: String,
    pub assigned_nodes: Vec<String>,
    pub status: String, // active | merged | failed
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MissionInvariants {
    #[serde(default)]
    pub locked_pins: Vec<String>,
    #[serde(default)]
    pub must_not_depend: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MissionBudget {
    #[serde(default)]
    pub max_escalations: u32,
    #[serde(default)]
    pub max_partial_losses: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mission {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub orchestrator: String,
    pub status: MissionStatus,
    pub created: String,
    pub updated: String,
    #[serde(default)]
    pub invariants: MissionInvariants,
    #[serde(default)]
    pub budget: MissionBudget,
    #[serde(default)]
    pub agents: Vec<MissionAgent>,
}

pub fn missions_dir(engine: &Engine) -> PathBuf {
    engine.store.afwe_dir.join("missions")
}

pub fn worktrees_root(engine: &Engine) -> PathBuf {
    engine.store.afwe_dir.join("worktrees")
}

pub fn create_mission(
    engine: &Engine,
    id: Option<String>,
    title: &str,
    prompt: &str,
    orchestrator: &str,
) -> Result<Mission> {
    let m_id = id.unwrap_or_else(|| format!("m-{}", crate::util::hash_str(prompt).chars().take(6).collect::<String>()));
    let mission = Mission {
        id: m_id,
        title: title.to_string(),
        prompt: prompt.to_string(),
        orchestrator: orchestrator.to_string(),
        status: MissionStatus::Active,
        created: crate::util::now(),
        updated: crate::util::now(),
        invariants: MissionInvariants::default(),
        budget: MissionBudget::default(),
        agents: vec![],
    };
    save_mission(engine, &mission)?;
    Ok(mission)
}

pub fn get_mission(engine: &Engine, id: &str) -> Result<Mission> {
    let p = missions_dir(engine).join(format!("{id}.yaml"));
    if !p.exists() {
        return Err(anyhow!("Mission `{id}` not found"));
    }
    let data = std::fs::read_to_string(&p)?;
    Ok(serde_yaml::from_str(&data)?)
}

pub fn save_mission(engine: &Engine, mission: &Mission) -> Result<()> {
    let dir = missions_dir(engine);
    std::fs::create_dir_all(&dir)?;
    let p = dir.join(format!("{}.yaml", mission.id));
    let y = serde_yaml::to_string(mission)?;
    std::fs::write(&p, y)?;
    Ok(())
}

pub fn list_missions(engine: &Engine) -> Result<Vec<Mission>> {
    let dir = missions_dir(engine);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let p = entry.path();
        if p.extension().map(|e| e == "yaml").unwrap_or(false) {
            if let Ok(data) = std::fs::read_to_string(&p) {
                if let Ok(m) = serde_yaml::from_str::<Mission>(&data) {
                    out.push(m);
                }
            }
        }
    }
    out.sort_by(|a, b| b.created.cmp(&a.created));
    Ok(out)
}

pub fn spawn_agent(
    engine: &Engine,
    mission_id: &str,
    agent_id: &str,
    role: &str,
    nodes: &[String],
) -> Result<MissionAgent> {
    let mut mission = get_mission(engine, mission_id)?;
    if mission.status != MissionStatus::Active {
        return Err(anyhow!("Mission `{}` is not active", mission_id));
    }

    // Try to acquire leases for assigned nodes
    for node in nodes {
        lease::acquire(engine, node, mission_id, agent_id, role, 7200)?;
    }

    let branch = format!("mission/{}/{}", mission_id, agent_id);
    let wt_path = worktrees_root(engine).join(agent_id);

    // Setup git worktree if git repo
    let root = &engine.store.project_root;
    if root.join(".git").exists() {
        if let Err(e) = GitProvider::worktree_add(root, &wt_path, &branch) {
            // Roll back leases on failure
            let _ = lease::release_all_for_agent(engine, mission_id, agent_id);
            return Err(e);
        }
    }

    let agent = MissionAgent {
        agent_id: agent_id.to_string(),
        role: role.to_string(),
        branch,
        worktree_path: wt_path.to_string_lossy().to_string(),
        assigned_nodes: nodes.to_vec(),
        status: "active".into(),
    };

    mission.agents.push(agent.clone());
    mission.updated = crate::util::now();
    save_mission(engine, &mission)?;

    Ok(agent)
}

pub fn merge_agent(
    engine: &Engine,
    mission_id: &str,
    agent_id: &str,
) -> Result<Value> {
    let mut mission = get_mission(engine, mission_id)?;
    let agent_idx = mission.agents.iter().position(|a| a.agent_id == agent_id)
        .ok_or_else(|| anyhow!("Agent `{agent_id}` not found in mission `{mission_id}`"))?;

    let branch = mission.agents[agent_idx].branch.clone();
    let wt_path = PathBuf::from(&mission.agents[agent_idx].worktree_path);
    let root = &engine.store.project_root;

    // Merge branch into main
    if root.join(".git").exists() {
        GitProvider::merge_branch(root, &branch)?;
    }

    // Run architectural verification gate on merged root
    let snap = engine.snapshot(true)?;
    let report = crate::verify::verify(&snap, root, &crate::verify::VerifyOptions {
        changed: vec![],
        run_commands: true,
        include_drift: false,
    });
    if !report.ok {
        return Err(anyhow!("MERGE_GATE_REDO: Architectural verification failed on merge of `{agent_id}`: {} error(s)", report.errors));
    }

    // Release all leases
    let released = lease::release_all_for_agent(engine, mission_id, agent_id)?;

    // Clean up worktree
    if wt_path.exists() {
        let _ = GitProvider::worktree_remove(root, &wt_path);
    }

    mission.agents[agent_idx].status = "merged".into();
    mission.updated = crate::util::now();
    save_mission(engine, &mission)?;

    Ok(serde_json::json!({
        "status": "merged",
        "agent": agent_id,
        "branch": branch,
        "leases_released": released,
    }))
}

pub fn pause_mission(engine: &Engine, id: &str) -> Result<Mission> {
    let mut m = get_mission(engine, id)?;
    m.status = MissionStatus::Paused;
    m.updated = crate::util::now();
    save_mission(engine, &m)?;
    Ok(m)
}

pub fn resume_mission(engine: &Engine, id: &str) -> Result<Mission> {
    let mut m = get_mission(engine, id)?;
    m.status = MissionStatus::Active;
    m.updated = crate::util::now();
    save_mission(engine, &m)?;
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init::{init, InitOptions};

    #[test]
    fn test_mission_lifecycle() {
        let dir = std::env::temp_dir().join(format!("afwe-mission-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = init(&dir, InitOptions { name: Some("mission-test".into()), description: None, root: None, force: true }).unwrap();
        let engine = Engine { store };

        // Create mission
        let m = create_mission(&engine, None, "Floating Cat Assistant", "Build floating cat on PC", "human").unwrap();
        assert_eq!(m.title, "Floating Cat Assistant");
        assert_eq!(m.status, MissionStatus::Active);

        // List missions
        let list = list_missions(&engine).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, m.id);

        // Get mission
        let fetched = get_mission(&engine, &m.id).unwrap();
        assert_eq!(fetched.id, m.id);

        let _ = std::fs::remove_dir_all(&dir);
    }
}

