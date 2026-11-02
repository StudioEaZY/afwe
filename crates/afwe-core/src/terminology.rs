//! Ubiquitous Language — Domain dictionary parser, markdown compiler, and interactive HTML generator.
//! Maintains canonical terminology alignment across AFWE-Core, AFWE-Client, agents, and human developers.

use crate::model::MemoryEntry;
use crate::store::Store;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TermItem {
    pub id: String,
    pub title: String,
    pub category: String,
    pub meaning: String,
    pub not_to_be_confused_with: Vec<(String, String)>,
    pub tags: Vec<String>,
    pub applies_to: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TerminologySyncReport {
    pub total_terms: usize,
    pub categories: BTreeMap<String, usize>,
    pub written_files: Vec<String>,
}

/// Determine category from tags and title
fn categorize_term(tags: &[String], title: &str) -> String {
    let lower_title = title.to_lowercase();
    for t in tags {
        let tag = t.to_lowercase();
        if tag.contains("turn") || tag.contains("lifecycle") || tag.contains("briefing") || tag.contains("declaration") {
            return "Turn Protocol & Lifecycle".into();
        }
        if tag.contains("philosophy") || tag.contains("mental-model") || tag.contains("persistent-model") || tag.contains("repository-rules") {
            return "Architecture Philosophy & Tenets".into();
        }
        if tag.contains("blueprint") || tag.contains("topology") || tag.contains("drift") || tag.contains("context") {
            return "Blueprint & Cartography".into();
        }
        if tag.contains("claim") || tag.contains("tripwire") || tag.contains("materializer") {
            return "Claims & Tripwires".into();
        }
        if tag.contains("ratchet") || tag.contains("gate") || tag.contains("baseline") {
            return "Ratchets & Integrity Verification".into();
        }
        if tag.contains("confidence") || tag.contains("advisory") || tag.contains("human-in-the-loop") || tag.contains("explore") {
            return "Confidence Bands & Calibration".into();
        }
        if tag.contains("pin") || tag.contains("intent") || tag.contains("memory") || tag.contains("governance") {
            return "Memory, Pins & Living Intents".into();
        }
        if tag.contains("multi-agent") || tag.contains("concurrency") || tag.contains("coordination") {
            return "Multi-Agent Concurrency & Worktrees".into();
        }
    }

    if lower_title.contains("turn") || lower_title.contains("phase") {
        "Turn Protocol & Lifecycle".into()
    } else if lower_title.contains("ratchet") || lower_title.contains("capability") || lower_title.contains("baseline") {
        "Ratchets & Integrity Verification".into()
    } else if lower_title.contains("guide") || lower_title.contains("question") || lower_title.contains("explore") {
        "Confidence Bands & Calibration".into()
    } else if lower_title.contains("lease") || lower_title.contains("mission") || lower_title.contains("contention") {
        "Multi-Agent Concurrency & Worktrees".into()
    } else {
        "Architecture Philosophy & Tenets".into()
    }
}

/// Parse a raw markdown body into Meaning and "Not to be confused with" sections
fn parse_term_sections(body: &str) -> (String, Vec<(String, String)>) {
    let mut meaning = String::new();
    let mut confused = Vec::new();

    let mut current_section = "";
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") {
            continue;
        } else if trimmed.eq_ignore_ascii_case("## Meaning") || trimmed.starts_with("## Meaning") {
            current_section = "meaning";
            continue;
        } else if trimmed.eq_ignore_ascii_case("## Not to be confused with") || trimmed.starts_with("## Not to be confused with") {
            current_section = "confused";
            continue;
        } else if trimmed.starts_with("## ") {
            current_section = "other";
            continue;
        }

        if current_section == "meaning" {
            if !meaning.is_empty() || !trimmed.is_empty() {
                meaning.push_str(line);
                meaning.push('\n');
            }
        } else if current_section == "confused" {
            if trimmed.starts_with("- **") || trimmed.starts_with("* **") {
                let rest = trimmed.trim_start_matches(['-', '*', ' ']);
                if let Some(idx) = rest.find("**:") {
                    let target_term = rest[..idx].trim().to_string();
                    let desc = rest[idx + 3..].trim().to_string();
                    confused.push((target_term, desc));
                } else if let Some(idx) = rest.find("** -") {
                    let target_term = rest[..idx].trim().to_string();
                    let desc = rest[idx + 4..].trim().to_string();
                    confused.push((target_term, desc));
                } else if let Some(idx) = rest.find("**") {
                    let target_term = rest[..idx].trim().to_string();
                    let desc = rest[idx + 2..].trim_start_matches([':', '-', ' ']).to_string();
                    confused.push((target_term, desc));
                }
            } else if !trimmed.is_empty() && !confused.is_empty() {
                let last_idx = confused.len() - 1;
                confused[last_idx].1.push(' ');
                confused[last_idx].1.push_str(trimmed);
            }
        }
    }

    (meaning.trim().to_string(), confused)
}

