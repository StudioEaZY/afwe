#!/usr/bin/env node
/**
 * scripts/sync-ubiquitous-language.js
 * Automatically parses .afwe/memory/terminology/*.md, generates:
 *  - docs/UBIQUITOUS_LANGUAGE.md
 *  - docs/UBIQUITOUS_LANGUAGE.html
 *  - .afwe/docs/UBIQUITOUS_LANGUAGE.md
 *  - .afwe/docs/UBIQUITOUS_LANGUAGE.html
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TERMS_DIR = path.join(ROOT, '.afwe', 'memory', 'terminology');
const DOCS_DIR = path.join(ROOT, 'docs');
const AFWE_DOCS_DIR = path.join(ROOT, '.afwe', 'docs');

function parseYamlFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const rawMeta = match[1];
  const body = match[2];
  const meta = {};

  let currentKey = null;
  let inArray = false;

  for (const line of rawMeta.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('- ') && currentKey && inArray) {
      meta[currentKey].push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''));
    } else if (trimmed.includes(':')) {
      const idx = trimmed.indexOf(':');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (val === '') {
        currentKey = key;
        inArray = true;
        meta[key] = [];
      } else {
        currentKey = key;
        inArray = false;
        meta[key] = val;
      }
    }
  }

  return { meta, body };
}

function parseSections(body) {
  let meaning = '';
  const confused = [];
  let currentSec = '';

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) continue;
    if (/^##\s+Meaning/i.test(trimmed)) {
      currentSec = 'meaning';
      continue;
    } else if (/^##\s+Not to be confused with/i.test(trimmed)) {
      currentSec = 'confused';
      continue;
    } else if (/^##\s+/.test(trimmed)) {
      currentSec = 'other';
      continue;
    }

    if (currentSec === 'meaning') {
      if (meaning || trimmed) {
        meaning += line + '\n';
      }
    } else if (currentSec === 'confused') {
      const match = trimmed.match(/^[-*]\s+\*\*([^*]+)\*\*[:\s-]*(.*)$/);
      if (match) {
        confused.push({ term: match[1].trim(), desc: match[2].trim() });
      } else if (trimmed && confused.length > 0) {
        confused[confused.length - 1].desc += ' ' + trimmed;
      }
    }
  }

  return { meaning: meaning.trim(), confused };
}

function categorizeTerm(tags = [], title = '') {
  const lowerTitle = title.toLowerCase();
  for (const t of tags) {
    const tag = t.toLowerCase();
    if (tag.includes('turn') || tag.includes('lifecycle') || tag.includes('briefing') || tag.includes('declaration')) {
      return 'Turn Protocol & Lifecycle';
    }
    if (tag.includes('philosophy') || tag.includes('mental-model') || tag.includes('persistent-model') || tag.includes('repository-rules')) {
      return 'Architecture Philosophy & Tenets';
    }
    if (tag.includes('blueprint') || tag.includes('topology') || tag.includes('drift') || tag.includes('context')) {
      return 'Blueprint & Cartography';
    }
    if (tag.includes('claim') || tag.includes('tripwire') || tag.includes('materializer')) {
      return 'Claims & Tripwires';
    }
    if (tag.includes('ratchet') || tag.includes('gate') || tag.includes('baseline')) {
      return 'Ratchets & Integrity Verification';
    }
    if (tag.includes('confidence') || tag.includes('advisory') || tag.includes('human-in-the-loop') || tag.includes('explore')) {
      return 'Confidence Bands & Calibration';
    }
    if (tag.includes('pin') || tag.includes('intent') || tag.includes('memory') || tag.includes('governance')) {
      return 'Memory, Pins & Living Intents';
    }
    if (tag.includes('multi-agent') || tag.includes('concurrency') || tag.includes('coordination')) {
      return 'Multi-Agent Concurrency & Worktrees';
    }
  }

  if (lowerTitle.includes('turn') || lowerTitle.includes('phase')) return 'Turn Protocol & Lifecycle';
  if (lowerTitle.includes('ratchet') || lowerTitle.includes('capability') || lowerTitle.includes('baseline')) return 'Ratchets & Integrity Verification';
  if (lowerTitle.includes('guide') || lowerTitle.includes('question') || lowerTitle.includes('explore')) return 'Confidence Bands & Calibration';
  if (lowerTitle.includes('lease') || lowerTitle.includes('mission') || lowerTitle.includes('contention')) return 'Multi-Agent Concurrency & Worktrees';
  return 'Architecture Philosophy & Tenets';
}

function loadTerms() {
  if (!fs.existsSync(TERMS_DIR)) return [];
  const files = fs.readdirSync(TERMS_DIR).filter(f => f.endsWith('.md') && f !== 'README.md');
  const terms = [];

  for (const file of files) {
    const full = path.join(TERMS_DIR, file);
    const content = fs.readFileSync(full, 'utf8');
    const { meta, body } = parseYamlFrontmatter(content);
    const { meaning, confused } = parseSections(body);

    const title = meta.title || body.split(/\r?\n/).find(l => l.startsWith('# '))?.replace(/^#\s+/, '') || file.replace(/\.md$/, '');
    const tags = Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []);
    const appliesTo = Array.isArray(meta.applies_to) ? meta.applies_to : (meta.applies_to ? [meta.applies_to] : []);
    const category = categorizeTerm(tags, title);

    terms.push({
      id: meta.id || file.replace(/\.md$/, ''),
      title,
      category,
      meaning: meaning || body.trim(),
      confused,
      tags,
      appliesTo
    });
  }

  return terms.sort((a, b) => a.title.localeCompare(b.title));
}

function generateMarkdown(terms) {
  let md = '# AFWE Ubiquitous Language Dictionary\n\n';
  md += '> **Canonical Domain Glossary & Semantic Model for AFWE-Core & AFWE-Client**\n>\n';
  md += '> In Domain-Driven Design (DDD), the **Ubiquitous Language** provides an unambiguous, shared vocabulary between software architects, human developers, agent harnesses, tools, and code. All agents MUST consult and preserve this language across plans, intents, code generation, and pull requests.\n\n';

  md += '## Domain Model & Architectural Lifecycle\n\n';
  md += '```mermaid\nflowchart TD\n';
  md += '    subgraph Client["Harness & Agent Interaction"]\n';
  md += '        P["Verbatim Prompt"] --> T0["Phase 0: turn begin\\n(Briefing, Pins, File Claims)"]\n';
  md += '        T0 --> Plan["Agent Plan & Reasoning"]\n';
  md += '        Plan --> T1["Phase 1: turn assume\\n(Declare Intents & AST Claims)"]\n';
  md += '        T1 --> Code["Active Code Generation\\n(Micro-Context, verify)"]\n';
  md += '        Code --> T2["Phase 2: turn commit\\n(CAS Plumbing Trees, Gate Checks)"]\n';
  md += '    end\n\n';
  md += '    subgraph Gate["AFWE Deterministic Commit Gate"]\n';
  md += '        T2 --> R1{"Capability Ratchet"}\n';
  md += '        R1 -- "Export dropped\\nw/o intent" --> Err1["DROPPED_CAPABILITY (Block)"]\n';
  md += '        R1 -- "Caller severed" --> Err2["SEVERED_CAPABILITY (Block)"]\n';
  md += '        R1 -- "Uncalled export" --> Err3["DEAD_ON_ARRIVAL (Block)"]\n';
  md += '        R1 -- "Pass" --> V1["Active Checks & Pins"]\n';
  md += '        V1 --> Receipt["Turn Receipt tNNNN.yaml\\n(Git Commit w/ AFWE-Turn:)"]\n';
  md += '    end\n\n';
  md += '    subgraph Persistent[".afwe/ The Folder is the Product"]\n';
  md += '        Receipt --> BP["Blueprint Graph"]\n';
  md += '        Receipt --> Int["Living Intents"]\n';
  md += '        Receipt --> Mem["Memory & Terminology"]\n';
  md += '    end\n```\n\n';

  md += '## Quick Reference Table\n\n';
  md += '| Term | Category | Meaning Summary | Not To Be Confused With |\n';
  md += '| :--- | :--- | :--- | :--- |\n';

  for (const t of terms) {
    const anchor = t.title.toLowerCase().replace(/[\s()/:&]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const shortMeaning = (t.meaning.split(/\r?\n/)[0] || '').replace(/\|/g, '\\|');
    const confusedSummary = t.confused.length ? t.confused.map(c => c.term).join(', ') : '—';
    md += `| [**${t.title}**](#${anchor}) | ${t.category} | ${shortMeaning} | ${confusedSummary} |\n`;
  }
  md += '\n';

  const grouped = {};
  for (const t of terms) {
    grouped[t.category] = grouped[t.category] || [];
    grouped[t.category].push(t);
  }

  md += '## Detailed Vocabulary by Category\n\n';
  for (const [cat, catTerms] of Object.entries(grouped)) {
    md += `### ${cat}\n\n`;
    for (const t of catTerms) {
      const anchor = t.title.toLowerCase().replace(/[\s()/:&]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      md += `#### ${t.title} <a id="${anchor}"></a>\n\n`;
      md += `- **ID**: \`${t.id}\`\n`;
      if (t.tags.length) md += `- **Tags**: ${t.tags.map(s => `\`${s}\``).join(', ')}\n`;
      if (t.appliesTo.length) md += `- **Applies to**: ${t.appliesTo.map(s => `\`${s}\``).join(', ')}\n`;
      md += '\n';
      md += '**Meaning:**\n';
      md += t.meaning + '\n\n';

      if (t.confused.length) {
        md += '**Not to be confused with:**\n';
        for (const c of t.confused) {
          md += `- **${c.term}**: ${c.desc}\n`;
        }
        md += '\n';
      }
      md += '---\n\n';
    }
  }

  md += '## Mandatory Agent Protocol & Synchronization Directives\n\n';
  md += 'All LLM coding agents interacting with this repository MUST comply with the following invariants:\n\n';
  md += '1. **Pre-Planning Reading Mandate**: Always read `docs/UBIQUITOUS_LANGUAGE.md` (or `.afwe/docs/UBIQUITOUS_LANGUAGE.md`) during Phase 0 to ensure plans, terminology, and intent statements use canonical domain terms rather than generic software development clichés.\n';
  md += '2. **Explicit Declaration for Removals**: AFWE adheres strictly to the **Rust for Project Intent** philosophy. If a capability, export, or component is deprecated or removed, it MUST be declared in `turn assume` under `removes: [...]` or with `action: remove / replace`. Regressions fail the gate unconditionally.\n';
  md += '3. **Post-Turn Synchronization**: Whenever code changes introduce a new architectural concept, rename a domain primitive, or modify domain boundaries:\n';
  md += '   - Create or update the corresponding term in `.afwe/memory/terminology/term-<name>.md`.\n';
  md += '   - Update `docs/UBIQUITOUS_LANGUAGE.md` and `.afwe/docs/UBIQUITOUS_LANGUAGE.md`.\n';
  md += '   - Re-generate the interactive HTML and documentation files by running `afwe memory sync-terms` (or `node scripts/sync-ubiquitous-language.js`).\n';
  md += '   - Ensure `AGENTS.md` and `.afwe/skills/afwe/SKILL.md` remain synchronized.\n';

  return md;
}

function generateHtml(terms) {
  let html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AFWE Ubiquitous Language Dictionary · Canonical Domain Terminology</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
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
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="badge">⛨ AFWE ReBorn · Domain-Driven Design</span>
      <h1>Ubiquitous Language Dictionary</h1>
      <p class="subtitle">The unambiguous canonical vocabulary governing AFWE-Core, AFWE-Client, automated coding agents, and architecture verification gates.</p>
    </header>

    <div class="controls">
      <div class="search-box">
        <input type="text" id="search" class="search-input" placeholder="Search terms, definitions, invariants, or confused-with concepts... (e.g. Turn, Ratchet, CAS)" autofocus />
        <div class="term-count"><span id="visible-count">${terms.length}</span> / ${terms.length} terms</div>
      </div>
      <div class="categories">
        <button class="cat-btn active" data-cat="all">All Categories</button>
`;

  const categories = {};
  for (const t of terms) {
    categories[t.category] = (categories[t.category] || 0) + 1;
  }

  for (const [cat, count] of Object.entries(categories)) {
    html += `        <button class="cat-btn" data-cat="${cat}">${cat} (${count})</button>\n`;
  }

  html += `      </div>
    </div>

    <div class="grid" id="terms-grid">
`;

  for (const t of terms) {
    const anchor = t.title.toLowerCase().replace(/[\s()/:&]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    html += `      <article class="card" id="${anchor}" data-category="${t.category}" data-title="${t.title.toLowerCase()}" data-tags="${t.tags.join(' ')}">
        <div class="card-header">
          <h2 class="card-title">${t.title}</h2>
          <span class="card-category">${t.category}</span>
        </div>
        <p class="card-meaning">${t.meaning.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
`;
    if (t.confused.length) {
      html += `        <div class="confused-box">
          <div class="confused-title">Not to be confused with:</div>
`;
      for (const c of t.confused) {
        html += `          <div class="confused-item"><strong>${c.term}</strong>: ${c.desc.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>\n`;
      }
      html += `        </div>\n`;
    }

    html += `        <div class="card-footer">
          <span><code>${t.id}</code></span>
          <button class="copy-btn" onclick="copyAnchor('${anchor}')" title="Copy permalink">🔗 permalink</button>
        </div>
      </article>
`;
  }

  html += `    </div>
  </div>

  <script>
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
      const url = \`\${window.location.origin}\${window.location.pathname}#\${id}\`;
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
`;

  return html;
}

function sync() {
  console.log('Syncing AFWE Ubiquitous Language...');
  const terms = loadTerms();
  console.log(`Loaded ${terms.length} terms across .afwe/memory/terminology/`);

  const md = generateMarkdown(terms);
  const html = generateHtml(terms);

  // Write to docs/
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOCS_DIR, 'UBIQUITOUS_LANGUAGE.md'), md, 'utf8');
  fs.writeFileSync(path.join(DOCS_DIR, 'UBIQUITOUS_LANGUAGE.html'), html, 'utf8');
  console.log('✓ Written docs/UBIQUITOUS_LANGUAGE.md');
  console.log('✓ Written docs/UBIQUITOUS_LANGUAGE.html');

  // Write to .afwe/docs/
  if (!fs.existsSync(AFWE_DOCS_DIR)) fs.mkdirSync(AFWE_DOCS_DIR, { recursive: true });
  fs.writeFileSync(path.join(AFWE_DOCS_DIR, 'UBIQUITOUS_LANGUAGE.md'), md, 'utf8');
  fs.writeFileSync(path.join(AFWE_DOCS_DIR, 'UBIQUITOUS_LANGUAGE.html'), html, 'utf8');
  console.log('✓ Written .afwe/docs/UBIQUITOUS_LANGUAGE.md');
  console.log('✓ Written .afwe/docs/UBIQUITOUS_LANGUAGE.html');

  // Write to apps/website/public/docs/ if apps/website exists
  const WEBSITE_PUBLIC_DOCS = path.join(ROOT, 'apps', 'website', 'public', 'docs');
  if (fs.existsSync(path.join(ROOT, 'apps', 'website'))) {
    if (!fs.existsSync(WEBSITE_PUBLIC_DOCS)) fs.mkdirSync(WEBSITE_PUBLIC_DOCS, { recursive: true });
    fs.writeFileSync(path.join(WEBSITE_PUBLIC_DOCS, 'UBIQUITOUS_LANGUAGE.md'), md, 'utf8');
    fs.writeFileSync(path.join(WEBSITE_PUBLIC_DOCS, 'UBIQUITOUS_LANGUAGE.html'), html, 'utf8');
    console.log('✓ Written apps/website/public/docs/UBIQUITOUS_LANGUAGE.html');
  }

  console.log('Done! All Ubiquitous Language targets synchronized.');
}

if (require.main === module) {
  sync();
}

module.exports = { sync, loadTerms, generateMarkdown, generateHtml };
