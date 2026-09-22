//! Blueprint tree helpers and implementation mapping (node ↔ file/symbol).

use crate::analyze::build_globset;
use crate::model::*;
use crate::util::{is_glob, slug};
use anyhow::{anyhow, Result};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone)]
pub struct FlatNode {
    pub id: String,
    pub name: String,
    pub kind: String,
    /// Dotted display path: `Product.Authentication.Sessions`
    pub path: String,
    pub parent: Option<String>,
    pub depth: usize,
    pub implements: Implementation,
    pub status: Option<String>,
    pub tags: Vec<String>,
    pub purpose: Option<String>,
    pub description: Option<String>,
    pub children: Vec<String>,
}

/// Flattened, indexed view of the blueprint tree.
#[derive(Debug, Clone, Default)]
pub struct NodeTable {
    pub nodes: BTreeMap<String, FlatNode>,
    pub order: Vec<String>,
    by_path: HashMap<String, String>,
    by_name: HashMap<String, Vec<String>>,
}

impl NodeTable {
    pub fn from_blueprint(b: &Blueprint) -> Self {
        let mut t = NodeTable::default();
        fn rec(t: &mut NodeTable, n: &BlueprintNode, parent: Option<&FlatNode>) {
            let path = match parent {
                Some(p) => format!("{}.{}", p.path, n.name),
                None => n.name.clone(),
            };
            let f = FlatNode {
                id: n.id.clone(),
                name: n.name.clone(),
                kind: n.kind.clone(),
                path: path.clone(),
                parent: parent.map(|p| p.id.clone()),
                depth: parent.map(|p| p.depth + 1).unwrap_or(0),
                implements: n.implements.clone(),
                status: n.status.clone(),
                tags: n.tags.clone(),
                purpose: n.purpose.clone(),
                description: n.description.clone(),
                children: n.children.iter().map(|c| c.id.clone()).collect(),
            };
            t.by_path.insert(path.to_lowercase(), n.id.clone());
            t.by_name.entry(n.name.to_lowercase()).or_default().push(n.id.clone());
            t.order.push(n.id.clone());
            t.nodes.insert(n.id.clone(), f.clone());
            for c in &n.children {
                rec(t, c, Some(&f));
            }
        }
        for n in &b.nodes {
            rec(&mut t, n, None);
        }
        t
    }

    pub fn get(&self, id: &str) -> Option<&FlatNode> {
        self.nodes.get(id)
    }

    /// Resolve a human/LLM reference: id, dotted path, unique name, slug or unique path suffix.
    pub fn resolve(&self, reference: &str) -> Option<String> {
        let r = reference.trim();
        if r.is_empty() {
            return None;
        }
        if self.nodes.contains_key(r) {
            return Some(r.to_string());
        }
        let lower = r.to_lowercase();
        if let Some(id) = self.by_path.get(&lower) {
            return Some(id.clone());
        }
        if let Some(ids) = self.by_name.get(&lower) {
            if ids.len() == 1 {
                return Some(ids[0].clone());
            }
        }
        let s = slug(r);
        if self.nodes.contains_key(&s) {
            return Some(s);
        }
        // unique path suffix match: "workspace.preview" -> "product.workspace.preview"
        let suffix = format!(".{lower}");
        let hits: Vec<&String> = self.by_path.iter().filter(|(p, _)| p.ends_with(&suffix)).map(|(_, id)| id).collect();
        if hits.len() == 1 {
            return Some(hits[0].clone());
        }
        // unique slugged-name match
        let hits: Vec<&String> = self.nodes.values().filter(|n| slug(&n.name) == s).map(|n| &n.id).collect();
        if hits.len() == 1 {
            return Some(hits[0].clone());
        }
        None
    }

    pub fn resolve_or_err(&self, reference: &str) -> Result<String> {
        self.resolve(reference).ok_or_else(|| anyhow!("unknown blueprint node `{reference}`"))
    }

    pub fn ancestors(&self, id: &str) -> Vec<String> {
        let mut out = vec![];
        let mut cur = self.nodes.get(id).and_then(|n| n.parent.clone());
        while let Some(p) = cur {
            cur = self.nodes.get(&p).and_then(|n| n.parent.clone());
            out.push(p);
        }
        out
    }