/// One anchor rule for table links, section ids and HTML cards. A run of delimiters collapses to a
/// single dash, but underscores are kept so anchors like `#dead_on_arrival` stay stable.
fn anchor_for(title: &str) -> String {
    let mut out = title.to_lowercase().replace([' ', '(', ')', '/', ':', '&'], "-");
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    out.trim_matches('-').to_string()
}

/// Load and parse all terminology entries from store
pub fn load_terms(store: &Store) -> Result<Vec<TermItem>> {
    let mut items = Vec::new();
    let all_mem = store.memory().unwrap_or_default();
    let mut term_entries: Vec<MemoryEntry> = all_mem.into_iter().filter(|m| m.meta.kind == "terminology").collect();

    // Sort deterministically by title
    term_entries.sort_by(|a, b| a.meta.title.cmp(&b.meta.title));

    for e in term_entries {
        let (meaning, confused) = parse_term_sections(&e.body);
        let category = categorize_term(&e.meta.tags, &e.meta.title);
        items.push(TermItem {
            id: e.meta.id,
            title: e.meta.title,
            category,
            meaning: if meaning.is_empty() { e.body.trim().to_string() } else { meaning },
            not_to_be_confused_with: confused,
            tags: e.meta.tags,
            applies_to: e.meta.applies_to,
        });
    }

    Ok(items)
}

