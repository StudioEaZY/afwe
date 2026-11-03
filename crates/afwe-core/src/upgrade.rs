//! Non-Destructive Project Upgrade.
//!
//! Refreshes AFWE documentation, skills, tripwires, agent hooks, CI workflows,
//! and git hooks in existing projects without overwriting custom blueprints,
//! pins, memories, decisions, or open turn state.

use crate::engine::Engine;
use crate::init::AFWE_README;
use crate::materialize::{self, MaterializeOptions};
use crate::model::FORMAT_VERSION;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpgradeReport {
    pub format: String,
    pub updated_files: Vec<String>,
    pub preserved_sources: Vec<String>,
    pub message: String,
}

pub fn upgrade(engine: &Engine) -> Result<UpgradeReport> {
    let store = &engine.store;

    let mut updated_files = Vec::new();

    // 1. Ensure all expected standard directories exist
    for d in [
        "blueprint",
        "memory/decisions",
        "memory/constraints",
        "memory/exceptions",
        "memory/terminology",
        "memory/problems",
        "guardrails/passive",
        "guardrails/active",
        "intents",
        "pins",
        "checks",
        "turns",
        "abstractions",
        "index/baselines",
        "state/quarantine",
        "log",
        "backups",
        "skills/afwe",
        "docs",
    ] {
        let p = store.p(d);
        if !p.exists() {
            fs::create_dir_all(&p)?;
        }
    }

    // 2. Refresh documentation templates and skills from embedded resources
    store.write_text("skills/afwe/SKILL.md", crate::contract::AFWE_SKILL_MD)?;
    updated_files.push(".afwe/skills/afwe/SKILL.md".into());

    store.write_text("docs/TUTORIAL.md", include_str!("../../../docs/TUTORIAL.md"))?;
    updated_files.push(".afwe/docs/TUTORIAL.md".into());

    store.write_text("docs/WALKTHROUGH.md", include_str!("../../../docs/WALKTHROUGH.md"))?;
    updated_files.push(".afwe/docs/WALKTHROUGH.md".into());

    store.write_text("docs/SPEC.md", include_str!("../../../docs/SPEC.md"))?;
    updated_files.push(".afwe/docs/SPEC.md".into());

    store.write_text("docs/UBIQUITOUS_LANGUAGE.md", include_str!("../../../docs/UBIQUITOUS_LANGUAGE.md"))?;
    updated_files.push(".afwe/docs/UBIQUITOUS_LANGUAGE.md".into());

    store.write_text("docs/UBIQUITOUS_LANGUAGE.html", include_str!("../../../docs/UBIQUITOUS_LANGUAGE.html"))?;
    updated_files.push(".afwe/docs/UBIQUITOUS_LANGUAGE.html".into());

    store.write_text("README.md", &AFWE_README.replace("(format afwe/2)", &format!("(format {FORMAT_VERSION})")))?;
    updated_files.push(".afwe/README.md".into());

    // 3. Update .afwe/.gitignore
    let gitignore_content = "# derived state is reproducible (rebuilt by `afwe sync`); the rest of .afwe/ is the product and belongs in git\nindex/\nstate/\nbackups/\nlog/\n";
    store.write_text(".gitignore", gitignore_content)?;
    updated_files.push(".afwe/.gitignore".into());

    // 4. Materialize tripwires, agent hooks, pre-commit, and CI
    let mat_res = materialize::run(
        engine,
        MaterializeOptions {
            apply: true,
            native_tests: true,
            git_hooks: true,
            ci: true,
            agent_hooks: true,
            claude_hooks: true,
            agents_md: true,
            ..Default::default()
        },
    )?;
    if let Some(entries) = mat_res.get("entries").and_then(|v| v.as_object()) {
        for (f, _) in entries {
            if !updated_files.contains(f) {
                updated_files.push(f.clone());
            }
        }
    }

    // 5. Migrate workflows if legacy format exists and bump format version in manifest
    let workflows_moved = store.migrate_workflows().unwrap_or(0);
    if let Ok(mut m) = store.manifest() {
        m.format = FORMAT_VERSION.into();
        let _ = store.save_manifest(&m);
    }

    // 6. Record preserved custom sources
    let preserved_sources = vec![
        ".afwe/blueprint/blueprint.yaml".into(),
        ".afwe/blueprint/relations.yaml".into(),
        ".afwe/blueprint/constraints.yaml".into(),
        ".afwe/memory/ (all custom decisions, constraints, problems)".into(),
        ".afwe/pins/ (all locked decisions)".into(),
        ".afwe/checks/ (all registered checks)".into(),
        ".afwe/turns/ (all historical and active turn records)".into(),
        ".afwe/intents/ (all live intents)".into(),
    ];

    engine.log(
        "human:upgrade",
        "project_upgrade",
        format!(
            "Upgraded project to format {FORMAT_VERSION} ({workflows_moved} legacy workflows moved, {} files updated, custom architecture preserved)",
            updated_files.len()
        ),
        Some(json!({
            "updated_files": updated_files,
            "format": FORMAT_VERSION,
        })),
    )?;

    Ok(UpgradeReport {
        format: FORMAT_VERSION.into(),
        updated_files,
        preserved_sources,
        message: format!(
            "Project successfully upgraded to format {FORMAT_VERSION}. Tripwires, agent-hooks, and documentation refreshed without altering blueprints, memories, or pins."
        ),
    })
}
