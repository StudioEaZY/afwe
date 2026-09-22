//! Language table for the tree‑sitter based analyzer.
//!
//! AFWE is language agnostic: adding a language means adding a grammar crate and a
//! few rows to the tables below (which node kinds are definitions, which carry the
//! name, which are imports). Files in languages without a grammar are still tracked
//! at file level so they can be mapped to the blueprint.

use tree_sitter::{Language, Node};

#[derive(Debug, Clone, Copy)]
pub struct DefRule {
    /// tree‑sitter node kind
    pub node: &'static str,
    /// AFWE symbol kind
    pub kind: &'static str,
    /// field carrying the identifier
    pub name_field: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub struct LangSpec {
    pub id: &'static str,
    pub extensions: &'static [&'static str],
    pub grammar: Option<fn() -> Language>,
    pub defs: &'static [DefRule],
}

const fn d(node: &'static str, kind: &'static str, name_field: &'static str) -> DefRule {
    DefRule { node, kind, name_field }
}

const TS_DEFS: &[DefRule] = &[
    d("function_declaration", "function", "name"),
    d("generator_function_declaration", "function", "name"),
    d("class_declaration", "class", "name"),
    d("abstract_class_declaration", "class", "name"),
    d("method_definition", "method", "name"),
    d("interface_declaration", "interface", "name"),
    d("type_alias_declaration", "type", "name"),
    d("enum_declaration", "enum", "name"),
    d("variable_declarator", "const", "name"),
    d("internal_module", "module", "name"), // namespace X {}
];
const PY_DEFS: &[DefRule] = &[
    d("function_definition", "function", "name"),
    d("class_definition", "class", "name"),
];
const RS_DEFS: &[DefRule] = &[
    d("function_item", "function", "name"),
    d("function_signature_item", "function", "name"),
    d("struct_item", "struct", "name"),
    d("enum_item", "enum", "name"),
    d("union_item", "struct", "name"),
    d("trait_item", "trait", "name"),
    d("impl_item", "impl", "type"),
    d("mod_item", "module", "name"),
    d("type_item", "type", "name"),
    d("const_item", "const", "name"),
    d("static_item", "const", "name"),
    d("macro_definition", "macro", "name"),
];
const GO_DEFS: &[DefRule] = &[
    d("function_declaration", "function", "name"),
    d("method_declaration", "method", "name"),
    d("type_spec", "type", "name"),
];
const JAVA_DEFS: &[DefRule] = &[
    d("class_declaration", "class", "name"),
    d("interface_declaration", "interface", "name"),
    d("enum_declaration", "enum", "name"),
    d("record_declaration", "class", "name"),
    d("method_declaration", "method", "name"),
    d("constructor_declaration", "method", "name"),
];

fn ts() -> Language {
    Language::new(tree_sitter_typescript::LANGUAGE_TYPESCRIPT)
}
fn tsx() -> Language {
    Language::new(tree_sitter_typescript::LANGUAGE_TSX)
}
fn js() -> Language {
    Language::new(tree_sitter_javascript::LANGUAGE)
}
fn py() -> Language {
    Language::new(tree_sitter_python::LANGUAGE)
}
fn rs() -> Language {
    Language::new(tree_sitter_rust::LANGUAGE)
}
fn go() -> Language {
    Language::new(tree_sitter_go::LANGUAGE)
}
fn java() -> Language {
    Language::new(tree_sitter_java::LANGUAGE)
}

pub const LANGS: &[LangSpec] = &[
    LangSpec { id: "typescript", extensions: &["ts", "mts", "cts"], grammar: Some(ts), defs: TS_DEFS },
    LangSpec { id: "tsx", extensions: &["tsx"], grammar: Some(tsx), defs: TS_DEFS },
    LangSpec { id: "javascript", extensions: &["js", "jsx", "mjs", "cjs"], grammar: Some(js), defs: TS_DEFS },
    LangSpec { id: "python", extensions: &["py", "pyi"], grammar: Some(py), defs: PY_DEFS },
    LangSpec { id: "rust", extensions: &["rs"], grammar: Some(rs), defs: RS_DEFS },
    LangSpec { id: "go", extensions: &["go"], grammar: Some(go), defs: GO_DEFS },
    LangSpec { id: "java", extensions: &["java"], grammar: Some(java), defs: JAVA_DEFS },
    // file‑level only (no grammar): still part of the architecture
    LangSpec { id: "css", extensions: &["css", "scss", "less"], grammar: None, defs: &[] },
    LangSpec { id: "html", extensions: &["html", "htm", "vue", "svelte"], grammar: None, defs: &[] },
    LangSpec { id: "json", extensions: &["json"], grammar: None, defs: &[] },
    LangSpec { id: "yaml", extensions: &["yaml", "yml"], grammar: None, defs: &[] },
    LangSpec { id: "toml", extensions: &["toml"], grammar: None, defs: &[] },
    LangSpec { id: "markdown", extensions: &["md", "mdx"], grammar: None, defs: &[] },
    LangSpec { id: "shell", extensions: &["sh", "bash", "zsh"], grammar: None, defs: &[] },
    LangSpec { id: "sql", extensions: &["sql"], grammar: None, defs: &[] },
    LangSpec { id: "c", extensions: &["c", "h"], grammar: None, defs: &[] },
    LangSpec { id: "cpp", extensions: &["cc", "cpp", "cxx", "hpp", "hh"], grammar: None, defs: &[] },
    LangSpec { id: "csharp", extensions: &["cs"], grammar: None, defs: &[] },
    LangSpec { id: "ruby", extensions: &["rb"], grammar: None, defs: &[] },
    LangSpec { id: "php", extensions: &["php"], grammar: None, defs: &[] },
    LangSpec { id: "kotlin", extensions: &["kt", "kts"], grammar: None, defs: &[] },
    LangSpec { id: "swift", extensions: &["swift"], grammar: None, defs: &[] },
];

