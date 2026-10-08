//! Structural editing operations on `.afwe/` sources: blueprint, memory, guardrails,
//! workflows and lenses. Every mutation is logged with its origin.

use crate::engine::Engine;
use crate::mapping::{all_ids, find_node_mut, remove_node, unique_id, NodeTable};
use crate::model::*;
use crate::store::Store;
use crate::util::{now, slug, today};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};

fn table(store: &Store) -> Result<(Blueprint, NodeTable)> {
    let bp = store.blueprint()?;
    let t = NodeTable::from_blueprint(&bp);
    Ok((bp, t))
}

// ───────────────────────────── blueprint ─────────────────────────────

pub struct AddNode {
    pub name: String,
    pub parent: Option<String>,
    pub kind: Option<String>,
    pub purpose: Option<String>,
    pub description: Option<String>,
    pub files: Vec<String>,
    pub symbols: Vec<String>,
    pub status: Option<String>,
    pub id: Option<String>,
    pub tags: Vec<String>,
}

pub fn add_node(engine: &Engine, a: AddNode, origin: &str) -> Result<BlueprintNode> {
    let (mut bp, t) = table(&engine.store)?;
    let mut ids = vec![];
    all_ids(&bp.nodes, &mut ids);
    let id = match a.id {
        Some(i) if !ids.contains(&i) => i,
        Some(i) => return Err(anyhow!("node id `{i}` already exists")),
        None => unique_id(&ids, &a.name),
    };
    let node = BlueprintNode { id, name: a.name, kind: a.kind.unwrap_or_else(|| "module".into()), purpose: a.purpose, description: a.description, implements: Implementation { files: a.files, symbols: a.symbols }, tags: a.tags, status: a.status.or(Some("active".into())), origin: Some(origin.into()), children: vec![] };
    match &a.parent {
        Some(p) => {
            let pid = t.resolve_or_err(p)?;
            find_node_mut(&mut bp.nodes, &pid).unwrap().children.push(node.clone());
        }
        None => bp.nodes.push(node.clone()),
    }
    engine.store.save_blueprint(&bp)?;
    engine.log(origin, "add_node", format!("Added node {}{}", node.name, a.parent.map(|p| format!(" under {p}")).unwrap_or_default()), Some(json!({"id": node.id})))?;
    Ok(node)
}

pub fn move_node(engine: &Engine, node: &str, new_parent: Option<&str>, origin: &str) -> Result<()> {
    let (mut bp, t) = table(&engine.store)?;
    let id = t.resolve_or_err(node)?;
    let parent = match new_parent {
        Some(p) => Some(t.resolve_or_err(p)?),
        None => None,
    };
    if let Some(p) = &parent {
        if t.is_ancestor_or_same(&id, p) {
            return Err(anyhow!("cannot move a node under itself"));
        }
    }
    let n = remove_node(&mut bp.nodes, &id).ok_or_else(|| anyhow!("node not found"))?;
    match &parent {
        Some(p) => find_node_mut(&mut bp.nodes, p).ok_or_else(|| anyhow!("parent not found"))?.children.push(n),
        None => bp.nodes.push(n),
    }
    engine.store.save_blueprint(&bp)?;
    engine.log(origin, "move_node", format!("Moved {} → {}", t.path_of(&id), parent.as_ref().map(|p| t.path_of(p)).unwrap_or("(root)".into())), None)?;
    Ok(())
}

pub fn update_node(engine: &Engine, node: &str, patch: &Value, origin: &str) -> Result<BlueprintNode> {
    let (mut bp, t) = table(&engine.store)?;
    let id = t.resolve_or_err(node)?;
    let n = find_node_mut(&mut bp.nodes, &id).unwrap();
    let mut changed = vec![];
    if let Some(v) = patch.get("name").and_then(|v| v.as_str()) {
        n.name = v.into();
        changed.push("name");
    }
    if let Some(v) = patch.get("kind").and_then(|v| v.as_str()) {
        n.kind = v.into();
        changed.push("kind");
    }
    if patch.get("purpose").is_some() {
        n.purpose = patch.get("purpose").and_then(|v| v.as_str()).map(|s| s.to_string()).filter(|s| !s.is_empty());
        changed.push("purpose");
    }
    if patch.get("description").is_some() {
        n.description = patch.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()).filter(|s| !s.is_empty());
        changed.push("description");
    }
    if let Some(v) = patch.get("status").and_then(|v| v.as_str()) {
        n.status = Some(v.into());
        changed.push("status");
    }
    if let Some(v) = patch.get("tags").and_then(|v| v.as_array()) {
        n.tags = v.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect();
        changed.push("tags");
    }
    if let Some(v) = patch.get("files").and_then(|v| v.as_array()) {
        n.implements.files = v.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect();
        changed.push("files");
    }
    if let Some(v) = patch.get("symbols").and_then(|v| v.as_array()) {
        n.implements.symbols = v.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect();
        changed.push("symbols");
    }
    let out = n.clone();
    engine.store.save_blueprint(&bp)?;
    engine.log(origin, "update_node", format!("Updated {} ({})", t.path_of(&id), changed.join(", ")), None)?;
    Ok(out)
}