    pub fn descendants(&self, id: &str) -> Vec<String> {
        let mut out = vec![];
        let mut stack = vec![id.to_string()];
        while let Some(cur) = stack.pop() {
            if let Some(n) = self.nodes.get(&cur) {
                for c in &n.children {
                    out.push(c.clone());
                    stack.push(c.clone());
                }
            }
        }
        out
    }

    pub fn is_ancestor_or_same(&self, a: &str, b: &str) -> bool {
        a == b || self.ancestors(b).iter().any(|x| x == a)
    }

    /// Roots first, then children (pre-order).
    pub fn ids(&self) -> &[String] {
        &self.order
    }

    pub fn path_of(&self, id: &str) -> String {
        self.nodes.get(id).map(|n| n.path.clone()).unwrap_or_else(|| id.to_string())
    }
}

// ───────────────────────────── tree mutation ─────────────────────────────

pub fn find_node_mut<'a>(nodes: &'a mut Vec<BlueprintNode>, id: &str) -> Option<&'a mut BlueprintNode> {
    for n in nodes.iter_mut() {
        if n.id == id {
            return Some(n);
        }
        if let Some(found) = find_node_mut(&mut n.children, id) {
            return Some(found);
        }
    }
    None
}

pub fn find_node<'a>(nodes: &'a [BlueprintNode], id: &str) -> Option<&'a BlueprintNode> {
    for n in nodes.iter() {
        if n.id == id {
            return Some(n);
        }
        if let Some(found) = find_node(&n.children, id) {
            return Some(found);
        }
    }
    None
}

pub fn remove_node(nodes: &mut Vec<BlueprintNode>, id: &str) -> Option<BlueprintNode> {
    if let Some(i) = nodes.iter().position(|n| n.id == id) {
        return Some(nodes.remove(i));
    }
    for n in nodes.iter_mut() {
        if let Some(r) = remove_node(&mut n.children, id) {
            return Some(r);
        }
    }
    None
}

pub fn all_ids(nodes: &[BlueprintNode], out: &mut Vec<String>) {
    for n in nodes {
        out.push(n.id.clone());
        all_ids(&n.children, out);
    }
}

pub fn unique_id(existing: &[String], base: &str) -> String {
    let base = slug(base);
    if !existing.iter().any(|e| e == &base) {
        return base;
    }
    let mut i = 2;
    loop {
        let cand = format!("{base}-{i}");
        if !existing.iter().any(|e| e == &cand) {
            return cand;
        }
        i += 1;
    }
}

// ───────────────────────────── file / symbol mapping ─────────────────────────────

#[derive(Debug, Clone)]
pub struct Claim {
    pub node: String,
    /// 4 symbol, 3 explicit file, 2 shallow glob, 1 deep glob (**)
    pub specificity: u8,
    pub depth: usize,
    pub via: String,
}

#[derive(Debug, Default)]
pub struct MappingResult {
    /// file -> claims (sorted best first)
    pub files: HashMap<String, Vec<Claim>>,
    /// symbol id -> node
    pub symbols: HashMap<String, String>,
    /// explicit file entries that matched nothing (node, entry)
    pub dangling_files: Vec<(String, String)>,
    /// explicit symbol entries that matched nothing (node, entry)
    pub dangling_symbols: Vec<(String, String)>,
}

impl MappingResult {
    pub fn primary(&self, file: &str) -> Option<&str> {
        self.files.get(file).and_then(|c| c.first()).map(|c| c.node.as_str())
    }
    pub fn nodes_of(&self, file: &str) -> Vec<String> {
        let mut v: Vec<String> = self.files.get(file).map(|c| c.iter().map(|x| x.node.clone()).collect()).unwrap_or_default();
        v.dedup();
        v
    }
}

