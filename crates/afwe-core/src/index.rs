//! Index = source of location / retrieval. Memory files = knowledge. Code = implementation.

use crate::mapping::{MappingResult, NodeTable};
use crate::model::*;
use crate::store::Sources;
use crate::util::now;
use std::collections::BTreeMap;

pub fn build_index(src: &Sources, table: &NodeTable, code: &CodeModel, mapping: &MappingResult) -> Index {
    let mut idx = Index { generated: now(), ..Default::default() };

    // nodes
    for id in table.ids() {
        let n = &table.nodes[id];
        idx.nodes.insert(
            id.clone(),
            NodeIndexEntry {
                path: n.path.clone(),
                name: n.name.clone(),
                kind: n.kind.clone(),
                depth: n.depth,
                parent: n.parent.clone(),
                files: vec![],
                symbols: n.implements.symbols.clone(),
                memory: vec![],
                guardrails: vec![],
            },
        );
    }

    // files + symbols
    for f in &code.files {
        let claims = mapping.nodes_of(&f.path);
        let primary = mapping.primary(&f.path).map(|s| s.to_string());
        for c in &claims {
            if let Some(n) = idx.nodes.get_mut(c) {
                n.files.push(f.path.clone());
            }
        }
        idx.files.insert(
            f.path.clone(),
            FileIndexEntry {
                language: f.language.clone(),
                hash: f.hash.clone(),
                node: primary,
                nodes: claims,
                symbols: f.symbols.iter().map(|s| s.id.clone()).collect(),
                imports: f.resolved_imports.clone(),
                externals: f.externals.clone(),
            },
        );
        for s in &f.symbols {
            idx.symbols.insert(s.id.clone(), s.clone());
        }
    }

    // memory
    for m in &src.memory {
        let nodes: Vec<String> = m.meta.applies_to.iter().filter_map(|r| table.resolve(r)).collect();
        for n in &nodes {
            if let Some(e) = idx.nodes.get_mut(n) {
                e.memory.push(m.meta.id.clone());
            }
        }
        idx.memory.insert(
            m.meta.id.clone(),
            MemoryIndexEntry {
                kind: m.meta.kind.clone(),
                title: m.meta.title.clone(),
                path: m.path.clone(),
                nodes,
                files: m.meta.files.clone(),
                symbols: m.meta.symbols.clone(),
                tags: m.meta.tags.clone(),
                status: m.meta.status.clone(),
            },
        );
    }

    // guardrails
    for g in &src.guardrails {
        let mut nodes: Vec<String> = g.scope.nodes.iter().filter_map(|r| table.resolve(r)).collect();
        if g.scope.global {
            nodes = table.ids().to_vec();
        }
        for l in &g.scope.lenses {
            if let Some(lens) = src.lenses.iter().find(|x| &x.id == l || &x.name == l) {
                nodes.extend(crate::lens::lens_node_ids(lens, table));
            }
        }
        for n in nodes {
            if let Some(e) = idx.nodes.get_mut(&n) {
                if !e.guardrails.contains(&g.id) {
                    e.guardrails.push(g.id.clone());
                }
            }
        }
    }

    // node edges from imports (primary nodes; containment is not dependency)
    for f in &code.files {
        let Some(a) = mapping.primary(&f.path) else { continue };
        for imp in &f.resolved_imports {
            let Some(b) = mapping.primary(imp) else { continue };
            if a == b || table.is_ancestor_or_same(a, b) || table.is_ancestor_or_same(b, a) {
                continue;
            }
            *idx.node_edges.entry(a.to_string()).or_default().entry(b.to_string()).or_default() += 1;
        }
    }
    for e in idx.nodes.values_mut() {
        e.files.sort();
        e.files.dedup();
    }
    idx
}

/// Roll an edge count map up so that edges are expressed between `visible` nodes
/// (used by the UI when subtrees are collapsed).
pub fn rollup_edges(edges: &BTreeMap<String, BTreeMap<String, usize>>, table: &NodeTable, visible: &[String]) -> BTreeMap<(String, String), usize> {
    let to_visible = |id: &str| -> Option<String> {
        if visible.iter().any(|v| v == id) {
            return Some(id.to_string());
        }
        table.ancestors(id).into_iter().find(|a| visible.iter().any(|v| v == a))
    };
    let mut out = BTreeMap::new();
    for (a, m) in edges {
        for (b, c) in m {
            if let (Some(va), Some(vb)) = (to_visible(a), to_visible(b)) {
                if va != vb {
                    *out.entry((va, vb)).or_default() += c;
                }
            }
        }
    }
    out
}
