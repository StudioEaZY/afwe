//! Code analysis: files → symbols (structural identity + fingerprint) → import graph.
//!
//! Identity is `file path + symbol + structural path + content fingerprint`.
//! Never line numbers (they are recorded for display only).

pub mod langs;

use crate::model::*;
use crate::util::{hash_bytes, hash_str, normalise_code, to_unix};
use anyhow::Result;
use globset::{Glob, GlobSet, GlobSetBuilder};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tree_sitter::{Node, Parser};

pub struct Analyzer {
    root: PathBuf,
    cfg: AnalyzerConfig,
}

impl Analyzer {
    pub fn new(root: impl AsRef<Path>, cfg: AnalyzerConfig) -> Self {
        Self { root: root.as_ref().to_path_buf(), cfg }
    }

    /// Enumerate candidate files (respects .gitignore, manifest ignore/include).
    pub fn list_files(&self) -> Result<Vec<String>> {
        let ignore = build_globset(&self.cfg.ignore)?;
        let include = if self.cfg.include.is_empty() { None } else { Some(build_globset(&self.cfg.include)?) };
        let max = self.cfg.max_file_size_kb * 1024;
        let mut out = vec![];
        let walker = ignore::WalkBuilder::new(&self.root)
            .hidden(true)
            .git_ignore(true)
            .git_global(false)
            .git_exclude(true)
            .follow_links(false)
            .build();
        for entry in walker.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let rel = to_unix(path.strip_prefix(&self.root).unwrap_or(path));
            if rel.starts_with(".afwe/") || ignore.is_match(&rel) {
                continue;
            }
            if let Some(inc) = &include {
                if !inc.is_match(&rel) {
                    continue;
                }
            }
            if let Ok(md) = path.metadata() {
                if md.len() > max {
                    continue;
                }
            }
            out.push(rel);
        }
        out.sort();
        Ok(out)
    }

    /// Full analysis of the project.
    pub fn analyze(&self) -> Result<CodeModel> {
        let files = self.list_files()?;
        self.analyze_files(&files)
    }

    pub fn analyze_files(&self, files: &[String]) -> Result<CodeModel> {
        let mut parsers: HashMap<&'static str, Parser> = HashMap::new();
        let mut infos = vec![];
        let mut languages: BTreeMap<String, usize> = BTreeMap::new();
        let allowed: HashSet<&str> = self.cfg.languages.iter().map(|s| s.as_str()).collect();
        for rel in files {
            let abs = self.root.join(rel);
            let Ok(bytes) = fs::read(&abs) else { continue };
            if looks_binary(&bytes) {
                continue;
            }
            let src = String::from_utf8_lossy(&bytes).to_string();
            let ext = Path::new(rel).extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
            let spec = langs::spec_for_ext(&ext);
            let lang = spec.map(|s| s.id).unwrap_or("other");
            if !allowed.is_empty() && !allowed.contains(lang) && spec.map(|s| s.grammar.is_some()).unwrap_or(false) {
                // language disabled in manifest: keep as file‑level only
            }
            let mut info = FileInfo {
                path: rel.clone(),
                language: lang.to_string(),
                hash: hash_bytes(&bytes),
                size: bytes.len() as u64,
                lines: src.lines().count(),
                ..Default::default()
            };
            if let Some(spec) = spec {
                if let Some(grammar) = spec.grammar {
                    if allowed.is_empty() || allowed.contains(spec.id) {
                        let parser = parsers.entry(spec.id).or_insert_with(|| {
                            let mut p = Parser::new();
                            p.set_language(&grammar()).expect("grammar");
                            p
                        });
                        if let Some(tree) = parser.parse(&src, None) {
                            let mut ex = Extractor { lang: spec.id, spec, src: &src, file: rel, symbols: vec![], imports: vec![] };
                            ex.walk(tree.root_node(), &mut vec![]);
                            info.symbols = dedupe_symbols(ex.symbols);
                            info.imports = ex.imports;
                        }
                    }
                }
            }
            *languages.entry(lang.to_string()).or_default() += 1;
            infos.push(info);
        }
        // resolve imports now that we know every file
        let all: HashSet<String> = infos.iter().map(|f| f.path.clone()).collect();
        let go_module = read_go_module(&self.root);
        for f in infos.iter_mut() {
            let mut resolved = vec![];
            let mut externals = vec![];
            for spec in f.imports.clone() {
                match resolve_import(&f.language, &f.path, &spec, &all, go_module.as_deref()) {
                    Resolved::File(p) => {
                        if p != f.path && !resolved.contains(&p) {
                            resolved.push(p)
                        }
                    }
                    Resolved::External(e) => {
                        if !externals.contains(&e) {
                            externals.push(e)
                        }
                    }
                    Resolved::None => {}
                }
            }
            f.resolved_imports = resolved;
            f.externals = externals;
        }
        let joined = infos.iter().map(|f| format!("{}={}", f.path, f.hash)).collect::<Vec<_>>().join("\n");
        Ok(CodeModel { fingerprint: hash_str(&joined), files: infos, languages })
    }
}