pub fn remove_node_op(engine: &Engine, node: &str, origin: &str) -> Result<BlueprintNode> {
    let (mut bp, t) = table(&engine.store)?;
    let id = t.resolve_or_err(node)?;
    let n = remove_node(&mut bp.nodes, &id).ok_or_else(|| anyhow!("node not found"))?;
    engine.store.save_blueprint(&bp)?;
    engine.log(origin, "remove_node", format!("Removed {} (and {} descendants)", t.path_of(&id), t.descendants(&id).len()), None)?;
    Ok(n)
}

pub fn map_node(engine: &Engine, node: &str, files: &[String], symbols: &[String], unmap: bool, origin: &str) -> Result<Implementation> {
    let (mut bp, t) = table(&engine.store)?;
    let id = t.resolve_or_err(node)?;
    let n = find_node_mut(&mut bp.nodes, &id).unwrap();
    for f in files {
        let f = f.trim_start_matches("./").to_string();
        if unmap {
            n.implements.files.retain(|x| x != &f);
        } else if !n.implements.files.contains(&f) {
            n.implements.files.push(f);
        }
    }
    for s in symbols {
        if unmap {
            n.implements.symbols.retain(|x| x != s);
        } else if !n.implements.symbols.contains(s) {
            n.implements.symbols.push(s.clone());
        }
    }
    let out = n.implements.clone();
    engine.store.save_blueprint(&bp)?;
    engine.log(origin, if unmap { "unmap" } else { "map" }, format!("{} {} {:?} {:?}", if unmap { "Unmapped" } else { "Mapped" }, t.path_of(&id), files, symbols), None)?;
    Ok(out)
}

pub fn relate(engine: &Engine, from: &str, to: &str, kind: &str, rationale: Option<String>, remove: bool, origin: &str) -> Result<Relations> {
    let (_, t) = table(&engine.store)?;
    let f = t.resolve_or_err(from)?;
    let tt = t.resolve_or_err(to)?;
    let mut rel = engine.store.relations()?;
    if remove {
        rel.relations.retain(|r| !(t.resolve(&r.from).as_deref() == Some(&f) && t.resolve(&r.to).as_deref() == Some(&tt)));
    } else if let Some(existing) = rel.relations.iter_mut().find(|r| t.resolve(&r.from).as_deref() == Some(&f) && t.resolve(&r.to).as_deref() == Some(&tt)) {
        existing.kind = kind.into();
        existing.status = "declared".into();
        if rationale.is_some() {
            existing.rationale = rationale.clone();
        }
        existing.origin = Some(origin.into());
    } else {
        rel.relations.push(Relation { id: None, from: f.clone(), to: tt.clone(), kind: kind.into(), rationale: rationale.clone(), status: "declared".into(), origin: Some(origin.into()), evidence: vec![], confidence: None });
    }
    engine.store.save_relations(&rel)?;
    engine.log(origin, if remove { "remove_relation" } else { "relate" }, format!("{} {} {kind} {}", if remove { "Removed relation" } else { "Declared" }, t.path_of(&f), t.path_of(&tt)), None)?;
    Ok(rel)
}

pub struct Constrain {
    pub id: Option<String>,
    pub rule: String,
    pub from: String,
    pub to: Vec<String>,
    pub except: Vec<String>,
    pub description: Option<String>,
    pub rationale: Option<String>,
    pub severity: Option<String>,
    pub phase: Option<String>,
}

