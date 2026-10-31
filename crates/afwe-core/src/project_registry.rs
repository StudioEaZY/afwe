use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use anyhow::{Context, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRegistration {
    pub id: String,
    pub name: String,
    pub path: String,
    pub host_id: String,
    pub registered_at: String,
    pub last_seen_seq: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectRegistry {
    pub projects: Vec<ProjectRegistration>,
}

impl ProjectRegistry {
    pub fn state_file_path() -> PathBuf {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            PathBuf::from(local_app_data).join("afwe").join("project_registry.json")
        } else if let Ok(home) = std::env::var("HOME") {
            PathBuf::from(home).join(".local").join("share").join("afwe").join("project_registry.json")
        } else {
            PathBuf::from(".afwe-project-registry.json")
        }
    }

    pub fn load() -> Result<Self> {
        let p = Self::state_file_path();
        if !p.exists() {
            return Ok(Self::default());
        }
        let data = fs::read_to_string(&p)
            .with_context(|| format!("Failed to read project registry at {:?}", p))?;
        let reg: Self = serde_json::from_str(&data).unwrap_or_default();
        Ok(reg)
    }

    pub fn save(&self) -> Result<()> {
        let p = Self::state_file_path();
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(self)?;
        fs::write(&p, data)?;
        Ok(())
    }

    pub fn register(&mut self, project_path: &Path, project_name: &str) -> Result<ProjectRegistration> {
        let canonical = project_path.canonicalize().unwrap_or_else(|_| project_path.to_path_buf());
        let path_str = canonical.to_string_lossy().to_string();
        let host = whoami_host();

        let id = blake3::hash(path_str.as_bytes()).to_hex()[0..12].to_string();
        let now = chrono::Utc::now().to_rfc3339();

        if let Some(pos) = self.projects.iter().position(|p| p.path == path_str || p.id == id) {
            self.projects[pos].name = project_name.to_string();
            self.projects[pos].path = path_str;
            self.projects[pos].host_id = host;
            let reg = self.projects[pos].clone();
            self.save()?;
            return Ok(reg);
        }

        let reg = ProjectRegistration {
            id,
            name: project_name.to_string(),
            path: path_str,
            host_id: host,
            registered_at: now,
            last_seen_seq: 0,
        };
        self.projects.push(reg.clone());
        self.save()?;
        Ok(reg)
    }

    pub fn unregister(&mut self, id_or_path: &str) -> Result<bool> {
        let initial_len = self.projects.len();
        self.projects.retain(|p| p.id != id_or_path && p.path != id_or_path);
        let removed = self.projects.len() < initial_len;
        if removed {
            self.save()?;
        }
        Ok(removed)
    }

    pub fn update_last_seen_seq(&mut self, id: &str, seq: u64) -> Result<()> {
        if let Some(p) = self.projects.iter_mut().find(|p| p.id == id) {
            p.last_seen_seq = seq;
            self.save()?;
        }
        Ok(())
    }
}

pub fn whoami_host() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "localhost".to_string())
}
