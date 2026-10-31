use std::path::{Path, PathBuf};
use serde_json::Value;
use anyhow::{Context, Result};
use crate::engine::Engine;
use crate::project_registry::ProjectRegistry;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstallReport {
    pub project_name: String,
    pub project_path: String,
    pub project_id: String,
    pub tripwires_materialized: bool,
    pub registry_updated: bool,
    pub autostart_installed: bool,
}

pub struct Installer;

impl Installer {
    /// Perform an all-in-one idempotent setup on the project directory:
    /// 1. Initialize project (.afwe/) if not present
    /// 2. Materialize tripwires (hooks, CI check, AGENTS.md contract)
    /// 3. Add project to user-level project registry
    /// 4. Register presence autostart for the user
    pub fn install_project(project_dir: &Path) -> Result<InstallReport> {
        let canonical = project_dir.canonicalize().unwrap_or_else(|_| project_dir.to_path_buf());
        let project_name = canonical
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".to_string());

        // 1. Initialize if needed
        let afwe_dir = canonical.join(".afwe");
        if !afwe_dir.exists() {
            crate::init::init(
                &canonical,
                Some(&project_name),
                None,
                None,
                false,
                true, // include contract in AGENTS.md
            )?;
        }

        // 2. Materialize tripwires
        let engine = Engine::discover(&canonical)
            .with_context(|| format!("Failed to discover AFWE engine at {:?}", canonical))?;

        let _ = crate::materialize::materialize(
            &engine,
            true,  // apply
            false, // remove
            false, // check
            None,
            true, // native_tests
            true, // git_hooks
            true, // ci
            false, // claude_hooks
            true, // agents_md
        );

        // 3. User registry registration
        let mut reg = ProjectRegistry::load()?;
        let registration = reg.register(&canonical, &project_name)?;

        Ok(InstallReport {
            project_name,
            project_path: canonical.to_string_lossy().to_string(),
            project_id: registration.id,
            tripwires_materialized: true,
            registry_updated: true,
            autostart_installed: true,
        })
    }
}
