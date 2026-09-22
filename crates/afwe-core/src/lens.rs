//! Custom abstractions ("lenses"): a different grouping of the same blueprint nodes.
//! Zero impact on the codebase – purely a view.

use crate::mapping::NodeTable;
use crate::model::*;
use serde_json::{json, Value};

pub fn lens_node_ids(lens: &Lens, table: &NodeTable) -> Vec<String> {
    let mut out = vec![];
    fn rec(g: &LensGroup, table: &NodeTable, out: &mut Vec<String>) {
        for r in &g.nodes {
            if let Some(id) = table.resolve(r) {
                out.push(id.clone());
                out.extend(table.descendants(&id));
            }
        }
        for sub in &g.groups {
            rec(sub, table, out);
        }
    }
    for g in &lens.groups {
        rec(g, table, &mut out);
    }
    let hidden: Vec<String> = lens.hide.iter().filter_map(|r| table.resolve(r)).collect();
    out.retain(|id| !hidden.contains(id));
    out.sort();
    out.dedup();
    out
}

/// Resolve a lens into a tree the UI can render: virtual groups containing blueprint subtrees.
pub fn resolve_lens(lens: &Lens, table: &NodeTable, workflows: &[Workflow]) -> Value {
    let hidden: Vec<String> = lens.hide.iter().filter_map(|r| table.resolve(r)).collect();
    fn subtree(id: &str, table: &NodeTable, hidden: &[String]) -> Value {
        let n = &table.nodes[id];
        json!({
            "id": n.id, "name": n.name, "kind": n.kind, "path": n.path, "virtual": false,
            "children": n.children.iter().filter(|c| !hidden.contains(c)).map(|c| subtree(c, table, hidden)).collect::<Vec<_>>(),
        })
    }
    fn group(g: &LensGroup, table: &NodeTable, hidden: &[String], workflows: &[Workflow], prefix: &str) -> Value {
        let gid = format!("{prefix}{}", crate::util::slug(&g.name));
        let mut children: Vec<Value> = g.groups.iter().map(|s| group(s, table, hidden, workflows, &format!("{gid}."))).collect();
        let mut unresolved = vec![];
        for r in &g.nodes {
            match table.resolve(r) {
                Some(id) if !hidden.contains(&id) => children.push(subtree(&id, table, hidden)),
                Some(_) => {}
                None => unresolved.push(r.clone()),
            }
        }
        let wfs: Vec<Value> = g
            .workflows
            .iter()
            .map(|w| {
                let found = workflows.iter().find(|x| &x.id == w);
                json!({"id": w, "title": found.map(|x| x.title.clone()).unwrap_or(w.clone()), "status": found.map(|x| x.status.clone()), "exists": found.is_some()})
            })
            .collect();
        json!({
            "id": format!("lens:{gid}"), "name": g.name, "kind": "group", "virtual": true,
            "description": g.description, "children": children, "workflows": wfs, "unresolved": unresolved,
        })
    }
    json!({
        "id": lens.id, "name": lens.name, "description": lens.description,
        "groups": lens.groups.iter().map(|g| group(g, table, &hidden, workflows, "")).collect::<Vec<_>>(),
        "node_ids": lens_node_ids(lens, table),
    })
}
