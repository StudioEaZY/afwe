//! The `.afwe/` data model.
//!
//! Everything in this file is serialisable to the human‑readable files that live
//! inside `.afwe/`. The folder is the product; these types are just its shape.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const FORMAT_VERSION: &str = "afwe/3";

fn is_false(b: &bool) -> bool {
    !*b
}
fn default_true() -> bool {
    true
}

// ───────────────────────────── manifest ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default = "default_format")]
    pub format: String,
    pub project: ProjectMeta,
    #[serde(default)]
    pub analyzer: AnalyzerConfig,
    #[serde(default)]
    pub policy: Policy,
    #[serde(default)]
    pub provenance: ProvenanceConfig,
    #[serde(default)]
    pub vcs: VcsConfig,
    /// Onboarding profile the project was set up with (normie | engineer | custom).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
}

fn default_format() -> String {
    FORMAT_VERSION.to_string()
}

impl Default for Manifest {
    fn default() -> Self {
        Self {
            format: default_format(),
            project: ProjectMeta::default(),
            analyzer: AnalyzerConfig::default(),
            policy: Policy::default(),
            provenance: ProvenanceConfig::default(),
            vcs: VcsConfig::default(),
            profile: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectMeta {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Root of the code relative to the directory containing `.afwe/`.
    #[serde(default = "default_root")]
    pub root: String,
}
fn default_root() -> String {
    ".".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzerConfig {
    /// Extra include globs (relative to project root). Empty = everything.
    #[serde(default)]
    pub include: Vec<String>,
    /// Ignore globs in addition to `.gitignore`.
    #[serde(default = "default_ignore")]
    pub ignore: Vec<String>,
    #[serde(default = "default_max_kb")]
    pub max_file_size_kb: u64,
    /// Restrict to these language ids (empty = all supported).
    #[serde(default)]
    pub languages: Vec<String>,
}
fn default_ignore() -> Vec<String> {
    vec![
        ".afwe/**".into(),
        "node_modules/**".into(),
        "target/**".into(),
        "dist/**".into(),
        "build/**".into(),
        ".git/**".into(),
        "**/*.min.js".into(),
        "**/*.lock".into(),
    ]
}
fn default_max_kb() -> u64 {
    512
}
impl Default for AnalyzerConfig {
    fn default() -> Self {
        Self {
            include: vec![],
            ignore: default_ignore(),
            max_file_size_kb: default_max_kb(),
            languages: vec![],
        }
    }
}

/// Confidence policy used by reconciliation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    /// >= this: auto reconcile, log, no review.
    #[serde(default = "d_auto")]
    pub auto_reconcile_min: f64,
    /// >= this (and < auto): reconcile when no contradiction, mark uncertain.
    #[serde(default = "d_soft")]
    pub soft_reconcile_min: f64,
    /// Below soft: never touch architecture silently, create proposals.
    #[serde(default = "default_true")]
    pub create_proposals: bool,
    /// Treat constraint violations as errors in `verify` (exit code 1).
    #[serde(default = "default_true")]
    pub fail_on_violation: bool,
    /// Pin budget slider (1 relaxed .. 5 strict). Scales the codebase-derived pin limit.
    #[serde(default)]
    pub pins: PinPolicy,
    /// Generate standing checks from confirmed assumptions (the default `checkgen` app).
    #[serde(default = "default_true")]
    pub checkgen: bool,
    /// Evidence-based probing and graduation policy (85%..90% -> >=90%).
    #[serde(default)]
    pub graduation: GraduationPolicy,
    /// Explore mode (`afwe unlock` / `afwe lock`): temporarily converts blocking checks into warnings while prototyping.
    #[serde(default, skip_serializing_if = "is_false")]
    pub explore_mode: bool,
}
fn d_auto() -> f64 {
    0.70
}
fn d_soft() -> f64 {
    0.50
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            auto_reconcile_min: d_auto(),
            soft_reconcile_min: d_soft(),
            create_proposals: true,
            fail_on_violation: true,
            pins: PinPolicy::default(),
            checkgen: true,
            graduation: GraduationPolicy::default(),
            explore_mode: false,
        }
    }
}

/// Graduation policy for probing guides (85%..90%) transitioning to blocking checks (>=90%).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraduationPolicy {
    /// Option A (default true): independent evidence moves a guide to `ready_to_graduate`,
    /// requiring one human confirmation (`afwe guide confirm <id>`) to become blocking.
    /// Option B (false): fully automatic graduation when evidence criteria are met.
    #[serde(default = "default_true")]
    pub require_human: bool,
    /// Minimum distinct sessions with qualifying AST-symbol probes (default 3).
    #[serde(default = "default_min_probe_sessions")]
    pub min_probe_sessions: usize,
    /// Require at least one hold-out probe where the guide was omitted from `turn.begin` (default true).
    #[serde(default = "default_true")]
    pub require_hold_out: bool,
}
fn default_min_probe_sessions() -> usize {
    3
}
impl Default for GraduationPolicy {
    fn default() -> Self {
        Self {
            require_human: true,
            min_probe_sessions: 3,
            require_hold_out: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinPolicy {
    /// 1 (relaxed) .. 5 (strict). 3 = balanced. Multiplies the codebase-derived pin limit.
    #[serde(default = "default_slider")]
    pub slider: u8,
}
fn default_slider() -> u8 {
    3
}
impl Default for PinPolicy {
    fn default() -> Self {
        Self { slider: 3 }
    }
}

/// How turns reach version control.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VcsConfig {
    /// git | none
    #[serde(default = "default_vcs_provider")]
    pub provider: String,
    /// true: a passing turn is committed by AFWE. false (engineer manual mode): the turn ends `ready`
    /// and the engineer commits with plain git (keeping the `AFWE-Turn:` trailer).
    #[serde(default = "default_true")]
    pub auto_commit: bool,
    /// Optional deterministic project check (exit code) run on every turn, e.g. `cargo test`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_command: Option<String>,
}
fn default_vcs_provider() -> String {
    "git".into()
}
impl Default for VcsConfig {
    fn default() -> Self {
        Self { provider: default_vcs_provider(), auto_commit: true, test_command: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvenanceConfig {
    /// Keep original prompts inside workflows (default true).
    #[serde(default = "default_true")]
    pub retain_prompts: bool,
}
impl Default for ProvenanceConfig {
    fn default() -> Self {
        Self { retain_prompts: true }
    }
}

// ───────────────────────────── blueprint ─────────────────────────────

/// Implementation mapping: how a blueprint node is realised in code.
/// Identity is `path + symbol + structural identity + fingerprint`, never line numbers.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Implementation {
    /// Files or globs relative to the project root.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    /// Symbol refs: `path/to/file.ts::Class.method`
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub symbols: Vec<String>,
}
impl Implementation {
    pub fn is_empty(&self) -> bool {
        self.files.is_empty() && self.symbols.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintNode {
    /// Stable slug id, unique across the blueprint. Never derived from position.
    pub id: String,
    pub name: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    /// "Why does it exist?"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    /// "What is this?"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Implementation::is_empty")]
    pub implements: Implementation,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// planned | active | deprecated
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// human | llm:<name> | afwe:inferred
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<BlueprintNode>,
}
fn default_kind() -> String {
    "module".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Blueprint {
    #[serde(default)]
    pub nodes: Vec<BlueprintNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub from: String,
    pub to: String,
    /// depends_on | uses | calls | reads | writes | emits | extends | implements
    #[serde(default = "default_rel_kind")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    /// declared | inferred | proposed
    #[serde(default = "default_declared")]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}
fn default_rel_kind() -> String {
    "depends_on".into()
}
fn default_declared() -> String {
    "declared".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Relations {
    #[serde(default)]
    pub relations: Vec<Relation>,
}

/// Machine‑checkable structural rule (part of the blueprint).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constraint {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// must_not_depend | may_depend_only
    pub rule: String,
    pub from: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub to: Vec<String>,
    /// For may_depend_only: the allow‑list. For must_not_depend: exempt nodes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub except: Vec<String>,
    /// error | warn
    #[serde(default = "default_error")]
    pub severity: String,
    /// active | planned (forward-looking constraint, informative only until active)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    /// Memory entries that explain this rule.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub memory: Vec<String>,
}
fn default_error() -> String {
    "error".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Constraints {
    #[serde(default)]
    pub constraints: Vec<Constraint>,
}

// ───────────────────────────── memory ─────────────────────────────

pub const MEMORY_KINDS: &[&str] = &["decisions", "constraints", "exceptions", "terminology", "problems"];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemoryMeta {
    pub id: String,
    /// decision | constraint | exception | terminology | problem
    pub kind: String,
    pub title: String,
    /// proposed | accepted | superseded | resolved | open
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Blueprint node refs (id, path or unique name).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub applies_to: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub symbols: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<String>,
    /// Structural constraint ids this entry explains/enforces.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enforces: Vec<String>,
    /// Workflow this knowledge came out of.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    #[serde(flatten)]
    pub meta: MemoryMeta,
    /// Markdown body (the actual knowledge).
    pub body: String,
    /// Path relative to `.afwe/`.
    pub path: String,
}

// ───────────────────────────── guardrails ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Scope {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<String>,
    /// Relation ids or "from->to"
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relations: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lenses: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Whole project.
    #[serde(default, skip_serializing_if = "is_false")]
    pub global: bool,
}
impl Scope {
    pub fn is_empty(&self) -> bool {
        *self == Scope::default()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Check {
    /// command | forbid_import | forbid_pattern | require_file | require_pattern
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<String>,
    /// always | files_changed_in_scope
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub to_nodes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Guardrail {
    pub id: String,
    /// passive | active
    pub mode: String,
    pub statement: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Scope::is_empty")]
    pub scope: Scope,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exceptions: Vec<String>,
    /// Scope where the exceptions apply (e.g. realtime widgets).
    #[serde(default, skip_serializing_if = "Scope::is_empty")]
    pub exception_scope: Scope,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub memory: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checks: Vec<Check>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
}

// ───────────────────────────── workflows ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNode {
    pub id: String,
    /// intent | prompt | design | step | component | decision | question | output | note
    #[serde(default = "default_step")]
    pub kind: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default)]
    pub position: Position,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<String>,
    /// Where this design element landed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maps_to: Option<WorkflowMapping>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
}
fn default_step() -> String {
    "step".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkflowMapping {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub symbols: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub memory: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEdge {
    pub from: String,
    pub to: String,
    /// then | refines | depends | produces | answers
    #[serde(default = "default_then")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}
fn default_then() -> String {
    "then".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// draft | in_progress | implemented | archived
    #[serde(default = "default_draft")]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    /// Blueprint nodes this workflow targets / produced.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<String>,
    #[serde(default)]
    pub nodes: Vec<WorkflowNode>,
    #[serde(default)]
    pub edges: Vec<WorkflowEdge>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    /// Task id this workflow was authored for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
}
fn default_draft() -> String {
    "draft".into()
}

// ───────────────────────────── lenses (custom abstractions) ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LensGroup {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Blueprint node refs shown under this group (whole subtrees).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workflows: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<LensGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lens {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub groups: Vec<LensGroup>,
    /// Node refs hidden in this lens.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hide: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

// ───────────────────────────── contracts & board ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractStep {
    pub id: String,
    /// before | during | after
    pub phase: String,
    /// afwe_context | harness | afwe_workflow | afwe_blueprint | afwe_verify | afwe_update | afwe_log | afwe_sync
    pub action: String,
    pub instruction: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contract {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Task kinds this contract applies to (code, bugfix, refactor, architecture, workflow, feature ...)
    #[serde(default)]
    pub task_kinds: Vec<String>,
    #[serde(default)]
    pub steps: Vec<ContractStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub contract: String,
    /// open | done | abandoned
    pub status: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow: Option<String>,
    pub created: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardItem {
    pub id: String,
    /// contract_step | proposal | drift | sync | uncertain | memory
    pub kind: String,
    pub title: String,
    /// open | done | dismissed
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    pub created: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Board {
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub items: Vec<BoardItem>,
}

// ───────────────────────────── log ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub ts: String,
    /// human | llm:<name> | afwe:reconcile | afwe:sync | afwe:cli
    pub origin: String,
    pub kind: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub uncertain: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

// ───────────────────────────── code model (derived) ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SymbolInfo {
    /// `file::Qualified.Name`
    pub id: String,
    pub file: String,
    pub name: String,
    pub qualified: String,
    /// function | class | method | struct | enum | interface | trait | impl | type | const | module
    pub kind: String,
    /// Structural identity: `class:Foo/method:bar`
    pub structural: String,
    /// Content fingerprint of the normalised symbol text.
    pub fingerprint: String,
    pub start_line: usize,
    pub end_line: usize,
    #[serde(default, skip_serializing_if = "is_false")]
    pub exported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FileInfo {
    pub path: String,
    pub language: String,
    pub hash: String,
    pub size: u64,
    pub lines: usize,
    #[serde(default)]
    pub symbols: Vec<SymbolInfo>,
    /// Raw import specifiers as written.
    #[serde(default)]
    pub imports: Vec<String>,
    /// Imports resolved to project files.
    #[serde(default)]
    pub resolved_imports: Vec<String>,
    /// Imports that point outside the project (packages).
    #[serde(default)]
    pub externals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CodeModel {
    pub files: Vec<FileInfo>,
    pub fingerprint: String,
    pub languages: BTreeMap<String, usize>,
}

// ───────────────────────────── index (derived) ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FileIndexEntry {
    pub language: String,
    pub hash: String,
    /// Primary (most specific) node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    /// All nodes claiming this file (including primary).
    #[serde(default)]
    pub nodes: Vec<String>,
    #[serde(default)]
    pub symbols: Vec<String>,
    #[serde(default)]
    pub imports: Vec<String>,
    #[serde(default)]
    pub externals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemoryIndexEntry {
    pub kind: String,
    pub title: String,
    pub path: String,
    #[serde(default)]
    pub nodes: Vec<String>,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub symbols: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodeIndexEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub depth: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub symbols: Vec<String>,
    #[serde(default)]
    pub memory: Vec<String>,
    #[serde(default)]
    pub guardrails: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Index {
    pub generated: String,
    pub files: BTreeMap<String, FileIndexEntry>,
    pub symbols: BTreeMap<String, SymbolInfo>,
    pub memory: BTreeMap<String, MemoryIndexEntry>,
    pub nodes: BTreeMap<String, NodeIndexEntry>,
    /// node -> node -> count of import edges
    pub node_edges: BTreeMap<String, BTreeMap<String, usize>>,
}

// ───────────────────────────── drift & proposals ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Change {
    MapFile { node: String, file: String },
    RemapFile { node: String, from: String, to: String },
    UnmapFile { node: String, file: String },
    RemapSymbol { node: String, from: String, to: String },
    UnmapSymbol { node: String, symbol: String },
    AddRelation { from: String, to: String, kind: String },
    RemoveRelation { from: String, to: String },
    CreateNode { parent: Option<String>, name: String, files: Vec<String> },
    Note { text: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub id: String,
    /// unmapped_file | missing_file | missing_symbol | undeclared_relation | unsupported_relation |
    /// constraint_violation | empty_node | stale_memory | broken_reference
    pub kind: String,
    /// error | warn | info
    pub severity: String,
    pub confidence: f64,
    pub summary: String,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change: Option<Change>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DriftReport {
    pub generated: String,
    pub findings: Vec<Finding>,
    #[serde(default)]
    pub applied: Vec<Finding>,
    #[serde(default)]
    pub proposed: Vec<Finding>,
    #[serde(default)]
    pub uncertain: Vec<Finding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proposal {
    pub id: String,
    pub created: String,
    pub finding: Finding,
    /// pending | accepted | reverted
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Proposals {
    #[serde(default)]
    pub proposals: Vec<Proposal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync: Option<String>,
    #[serde(default)]
    pub code_fingerprint: String,
    #[serde(default)]
    pub afwe_fingerprint: String,
    #[serde(default)]
    pub engine_version: String,
    #[serde(default)]
    pub files_analyzed: usize,
}

// ───────────────────────────── verify ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyIssue {
    /// error | warn | info
    pub severity: String,
    /// constraint | guardrail | drift | integrity
    pub source: String,
    pub id: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VerifyReport {
    pub ok: bool,
    pub errors: usize,
    pub warnings: usize,
    pub issues: Vec<VerifyIssue>,
    #[serde(default)]
    pub checked_files: Vec<String>,
    #[serde(default)]
    pub ran_checks: Vec<String>,
}

// ───────────────────────────── v2: attachments ─────────────────────────────

/// What a record is anchored to. Nodes are the primary anchor (they survive refactors); files and
/// symbols are used when no node applies yet. Never line numbers.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Attachment {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub symbols: Vec<String>,
    /// Whole project.
    #[serde(default, skip_serializing_if = "is_false")]
    pub global: bool,
}
impl Attachment {
    pub fn is_empty(&self) -> bool {
        *self == Attachment::default()
    }
}

// ───────────────────────────── v2: intents (living, DAG) ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntentRevision {
    pub turn: String,
    pub ts: String,
    pub statement: String,
    /// Agent or human rationale (context only; never gates commits).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
}

/// Optional node-based design graph (the former `workflows/` documents live here).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntentGraph {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub nodes: Vec<WorkflowNode>,
    #[serde(default)]
    pub edges: Vec<WorkflowEdge>,
}

/// A stable "what is wanted" record. It is a *view* merged from raw prompts (turns): the statement
/// can be rewritten, the originals never are. Pins are the only human-locked part.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Intent {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statement: Option<String>,
    /// active | paused | superseded | archived | orphaned | draft | in_progress | implemented
    #[serde(default = "default_active")]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Attachment::is_empty")]
    pub attaches: Attachment,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parents: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub from_turns: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<IntentRevision>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pins: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graph: Option<IntentGraph>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
}
fn default_active() -> String {
    "active".into()
}

// ───────────────────────────── v2: pins (human-locked decisions) ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pin {
    pub id: String,
    pub statement: String,
    /// decision | intentional | constraint | preference
    #[serde(default = "default_decision")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Attachment::is_empty")]
    pub attaches: Attachment,
    /// block (commit refused) | confirm (staged until a human confirms) | warn (reported)
    #[serde(default = "default_confirm")]
    pub severity: String,
    /// proposed | active | retired
    pub status: String,
    pub origin: String,
    pub created: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retired: Option<String>,
    /// A deliberate bug/quirk: "fix all bugs" must not touch it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub intentional: bool,
}
fn default_decision() -> String {
    "decision".into()
}
fn default_confirm() -> String {
    "confirm".into()
}

// ───────────────────────────── v2: checks (the gate's registry) ─────────────────────────────

/// How strong a pass is. Ordered weakest → strongest.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Default)]
#[serde(rename_all = "snake_case")]
pub enum CheckTrust {
    /// Nothing verified this turn.
    #[default]
    Unverified,
    /// Judged by a model (adversarial pair, reviewer). Advisory: never blocks alone.
    LlmJudged,
    /// Tests written by an agent or a generator. Blocks when failing.
    Generated,
    /// Parser/AST/regex/exit-code checks. Blocks when failing.
    Deterministic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckSpec {
    pub id: String,
    pub title: String,
    pub trust: CheckTrust,
    /// human | agent | checkgen | app:<name>
    pub authored_by: String,
    #[serde(default, skip_serializing_if = "Attachment::is_empty")]
    pub attaches: Attachment,
    /// Shell command, exit 0 = pass, run from the project root. Gets AFWE_CHANGED_FILES.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// Or a declarative claim (what checkgen produces from confirmed assumptions).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<AssumptionClaim>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_s: Option<u64>,
    /// active | retired | superseded
    #[serde(default = "default_active")]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_from: Option<String>,
    /// Turn or check id that superseded this check when its target was removed/replaced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub superseded_by: Option<String>,
    /// inferred | confirmed | graduated
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
}

// ───────────────────────────── v2: turns (append-only ledger) ─────────────────────────────

/// A declarative, tree-sitter / regex checkable statement an agent makes before writing code.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct AssumptionClaim {
    /// forbid_pattern | require_pattern | forbid_import | symbol_exists | require_file | forbid_symbol | export_exists | symbol_signature
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub to_nodes: Vec<String>,
    /// When false (default), comments are blanked before evaluating pattern claims.
    #[serde(default, skip_serializing_if = "is_false")]
    pub include_comments: bool,
}

impl Check {
    pub fn to_claim(&self) -> AssumptionClaim {
        let mut files = self.files.clone();
        if let Some(p) = &self.path {
            if !files.contains(p) {
                files.push(p.clone());
            }
        }
        AssumptionClaim {
            kind: self.kind.clone(),
            pattern: self.pattern.clone(),
            symbol: None,
            files,
            to_nodes: self.to_nodes.clone(),
            include_comments: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Assumption {
    pub id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<AssumptionClaim>,
    /// proposed | confirmed | failed
    #[serde(default)]
    pub status: String,
    /// Model-stated confidence (stored as metadata only; never used directly as the rubric score).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    /// Deterministic rubric score computed by `calibration.rs`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub computed_score: Option<f64>,
}

/// A decomposed piece of a prompt: what the turn intends to do to which nodes.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TurnIntent {
    pub id: String,
    /// create | update | refine | remove | rename | move | replace | keep
    pub action: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statement: Option<String>,
    /// Agent's stated reasoning (context only; never gates commits).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
}

/// An explicit, reasoned exception to a pin.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PinOverride {
    pub pin: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TurnScope {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TurnTouched {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub symbols: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct FileClaim {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_blob: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    #[serde(default)]
    pub claimed_at: String,
}

impl FileClaim {
    pub fn new(path: impl Into<String>, base_blob: Option<String>, node: Option<String>) -> Self {
        Self {
            path: path.into(),
            base_blob,
            node,
            claimed_at: crate::util::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CheckResult {
    pub id: String,
    pub title: String,
    pub trust: CheckTrust,
    pub authored_by: String,
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Does a failure stop the commit?
    #[serde(default)]
    pub blocking: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ran_against: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strength: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl CheckResult {
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        trust: CheckTrust,
        authored_by: impl Into<String>,
        passed: bool,
        message: Option<String>,
        blocking: bool,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            trust,
            authored_by: authored_by.into(),
            passed,
            message,
            blocking,
            ran_against: None,
            strength: None,
            note: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GateRecord {
    /// commit | stage | redo | ready | empty
    #[serde(default)]
    pub decision: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RestoreRecord {
    pub feature: String,
    pub from_turn: String,
    pub lost_turn: String,
    #[serde(default)]
    pub conflicts: usize,
}

/// One prompt = one turn. The prompt is stored verbatim and never edited afterwards.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Turn {
    pub id: String,
    #[serde(default)]
    pub turn_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(default)]
    pub epoch_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_hash: Option<String>,
    #[serde(default)]
    pub token_hash: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub claims: Vec<FileClaim>,
    #[serde(default)]
    pub base_head: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub child_commits: Vec<String>,
    #[serde(default)]
    pub last_activity: String,
    pub ts: String,
    #[serde(default)]
    pub origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub prompt_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refines: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<String>,
    #[serde(default)]
    pub scope: TurnScope,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub intents: Vec<TurnIntent>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assumptions: Vec<Assumption>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overrides: Vec<PinOverride>,
    /// open | staged | ready | committed | reverted | folded | abandoned
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub touched: TurnTouched,
    /// node -> files realising it right after this turn (basis for restore and loss search)
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub implements: BTreeMap<String, Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checks: Vec<CheckResult>,
    #[serde(default)]
    pub strength: CheckTrust,
    #[serde(default)]
    pub confidence: f64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub confidence_parts: BTreeMap<String, f64>,
    #[serde(default)]
    pub gate: GateRecord,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folded: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folded_into: Option<String>,
    #[serde(default)]
    pub footer_shown: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub committed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restore: Option<RestoreRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pin_proposals: Vec<String>,
    /// Cryptographic blake3 token issued at turn.begin to prevent out-of-band cheating / tampering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_token: Option<String>,
    /// Associated mission id when executed as part of an autonomous mission
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mission: Option<String>,
    /// Post-commit hashes of touched files, used for automated rollback / external undo reconciliation.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub post_hashes: BTreeMap<String, String>,
    /// Distinct session or thread identifier (from harness `thread_id` or derived from agent + 30m activity gap).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Optional provenance link to external systems (e.g. DeltaDB thread, Claude session).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_provenance: Option<ExternalProvenance>,
    /// Standing check IDs generated by `checkgen` on this turn.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checkgen: Vec<String>,
    /// Guide IDs intentionally held out from `turn.begin` on this turn to test independent compliance.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub held_out_guides: Vec<String>,
    /// Silent local/leaf rationales recorded below 0.85 without interrupting the developer.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agent_zone_rationales: Vec<String>,
}

/// Optional provenance metadata linking a turn to an external conversational workspace.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ExternalProvenance {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_uri: Option<String>,
}

// ───────────────────────────── ReBorn: calibration, probing guides & ask queue ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ProbeRecord {
    pub turn: String,
    pub session_id: String,
    pub symbol: String,
    #[serde(default)]
    pub held_out: bool,
}

fn default_inferred() -> String {
    "inferred".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GuideState {
    pub id: String,
    pub title: String,
    /// probing | ready_to_graduate | graduated | demoted | retired
    pub status: String,
    pub score: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_reported_confidence: Option<f64>,
    pub claim: AssumptionClaim,
    #[serde(default, skip_serializing_if = "Attachment::is_empty")]
    pub attaches: Attachment,
    #[serde(default)]
    pub probes: Vec<ProbeRecord>,
    #[serde(default)]
    pub contradictions: usize,
    /// inferred | confirmed | graduated
    #[serde(default = "default_inferred")]
    pub provenance: String,
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub created: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graduated_check_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmed_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AmbiguityQuestion {
    pub id: String,
    pub turn: String,
    pub session_id: String,
    pub question: String,
    pub why_asking: String,
    /// exported_symbol | cross_subsystem | contradicts_history
    #[serde(default)]
    pub blast_reasons: Vec<String>,
    pub blast_score: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposed_claim: Option<AssumptionClaim>,
    #[serde(default, skip_serializing_if = "Attachment::is_empty")]
    pub attaches: Attachment,
    /// open | deferred | answered | dismissed
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    pub created: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCalibrationProfile {
    pub model_id: String,
    #[serde(default)]
    pub human_accepted: usize,
    #[serde(default)]
    pub human_rejected: usize,
    #[serde(default = "default_trust_factor")]
    pub trust_factor: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}
fn default_trust_factor() -> f64 {
    1.0
}
impl Default for ModelCalibrationProfile {
    fn default() -> Self {
        Self {
            model_id: "default".into(),
            human_accepted: 0,
            human_rejected: 0,
            trust_factor: 1.0,
            updated_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CalibrationStore {
    #[serde(default)]
    pub models: BTreeMap<String, ModelCalibrationProfile>,
    #[serde(default)]
    pub guides: Vec<GuideState>,
    #[serde(default)]
    pub questions: Vec<AmbiguityQuestion>,
}

/// Derived (rebuildable) snapshot taken at turn.begin, used to attribute changes at commit time.
/// Lives in index/baselines/ and is never committed.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Baseline {
    #[serde(default)]
    pub head: Option<String>,
    /// project-relative path -> content hash (code files and .afwe sources)
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    /// symbol id -> fingerprint
    #[serde(default)]
    pub symbols: BTreeMap<String, String>,
    /// node -> files that realised it at begin
    #[serde(default)]
    pub implements: BTreeMap<String, Vec<String>>,
    /// Guard fingerprints at begin (pins, checks, constraints) for anti-tamper detection
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub guards: BTreeMap<String, String>,
    /// Number of incoming imports per code-relative file at begin (used for newly-orphaned module detection)
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub importer_counts: BTreeMap<String, usize>,
    /// Exported symbol signatures per file at begin (used for intra-file dropped capability detection)
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub exported_symbols: BTreeMap<String, Vec<String>>,
    /// Inbound reference counts per exported symbol at begin (qualified id -> reference count)
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub symbol_inbound: BTreeMap<String, usize>,
}