pub fn constrain(engine: &Engine, c: Constrain, origin: &str) -> Result<Constraint> {
    let (_, t) = table(&engine.store)?;
    let from = t.resolve_or_err(&c.from)?;
    let to: Vec<String> = c.to.iter().map(|r| t.resolve_or_err(r)).collect::<Result<_>>()?;
    let except: Vec<String> = c.except.iter().map(|r| t.resolve_or_err(r)).collect::<Result<_>>()?;
    if !matches!(c.rule.as_str(), "must_not_depend" | "may_depend_only") {
        return Err(anyhow!("rule must be must_not_depend or may_depend_only"));
    }
    let mut cs = engine.store.constraints()?;
    let id = c.id.unwrap_or_else(|| slug(&format!("{}-{}-{}", from, c.rule.replace("_depend", ""), if c.rule == "may_depend_only" { except.join("-") } else { to.join("-") })));
    let constraint = Constraint { id: id.clone(), description: c.description, rule: c.rule, from, to, except, severity: c.severity.unwrap_or("error".into()), phase: c.phase, rationale: c.rationale, memory: vec![] };
    cs.constraints.retain(|x| x.id != id);
    cs.constraints.push(constraint.clone());
    engine.store.save_constraints(&cs)?;
    engine.log(origin, "constrain", format!("Constraint {}: {} {} {:?}", id, constraint.from, constraint.rule, if constraint.rule == "may_depend_only" { &constraint.except } else { &constraint.to }), None)?;
    Ok(constraint)
}

pub fn remove_constraint(engine: &Engine, id: &str, origin: &str) -> Result<()> {
    let mut cs = engine.store.constraints()?;
    let before = cs.constraints.len();
    cs.constraints.retain(|c| c.id != id);
    if cs.constraints.len() == before {
        return Err(anyhow!("constraint `{id}` not found"));
    }
    engine.store.save_constraints(&cs)?;
    engine.log(origin, "remove_constraint", format!("Removed constraint {id}"), None)
}

// ───────────────────────────── memory ─────────────────────────────

pub struct MemoryAdd {
    pub kind: String,
    pub title: String,
    pub body: String,
    pub id: Option<String>,
    pub applies_to: Vec<String>,
    pub files: Vec<String>,
    pub symbols: Vec<String>,
    pub tags: Vec<String>,
    pub status: Option<String>,
    pub supersedes: Option<String>,
    pub enforces: Vec<String>,
    pub workflow: Option<String>,
}

pub fn memory_add(engine: &Engine, m: MemoryAdd, origin: &str) -> Result<MemoryEntry> {
    let kind = crate::store::singular(&m.kind);
    if !MEMORY_KINDS.iter().any(|k| crate::store::singular(k) == kind) {
        return Err(anyhow!("kind must be one of decision, constraint, exception, terminology, problem"));
    }
    let (_, t) = table(&engine.store)?;
    // validate node refs (warn only: memory may be written before the node exists)
    let mut applies_to = vec![];
    for r in &m.applies_to {
        applies_to.push(t.resolve(r).unwrap_or_else(|| r.clone()));
    }
    let id = m.id.unwrap_or_else(|| slug(&m.title));
    let path = Store::memory_path(&kind, &id);
    if engine.store.p(&path).exists() {
        return Err(anyhow!("memory `{id}` already exists at .afwe/{path} (edit it or choose another id)"));
    }
    let default_status = match kind.as_str() {
        "problem" => "open",
        _ => "accepted",
    };
    let body = if m.body.trim().is_empty() { default_body(&kind, &m.title) } else { m.body.clone() };
    let entry = MemoryEntry {
        meta: MemoryMeta { id: id.clone(), kind: kind.clone(), title: m.title.clone(), status: Some(m.status.unwrap_or(default_status.into())), applies_to, files: m.files, symbols: m.symbols, tags: m.tags, origin: Some(origin.into()), created: Some(today()), updated: None, supersedes: m.supersedes.clone(), enforces: m.enforces, workflow: m.workflow },
        body,
        path,
    };
    engine.store.save_memory(&entry)?;
    if let Some(old) = &m.supersedes {
        if let Some(mut prev) = engine.store.memory()?.into_iter().find(|e| &e.meta.id == old) {
            prev.meta.status = Some("superseded".into());
            prev.meta.updated = Some(today());
            engine.store.save_memory(&prev)?;
        }
    }
    engine.log(origin, "memory_add", format!("Recorded {kind} `{id}`: {}", m.title), Some(json!({"path": entry.path})))?;
    Ok(entry)
}