pub fn compute_mapping(table: &NodeTable, code: &CodeModel) -> Result<MappingResult> {
    let mut res = MappingResult::default();
    let symbol_ids: HashMap<&str, &SymbolInfo> = code.files.iter().flat_map(|f| f.symbols.iter()).map(|s| (s.id.as_str(), s)).collect();
    for id in table.ids() {
        let n = &table.nodes[id];
        for entry in &n.implements.files {
            let entry_norm = entry.trim_start_matches("./").trim_end_matches('/').to_string();
            if is_glob(&entry_norm) {
                let gs = build_globset(&[entry_norm.clone()])?;
                let deep = entry_norm.contains("**");
                let spec = if deep { 1 } else { 2 };
                for f in &code.files {
                    if gs.is_match(&f.path) {
                        res.files.entry(f.path.clone()).or_default().push(Claim { node: id.clone(), specificity: spec, depth: n.depth, via: entry_norm.clone() });
                    }
                }
            } else {
                // explicit file or directory
                let mut hit = false;
                for f in &code.files {
                    if f.path == entry_norm {
                        res.files.entry(f.path.clone()).or_default().push(Claim { node: id.clone(), specificity: 3, depth: n.depth, via: entry_norm.clone() });
                        hit = true;
                    } else if f.path.starts_with(&format!("{entry_norm}/")) {
                        res.files.entry(f.path.clone()).or_default().push(Claim { node: id.clone(), specificity: 2, depth: n.depth, via: entry_norm.clone() });
                        hit = true;
                    }
                }
                if !hit {
                    res.dangling_files.push((id.clone(), entry.clone()));
                }
            }
        }
        for sym in &n.implements.symbols {
            if symbol_ids.contains_key(sym.as_str()) {
                res.symbols.insert(sym.clone(), id.clone());
                if let Some((file, _)) = sym.split_once("::") {
                    res.files.entry(file.to_string()).or_default().push(Claim { node: id.clone(), specificity: 4, depth: n.depth, via: sym.clone() });
                }
            } else {
                res.dangling_symbols.push((id.clone(), sym.clone()));
            }
        }
    }
    for claims in res.files.values_mut() {
        // Best claim first: a file‑level explicit claim beats symbol claims for the *file's*
        // primary node, so order: explicit file (3) > shallow glob (2) > deep glob (1) > symbol (4 → last)
        claims.sort_by(|a, b| {
            let rank = |c: &Claim| match c.specificity {
                3 => 0,
                2 => 1,
                1 => 2,
                _ => 3,
            };
            rank(a).cmp(&rank(b)).then(b.depth.cmp(&a.depth)).then(a.node.cmp(&b.node))
        });
        claims.dedup_by(|a, b| a.node == b.node);
    }
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bp() -> Blueprint {
        serde_yaml::from_str(
            r#"
nodes:
  - id: product
    name: Product
    children:
      - id: authentication
        name: Authentication
        implements: { files: ["src/auth/**"] }
        children:
          - id: sessions
            name: Sessions
            implements: { files: ["src/auth/session.ts"] }
      - id: payments
        name: Payments
        implements: { files: ["src/payments/**"] }
"#,
        )
        .unwrap()
    }

    #[test]
    fn resolves_references() {
        let t = NodeTable::from_blueprint(&bp());
        assert_eq!(t.resolve("sessions").as_deref(), Some("sessions"));
        assert_eq!(t.resolve("Product.Authentication.Sessions").as_deref(), Some("sessions"));
        assert_eq!(t.resolve("Authentication.Sessions").as_deref(), Some("sessions"));
        assert_eq!(t.resolve("Payments").as_deref(), Some("payments"));
        assert_eq!(t.ancestors("sessions"), vec!["authentication", "product"]);
    }

    #[test]
    fn mapping_prefers_specific() {
        let t = NodeTable::from_blueprint(&bp());
        let code = CodeModel {
            files: vec![
                FileInfo { path: "src/auth/session.ts".into(), ..Default::default() },
                FileInfo { path: "src/auth/oauth.ts".into(), ..Default::default() },
                FileInfo { path: "src/other.ts".into(), ..Default::default() },
            ],
            ..Default::default()
        };
        let m = compute_mapping(&t, &code).unwrap();
        assert_eq!(m.primary("src/auth/session.ts"), Some("sessions"));
        assert_eq!(m.primary("src/auth/oauth.ts"), Some("authentication"));
        assert_eq!(m.primary("src/other.ts"), None);
    }
}
