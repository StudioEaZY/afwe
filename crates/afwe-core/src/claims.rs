//! Assumption claims: small declarative statements an agent makes before writing code, checked
//! deterministically (regex over files, import edges in the parser graph, symbol presence).

use crate::analyze::build_globset;
use crate::analyze::langs::LANGS;
use crate::engine::Snapshot;
use crate::mapping::NodeTable;
use crate::model::AssumptionClaim;
use anyhow::Result;
use regex::Regex;
use std::path::Path;
use tree_sitter::{Node, Parser};

pub const CLAIM_TYPES: &[&str] = &[
    "forbid_pattern",
    "require_pattern",
    "forbid_import",
    "symbol_exists",
    "forbid_symbol",
    "export_exists",
    "symbol_signature",
    "require_file",
];

/// Replaces comment characters with spaces while preserving every `\n` (and `\r`) so line numbers
/// and byte offsets never shift.
///
/// Primary path: uses the language's tree-sitter grammar to locate `comment` AST nodes, leaving
/// string literals (`"https://delta.dev"`, `"src/**/test"`, Python `"# tag"`) untouched.
/// Fallback path: a string-aware state machine for languages without an embedded tree-sitter grammar.
pub fn blank_comments(src: &str, lang: &str) -> String {
    if src.is_empty() {
        return String::new();
    }
    let spec = LANGS.iter().find(|l| l.id == lang || l.extensions.contains(&lang));
    if let Some(spec) = spec {
        if let Some(grammar) = spec.grammar {
            let mut parser = Parser::new();
            if parser.set_language(&grammar()).is_ok() {
                if let Some(tree) = parser.parse(src, None) {
                    let mut bytes = src.as_bytes().to_vec();
                    blank_tree_comments(tree.root_node(), &mut bytes);
                    // Safety: replacing UTF-8 bytes within comment spans with ASCII space (0x20)
                    // while keeping '\n' and '\r' always produces valid UTF-8 if we align to char boundaries.
                    return blank_ranges_utf8(src, &bytes);
                }
            }
        }
    }
    blank_comments_fallback(src, lang)
}

fn blank_tree_comments(node: Node, mask: &mut [u8]) {
    let kind = node.kind();
    if kind.contains("comment") {
        let start = node.start_byte().min(mask.len());
        let end = node.end_byte().min(mask.len());
        for b in &mut mask[start..end] {
            if *b != b'\n' && *b != b'\r' {
                *b = 0; // mark as blanked
            }
        }
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        blank_tree_comments(child, mask);
    }
}

