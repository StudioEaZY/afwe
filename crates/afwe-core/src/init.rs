//! `afwe init` – scaffold an empty `.afwe/` (as empty as the codebase it starts with)
//! and `afwe bootstrap` – propose an initial blueprint for an existing codebase.

use crate::engine::Engine;
use crate::model::*;
use crate::store::Store;
use crate::util::slug;
use anyhow::{anyhow, Result};
use std::collections::BTreeMap;
use std::path::Path;

pub const AFWE_README: &str = r#"# .afwe/ — Architecture-First Workspace Engine (format afwe/2)

This folder is the product: a persistent, structural model of the project that a harness reads and writes.
The engine that reads and writes it is replaceable.

## Sources of truth (commit these)

- `afwe.yaml` — manifest: policy (confidence thresholds, pin slider, checkgen), vcs (provider, auto-commit, test command), profile.
- `blueprint/` — structural reality: nodes (with implementation mapping), relations, constraints.
- `memory/<kind>/*.md` — decisions, constraints, exceptions, terminology, problems. Scoped by applies_to / files / symbols.
- `guardrails/passive|active/*.yaml` — context to inject (passive) and checks to enforce (active).
- `intents/*.yaml` — living intents: the merged statement of what is wanted, with its history and its raw prompts.
- `pins/*.yaml` — human-locked decisions and intentional bugs. The only part a human must lock.
- `checks/*.yaml` — what the gate must pass: shell commands or claims, with trust and authorship.
- `turns/tNNNN.yaml` — the ledger: one prompt per turn, its gate outcome and what it touched.
- `workflows/`, `abstractions/`, `contracts/` — node graphs (legacy), lenses, contract steps.
- `log/changes.jsonl` — append-only change log.

## Derived (rebuildable, never committed)

- `index/` and `state/` — code model, index, drift, board, proposals, baselines. `afwe sync` rebuilds them.

## The turn protocol

`afwe turn begin "<prompt>"` → briefing · `afwe turn assume <turn> --file <json>` → intents and claims ·
`afwe turn commit <turn>` → gate, then commit (`AFWE-Turn:` trailer), stage, or REDO.
History: `afwe timeline`, `afwe timeline losses`, `afwe timeline restore <feature>`.

Read `.afwe/docs/SPEC.md` for formats and `.afwe/docs/TUTORIAL.md` for the developer guide.
"#;

pub struct InitOptions {
    pub name: Option<String>,
    pub description: Option<String>,
    pub root: Option<String>,
    pub force: bool,
}

pub fn init(project_root: &Path, opts: InitOptions) -> Result<Store> {
    let store = Store::new(project_root);
    if store.exists() && !opts.force {
        return Err(anyhow!(".afwe/ already exists at {} (use --force to reset the manifest)", store.afwe_dir.display()));
    }
    let name = opts.name.unwrap_or_else(|| project_root.canonicalize().ok().and_then(|p| p.file_name().map(|s| s.to_string_lossy().to_string())).unwrap_or("project".into()));
    let manifest = Manifest { format: FORMAT_VERSION.into(), project: ProjectMeta { name: name.clone(), description: opts.description, root: opts.root.unwrap_or(".".into()) }, analyzer: AnalyzerConfig::default(), policy: Policy::default(), provenance: ProvenanceConfig::default(), vcs: VcsConfig::default(), profile: None };
    store.save_manifest(&manifest)?;
    if !store.p("blueprint/blueprint.yaml").exists() {
        let root = BlueprintNode { id: slug(&name), name: name.clone(), kind: "product".into(), purpose: Some("Root of the architecture. Everything the project is lives beneath this node.".into()), description: None, implements: Implementation::default(), tags: vec![], status: Some("active".into()), origin: Some("human".into()), children: vec![] };
        store.save_blueprint(&Blueprint { nodes: vec![root] })?;
    }
    if !store.p("blueprint/relations.yaml").exists() {
        store.save_relations(&Relations::default())?;
    }
    if !store.p("blueprint/constraints.yaml").exists() {
        store.save_constraints(&Constraints::default())?;
    }
    for k in MEMORY_KINDS {
        std::fs::create_dir_all(store.p(&format!("memory/{k}")))?;
        let keep = store.p(&format!("memory/{k}/.gitkeep"));
        if !keep.exists() {
            std::fs::write(keep, "")?;
        }
    }
    for d in ["guardrails/passive", "guardrails/active", "intents", "pins", "checks", "turns", "abstractions", "index/baselines", "state", "log"] {
        std::fs::create_dir_all(store.p(d))?;
    }
    if store.contracts()?.is_empty() {
        for c in crate::contract::default_contracts() {
            store.save_contract(&c)?;
        }
    }
    store.write_text("skills/afwe/SKILL.md", crate::contract::AFWE_SKILL_MD)?;
    store.write_text("docs/TUTORIAL.md", include_str!("../../../docs/TUTORIAL.md"))?;
    store.write_text("docs/WALKTHROUGH.md", include_str!("../../../docs/WALKTHROUGH.md"))?;
    store.write_text("docs/SPEC.md", include_str!("../../../docs/SPEC.md"))?;
    store.write_text("README.md", AFWE_README)?;
    store.write_text(".gitignore", "# derived state is reproducible (rebuilt by `afwe sync`); the rest of .afwe/ is the product and belongs in git\nindex/\nstate/\n")?;
    let engine = Engine { store: store.clone() };
    engine.log("human", "init", format!("Initialised .afwe for `{name}`"), None)?;
    Ok(store)
}