fn default_body(kind: &str, title: &str) -> String {
    match kind {
        "decision" => format!("# {title}\n\n## Decision\n\n## Reason\n\n## Trade-off\n\n## Status\nAccepted.\n"),
        "exception" => format!("# {title}\n\n## Exception\n\n## Why it is intentional\n\n## Scope\n"),
        "constraint" => format!("# {title}\n\n## Rule\n\n## Reason\n\n## Exceptions\n"),
        "terminology" => format!("# {title}\n\n## Meaning\n\n## Not to be confused with\n"),
        _ => format!("# {title}\n\n## Problem\n\n## Impact\n\n## Ideas\n"),
    }
}

pub fn memory_update(engine: &Engine, id: &str, patch: &Value, origin: &str) -> Result<MemoryEntry> {
    let mut e = engine.store.memory()?.into_iter().find(|e| e.meta.id == id).ok_or_else(|| anyhow!("memory `{id}` not found"))?;
    if let Some(b) = patch.get("body").and_then(|v| v.as_str()) {
        e.body = b.to_string();
    }
    if let Some(v) = patch.get("title").and_then(|v| v.as_str()) {
        e.meta.title = v.into();
    }
    if let Some(v) = patch.get("status").and_then(|v| v.as_str()) {
        e.meta.status = Some(v.into());
    }
    for (key, target) in [("applies_to", &mut e.meta.applies_to), ("files", &mut e.meta.files), ("symbols", &mut e.meta.symbols), ("tags", &mut e.meta.tags)] {
        if let Some(v) = patch.get(key).and_then(|v| v.as_array()) {
            *target = v.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect();
        }
    }
    e.meta.updated = Some(today());
    engine.store.save_memory(&e)?;
    engine.log(origin, "memory_update", format!("Updated memory `{id}`"), None)?;
    Ok(e)
}

pub fn memory_remove(engine: &Engine, id: &str, origin: &str) -> Result<()> {
    let e = engine.store.memory()?.into_iter().find(|e| e.meta.id == id).ok_or_else(|| anyhow!("memory `{id}` not found"))?;
    engine.store.remove(&e.path)?;
    engine.log(origin, "memory_remove", format!("Removed memory `{id}`"), None)
}

// ───────────────────────────── guardrails ─────────────────────────────

pub fn guardrail_add(engine: &Engine, mut g: Guardrail, origin: &str) -> Result<Guardrail> {
    if g.id.is_empty() {
        g.id = slug(&g.statement);
    }
    if g.mode.is_empty() {
        g.mode = if g.checks.is_empty() { "passive".into() } else { "active".into() };
    }
    if g.mode == "active" && g.checks.is_empty() {
        return Err(anyhow!("an active guardrail needs at least one check"));
    }
    let (_, t) = table(&engine.store)?;
    g.scope.nodes = g.scope.nodes.iter().map(|r| t.resolve(r).unwrap_or(r.clone())).collect();
    g.exception_scope.nodes = g.exception_scope.nodes.iter().map(|r| t.resolve(r).unwrap_or(r.clone())).collect();
    if g.origin.is_none() {
        g.origin = Some(origin.into());
    }
    if g.created.is_none() {
        g.created = Some(today());
    }
    if g.status.is_none() {
        g.status = Some("active".into());
    }
    engine.store.save_guardrail(&g)?;
    engine.log(origin, "guardrail_add", format!("Added {} guardrail `{}`: {}", g.mode, g.id, g.statement), None)?;
    Ok(g)
}

pub fn guardrail_remove(engine: &Engine, id: &str, origin: &str) -> Result<()> {
    let g = engine.store.guardrails()?.into_iter().find(|g| g.id == id).ok_or_else(|| anyhow!("guardrail `{id}` not found"))?;
    engine.store.remove(&format!("guardrails/{}/{}.yaml", g.mode, g.id))?;
    engine.log(origin, "guardrail_remove", format!("Removed guardrail `{id}`"), None)
}

// ───────────────────────────── workflows ─────────────────────────────

