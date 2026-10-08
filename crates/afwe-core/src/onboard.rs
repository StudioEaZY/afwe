//! Onboarding: detect stacks and version control, choose a profile (policy presets only — the engine
//! is the same for everyone), and optionally create the git repository, a CI gate and the agent
//! contract block. Nothing here is silent: `detect` reports, `apply` lists every action it took.

use crate::contract;
use crate::engine::Engine;
use crate::init::{init, InitOptions};
use crate::store::Store;
use crate::sync::{sync, SyncOptions};
use crate::vcs;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::path::Path;

pub const CI_TEMPLATE: &str = r#"# AFWE architecture gate — added by `afwe onboard`.
# Set the repository variable AFWE_INSTALL_COMMAND to whatever installs the afwe binary for your team,
# for example: cargo install --git <your afwe repo> afwe-cli
name: AFWE Architecture Gate
on: [push, pull_request]
jobs:
  afwe-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install AFWE
        run: ${{ vars.AFWE_INSTALL_COMMAND }}
      - name: The architecture matches the code
        run: afwe sync --check
      - name: Constraints, guardrails, pins and registered checks hold
        run: afwe gate --ci
"#;

const AGENTS_BEGIN: &str = "<!-- afwe:begin -->";
const AGENTS_END: &str = "<!-- afwe:end -->";

pub fn detect_stacks(root: &Path) -> Vec<Value> {
    let has = |f: &str| root.join(f).exists();
    let mut out = vec![];
    if has("Cargo.toml") {
        out.push(json!({"stack": "rust", "marker": "Cargo.toml", "test": "cargo test"}));
    }
    if has("package.json") {
        let scripts_test = std::fs::read_to_string(root.join("package.json")).map(|s| s.contains("\"test\"")).unwrap_or(false);
        let test: Option<&str> = if scripts_test { Some("npm test") } else { None };
        out.push(json!({"stack": "node", "marker": "package.json", "test": test}));
    }
    if has("pyproject.toml") || has("setup.py") || has("requirements.txt") {
        out.push(json!({"stack": "python", "marker": "pyproject.toml", "test": "pytest"}));
    }
    if has("go.mod") {
        out.push(json!({"stack": "go", "marker": "go.mod", "test": "go test ./..."}));
    }
    if has("pom.xml") {
        out.push(json!({"stack": "java", "marker": "pom.xml", "test": "mvn -q test"}));
    }
    if has("build.gradle") || has("build.gradle.kts") {
        out.push(json!({"stack": "jvm-gradle", "marker": "build.gradle", "test": "gradle test"}));
    }
    out
}

pub fn detect(root: &Path) -> Result<Value> {
    let stacks = detect_stacks(root);
    let initialised = root.join(".afwe/afwe.yaml").exists();
    let (profile, nodes) = if initialised {
        let m = Store::new(root).manifest()?;
        let bp = Store::new(root).blueprint()?;
        (m.profile, crate::mapping::NodeTable::from_blueprint(&bp).nodes.len())
    } else {
        (None, 0)
    };
    let git = vcs::open("git");
    let suggestion: Option<String> = stacks.iter().find_map(|s| s["test"].as_str().map(|t| t.to_string()));
    Ok(json!({
        "root": root,
        "initialised": initialised,
        "configured": profile.is_some(),
        "profile": profile,
        "blueprint_nodes": nodes,
        "stacks": stacks,
        "test_command_suggestion": suggestion,
        "git": {"repo": git.is_repo(root), "head": git.head(root)},
        "ci_present": root.join(".github/workflows/afwe-gate.yml").exists(),
        "agents_md": root.join("AGENTS.md").exists(),
        "profiles": {
            "normie": "zero friction: strong defaults, AFWE commits passing turns itself, proposals for anything doubtful, checkgen on",
            "engineer": "manual commit mode (turns end `ready`, you commit with git), stricter pin slider, same gate and same engine"
        },
    }))
}

pub struct ApplyOptions {
    pub profile: String,
    pub init_git: bool,
    pub baseline_commit: bool,
    pub ci: bool,
    pub agents_md: bool,
    pub test_command: Option<String>,
}

fn write_gitignore_if_missing(root: &Path) -> Result<bool> {
    let p = root.join(".gitignore");
    if p.exists() {
        return Ok(false);
    }
    std::fs::write(&p, "# added by `afwe onboard` (edit freely)\ntarget/\nnode_modules/\ndist/\nbuild/\n.DS_Store\n")?;
    Ok(true)
}