pub fn spec_for_ext(ext: &str) -> Option<&'static LangSpec> {
    let ext = ext.to_ascii_lowercase();
    LANGS.iter().find(|l| l.extensions.contains(&ext.as_str()))
}

pub fn supported_languages() -> Vec<&'static str> {
    LANGS.iter().filter(|l| l.grammar.is_some()).map(|l| l.id).collect()
}

/// Kinds whose subtree we never descend into for definitions (bodies of functions in
/// Python/JS produce local helpers we do not want as architectural symbols).
pub fn is_local_scope(lang: &str, kind: &str) -> bool {
    matches!(
        (lang, kind),
        ("python", "function") | ("typescript", "function") | ("tsx", "function") | ("javascript", "function")
            | ("typescript", "method") | ("tsx", "method") | ("javascript", "method") | ("python", "method")
            | ("rust", "function") | ("rust", "method") | ("go", "function") | ("go", "method")
            | ("java", "method")
    )
}

/// Is this node an import‑like statement? Returns the raw specifier(s).
pub fn imports_of(lang: &str, node: Node, src: &str) -> Vec<String> {
    let text = |n: Node| n.utf8_text(src.as_bytes()).unwrap_or("").to_string();
    let unquote = |s: String| s.trim_matches(|c| c == '"' || c == '\'' || c == '`').to_string();
    match lang {
        "typescript" | "tsx" | "javascript" => match node.kind() {
            "import_statement" | "export_statement" => node
                .child_by_field_name("source")
                .map(|n| vec![unquote(text(n))])
                .unwrap_or_default(),
            "call_expression" => {
                let f = node.child_by_field_name("function").map(text).unwrap_or_default();
                if f == "require" || f == "import" {
                    if let Some(args) = node.child_by_field_name("arguments") {
                        let mut c = args.walk();
                        for a in args.named_children(&mut c) {
                            if a.kind() == "string" {
                                return vec![unquote(text(a))];
                            }
                        }
                    }
                }
                vec![]
            }
            _ => vec![],
        },
        "python" => match node.kind() {
            "import_statement" => {
                let mut out = vec![];
                let mut c = node.walk();
                for ch in node.named_children(&mut c) {
                    match ch.kind() {
                        "dotted_name" => out.push(text(ch)),
                        "aliased_import" => {
                            if let Some(n) = ch.child_by_field_name("name") {
                                out.push(text(n));
                            }
                        }
                        _ => {}
                    }
                }
                out
            }
            "import_from_statement" => node
                .child_by_field_name("module_name")
                .map(|n| vec![text(n)])
                .unwrap_or_default(),
            _ => vec![],
        },
        "rust" => match node.kind() {
            "use_declaration" => node
                .child_by_field_name("argument")
                .map(|n| vec![text(n)])
                .unwrap_or_default(),
            "mod_item" => {
                // `mod foo;` (no body) references foo.rs / foo/mod.rs
                if node.child_by_field_name("body").is_none() {
                    node.child_by_field_name("name").map(|n| vec![format!("mod {}", text(n))]).unwrap_or_default()
                } else {
                    vec![]
                }
            }
            "extern_crate_declaration" => node
                .child_by_field_name("name")
                .map(|n| vec![text(n)])
                .unwrap_or_default(),
            _ => vec![],
        },
        "go" => match node.kind() {
            "import_spec" => node.child_by_field_name("path").map(|n| vec![unquote(text(n))]).unwrap_or_default(),
            _ => vec![],
        },
        "java" => match node.kind() {
            "import_declaration" => {
                let mut c = node.walk();
                let mut out = vec![];
                for ch in node.named_children(&mut c) {
                    if ch.kind() == "scoped_identifier" || ch.kind() == "identifier" {
                        out.push(text(ch));
                    }
                }
                out
            }
            _ => vec![],
        },
        _ => vec![],
    }
}

/// Whether a definition node is exported / public.
pub fn is_exported(lang: &str, node: Node, name: &str, src: &str) -> bool {
    match lang {
        "typescript" | "tsx" | "javascript" => {
            let mut p = node.parent();
            let mut hops = 0;
            while let Some(n) = p {
                if n.kind() == "export_statement" {
                    return true;
                }
                if n.kind() == "program" || hops > 3 {
                    break;
                }
                p = n.parent();
                hops += 1;
            }
            false
        }
        "python" => !name.starts_with('_'),
        "rust" => {
            let mut c = node.walk();
            let x = node.children(&mut c).any(|ch| ch.kind() == "visibility_modifier");
            x
        }
        "go" => name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false),
        "java" => {
            let mut c = node.walk();
            let x = node.children(&mut c).any(|ch| ch.kind() == "modifiers" && ch.utf8_text(src.as_bytes()).unwrap_or("").contains("public"));
            x
        }
        _ => false,
    }
}