/// Propose an initial blueprint from the directory structure of an existing codebase.
/// Top-level source directories become subsystems, their immediate children modules.
/// Everything is marked `origin: afwe:bootstrap` so humans/LLMs know it is a guess.
pub fn bootstrap(engine: &Engine, depth: usize, apply: bool) -> Result<Blueprint> {
    let manifest = engine.store.manifest()?;
    let code = engine.analyzer(&manifest).analyze()?;
    let mut bp = engine.store.blueprint()?;
    let root_id = bp.nodes.first().map(|n| n.id.clone()).unwrap_or_else(|| slug(&manifest.project.name));
    if bp.nodes.is_empty() {
        bp.nodes.push(BlueprintNode { id: root_id.clone(), name: manifest.project.name.clone(), kind: "product".into(), purpose: None, description: None, implements: Implementation::default(), tags: vec![], status: Some("active".into()), origin: Some("human".into()), children: vec![] });
    }
    // count code files per directory prefix
    let mut dirs: BTreeMap<String, usize> = BTreeMap::new();
    for f in &code.files {
        if matches!(f.language.as_str(), "other" | "json" | "yaml" | "toml" | "markdown") {
            continue;
        }
        let parts: Vec<&str> = f.path.split('/').collect();
        for d in 1..parts.len().min(depth + 1) {
            *dirs.entry(parts[..d].join("/")).or_default() += 1;
        }
    }
    // skip generic wrapper dirs (src, lib, app) by descending into them
    let generic = ["src", "lib", "app", "apps", "packages", "pkg", "internal", "cmd"];
    let mut existing_ids = vec![];
    crate::mapping::all_ids(&bp.nodes, &mut existing_ids);
    fn build(prefix: &str, dirs: &BTreeMap<String, usize>, depth_left: usize, generic: &[&str], ids: &mut Vec<String>) -> Vec<BlueprintNode> {
        let mut out = vec![];
        let children: Vec<(&String, &usize)> = dirs.iter().filter(|(d, _)| {
            let parent = match d.rfind('/') { Some(i) => &d[..i], None => "" };
            parent == prefix
        }).collect();
        for (d, count) in children {
            let name = d.rsplit('/').next().unwrap_or(d).to_string();
            if generic.contains(&name.as_str()) {
                out.extend(build(d, dirs, depth_left, generic, ids));
                continue;
            }
            if *count < 1 || depth_left == 0 {
                continue;
            }
            let id = crate::mapping::unique_id(ids, &name);
            ids.push(id.clone());
            let kids = build(d, dirs, depth_left - 1, generic, ids);
            out.push(BlueprintNode { id, name: humanise(&name), kind: if kids.is_empty() { "module".into() } else { "subsystem".into() }, purpose: None, description: Some(format!("Bootstrapped from `{d}/` ({count} code files). Review and give it a purpose.")), implements: Implementation { files: vec![format!("{d}/**")], symbols: vec![] }, tags: vec!["bootstrapped".into()], status: Some("active".into()), origin: Some("afwe:bootstrap".into()), children: kids });
        }
        out
    }
    let nodes = build("", &dirs, depth, &generic, &mut existing_ids);
    let root = crate::mapping::find_node_mut(&mut bp.nodes, &root_id).unwrap();
    for n in nodes {
        if !root.children.iter().any(|c| c.name == n.name) {
            root.children.push(n);
        }
    }
    if apply {
        engine.store.save_blueprint(&bp)?;
        engine.log("afwe:bootstrap", "bootstrap", format!("Bootstrapped blueprint from directory structure ({} files)", code.files.len()), None)?;
    }
    Ok(bp)
}

fn humanise(s: &str) -> String {
    let mut out = String::new();
    for (i, part) in s.split(|c| c == '-' || c == '_' || c == '.').enumerate() {
        if part.is_empty() {
            continue;
        }
        if i > 0 {
            out.push(' ');
        }
        let mut chars = part.chars();
        if let Some(f) = chars.next() {
            out.push(f.to_ascii_uppercase());
            out.extend(chars);
        }
    }
    out
}