/// Generate the canonical markdown reference
pub fn generate_markdown(terms: &[TermItem]) -> String {
    let mut md = String::new();
    md.push_str("# AFWE Ubiquitous Language Dictionary\n\n");
    md.push_str("> **Canonical Domain Glossary & Semantic Model for AFWE-Core & AFWE-Client**\n>\n");
    md.push_str("> In Domain-Driven Design (DDD), the **Ubiquitous Language** provides an unambiguous, shared vocabulary between software architects, human developers, agent harnesses, tools, and code. All agents MUST consult and preserve this language across plans, intents, code generation, and pull requests.\n\n");

    md.push_str("## Domain Model & Architectural Lifecycle\n\n");
    md.push_str("```mermaid\nflowchart TD\n");
    md.push_str("    subgraph Client[\"Harness & Agent Interaction\"]\n");
    md.push_str("        P[\"Verbatim Prompt\"] --> T0[\"Phase 0: turn begin\\n(Briefing, Pins, File Claims)\"]\n");
    md.push_str("        T0 --> Plan[\"Agent Plan & Reasoning\"]\n");
    md.push_str("        Plan --> T1[\"Phase 1: turn assume\\n(Declare Intents & AST Claims)\"]\n");
    md.push_str("        T1 --> Code[\"Active Code Generation\\n(Micro-Context, verify)\"]\n");
    md.push_str("        Code --> T2[\"Phase 2: turn commit\\n(CAS Plumbing Trees, Gate Checks)\"]\n");
    md.push_str("    end\n\n");
    md.push_str("    subgraph Gate[\"AFWE Deterministic Commit Gate\"]\n");
    md.push_str("        T2 --> R1{\"Capability Ratchet\"}\n");
    md.push_str("        R1 -- \"Export dropped\\nw/o intent\" --> Err1[\"DROPPED_CAPABILITY (Block)\"]\n");
    md.push_str("        R1 -- \"Caller severed\" --> Err2[\"SEVERED_CAPABILITY (Block)\"]\n");
    md.push_str("        R1 -- \"Uncalled export\" --> Err3[\"DEAD_ON_ARRIVAL (Block)\"]\n");
    md.push_str("        R1 -- \"Pass\" --> V1[\"Active Checks & Pins\"]\n");
    md.push_str("        V1 --> Receipt[\"Turn Receipt tNNNN.yaml\\n(Git Commit w/ AFWE-Turn:)\"]\n");
    md.push_str("    end\n\n");
    md.push_str("    subgraph Persistent[\".afwe/ The Folder is the Product\"]\n");
    md.push_str("        Receipt --> BP[\"Blueprint Graph\"]\n");
    md.push_str("        Receipt --> Int[\"Living Intents\"]\n");
    md.push_str("        Receipt --> Mem[\"Memory & Terminology\"]\n");
    md.push_str("    end\n```\n\n");

    md.push_str("## Quick Reference Table\n\n");
    md.push_str("| Term | Category | Meaning Summary | Not To Be Confused With |\n");
    md.push_str("| :--- | :--- | :--- | :--- |\n");

    for t in terms {
        let anchor = anchor_for(&t.title);
        let short_meaning = t.meaning.lines().next().unwrap_or("").trim();
        let confused_summary = if t.not_to_be_confused_with.is_empty() {
            "—".into()
        } else {
            t.not_to_be_confused_with.iter().map(|(target, _)| target.as_str()).collect::<Vec<&str>>().join(", ")
        };
        md.push_str(&format!("| [**{}**](#{}) | {} | {} | {} |\n", t.title, anchor, t.category, short_meaning, confused_summary));
    }
    md.push('\n');

    // Group terms by category
    let mut grouped: BTreeMap<String, Vec<&TermItem>> = BTreeMap::new();
    for t in terms {
        grouped.entry(t.category.clone()).or_default().push(t);
    }

    md.push_str("## Detailed Vocabulary by Category\n\n");
    for (cat, cat_terms) in grouped {
        md.push_str(&format!("### {}\n\n", cat));
        for t in cat_terms {
            let anchor = anchor_for(&t.title);
            md.push_str(&format!("#### {} <a id=\"{}\"></a>\n\n", t.title, anchor));
            md.push_str(&format!("- **ID**: `{}`\n", t.id));
            if !t.tags.is_empty() {
                md.push_str(&format!("- **Tags**: {}\n", t.tags.iter().map(|s| format!("`{}`", s)).collect::<Vec<_>>().join(", ")));
            }
            if !t.applies_to.is_empty() {
                md.push_str(&format!("- **Applies to**: {}\n", t.applies_to.iter().map(|s| format!("`{}`", s)).collect::<Vec<_>>().join(", ")));
            }
            md.push('\n');

            md.push_str("**Meaning:**\n");
            md.push_str(&t.meaning);
            md.push_str("\n\n");

            if !t.not_to_be_confused_with.is_empty() {
                md.push_str("**Not to be confused with:**\n");
                for (other, desc) in &t.not_to_be_confused_with {
                    md.push_str(&format!("- **{}**: {}\n", other, desc));
                }
                md.push('\n');
            }
            md.push_str("---\n\n");
        }
    }

    md.push_str("## Mandatory Agent Protocol & Synchronization Directives\n\n");
    md.push_str("All LLM coding agents interacting with this repository MUST comply with the following invariants:\n\n");
    md.push_str("1. **Pre-Planning Reading Mandate**: Always read `docs/UBIQUITOUS_LANGUAGE.md` (or `.afwe/docs/UBIQUITOUS_LANGUAGE.md`) during Phase 0 to ensure plans, terminology, and intent statements use canonical domain terms rather than generic software development clichés.\n");
    md.push_str("2. **Explicit Declaration for Removals**: AFWE adheres strictly to the **Rust for Project Intent** philosophy. If a capability, export, or component is deprecated or removed, it MUST be declared in `turn assume` under `removes: [...]` or with `action: remove / replace`. Regressions fail the gate unconditionally.\n");
    md.push_str("3. **Post-Turn Synchronization**: Whenever code changes introduce a new architectural concept, rename a domain primitive, or modify domain boundaries:\n");
    md.push_str("   - Create or update the corresponding term in `.afwe/memory/terminology/term-<name>.md`.\n");
    md.push_str("   - Update `docs/UBIQUITOUS_LANGUAGE.md` and `.afwe/docs/UBIQUITOUS_LANGUAGE.md`.\n");
    md.push_str("   - Re-generate the interactive HTML and documentation files by running `afwe memory sync-terms` (or `node scripts/sync-ubiquitous-language.js`).\n");
    md.push_str("   - Ensure `AGENTS.md` and `.afwe/skills/afwe/SKILL.md` remain synchronized.\n");

    md
}