fn blank_ranges_utf8(src: &str, mask: &[u8]) -> String {
    let mut out = String::with_capacity(src.len());
    for (idx, ch) in src.char_indices() {
        if idx < mask.len() && mask[idx] == 0 {
            if ch == '\n' || ch == '\r' {
                out.push(ch);
            } else {
                for _ in 0..ch.len_utf8() {
                    out.push(' ');
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// String-aware state machine fallback for languages without a tree-sitter grammar.
/// Tracks `"..."` (`\"`), `'...'` (`\'`), Rust raw strings `r#"..."#`, JS template literals `` `...` ``,
/// Python triple quotes `"""..."""` / `'''...'''`, and nested `/* ... */` block comments.
pub fn blank_comments_fallback(src: &str, lang: &str) -> String {
    let bytes = src.as_bytes();
    let len = bytes.len();
    let mut mask = bytes.to_vec();
    let hash_comments = matches!(
        lang,
        "python" | "py" | "shell" | "sh" | "bash" | "zsh" | "yaml" | "yml" | "toml" | "ruby" | "rb" | "other" | ""
    );

    let mut i = 0;
    while i < len {
        let b = bytes[i];

        // Rust raw string: r#"..."# or r"..."
        if b == b'r' && i + 1 < len && (bytes[i + 1] == b'#' || bytes[i + 1] == b'"') {
            let mut hashes = 0usize;
            let mut j = i + 1;
            while j < len && bytes[j] == b'#' {
                hashes += 1;
                j += 1;
            }
            if j < len && bytes[j] == b'"' {
                j += 1; // skip opening '"'
                while j < len {
                    if bytes[j] == b'"' {
                        let mut k = j + 1;
                        let mut matched = 0usize;
                        while k < len && bytes[k] == b'#' && matched < hashes {
                            matched += 1;
                            k += 1;
                        }
                        if matched == hashes {
                            i = k;
                            break;
                        }
                    }
                    j += 1;
                }
                if j >= len {
                    break;
                }
                continue;
            }
        }

        // Triple-quoted strings: """...""" or '''...'''
        if i + 2 < len && ((b == b'"' && bytes[i + 1] == b'"' && bytes[i + 2] == b'"') || (b == b'\'' && bytes[i + 1] == b'\'' && bytes[i + 2] == b'\'')) {
            let quote = b;
            i += 3;
            while i < len {
                if bytes[i] == b'\\' {
                    i = (i + 2).min(len);
                    continue;
                }
                if i + 2 < len && bytes[i] == quote && bytes[i + 1] == quote && bytes[i + 2] == quote {
                    i += 3;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // Standard strings: "...", '...', `...`
        if b == b'"' || b == b'\'' || b == b'`' {
            let quote = b;
            i += 1;
            while i < len {
                if bytes[i] == b'\\' {
                    i = (i + 2).min(len);
                    continue;
                }
                if bytes[i] == quote {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // Line comment: //
        if b == b'/' && i + 1 < len && bytes[i + 1] == b'/' {
            while i < len && bytes[i] != b'\n' {
                if bytes[i] != b'\r' {
                    mask[i] = 0;
                }
                i += 1;
            }
            continue;
        }

        // Block comment: /* ... */ (supports nesting)
        if b == b'/' && i + 1 < len && bytes[i + 1] == b'*' {
            let mut depth = 1usize;
            mask[i] = 0;
            mask[i + 1] = 0;
            i += 2;
            while i < len && depth > 0 {
                if bytes[i] == b'/' && i + 1 < len && bytes[i + 1] == b'*' {
                    depth += 1;
                    mask[i] = 0;
                    mask[i + 1] = 0;
                    i += 2;
                } else if bytes[i] == b'*' && i + 1 < len && bytes[i + 1] == b'/' {
                    depth -= 1;
                    mask[i] = 0;
                    mask[i + 1] = 0;
                    i += 2;
                } else {
                    if bytes[i] != b'\n' && bytes[i] != b'\r' {
                        mask[i] = 0;
                    }
                    i += 1;
                }
            }
            continue;
        }

        // Hash line comment: #
        if b == b'#' && hash_comments {
            while i < len && bytes[i] != b'\n' {
                if bytes[i] != b'\r' {
                    mask[i] = 0;
                }
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    blank_ranges_utf8(src, &mask)
}

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
        "symbol_exists" | "forbid_symbol" | "export_exists" => {
            if c.symbol.is_none() && c.pattern.is_none() {
                return Err(format!("{} needs `symbol`", c.kind));
            }
        }
        "symbol_signature" => {
            if c.symbol.is_none() {
                return Err("symbol_signature needs `symbol`".into());
            }
            let p = c.pattern.as_deref().ok_or_else(|| "symbol_signature needs `pattern`".to_string())?;
            Regex::new(p).map_err(|e| format!("invalid regex `{p}`: {e}"))?;
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

/// Is this claim backed by AST/symbol/import structure rather than a bare text regex?
pub fn is_structural_claim(c: &AssumptionClaim) -> bool {
    matches!(
        c.kind.as_str(),
        "forbid_import" | "symbol_exists" | "forbid_symbol" | "export_exists" | "symbol_signature"
    )
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
                let Ok(raw) = std::fs::read_to_string(root.join(&f.path)) else { continue };
                let src = if c.include_comments { raw } else { blank_comments(&raw, &f.language) };
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
                if let Ok(raw) = std::fs::read_to_string(root.join(&f.path)) {
                    let src = if c.include_comments { raw } else { blank_comments(&raw, &f.language) };
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
        "forbid_symbol" => {
            let name = c.symbol.clone().or(c.pattern.clone()).unwrap_or_default();
            for f in &candidates {
                if let Some(s) = f.symbols.iter().find(|s| s.qualified == name || s.name == name) {
                    return Ok(Some(format!("{}:{} defines forbidden symbol `{}`", f.path, s.start_line, s.qualified)));
                }
            }
            Ok(None)
        }
        "export_exists" => {
            let name = c.symbol.clone().or(c.pattern.clone()).unwrap_or_default();
            let found = candidates
                .iter()
                .any(|f| f.symbols.iter().any(|s| s.exported && (s.qualified == name || s.name == name)));
            Ok(if found { None } else { Some(format!("exported symbol `{name}` does not exist")) })
        }
        "symbol_signature" => {
            let name = c.symbol.clone().unwrap_or_default();
            let pat = c.pattern.clone().unwrap_or_default();
            let re = Regex::new(&pat)?;
            for f in &candidates {
                for s in f.symbols.iter().filter(|s| s.qualified == name || s.name == name) {
                    if let Ok(raw) = std::fs::read_to_string(root.join(&f.path)) {
                        let lines: Vec<&str> = raw.lines().collect();
                        let start = s.start_line.saturating_sub(1).min(lines.len());
                        let end = s.end_line.min(lines.len()).max(start);
                        let snippet = lines[start..end].join("\n");
                        if re.is_match(&snippet) {
                            return Ok(None);
                        }
                    }
                }
            }
            Ok(Some(format!("symbol `{name}` matching signature /{pat}/ not found")))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_comments_preserves_urls_globs_python_hashes_and_line_numbers() {
        // 1. URL string in TypeScript / Rust
        let ts_src = "const url = \"https://delta.dev/docs\"; // forbidden_token here\nconst next = 1;\n";
        let blanked_ts = blank_comments(ts_src, "typescript");
        assert!(blanked_ts.contains("\"https://delta.dev/docs\""));
        assert!(!blanked_ts.contains("forbidden_token"));
        assert_eq!(ts_src.lines().count(), blanked_ts.lines().count());

        // 2. Glob string containing /*
        let rs_src = "let glob = \"src/**/test/*\"; /* forbidden_in_block */\nlet ok = true;";
        let blanked_rs = blank_comments(rs_src, "rust");
        assert!(blanked_rs.contains("\"src/**/test/*\""));
        assert!(!blanked_rs.contains("forbidden_in_block"));
        assert_eq!(rs_src.lines().count(), blanked_rs.lines().count());

        // 3. Python # inside string vs trailing # comment
        let py_src = "tag = \"#not_a_comment\"\nx = 42 # real_comment\n";
        let blanked_py = blank_comments(py_src, "python");
        assert!(blanked_py.contains("\"#not_a_comment\""));
        assert!(!blanked_py.contains("real_comment"));
        assert_eq!(py_src.lines().count(), blanked_py.lines().count());

        // 4. Nested block comment (both Rust tree-sitter and fallback)
        let nested = "let a = 1;\n/* outer /* inner_secret */ still_outer */\nlet b = 2;";
        let blanked_nested_ts = blank_comments(nested, "rust");
        let blanked_nested_fb = blank_comments_fallback(nested, "c");
        assert!(!blanked_nested_ts.contains("inner_secret"));
        assert!(!blanked_nested_ts.contains("still_outer"));
        assert!(!blanked_nested_fb.contains("inner_secret"));
        assert!(!blanked_nested_fb.contains("still_outer"));
        assert_eq!(blanked_nested_fb.lines().count(), 3);

        // 5. Comment on final line with no trailing newline
        let eof_src = "fn main() {}\n// eof_comment_no_newline";
        let blanked_eof = blank_comments(eof_src, "rust");
        assert!(!blanked_eof.contains("eof_comment_no_newline"));
        assert_eq!(blanked_eof.matches('\n').count(), 1);
    }
}
