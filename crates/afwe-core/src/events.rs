use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use anyhow::{Context, Result};

/// Monotonically sequenced presence/lifecycle event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresenceEvent {
    pub seq: u64,
    pub timestamp: String,
    pub project_id: String,
    pub host_id: String,
    pub turn_hash: Option<String>,
    pub turn_id: Option<String>,
    pub kind: String, // turn.begin, turn.committed, turn.staged, turn.redo, turn.ready, turn.abandoned, queue.changed, steering.lifecycle, authority.changed
    pub outcome: Option<String>,
    pub blast_radius: String, // low, medium, high
    pub requires_human: bool,
    pub title: String,
    pub detail: String,
    pub touched_files: Vec<String>,
    pub agent_quote: Option<String>, // Verbatim agent text quoted explicitly
    pub metadata: Value,
}

pub struct EventFeed {
    events_path: PathBuf,
}

impl EventFeed {
    pub fn for_project(project_dir: &Path) -> Self {
        let events_path = project_dir.join(".afwe").join("log").join("presence_events.jsonl");
        Self { events_path }
    }

    /// Read the latest sequence number in the event stream
    pub fn latest_seq(&self) -> Result<u64> {
        if !self.events_path.exists() {
            return Ok(0);
        }
        let file = fs::File::open(&self.events_path)
            .with_context(|| format!("Failed to open events file {:?}", self.events_path))?;
        let reader = BufReader::new(file);
        let mut last_seq = 0u64;
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(val) = serde_json::from_str::<PresenceEvent>(&line) {
                last_seq = val.seq;
            }
        }
        Ok(last_seq)
    }

    /// Emit a new event to the presence event log with monotonic sequence
    pub fn emit(&self, mut event: PresenceEvent) -> Result<PresenceEvent> {
        if let Some(parent) = self.events_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let next_seq = self.latest_seq()?.saturating_add(1);
        event.seq = next_seq;
        if event.timestamp.is_empty() {
            event.timestamp = chrono::Utc::now().to_rfc3339();
        }

        let serialized = serde_json::to_string(&event)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.events_path)
            .with_context(|| format!("Failed to append to {:?}", self.events_path))?;
        writeln!(file, "{}", serialized)?;
        Ok(event)
    }

    /// Stream events starting from after `after_seq`
    pub fn read_since(&self, after_seq: u64) -> Result<Vec<PresenceEvent>> {
        if !self.events_path.exists() {
            return Ok(Vec::new());
        }
        let file = fs::File::open(&self.events_path)?;
        let reader = BufReader::new(file);
        let mut events = Vec::new();
        for line in reader.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(event) = serde_json::from_str::<PresenceEvent>(&line) {
                if event.seq > after_seq {
                    events.push(event);
                }
            }
        }
        Ok(events)
    }
}