/// Generate modern interactive single-file HTML dictionary
pub fn generate_html(terms: &[TermItem]) -> String {
    let mut html = String::new();
    html.push_str("<!DOCTYPE html>\n<html lang=\"en\" class=\"dark\">\n<head>\n");
    html.push_str("  <meta charset=\"utf-8\" />\n");
    html.push_str("  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n");
    html.push_str("  <title>AFWE Ubiquitous Language Dictionary · Canonical Domain Terminology</title>\n");
    html.push_str("  <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n");
    html.push_str("  <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n");
    html.push_str("  <link href=\"https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n");
    html.push_str("  <style>\n");
    html.push_str(r#"
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f293d;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #10b981;
      --accent-muted: rgba(16, 185, 129, 0.15);
      --amber: #f59e0b;
      --cyan: #06b6d4;
      --rose: #f43f5e;
      --font-sans: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.6;
      padding: 0 1rem 4rem 1rem;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      padding: 3rem 0 2rem 0;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 2rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      background: var(--accent-muted);
      color: var(--accent);
      border: 1px solid rgba(16, 185, 129, 0.3);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    h1 {
      font-size: 2.25rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      margin-top: 0.75rem;
      color: #fff;
    }
    .subtitle {
      font-size: 1.1rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
      max-width: 800px;
    }
    .controls {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-bottom: 2rem;
      position: sticky;
      top: 0.5rem;
      z-index: 20;
      background: rgba(9, 13, 22, 0.95);
      backdrop-filter: blur(12px);
      padding: 1rem;
      border-radius: 0.75rem;
      border: 1px solid var(--card-border);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .search-box {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }
    .search-input {
      flex: 1;
      background: #0d131f;
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      color: #fff;
      font-family: var(--font-mono);
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-muted);
    }
    .term-count {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .categories {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .cat-btn {
      background: #141c2e;
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 0.35rem 0.75rem;
      border-radius: 0.375rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .cat-btn:hover, .cat-btn.active {
      background: var(--accent);
      color: #090d16;
      border-color: var(--accent);
      font-weight: 600;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 1.25rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
      position: relative;
    }
    .card:hover {
      transform: translateY(-2px);
      border-color: rgba(16, 185, 129, 0.4);
      box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.4);
    }
    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .card-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .card-category {
      font-family: var(--font-mono);
      font-size: 0.65rem;
      color: var(--cyan);
      background: rgba(6, 182, 212, 0.1);
      border: 1px solid rgba(6, 182, 212, 0.2);
      padding: 0.15rem 0.45rem;
      border-radius: 0.25rem;
      white-space: nowrap;
    }
    .card-meaning {
      font-size: 0.95rem;
      color: #cbd5e1;
      line-height: 1.55;
    }
    .confused-box {
      margin-top: auto;
      background: rgba(15, 23, 42, 0.6);
      border-left: 3px solid var(--amber);
      padding: 0.75rem 0.85rem;
      border-radius: 0 0.375rem 0.375rem 0;
      font-size: 0.825rem;
    }
    .confused-title {
      font-family: var(--font-mono);
      font-weight: 600;
      color: var(--amber);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.35rem;
    }
    .confused-item {
      margin-top: 0.35rem;
      color: #94a3b8;
      line-height: 1.4;
    }
    .confused-item strong {
      color: #e2e8f0;
    }
    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 0.75rem;
      font-family: var(--font-mono);
      font-size: 0.7rem;
      color: var(--text-muted);
    }
    .copy-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      transition: color 0.2s;
    }
    .copy-btn:hover {
      color: var(--accent);
    }
    @media (max-width: 768px) {
      .grid { grid-template-columns: 1fr; }
      h1 { font-size: 1.75rem; }
    }
    "#);
    html.push_str("  </style>\n</head>\n<body>\n");
    html.push_str("  <div class=\"container\">\n");
    html.push_str("    <header>\n");
    html.push_str("      <span class=\"badge\">⛨ AFWE ReBorn · Domain-Driven Design</span>\n");
    html.push_str("      <h1>Ubiquitous Language Dictionary</h1>\n");
    html.push_str("      <p class=\"subtitle\">The unambiguous canonical vocabulary governing AFWE-Core, AFWE-Client, automated coding agents, and architecture verification gates.</p>\n");
    html.push_str("    </header>\n\n");

    html.push_str("    <div class=\"controls\">\n");
    html.push_str("      <div class=\"search-box\">\n");
    html.push_str("        <input type=\"text\" id=\"search\" class=\"search-input\" placeholder=\"Search terms, definitions, invariants, or confused-with concepts... (e.g. Turn, Ratchet, CAS)\" autofocus />\n");
    html.push_str(&format!("        <div class=\"term-count\"><span id=\"visible-count\">{}</span> / {} terms</div>\n", terms.len(), terms.len()));
    html.push_str("      </div>\n");

    // Category filter pills
    let mut categories: BTreeMap<String, usize> = BTreeMap::new();
    for t in terms {
        *categories.entry(t.category.clone()).or_default() += 1;
    }

    html.push_str("      <div class=\"categories\">\n");
    html.push_str("        <button class=\"cat-btn active\" data-cat=\"all\">All Categories</button>\n");
    for (cat, count) in &categories {
        html.push_str(&format!("        <button class=\"cat-btn\" data-cat=\"{}\">{} ({})</button>\n", cat, cat, count));
    }
    html.push_str("      </div>\n");
    html.push_str("    </div>\n\n");

    html.push_str("    <div class=\"grid\" id=\"terms-grid\">\n");
    for t in terms {
        let anchor = anchor_for(&t.title);
        html.push_str(&format!("      <article class=\"card\" id=\"{}\" data-category=\"{}\" data-title=\"{}\" data-tags=\"{}\">\n", anchor, t.category, t.title.to_lowercase(), t.tags.join(" ")));
        html.push_str("        <div class=\"card-header\">\n");
        html.push_str(&format!("          <h2 class=\"card-title\">{}</h2>\n", t.title));
        html.push_str(&format!("          <span class=\"card-category\">{}</span>\n", t.category));
        html.push_str("        </div>\n");

        html.push_str(&format!("        <p class=\"card-meaning\">{}</p>\n", t.meaning));

        if !t.not_to_be_confused_with.is_empty() {
            html.push_str("        <div class=\"confused-box\">\n");
            html.push_str("          <div class=\"confused-title\">Not to be confused with:</div>\n");
            for (other, desc) in &t.not_to_be_confused_with {
                html.push_str(&format!("          <div class=\"confused-item\"><strong>{}</strong>: {}</div>\n", other, desc));
            }
            html.push_str("        </div>\n");
        }

        html.push_str("        <div class=\"card-footer\">\n");
        html.push_str(&format!("          <span><code>{}</code></span>\n", t.id));
        html.push_str(&format!("          <button class=\"copy-btn\" onclick=\"copyAnchor('{}')\" title=\"Copy link to clipboard\">🔗 permalink</button>\n", anchor));
        html.push_str("        </div>\n");
        html.push_str("      </article>\n");
    }
    html.push_str("    </div>\n");
    html.push_str("  </div>\n\n");

    html.push_str(r#"  <script>
    const searchInput = document.getElementById('search');
    const catButtons = document.querySelectorAll('.cat-btn');
    const cards = document.querySelectorAll('.card');
    const countDisplay = document.getElementById('visible-count');
    let activeCat = 'all';

    function filterTerms() {
      const q = searchInput.value.toLowerCase().trim();
      let visible = 0;

      cards.forEach(card => {
        const cat = card.getAttribute('data-category');
        const text = card.textContent.toLowerCase();
        const matchesSearch = !q || text.includes(q);
        const matchesCat = activeCat === 'all' || cat === activeCat;

        if (matchesSearch && matchesCat) {
          card.style.display = 'flex';
          visible++;
        } else {
          card.style.display = 'none';
        }
      });

      countDisplay.textContent = visible;
    }

    searchInput.addEventListener('input', filterTerms);

    catButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        catButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeCat = btn.getAttribute('data-cat');
        filterTerms();
      });
    });

    function copyAnchor(id) {
      const url = `${window.location.origin}${window.location.pathname}#${id}`;
      navigator.clipboard.writeText(url).then(() => {
        const el = document.getElementById(id);
        if (el) {
          el.style.borderColor = 'var(--accent)';
          setTimeout(() => { el.style.borderColor = ''; }, 1000);
        }
      });
    }

    if (window.location.hash) {
      const target = document.querySelector(window.location.hash);
      if (target) {
        setTimeout(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.style.borderColor = 'var(--accent)';
        }, 200);
      }
    }
  </script>
