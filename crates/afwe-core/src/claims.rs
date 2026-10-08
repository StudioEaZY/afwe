//! Assumption claims: small declarative statements an agent makes before writing code, checked
//! deterministically (regex over files, import edges in the parser graph, symbol presence).

use crate::analyze::build_globset;
use crate::engine::Snapshot;
use crate::mapping::NodeTable;
use crate::model::AssumptionClaim;
use anyhow::Result;
use regex::Regex;
use std::path::Path;

pub const CLAIM_TYPES: &[&str] = &["forbid_pattern", "require_pattern", "forbid_import", "symbol_exists", "require_file"];

/// Shape check at turn.assume time (types, regexes, node references).
pub fn validate(c: &AssumptionClaim, table: &NodeTable) -> std::result::Result<(), String> {
    if !CLAIM_TYPES.contains(&c.kind.as_str()) {
        return Err(format!("unknown claim type `{}` (use one of: {})", c.kind, CLAIM_TYPES.join(", ")));
    }
    match c.kind.as_str() {
        "forbid_pattern" | "require_pattern" => {
            let p = c.pattern.as_deref().ok_or_else(|| format!("`{}` needs a pattern", c.kind))?;
            Regex::new(p).map_err(|e| format!("invalid regex `{p}`: {e}"))?;
        }
        "forbid_import" => {
            if c.to_nodes.is_empty() {
                return Err("forbid_import needs to_nodes".into());
            }
            for n in &c.to_nodes {
                if table.resolve(n).is_none() {
                    return Err(format!("unknown node `{n}` in to_nodes"));
                }
            }
        }
        "symbol_exists" => {
            if c.symbol.is_none() && c.pattern.is_none() {
                return Err("symbol_exists needs `symbol`".into());
            }
        }
        "require_file" => {
            if c.files.is_empty() {
                return Err("require_file needs `files`".into());
            }
        }
        _ => {}
    }
    Ok(())
}

/// Ok(None) = the claim holds; Ok(Some(why)) = it is violated.
/// `scope` (code-root-relative files) is used when the claim names no files of its own.
pub fn evaluate(c: &AssumptionClaim, snap: &Snapshot, root: &Path, scope: &[String]) -> Result<Option<String>> {
    let table = &snap.table;
    let globs = if c.files.is_empty() { None } else { Some(build_globset(&c.files)?) };
    let candidates: Vec<&crate::model::FileInfo> = snap
        .code
        .files
        .iter()
        .filter(|f| match &globs {
            Some(g) => g.is_match(&f.path),
            None => scope.is_empty() || scope.contains(&f.path),
        })
        .collect();
    match c.kind.as_str() {
        "forbid_pattern" => {
            let pat = c.pattern.clone().unwrap_or_default();
            let re = Regex::new(&pat)?;
            for f in &candidates {
                let Ok(src) = std::fs::read_to_string(root.join(&f.path)) else { continue };
                if let Some(m) = re.find(&src) {
                    let line = src[..m.start()].matches('\n').count() + 1;
                    return Ok(Some(format!("{}:{} matches forbidden /{}/", f.path, line, pat)));
                }
            }
            Ok(None)
        }
        "require_pattern" => {
            let pat = c.pattern.clone().unwrap_or_default();
            let re = Regex::new(&pat)?;
            if candidates.is_empty() {
                return Ok(Some("no files fall inside the claim's scope".into()));
            }
            for f in &candidates {
                if let Ok(src) = std::fs::read_to_string(root.join(&f.path)) {
                    if re.is_match(&src) {
                        return Ok(None);
                    }
                }
            }
            Ok(Some(format!("no file in scope contains required /{pat}/")))
        }
        "forbid_import" => {
            let targets: Vec<String> = c.to_nodes.iter().filter_map(|n| table.resolve(n)).collect();
            for f in &candidates {
                for imp in &f.resolved_imports {
                    if let Some(b) = snap.mapping.primary(imp) {
                        if targets.iter().any(|t| table.is_ancestor_or_same(t, b)) {
                            return Ok(Some(format!("{} imports {} inside {}", f.path, imp, table.path_of(b))));
                        }
                    }
                }
            }
            Ok(None)
        }
        "symbol_exists" => {
            let name = c.symbol.clone().or(c.pattern.clone()).unwrap_or_default();
            let found = candidates.iter().any(|f| f.symbols.iter().any(|s| s.qualified == name || s.name == name));
            Ok(if found { None } else { Some(format!("symbol `{name}` does not exist")) })
        }
        "require_file" => {
            for p in &c.files {
                if !root.join(p).exists() {
                    return Ok(Some(format!("required file `{p}` is missing")));
                }
            }
            Ok(None)
        }
        other => Ok(Some(format!("unknown claim type `{other}`"))),
    }
}