/// Replace the AFWE block between its markers, or append it. Re-running onboarding never duplicates it.
fn write_agents_block(path: &Path, block: &str) -> Result<()> {
    let body = if block.contains(AGENTS_BEGIN) { block.to_string() } else { format!("{AGENTS_BEGIN}\n{block}\n{AGENTS_END}") };
    let next = match std::fs::read_to_string(path) {
        Ok(existing) => match (existing.find(AGENTS_BEGIN), existing.find(AGENTS_END)) {
            (Some(a), Some(b)) if b > a => format!("{}{}{}", &existing[..a], body, &existing[b + AGENTS_END.len()..]),
            _ => format!("{}\n\n{}\n", existing.trim_end(), body),
        },
        Err(_) => format!("{body}\n"),
    };
    std::fs::write(path, next)?;
    Ok(())
}

pub fn apply(root: &Path, o: ApplyOptions) -> Result<Value> {
    let mut actions: Vec<String> = vec![];
    if !root.join(".afwe/afwe.yaml").exists() {
        let name = root.canonicalize().ok().and_then(|p| p.file_name().map(|s| s.to_string_lossy().to_string())).unwrap_or_else(|| "project".into());
        init(root, InitOptions { name: Some(name), description: None, root: None, force: false })?;
        actions.push("initialised .afwe/".into());
    }
    let engine = Engine::at(root);
    let mut m = engine.store.manifest()?;
    let (slider, auto_commit) = match o.profile.as_str() {
        "normie" => (2u8, true),
        "engineer" => (4u8, false),
        other => return Err(anyhow!("unknown profile `{other}` (use `normie` or `engineer`)")),
    };
    m.profile = Some(o.profile.clone());
    m.policy.pins.slider = slider;
    m.policy.checkgen = true;
    m.vcs.auto_commit = auto_commit;
    m.vcs.test_command = o.test_command.clone().or_else(|| detect_stacks(root).iter().find_map(|s| s["test"].as_str().map(|t| t.to_string())));
    engine.store.save_manifest(&m)?;
    actions.push(format!("profile `{}`: pin slider {slider}, checkgen on, auto-commit {auto_commit}", o.profile));
    if let Some(t) = &m.vcs.test_command {
        actions.push(format!("project test command `{t}` runs on every turn"));
    }

    let git = vcs::open("git");
    if o.init_git && !git.is_repo(root) {
        git.init(root)?;
        actions.push("git init".into());
        if write_gitignore_if_missing(root)? {
            actions.push("wrote a starter .gitignore".into());
        }
        if o.baseline_commit {
            match git.commit_paths(root, &[".".to_string()], "AFWE: baseline before the first turn") {
                Ok(Some(sha)) => actions.push(format!("baseline commit {}", sha.chars().take(7).collect::<String>())),
                Ok(None) => actions.push("nothing to commit for the baseline".into()),
                Err(e) => actions.push(format!("baseline commit skipped: {e:#}")),
            }
        }
    }
    if o.ci {
        let dir = root.join(".github/workflows");
        std::fs::create_dir_all(&dir)?;
        let p = dir.join("afwe-gate.yml");
        if p.exists() {
            actions.push("kept the existing .github/workflows/afwe-gate.yml".into());
        } else {
            std::fs::write(&p, CI_TEMPLATE)?;
            actions.push("wrote .github/workflows/afwe-gate.yml (set the repo variable AFWE_INSTALL_COMMAND)".into());
        }
    }
    if o.agents_md {
        let contracts = engine.store.contracts()?;
        let block = contract::render_agents_block(&m.project.name, &contracts);
        write_agents_block(&root.join("AGENTS.md"), &block)?;
        engine.store.write_text("skills/afwe/SKILL.md", contract::AFWE_SKILL_MD)?;
        actions.push("AGENTS.md: AFWE contract block written".into());
        actions.push(".afwe/skills/afwe/SKILL.md: skill template written".into());
    }
    let (report, _) = sync(&engine, &SyncOptions { dry_run: false, origin: "human:onboard".into() })?;
    engine.log("human:onboard", "onboard", format!("Onboarded with profile `{}`", o.profile), Some(json!({"actions": actions})))?;
    Ok(json!({"status": "configured", "profile": o.profile, "actions": actions, "sync": {"files": report.files, "nodes": report.nodes, "mapped": report.mapped_files}}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agents_block_is_replaced_not_duplicated() {
        let dir = std::env::temp_dir().join(format!("afwe-agents-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("AGENTS.md");
        let _ = std::fs::remove_file(&p);
        write_agents_block(&p, "v1").unwrap();
        write_agents_block(&p, &format!("{AGENTS_BEGIN}\nv2\n{AGENTS_END}")).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert_eq!(text.matches(AGENTS_BEGIN).count(), 1);
        assert!(text.contains("v2") && !text.contains("v1"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_common_stacks() {
        let dir = std::env::temp_dir().join(format!("afwe-stacks-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Cargo.toml"), "[package]").unwrap();
        let stacks = detect_stacks(&dir);
        assert_eq!(stacks[0]["stack"], "rust");
        assert_eq!(stacks[0]["test"], "cargo test");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