pub fn workflow_new(engine: &Engine, title: &str, id: Option<String>, description: Option<String>, prompt: Option<String>, targets: Vec<String>, task: Option<String>, origin: &str) -> Result<Workflow> {
    let id = id.unwrap_or_else(|| slug(title));
    if engine.store.intent(&id)?.is_some() {
        return Err(anyhow!("workflow `{id}` already exists"));
    }
    let manifest = engine.store.manifest()?;
    let mut nodes = vec![];
    if let Some(p) = prompt {
        if manifest.provenance.retain_prompts {
            nodes.push(WorkflowNode { id: "prompt-1".into(), kind: "prompt".into(), title: "Original prompt".into(), text: Some(p), origin: Some(origin.into()), status: Some("captured".into()), position: Position { x: 0.0, y: 0.0 }, attachments: vec![], maps_to: None, created: Some(now()) });
        }
    }
    let w = Workflow { id: id.clone(), title: title.into(), description, status: "draft".into(), origin: Some(origin.into()), targets, nodes, edges: vec![], created: Some(now()), updated: Some(now()), task };
    engine.store.save_workflow(&w)?;
    engine.log(origin, "workflow_new", format!("Created workflow `{id}`: {title}"), None)?;
    Ok(w)
}

pub struct WfAddNode {
    pub workflow: String,
    pub kind: String,
    pub title: String,
    pub text: Option<String>,
    pub after: Option<String>,
    pub edge_kind: Option<String>,
    pub id: Option<String>,
    pub position: Option<Position>,
}

pub fn workflow_add_node(engine: &Engine, a: WfAddNode, origin: &str) -> Result<(Workflow, WorkflowNode)> {
    let mut w = engine.store.workflow(&a.workflow)?;
    let base = slug(&a.title);
    let mut id = a.id.unwrap_or_else(|| base.clone());
    let mut i = 2;
    while w.nodes.iter().any(|n| n.id == id) {
        id = format!("{base}-{i}");
        i += 1;
    }
    let position = a.position.unwrap_or_else(|| {
        let n = w.nodes.len() as f64;
        Position { x: (n % 4.0) * 260.0, y: (n / 4.0).floor() * 160.0 }
    });
    let node = WorkflowNode { id: id.clone(), kind: a.kind, title: a.title, text: a.text, origin: Some(origin.into()), status: Some("pending".into()), position, attachments: vec![], maps_to: None, created: Some(now()) };
    if let Some(after) = a.after {
        if !w.nodes.iter().any(|n| n.id == after) {
            return Err(anyhow!("node `{after}` not in workflow"));
        }
        w.edges.push(WorkflowEdge { from: after, to: id.clone(), kind: a.edge_kind.unwrap_or("then".into()), label: None });
    }
    w.nodes.push(node.clone());
    w.updated = Some(now());
    engine.store.save_workflow(&w)?;
    engine.log(origin, "workflow_add_node", format!("Workflow `{}`: added {} node `{}`", w.id, node.kind, node.title), None)?;
    Ok((w, node))
}

pub fn workflow_link(engine: &Engine, workflow: &str, from: &str, to: &str, kind: &str, remove: bool, origin: &str) -> Result<Workflow> {
    let mut w = engine.store.workflow(workflow)?;
    for x in [from, to] {
        if !w.nodes.iter().any(|n| n.id == x) {
            return Err(anyhow!("node `{x}` not in workflow"));
        }
    }
    w.edges.retain(|e| !(e.from == from && e.to == to));
    if !remove {
        w.edges.push(WorkflowEdge { from: from.into(), to: to.into(), kind: kind.into(), label: None });
    }
    w.updated = Some(now());
    engine.store.save_workflow(&w)?;
    engine.log(origin, "workflow_link", format!("Workflow `{workflow}`: {} {from} → {to}", if remove { "unlinked" } else { "linked" }), None)?;
    Ok(w)
}

/// Full upsert (used by the UI and by LLMs authoring whole workflows).
pub fn workflow_upsert(engine: &Engine, mut w: Workflow, origin: &str) -> Result<Workflow> {
    if w.id.is_empty() {
        w.id = slug(&w.title);
    }
    let existing = engine.store.workflow(&w.id).ok();
    if w.created.is_none() {
        w.created = existing.as_ref().and_then(|e| e.created.clone()).or(Some(now()));
    }
    if w.origin.is_none() {
        w.origin = existing.as_ref().and_then(|e| e.origin.clone()).or(Some(origin.into()));
    }
    for n in w.nodes.iter_mut() {
        if n.origin.is_none() {
            n.origin = Some(origin.into());
        }
        if n.created.is_none() {
            n.created = Some(now());
        }
    }
    w.updated = Some(now());
    engine.store.save_workflow(&w)?;
    engine.log(origin, if existing.is_some() { "workflow_update" } else { "workflow_new" }, format!("Workflow `{}` saved ({} nodes, {} edges)", w.id, w.nodes.len(), w.edges.len()), None)?;
    Ok(w)
}