pub fn build_globset(patterns: &[String]) -> Result<GlobSet> {
    let mut b = GlobSetBuilder::new();
    for p in patterns {
        let p = p.trim_start_matches("./");
        if p.is_empty() {
            continue;
        }
        b.add(Glob::new(p)?);
        // `dir/**` should also match `dir` itself and `dir/x`; `dir/*` fine.
        if let Some(stripped) = p.strip_suffix("/**") {
            b.add(Glob::new(stripped)?);
        }
    }
    Ok(b.build()?)
}

fn looks_binary(b: &[u8]) -> bool {
    b.iter().take(8000).any(|&c| c == 0)
}

fn dedupe_symbols(mut syms: Vec<SymbolInfo>) -> Vec<SymbolInfo> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    for s in syms.iter_mut() {
        let n = seen.entry(s.id.clone()).or_default();
        *n += 1;
        if *n > 1 {
            s.id = format!("{}#{}", s.id, n);
            s.qualified = format!("{}#{}", s.qualified, n);
        }
    }
    syms
}

struct Extractor<'a> {
    lang: &'static str,
    spec: &'static langs::LangSpec,
    src: &'a str,
    file: &'a str,
    symbols: Vec<SymbolInfo>,
    imports: Vec<String>,
}

impl<'a> Extractor<'a> {
    fn text(&self, n: Node) -> String {
        n.utf8_text(self.src.as_bytes()).unwrap_or("").to_string()
    }

    fn walk(&mut self, node: Node, stack: &mut Vec<(String, String)>) {
        // imports
        for imp in langs::imports_of(self.lang, node, self.src) {
            if !self.imports.contains(&imp) {
                self.imports.push(imp);
            }
        }
        // definitions
        let rule = self.spec.defs.iter().find(|r| r.node == node.kind()).copied();
        if let Some(rule) = rule {
            if let Some(mut name) = node.child_by_field_name(rule.name_field).map(|n| self.text(n)) {
                let mut kind = rule.kind.to_string();
                // language specific refinements
                match (self.lang, rule.node) {
                    (_, "variable_declarator") => {
                        // only module‑level `const x = () => {}` / values
                        if !stack.is_empty() {
                            return; // local variable inside a function: ignore subtree
                        }
                        if let Some(v) = node.child_by_field_name("value") {
                            if matches!(v.kind(), "arrow_function" | "function_expression" | "function" | "generator_function") {
                                kind = "function".into();
                            } else if matches!(v.kind(), "class") {
                                kind = "class".into();
                            }
                        }
                        if name.starts_with('{') || name.starts_with('[') {
                            return; // destructuring
                        }
                    }
                    ("python", "function_definition") => {
                        if let Some((_, k)) = stack.last() {
                            if k == "class" {
                                kind = "method".into();
                            } else {
                                return; // nested function
                            }
                        }
                    }
                    ("rust", "impl_item") => {
                        name = strip_generics(&name);
                        if let Some(t) = node.child_by_field_name("trait") {
                            name = format!("{name}[{}]", strip_generics(&self.text(t)));
                        }
                    }
                    ("rust", "function_item") | ("rust", "function_signature_item") => {
                        if let Some((_, k)) = stack.last() {
                            if k == "impl" || k == "trait" {
                                kind = "method".into();
                            } else if k == "function" || k == "method" {
                                return;
                            }
                        }
                    }
                    ("go", "method_declaration") => {
                        if let Some(recv) = node.child_by_field_name("receiver") {
                            let t = receiver_type(recv, self.src);
                            if !t.is_empty() {
                                name = format!("{t}.{name}");
                            }
                        }
                    }
                    ("java", "method_declaration") | ("java", "constructor_declaration") => {}
                    _ => {}
                }
                let qualified = if stack.is_empty() {
                    name.clone()
                } else {
                    format!("{}.{}", stack.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join("."), name)
                };
                let structural = {
                    let mut parts: Vec<String> = stack.iter().map(|(n, k)| format!("{k}:{n}")).collect();
                    parts.push(format!("{kind}:{name}"));
                    parts.join("/")
                };
                let body = self.text(node);
                let exported = langs::is_exported(self.lang, node, &name, self.src);
                if kind != "impl" {
                    self.symbols.push(SymbolInfo {
                        id: format!("{}::{}", self.file, qualified),
                        file: self.file.to_string(),
                        name: name.clone(),
                        qualified: qualified.clone(),
                        kind: kind.clone(),
                        structural,
                        fingerprint: hash_str(&normalise_code(&body)),
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        exported,
                    });
                }
                if langs::is_local_scope(self.lang, &kind) {
                    // still collect imports inside (dynamic import / require) but no defs
                    self.collect_imports_only(node);
                    return;
                }
                stack.push((name, kind));
                let mut c = node.walk();
                for ch in node.children(&mut c) {
                    self.walk(ch, stack);
                }
                stack.pop();
                return;
            }
        }
        let mut c = node.walk();
        for ch in node.children(&mut c) {
            self.walk(ch, stack);
        }
    }