</body>
</html>
"#);

    html
}

/// Synchronize terminology memory into docs/UBIQUITOUS_LANGUAGE.md and .html
pub fn sync_ubiquitous_language(store: &Store) -> Result<TerminologySyncReport> {
    let terms = load_terms(store)?;
    let mut report = TerminologySyncReport {
        total_terms: terms.len(),
        categories: BTreeMap::new(),
        written_files: Vec::new(),
    };

    for t in &terms {
        *report.categories.entry(t.category.clone()).or_default() += 1;
    }

    let md_content = generate_markdown(&terms);
    let html_content = generate_html(&terms);

    // Target 1: Core docs/
    let root_docs = store.project_root.join("docs");
    if root_docs.exists() {
        let md_path = root_docs.join("UBIQUITOUS_LANGUAGE.md");
        std::fs::write(&md_path, &md_content)?;
        report.written_files.push(md_path.to_string_lossy().to_string());

        let html_path = root_docs.join("UBIQUITOUS_LANGUAGE.html");
        std::fs::write(&html_path, &html_content)?;
        report.written_files.push(html_path.to_string_lossy().to_string());
    }

    // Target 2: Client/dogfooding .afwe/docs/
    let client_docs = store.p("docs");
    std::fs::create_dir_all(&client_docs)?;
    let client_md = client_docs.join("UBIQUITOUS_LANGUAGE.md");
    std::fs::write(&client_md, &md_content)?;
    report.written_files.push(client_md.to_string_lossy().to_string());

    let client_html = client_docs.join("UBIQUITOUS_LANGUAGE.html");
    std::fs::write(&client_html, &html_content)?;
    report.written_files.push(client_html.to_string_lossy().to_string());

    // Target 3: Website public/docs/ if present
    let website_docs = store.project_root.join("apps/website/public/docs");
    if store.project_root.join("apps/website").exists() {
        let _ = std::fs::create_dir_all(&website_docs);
        let _ = std::fs::write(website_docs.join("UBIQUITOUS_LANGUAGE.md"), &md_content);
        let _ = std::fs::write(website_docs.join("UBIQUITOUS_LANGUAGE.html"), &html_content);
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_terminology_parsing_and_generation() {
        let term = TermItem {
            id: "term-test".into(),
            title: "Test Term".into(),
            category: "Turn Protocol & Lifecycle".into(),
            meaning: "A test concept for unit testing.".into(),
            not_to_be_confused_with: vec![("Other".into(), "Something else".into())],
            tags: vec!["turn-protocol".into()],
            applies_to: vec!["core".into()],
        };

        let terms = vec![term];
        let md = generate_markdown(&terms);
        assert!(md.contains("Test Term"));
        assert!(md.contains("A test concept for unit testing."));
        assert!(md.contains("Not to be confused with"));

        let html = generate_html(&terms);
        assert!(html.contains("Test Term"));
        assert!(html.contains("A test concept for unit testing."));

        let temp_dir = std::env::temp_dir().join(format!("afwe-term-test-{}", crate::util::short_id("term")));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let store = Store::new(&temp_dir);
        let loaded = load_terms(&store).unwrap();
        assert!(loaded.is_empty());
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn confused_terms_keep_their_first_characters() {
        let body = "# Dormant Check\n\n## Meaning\nA check.\n\n## Not to be confused with\n- **Retired check**: a deliberate retirement.\n- **Superseded check** - replaced by a newer check.\n";
        let (meaning, confused) = parse_term_sections(body);
        assert_eq!(meaning.trim(), "A check.");
        assert_eq!(confused.len(), 2, "{confused:?}");
        assert_eq!(confused[0].0, "Retired check");
        assert_eq!(confused[0].1, "a deliberate retirement.");
        assert_eq!(confused[1].0, "Superseded check");
        assert_eq!(confused[1].1, "replaced by a newer check.");
    }

    #[test]
    fn anchors_collapse_delimiter_runs_without_touching_underscores() {
        assert_eq!(anchor_for("CI Runner Profile & Cached Acquisition"), "ci-runner-profile-cached-acquisition");
        assert_eq!(anchor_for("DEAD_ON_ARRIVAL"), "dead_on_arrival");
        assert_eq!(anchor_for("4D Timeline Dial"), "4d-timeline-dial");
    }
}