pub fn workflow_set(engine: &Engine, workflow: &str, node: Option<&str>, patch: &Value, origin: &str) -> Result<Workflow> {
    let mut w = engine.store.workflow(workflow)?;
    match node {
        None => {
            if let Some(s) = patch.get("status").and_then(|v| v.as_str()) {
                w.status = s.into();
            }
            if let Some(s) = patch.get("title").and_then(|v| v.as_str()) {
                w.title = s.into();
            }
            if patch.get("description").is_some() {
                w.description = patch.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
            }
            if let Some(v) = patch.get("targets").and_then(|v| v.as_array()) {
                w.targets = v.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect();
            }
        }
        Some(nid) => {
            let n = w.nodes.iter_mut().find(|n| n.id == nid).ok_or_else(|| anyhow!("node `{nid}` not in workflow"))?;
            if let Some(s) = patch.get("status").and_then(|v| v.as_str()) {
                n.status = Some(s.into());
            }
            if let Some(s) = patch.get("title").and_then(|v| v.as_str()) {
                n.title = s.into();
            }
            if patch.get("text").is_some() {
                n.text = patch.get("text").and_then(|v| v.as_str()).map(|s| s.to_string());
            }
            if let Some(s) = patch.get("kind").and_then(|v| v.as_str()) {
                n.kind = s.into();
            }
            if let Some(p) = patch.get("position") {
                if let Ok(pos) = serde_json::from_value::<Position>(p.clone()) {
                    n.position = pos;
                }
            }
            if let Some(m) = patch.get("maps_to") {
                n.maps_to = serde_json::from_value(m.clone()).ok();
            }
        }
    }
    w.updated = Some(now());
    engine.store.save_workflow(&w)?;
    engine.log(origin, "workflow_set", format!("Workflow `{workflow}` updated{}", node.map(|n| format!(" (node {n})")).unwrap_or_default()), None)?;
    Ok(w)
}

pub fn workflow_remove(engine: &Engine, id: &str, origin: &str) -> Result<()> {
    engine.store.remove_workflow(id)?;
    engine.log(origin, "workflow_remove", format!("Removed workflow `{id}`"), None)
}

/// Promote a workflow's component nodes into blueprint nodes under `parent`.
pub fn workflow_promote(engine: &Engine, workflow: &str, parent: Option<&str>, origin: &str) -> Result<Vec<BlueprintNode>> {
    let mut w = engine.store.workflow(workflow)?;
    let mut created = vec![];
    let parent_id = match parent {
        Some(p) => Some(NodeTable::from_blueprint(&engine.store.blueprint()?).resolve_or_err(p)?),
        None => None,
    };
    for n in w.nodes.iter_mut().filter(|n| n.kind == "component") {
        let already = n.maps_to.as_ref().map(|m| !m.nodes.is_empty()).unwrap_or(false);
        if already {
            continue;
        }
        let node = add_node(engine, AddNode { name: n.title.clone(), parent: parent_id.clone(), kind: Some("component".into()), purpose: n.text.clone(), description: None, files: vec![], symbols: vec![], status: Some("planned".into()), id: None, tags: vec![format!("workflow:{}", w.id)] }, origin)?;
        n.maps_to = Some(WorkflowMapping { nodes: vec![node.id.clone()], ..Default::default() });
        created.push(node);
    }
    for c in &created {
        if !w.targets.contains(&c.id) {
            w.targets.push(c.id.clone());
        }
    }
    if w.status == "draft" && !created.is_empty() {
        w.status = "in_progress".into();
    }
    w.updated = Some(now());
    engine.store.save_workflow(&w)?;
    engine.log(origin, "workflow_promote", format!("Promoted {} component(s) of `{}` into the blueprint", created.len(), w.id), None)?;
    Ok(created)
}

// ───────────────────────────── lenses ─────────────────────────────

pub fn lens_save(engine: &Engine, mut l: Lens, origin: &str) -> Result<Lens> {
    if l.id.is_empty() {
        l.id = slug(&l.name);
    }
    if l.origin.is_none() {
        l.origin = Some(origin.into());
    }
    engine.store.save_lens(&l)?;
    engine.log(origin, "lens_save", format!("Saved lens `{}`", l.id), None)?;
    Ok(l)
}

pub fn lens_remove(engine: &Engine, id: &str, origin: &str) -> Result<()> {
    engine.store.remove(&format!("abstractions/{id}.yaml"))?;
    engine.log(origin, "lens_remove", format!("Removed lens `{id}`"), None)
}