    fn collect_imports_only(&mut self, node: Node) {
        let mut c = node.walk();
        for ch in node.children(&mut c) {
            for imp in langs::imports_of(self.lang, ch, self.src) {
                if !self.imports.contains(&imp) {
                    self.imports.push(imp);
                }
            }
            self.collect_imports_only(ch);
        }
    }
}

fn strip_generics(s: &str) -> String {
    match s.find('<') {
        Some(i) => s[..i].trim().to_string(),
        None => s.trim().to_string(),
    }
}

fn receiver_type(recv: Node, src: &str) -> String {
    let t = recv.utf8_text(src.as_bytes()).unwrap_or("");
    // (s *Server) / (Server) / (s Server)
    let inner = t.trim_matches(|c| c == '(' || c == ')');
    let last = inner.split_whitespace().last().unwrap_or("");
    strip_generics(last.trim_start_matches('*')).to_string()
}

fn read_go_module(root: &Path) -> Option<String> {
    let s = fs::read_to_string(root.join("go.mod")).ok()?;
    s.lines().find_map(|l| l.strip_prefix("module ").map(|m| m.trim().to_string()))
}

enum Resolved {
    File(String),
    External(String),
    None,
}

fn join_norm(dir: &str, rel: &str) -> String {
    let mut parts: Vec<&str> = if dir.is_empty() { vec![] } else { dir.split('/').collect() };
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn dir_of(file: &str) -> String {
    match file.rfind('/') {
        Some(i) => file[..i].to_string(),
        None => String::new(),
    }
}

fn first_existing(cands: Vec<String>, all: &HashSet<String>) -> Option<String> {
    cands.into_iter().find(|c| all.contains(c))
}

fn resolve_import(lang: &str, file: &str, spec: &str, all: &HashSet<String>, go_module: Option<&str>) -> Resolved {
    match lang {
        "typescript" | "tsx" | "javascript" => {
            let exts = ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs", "d.ts", "vue", "svelte", "json", "css", "scss"];
            let base = if spec.starts_with('.') {
                join_norm(&dir_of(file), spec)
            } else if let Some(rest) = spec.strip_prefix("@/") {
                format!("src/{rest}")
            } else if let Some(rest) = spec.strip_prefix("~/") {
                format!("src/{rest}")
            } else if spec.starts_with("src/") {
                spec.to_string()
            } else {
                let name = if spec.starts_with('@') {
                    spec.splitn(3, '/').take(2).collect::<Vec<_>>().join("/")
                } else {
                    spec.split('/').next().unwrap_or(spec).to_string()
                };
                return Resolved::External(name);
            };
            let mut cands = vec![base.clone()];
            // `./x.js` written for ESM may really be `./x.ts`
            let stem = base.rsplit_once('.').filter(|(_, e)| ["js", "jsx", "mjs", "cjs"].contains(e)).map(|(s, _)| s.to_string());
            for e in exts {
                cands.push(format!("{base}.{e}"));
                if let Some(s) = &stem {
                    cands.push(format!("{s}.{e}"));
                }
            }
            for e in exts {
                cands.push(format!("{base}/index.{e}"));
            }
            match first_existing(cands, all) {
                Some(p) => Resolved::File(p),
                None => Resolved::None,
            }
        }
        "python" => {
            let dots = spec.chars().take_while(|c| *c == '.').count();
            let modpath = spec[dots..].replace('.', "/");
            let mut roots: Vec<String> = vec![];
            if dots > 0 {
                let mut d = dir_of(file);
                for _ in 1..dots {
                    d = dir_of(&d);
                }
                roots.push(d);
            } else {
                // search from the importing file's dir upwards, then common source roots
                let mut d = dir_of(file);
                loop {
                    roots.push(d.clone());
                    if d.is_empty() {
                        break;
                    }
                    d = dir_of(&d);
                }
                roots.push("src".into());
            }
            let mut cands = vec![];
            for r in roots {
                let p = if modpath.is_empty() { r.clone() } else { join_norm(&r, &modpath) };
                if !modpath.is_empty() {
                    cands.push(format!("{p}.py"));
                }
                cands.push(format!("{p}/__init__.py"));
            }
            match first_existing(cands, all) {
                Some(p) => Resolved::File(p),
                None => {
                    if dots > 0 {
                        Resolved::None
                    } else {
                        Resolved::External(spec.split('.').next().unwrap_or(spec).to_string())
                    }
                }
            }
        }
        "rust" => {
            let crate_root = {
                // nearest ancestor dir named src (or the file's dir)
                let d = dir_of(file);
                let mut cur = d.clone();
                loop {
                    if cur.ends_with("src") || cur == "src" {
                        break cur;
                    }
                    if cur.is_empty() {
                        break d.clone();
                    }
                    cur = dir_of(&cur);
                }
            };
            let file_dir = dir_of(file);
            let file_stem = Path::new(file).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            // module dir for `self::` and `mod x;`: foo.rs -> foo/, mod.rs|lib.rs|main.rs -> same dir
            let self_dir = if ["mod", "lib", "main"].contains(&file_stem.as_str()) { file_dir.clone() } else { format!("{file_dir}/{file_stem}") };
            if let Some(m) = spec.strip_prefix("mod ") {
                let cands = vec![format!("{self_dir}/{m}.rs"), format!("{self_dir}/{m}/mod.rs"), format!("{file_dir}/{m}.rs"), format!("{file_dir}/{m}/mod.rs")];
                return match first_existing(cands, all) {
                    Some(p) => Resolved::File(p),
                    None => Resolved::None,
                };
            }
            let cleaned = spec.split('{').next().unwrap_or(spec).trim().trim_end_matches("::").to_string();
            let segs: Vec<&str> = cleaned.split("::").filter(|s| !s.is_empty()).collect();
            if segs.is_empty() {
                return Resolved::None;
            }
            let (base, rest): (String, &[&str]) = match segs[0] {
                "crate" => (crate_root.clone(), &segs[1..]),
                "self" => (self_dir.clone(), &segs[1..]),
                "super" => {
                    let mut d = dir_of(&self_dir);
                    let mut i = 1;
                    while i < segs.len() && segs[i] == "super" {
                        d = dir_of(&d);
                        i += 1;
                    }
                    (d, &segs[i..])
                }
                "std" | "core" | "alloc" => return Resolved::External(segs[0].to_string()),
                other => {
                    // could be a sibling module referenced by bare name (2018 edition allows crate‑root items)
                    let cands = vec![format!("{self_dir}/{other}.rs"), format!("{self_dir}/{other}/mod.rs"), format!("{crate_root}/{other}.rs"), format!("{crate_root}/{other}/mod.rs")];
                    return match first_existing(cands, all) {
                        Some(p) => Resolved::File(p),
                        None => Resolved::External(other.to_string()),
                    };
                }
            };
            // try longest path prefix that resolves to a file
            let mut n = rest.len();
            while n > 0 {
                let p = join_norm(&base, &rest[..n].join("/"));
                let cands = vec![format!("{p}.rs"), format!("{p}/mod.rs")];
                if let Some(f) = first_existing(cands, all) {
                    return Resolved::File(f);
                }
                n -= 1;
            }
            let cands = vec![format!("{base}/mod.rs"), format!("{base}/lib.rs"), format!("{base}/main.rs")];
            match first_existing(cands, all) {
                Some(f) => Resolved::File(f),
                None => Resolved::None,
            }
        }
        "go" => {
            if let Some(module) = go_module {
                if let Some(rest) = spec.strip_prefix(module) {
                    let dir = rest.trim_start_matches('/');
                    // link to any .go file in that directory (pick first, deterministic)
                    let mut files: Vec<&String> = all.iter().filter(|f| f.ends_with(".go") && dir_of(f) == dir && !f.ends_with("_test.go")).collect();
                    files.sort();
                    return match files.first() {
                        Some(f) => Resolved::File((*f).clone()),
                        None => Resolved::None,
                    };
                }
            }
            Resolved::External(spec.to_string())
        }
        "java" => {
            let path = spec.trim_end_matches(".*").replace('.', "/");
            let target = format!("{path}.java");
            let mut hits: Vec<&String> = all.iter().filter(|f| f.ends_with(&target)).collect();
            hits.sort();
            match hits.first() {
                Some(f) => Resolved::File((*f).clone()),
                None => Resolved::External(spec.split('.').take(2).collect::<Vec<_>>().join(".")),
            }
        }
        _ => Resolved::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn analyze_src(name: &str, src: &str) -> FileInfo {
        let dir = std::env::temp_dir().join(format!("afwe-test-{}-{}", std::process::id(), name.replace('/', "_")));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(Path::new(name).parent().unwrap_or(Path::new("")))).unwrap();
        fs::write(dir.join(name), src).unwrap();
        let a = Analyzer::new(&dir, AnalyzerConfig::default());
        let m = a.analyze().unwrap();
        let _ = fs::remove_dir_all(&dir);
        m.files.into_iter().find(|f| f.path == name).unwrap()
    }

    #[test]
    fn typescript_symbols_and_imports() {
        let f = analyze_src(
            "src/a.tsx",
            "import x from './b';\nimport { y } from 'react';\nexport class CanvasRenderer { render() { return 1 } }\nexport const useThing = () => 1;\nfunction helper() { const inner = 2; }\n",
        );
        let ids: Vec<&str> = f.symbols.iter().map(|s| s.qualified.as_str()).collect();
        assert!(ids.contains(&"CanvasRenderer"));
        assert!(ids.contains(&"CanvasRenderer.render"));
        assert!(ids.contains(&"useThing"));
        assert!(ids.contains(&"helper"));
        assert!(!ids.contains(&"inner"));
        assert!(f.imports.contains(&"./b".to_string()));
        assert!(f.externals.contains(&"react".to_string()));
        let m = f.symbols.iter().find(|s| s.qualified == "CanvasRenderer.render").unwrap();
        assert_eq!(m.structural, "class:CanvasRenderer/method:render");
        assert!(m.exported);
    }

    #[test]
    fn python_symbols() {
        let f = analyze_src("pkg/mod.py", "import os\nfrom .sibling import thing\nclass A:\n    def m(self):\n        def local():\n            pass\n        return 1\n\ndef top():\n    pass\n");
        let ids: Vec<&str> = f.symbols.iter().map(|s| s.qualified.as_str()).collect();
        assert_eq!(ids, vec!["A", "A.m", "top"]);
        assert!(f.externals.contains(&"os".to_string()));
    }

    #[test]
    fn rust_symbols() {
        let f = analyze_src("src/lib.rs", "use std::fmt;\npub struct Foo;\nimpl Foo { pub fn new() -> Self { Foo } }\nimpl fmt::Display for Foo { fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { Ok(()) } }\n");
        let ids: Vec<&str> = f.symbols.iter().map(|s| s.qualified.as_str()).collect();
        assert!(ids.contains(&"Foo"));
        assert!(ids.contains(&"Foo.new"));
        assert!(ids.contains(&"Foo[fmt::Display].fmt"));
    }

    #[test]
    fn go_symbols() {
        let f = analyze_src("main.go", "package main\nimport \"fmt\"\ntype Server struct{}\nfunc (s *Server) Start() {}\nfunc main() { fmt.Println(1) }\n");
        let ids: Vec<&str> = f.symbols.iter().map(|s| s.qualified.as_str()).collect();
        assert!(ids.contains(&"Server"));
        assert!(ids.contains(&"Server.Start"));
        assert!(ids.contains(&"main"));
        assert!(f.externals.contains(&"fmt".to_string()));
    }
}
