//! 4D Temporal Timeline Snapshot & Delta Engine.
//!
//! Provides deterministic point-in-time reconstruction of the architectural
//! scene graph across turns (`@t0014`), and range diffing between arbitrary turns
//! (`@t0010..t0018`) for real-time 4D scrubbing in Studio.

use crate::engine::Engine;
use crate::scene::{DeltaStatus, SceneWorld};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneFrameMeta {
    pub turn: String,
    pub ts: String,
    pub status: String,
    pub prompt: String,
    pub summary: Option<String>,
    pub confidence: f64,
    pub touched_nodes: Vec<String>,
    pub touched_files: Vec<String>,
}

/// Computes the complete series of compact 4D timeline frames for the dope sheet.
pub fn timeline_frames(engine: &Engine) -> Result<Value> {
    let turns = engine.store.turns()?;
    let frames: Vec<Value> = turns.iter().map(|t| {
        json!({
            "turn": t.id,
            "ts": t.ts,
            "status": t.status,
            "prompt": t.prompt.lines().next().unwrap_or("").trim(),
            "summary": t.summary,
            "confidence": t.confidence,
            "touched_nodes": t.touched.nodes,
            "touched_files": t.touched.files,
            "pin_proposals": t.pin_proposals.len(),
            "checks_count": t.checks.len(),
        })
    }).collect();

    Ok(json!({
        "count": frames.len(),
        "frames": frames,
    }))
}

/// Point-in-time 4D snapshot: projects the scene world as of a specific turn `target_turn`.
pub fn snapshot_at_turn(engine: &Engine, target_turn: &str) -> Result<Value> {
    let mut world = SceneWorld::build(engine)?;
    let turns = engine.store.turns()?;
    let target = turns.iter().find(|t| t.id == target_turn).ok_or_else(|| anyhow!("turn `{target_turn}` not found"))?;

    let touched_nodes: HashSet<&str> = target.touched.nodes.iter().map(|s| s.as_str()).collect();
    let touched_files: HashSet<&str> = target.touched.files.iter().map(|s| s.as_str()).collect();

    for entity in &world.entities {
        let idx = entity.0 as usize;
        let node_id = &world.identities[idx].name;
        let dot_path = &world.identities[idx].dot_path;

        if touched_nodes.contains(node_id.as_str()) || touched_nodes.contains(dot_path.as_str()) {
            world.deltas[idx].status = DeltaStatus::Modified;
            world.deltas[idx].notes = Some(format!("Modified in {}", target.id));
        } else if world.identities[idx].status == "planned" {
            world.deltas[idx].status = DeltaStatus::PlannedFuture;
        } else {
            world.deltas[idx].status = DeltaStatus::Unchanged;
        }

        // Check if any files belonging to this node changed
        let delta_files = world.implementations[idx].file_paths.iter().filter(|f| touched_files.contains(f.as_str())).count();
        world.deltas[idx].delta_files = delta_files as i32;
    }

    let mut out = world.to_studio_json();
    out["turn"] = json!(target_turn);
    out["prompt"] = json!(target.prompt);
    out["summary"] = json!(target.summary);
    out["confidence"] = json!(target.confidence);

    Ok(out)
}

/// Range comparison between two turns: computes delta evolution from `from_turn` to `to_turn`.
pub fn range_diff(engine: &Engine, from_turn: &str, to_turn: &str) -> Result<Value> {
    let mut world = SceneWorld::build(engine)?;
    let turns = engine.store.turns()?;

    let from_idx = turns.iter().position(|t| t.id == from_turn).ok_or_else(|| anyhow!("turn `{from_turn}` not found"))?;
    let to_idx = turns.iter().position(|t| t.id == to_turn).ok_or_else(|| anyhow!("turn `{to_turn}` not found"))?;

    let (start_idx, end_idx) = if from_idx <= to_idx {
        (from_idx, to_idx)
    } else {
        (to_idx, from_idx)
    };

    let slice = &turns[start_idx..=end_idx];
    let mut aggregated_touched_nodes: HashMap<String, usize> = HashMap::new();
    let mut aggregated_touched_files: HashSet<String> = HashSet::new();

    for t in slice {
        for n in &t.touched.nodes {
            *aggregated_touched_nodes.entry(n.clone()).or_insert(0) += 1;
        }
        for f in &t.touched.files {
            aggregated_touched_files.insert(f.clone());
        }
    }

    for entity in &world.entities {
        let idx = entity.0 as usize;
        let node_id = &world.identities[idx].name;
        let dot_path = &world.identities[idx].dot_path;

        if let Some(&count) = aggregated_touched_nodes.get(node_id).or_else(|| aggregated_touched_nodes.get(dot_path)) {
            world.deltas[idx].status = DeltaStatus::Modified;
            world.deltas[idx].notes = Some(format!("Modified across {} turn(s) in range", count));
        }

        let delta_files = world.implementations[idx].file_paths.iter().filter(|f| aggregated_touched_files.contains(*f)).count();
        world.deltas[idx].delta_files = delta_files as i32;
    }

    let mut out = world.to_studio_json();
    out["range"] = json!({
        "from": from_turn,
        "to": to_turn,
        "turns_spanned": slice.len(),
        "total_files_changed": aggregated_touched_files.len(),
    });

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init::{init, InitOptions};

    #[test]
    fn test_timeline_frames_empty_repo() {
        let dir = std::env::temp_dir().join(format!("afwe-4d-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = init(&dir, InitOptions { name: Some("4d-test".into()), description: None, root: None, force: true }).unwrap();
        let engine = Engine { store };

        let frames = timeline_frames(&engine).unwrap();
        assert_eq!(frames["count"], 0);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
