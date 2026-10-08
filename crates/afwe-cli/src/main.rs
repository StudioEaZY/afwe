//! `afwe` — command line for the Architecture-First Workspace Engine.
//! Also hosts the MCP server (`afwe mcp`) and the web studio (`afwe studio`).

mod mcp;
mod render;
mod studio;

use afwe_core::api;
use afwe_core::engine::Engine;
use anyhow::{anyhow, Result};
use clap::{Args, Parser, Subcommand};
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "afwe", version, about = "AFWE — Architecture-First Workspace Engine. The folder is the product; this is the machine that reads and writes it.")]
struct Cli {
    /// Project directory (defaults to the current directory; `.afwe/` is discovered upwards)
    #[arg(short = 'C', long = "dir", global = true)]
    dir: Option<PathBuf>,
    /// Who is making this change: human | llm:<name> (recorded in the log)
    #[arg(long, global = true, default_value = "human")]
    origin: String,
    /// Machine readable output
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create an empty `.afwe/` for this project (as empty as the codebase it starts with)
    Init {
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        description: Option<String>,
        /// Code root relative to the project dir
        #[arg(long)]
        root: Option<String>,
        #[arg(long)]
        force: bool,
        /// Also append the AFWE contract block to AGENTS.md (and CLAUDE.md if present)
        #[arg(long)]
        agents_md: bool,
    },
    /// Propose an initial blueprint from the directory structure of an existing codebase
    Bootstrap {
        #[arg(long, default_value_t = 2)]
        depth: usize,
        /// Write it (default: preview only)
        #[arg(long)]
        apply: bool,
    },
    /// Project summary and sync status
    Status,
    /// Analyse code, rebuild index, detect drift and reconcile by confidence
    Sync {
        /// Detect and report only
        #[arg(long)]
        dry_run: bool,
        /// Exit 1 if the graph is out of sync with the files (CI)
        #[arg(long)]
        check: bool,
    },
    /// Micro-context for files / a symbol / a node (passive guardrail)
    Context {
        files: Vec<String>,
        #[arg(long)]
        symbol: Option<String>,
        #[arg(long)]
        node: Option<String>,
        #[arg(long)]
        task: Option<String>,
        /// code | bugfix | refactor | architecture | feature | workflow
        #[arg(long, default_value = "code")]
        kind: String,
        /// Full memory bodies
        #[arg(long)]
        full: bool,
    },
    /// Verify (changed) files against the blueprint (active guardrails)
    Verify {
        files: Vec<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        changed: Vec<String>,
        #[arg(long)]
        no_commands: bool,
        #[arg(long)]
        no_drift: bool,
        #[arg(long)]
        task: Option<String>,
    },
    /// Show blueprint/code disagreements with confidence (no changes applied)
    Drift { files: Vec<String> },
    /// Search nodes, memory, guardrails, workflows, files, symbols
    Search { q: String },
    /// Blueprint: deterministic architecture tree
    #[command(subcommand)]
    Blueprint(BlueprintCmd),
    /// Memory: decisions, constraints, exceptions, terminology, problems
    #[command(subcommand)]
    Memory(MemoryCmd),
    /// Guardrails: passive (context) and active (checks)
    #[command(subcommand)]
    Guardrail(GuardrailCmd),
    /// Node-based workflows: intent → design → implementation
    #[command(subcommand)]
    Workflow(WorkflowCmd),
    /// Custom abstractions (lenses)
    #[command(subcommand)]
    Lens(LensCmd),
    /// Contracts the harness follows
    #[command(subcommand)]
    Contract(ContractCmd),
    /// Tasks on the Board
    #[command(subcommand)]
    Task(TaskCmd),
    /// Board: open obligations, proposals, uncertainties
    Board {
        #[command(subcommand)]
        cmd: Option<BoardCmd>,
    },
    /// Proposals (<50% confidence changes waiting for you)
    Proposals {
        #[command(subcommand)]
        cmd: Option<ProposalCmd>,
    },
    /// Change log
    Log {
        #[arg(long, default_value_t = 30)]
        tail: usize,
        #[command(subcommand)]
        cmd: Option<LogCmd>,
    },
    /// Run the MCP server on stdio (for Claude Code, Codex, Cursor, …)
    Mcp {
        /// Default origin recorded for changes made through MCP
        #[arg(long)]
        origin_name: Option<String>,
    },
    /// Open the Studio (web mode) — the Tauri desktop app uses the same engine
    Studio {
        #[arg(long, default_value_t = 4242)]
        port: u16,
        #[arg(long)]
        no_open: bool,
        /// Serve a built frontend from this directory instead of the embedded one
        #[arg(long)]
        dist: Option<PathBuf>,
        /// Bind address
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
    },
    /// The turn protocol: begin → assume → commit. One prompt = one turn; AFWE gates every commit
    #[command(subcommand)]
    Turn(TurnCmd),
    /// Living intents: merged statements derived from the raw prompts, with history
    #[command(subcommand)]
    Intent(IntentCmd),
    /// Pins: human-locked decisions and intentional bugs, under a codebase-scaled budget
    #[command(subcommand)]
    Pin(PinCmd),
    /// The gate's registry of checks (who authored them, how strong they are)
    #[command(subcommand)]
    Check(CheckCmd),
    /// History by intent: committed turns (default), or show/diff/search/losses/restore
    Timeline {
        #[command(subcommand)]
        cmd: Option<TimelineCmd>,
        #[arg(long, default_value_t = 30)]
        limit: usize,
    },
    /// Whole-project gate: constraints, guardrails, registered checks, project tests. Exit 1 on failure
    Gate {
        /// Terse output for CI
        #[arg(long)]
        ci: bool,
    },
    /// Set the project up: stacks, profile, git, CI gate and agent contract (idempotent)
    Onboard {
        /// normie (AFWE commits passing turns) | engineer (manual commit mode, stricter pins)
        #[arg(long, default_value = "normie")]
        profile: String,
        /// Only report what would be configured
        #[arg(long)]
        check: bool,
        #[arg(long)]
        no_git: bool,
        #[arg(long)]
        no_baseline: bool,
        #[arg(long)]
        no_ci: bool,
        #[arg(long)]
        no_agents: bool,
        #[arg(long)]
        test_command: Option<String>,
    },
    /// Upgrade the .afwe/ folder to the current format (legacy workflows/ become intents/)
    Migrate,
    /// Raw engine call: `afwe call <op> '<json params>'` (see `afwe call ops`)
    Call { op: String, params: Option<String> },
}

#[derive(Subcommand)]
enum BlueprintCmd {
    /// Print the tree (or one node in detail)
    Show { node: Option<String> },
    Add {
        name: String,
        #[arg(long)]
        parent: Option<String>,
        #[arg(long)]
        kind: Option<String>,
        #[arg(long)]
        purpose: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        files: Vec<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        symbols: Vec<String>,
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        id: Option<String>,
    },
    /// Move a node under another parent (omit --to for root)
    Move {
        node: String,
        #[arg(long)]
        to: Option<String>,
    },
    Update {
        node: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        kind: Option<String>,
        #[arg(long)]
        purpose: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        status: Option<String>,
    },
    Remove { node: String },
    /// Map files/globs/symbols to a node
    Map {
        node: String,
        files: Vec<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        symbols: Vec<String>,
    },
    Unmap {
        node: String,
        files: Vec<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        symbols: Vec<String>,
    },
    /// Declare a relationship
    Relate {
        from: String,
        to: String,
        #[arg(long, default_value = "depends_on")]
        kind: String,
        #[arg(long)]
        why: Option<String>,
    },
    Unrelate { from: String, to: String },
    /// Add a structural rule
    Constrain {
        from: String,
        #[arg(long, value_name = "NODE", num_args = 1..)]
        must_not_depend: Vec<String>,
        #[arg(long, value_name = "NODE", num_args = 1..)]
        may_depend_only: Vec<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        except: Vec<String>,
        #[arg(long)]
        why: Option<String>,
        #[arg(long)]
        id: Option<String>,
        #[arg(long, default_value = "error")]
        severity: String,
        /// active | planned (forward-looking constraint)
        #[arg(long)]
        phase: Option<String>,
        /// Mark constraint as planned (forward-looking, non-blocking)
        #[arg(long)]
        planned: bool,
    },
    Unconstrain { id: String },
}

#[derive(Subcommand)]
enum MemoryCmd {
    List {
        #[arg(long)]
        kind: Option<String>,
        #[arg(long)]
        node: Option<String>,
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        q: Option<String>,
    },
    Show { id: String },
    /// afwe memory add decision "Title" --applies-to Dashboard --files 'src/dashboard/**' --tags perf --body-file note.md
    Add {
        kind: String,
        title: String,
        #[arg(long)]
        body: Option<String>,
        /// Read body from a file (`-` for stdin)
        #[arg(long)]
        body_file: Option<String>,
        #[arg(long)]
        id: Option<String>,
        #[arg(long = "applies-to", num_args = 1.., value_delimiter = ',')]
        applies_to: Vec<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        files: Vec<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        symbols: Vec<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        tags: Vec<String>,
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        supersedes: Option<String>,
        #[arg(long)]
        workflow: Option<String>,
    },
    Update {
        id: String,
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        body_file: Option<String>,
    },
    Remove { id: String },
}

#[derive(Subcommand)]
enum GuardrailCmd {
    List,
    /// Add a passive guardrail from flags, or any guardrail from a YAML/JSON file
    Add {
        /// YAML or JSON file describing the guardrail
        file: Option<PathBuf>,
        #[arg(long)]
        statement: Option<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        scope: Vec<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        exception: Vec<String>,
        #[arg(long = "exception-scope", num_args = 1.., value_delimiter = ',')]
        exception_scope: Vec<String>,
        #[arg(long)]
        reason: Option<String>,
        #[arg(long)]
        id: Option<String>,
        /// Add an active `command` check (use {files} for changed files in scope)
        #[arg(long)]
        run: Option<String>,
        /// Add an active `forbid_pattern` check
        #[arg(long)]
        forbid_pattern: Option<String>,
        /// Add an active `forbid_import` check into these nodes
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        forbid_import: Vec<String>,
    },
    Remove { id: String },
}

#[derive(Subcommand)]
enum WorkflowCmd {
    List,
    Show { id: String },
    New {
        title: String,
        #[arg(long)]
        id: Option<String>,
        #[arg(long)]
        description: Option<String>,
        /// The original prompt, kept verbatim as provenance
        #[arg(long)]
        prompt: Option<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        targets: Vec<String>,
        #[arg(long)]
        task: Option<String>,
    },
    AddNode {
        workflow: String,
        title: String,
        /// intent | prompt | design | step | component | decision | question | output | note
        #[arg(long, default_value = "step")]
        kind: String,
        #[arg(long)]
        text: Option<String>,
        #[arg(long)]
        after: Option<String>,
        #[arg(long)]
        id: Option<String>,
    },
    Link {
        workflow: String,
        from: String,
        to: String,
        #[arg(long, default_value = "then")]
        kind: String,
        #[arg(long)]
        remove: bool,
    },
    Set {
        workflow: String,
        #[arg(long)]
        node: Option<String>,
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        text: Option<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        targets: Vec<String>,
    },
    /// Turn component nodes into planned blueprint nodes
    Promote {
        workflow: String,
        #[arg(long)]
        parent: Option<String>,
    },
    Remove { id: String },
}

#[derive(Subcommand)]
enum LensCmd {
    List,
    Show { id: String },
    /// afwe lens create "Workspace Blueprint" --group "Library=workspace-library" --group "Search=workspace-search,search-index"
    Create {
        name: String,
        #[arg(long)]
        group: Vec<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        hide: Vec<String>,
        #[arg(long)]
        id: Option<String>,
    },
    Remove { id: String },
}

#[derive(Subcommand)]
enum ContractCmd {
    List,
    Show {
        #[arg(long, default_value = "code")]
        kind: String,
    },
    /// Render the AGENTS.md block (optionally write/update a file)
    Render {
        #[arg(long)]
        write: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum TaskCmd {
    Start {
        title: String,
        #[arg(long, default_value = "code")]
        kind: String,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        files: Vec<String>,
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        nodes: Vec<String>,
        #[arg(long)]
        workflow: Option<String>,
    },
    Done {
        task: Option<String>,
        #[arg(long)]
        message: Option<String>,
    },
    List,
}

#[derive(Subcommand, Debug)]
enum BoardCmd {
    /// Mark a system item (uncertain reconciliation, stale reference) as reviewed
    Dismiss { id: String },
}

#[derive(Subcommand)]
enum ProposalCmd {
    Accept { id: String },
    Revert { id: String },
    Review { id: String },
}

#[derive(Subcommand)]
enum LogCmd {
    Add {
        message: String,
        #[arg(long, default_value = "note")]
        kind: String,
        #[arg(long)]
        task: Option<String>,
    },
}

#[derive(Args)]
struct Empty {}

fn main() {
    let cli = Cli::parse();
    let code = match run(cli) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("afwe: {e:#}");
            2
        }
    };
    std::process::exit(code);
}

fn engine_for(dir: &Option<PathBuf>) -> Result<Engine> {
    let start = dir.clone().unwrap_or(std::env::current_dir()?);
    Engine::open(start)
}

fn out(json: bool, v: &Value, human: impl FnOnce(&Value) -> String) {
    use std::io::Write;
    let text = if json { serde_json::to_string_pretty(v).unwrap() } else { human(v) };
    // ignore EPIPE so `afwe … | head` does not panic
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    let _ = writeln!(lock, "{text}");
    let _ = lock.flush();
}

fn strs(v: &[String]) -> Value {
    json!(v.iter().flat_map(|s| s.split(',')).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect::<Vec<_>>())
}

fn read_body(body: Option<String>, body_file: Option<String>) -> Result<String> {
    if let Some(b) = body {
        return Ok(b);
    }
    match body_file.as_deref() {
        Some("-") => {
            let mut s = String::new();
            std::io::Read::read_to_string(&mut std::io::stdin(), &mut s)?;
            Ok(s)
        }
        Some(p) => Ok(std::fs::read_to_string(p)?),
        None => Ok(String::new()),
    }
}

fn run(cli: Cli) -> Result<i32> {
    let json = cli.json;
    let origin = cli.origin.clone();
    match cli.cmd {
        Cmd::Init { name, description, root, force, agents_md } => {
            let dir = cli.dir.clone().unwrap_or(std::env::current_dir()?);
            let store = afwe_core::init::init(&dir, afwe_core::init::InitOptions { name, description, root, force })?;
            println!("Initialised {}", store.afwe_dir.display());
            if agents_md {
                let engine = Engine { store: store.clone() };
                let r = api::call(&engine, "contract.render", json!({}), &origin)?;
                let block = r["markdown"].as_str().unwrap_or("").to_string();
                for f in ["AGENTS.md", "CLAUDE.md"] {
                    let p = dir.join(f);
                    if p.exists() || f == "AGENTS.md" {
                        write_agents_block(&p, &block)?;
                        println!("Updated {}", p.display());
                    }
                }
            }
            println!("\nNext steps:\n  afwe blueprint add \"Authentication\" --parent {} --files 'src/auth/**'\n  afwe sync\n  afwe studio\n  afwe contract render --write AGENTS.md   # tell your harness about the contract\n  afwe mcp                                  # or connect via MCP", store.blueprint()?.nodes.first().map(|n| n.id.clone()).unwrap_or("<root>".into()));
            Ok(0)
        }
        Cmd::Bootstrap { depth, apply } => {
            let engine = engine_for(&cli.dir)?;
            let bp = afwe_core::init::bootstrap(&engine, depth, apply)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&bp)?);
            } else {
                println!("{}", render::tree_from_blueprint(&bp));
                if !apply {
                    println!("(preview — run with --apply to write it; nodes are tagged `bootstrapped`)");
                }
            }
            Ok(0)
        }
        Cmd::Status => {
            let engine = engine_for(&cli.dir)?;
            let v = api::call(&engine, "status", json!({}), &origin)?;
            out(json, &v, render::status);
            Ok(0)
        }
        Cmd::Sync { dry_run, check } => {
            let engine = engine_for(&cli.dir)?;
            if check {
                let st = engine.sync_status()?;
                out(json, &serde_json::to_value(&st)?, |v| format!("sync status: {}{}", v["status"].as_str().unwrap_or("?"), if v["status"] == "stale" { " — run `afwe sync`" } else { "" }));
                return Ok(if st.status == "in_sync" { 0 } else { 1 });
            }
            let v = api::call(&engine, "sync", json!({"dry_run": dry_run, "origin": origin}), &origin)?;
            out(json, &v, render::sync);
            Ok(0)
        }
        Cmd::Context { files, symbol, node, task, kind, full } => {
            let engine = engine_for(&cli.dir)?;
            if files.is_empty() && symbol.is_none() && node.is_none() {
                return Err(anyhow!("give at least one file, --symbol or --node"));
            }
            let v = api::call(&engine, "context", json!({"files": files, "symbol": symbol, "node": node, "task": task, "task_kind": kind, "full": full}), &origin)?;
            out(json, &v, |v| v["markdown"].as_str().unwrap_or("").to_string());
            Ok(0)
        }
        Cmd::Verify { mut files, changed, no_commands, no_drift, task } => {
            let engine = engine_for(&cli.dir)?;
            files.extend(changed);
            let v = api::call(&engine, "verify", json!({"files": files, "run_commands": !no_commands, "include_drift": !no_drift, "task": task, "origin": origin}), &origin)?;
            let ok = v["ok"].as_bool().unwrap_or(false);
            out(json, &v, |v| afwe_core::verify::render_report(&serde_json::from_value(v.clone()).unwrap()));
            let m = engine.store.manifest()?;
            Ok(if ok || !m.policy.fail_on_violation { 0 } else { 1 })
        }
        Cmd::Drift { files } => {
            let engine = engine_for(&cli.dir)?;
            let v = api::call(&engine, "drift", json!({"files": files}), &origin)?;
            out(json, &v, render::drift);
            Ok(0)
        }
        Cmd::Search { q } => {
            let engine = engine_for(&cli.dir)?;
            let v = api::call(&engine, "search", json!({"q": q}), &origin)?;
            out(json, &v, |v| v["hits"].as_array().map(|a| a.iter().map(|h| format!("{:<9} {}  {}", h["type"].as_str().unwrap_or(""), h["title"].as_str().unwrap_or(""), h["detail"].as_str().unwrap_or(""))).collect::<Vec<_>>().join("\n")).unwrap_or_default());
            Ok(0)
        }
        Cmd::Blueprint(cmd) => {
            let engine = engine_for(&cli.dir)?;
            let (op, params) = match cmd {
                BlueprintCmd::Show { node } => {
                    let v = api::call(&engine, "blueprint.get", json!({"node": node}), &origin)?;
                    if node.is_some() {
                        out(json, &v, render::node_detail);
                    } else {
                        out(json, &v, |v| render::tree_from_blueprint(&serde_json::from_value(v.clone()).unwrap()));
                    }
                    return Ok(0);
                }
                BlueprintCmd::Add { name, parent, kind, purpose, description, files, symbols, status, id } => ("blueprint.add", json!({"name": name, "parent": parent, "kind": kind, "purpose": purpose, "description": description, "files": strs(&files), "symbols": strs(&symbols), "status": status, "id": id})),
                BlueprintCmd::Move { node, to } => ("blueprint.move", json!({"node": node, "parent": to})),
                BlueprintCmd::Update { node, name, kind, purpose, description, status } => {
                    let mut patch = serde_json::Map::new();
                    for (k, v) in [("name", name), ("kind", kind), ("purpose", purpose), ("description", description), ("status", status)] {
                        if let Some(v) = v {
                            patch.insert(k.into(), json!(v));
                        }
                    }
                    ("blueprint.update", json!({"node": node, "patch": patch}))
                }
                BlueprintCmd::Remove { node } => ("blueprint.remove", json!({"node": node})),
                BlueprintCmd::Map { node, files, symbols } => ("blueprint.map", json!({"node": node, "files": strs(&files), "symbols": strs(&symbols)})),
                BlueprintCmd::Unmap { node, files, symbols } => ("blueprint.unmap", json!({"node": node, "files": strs(&files), "symbols": strs(&symbols)})),
                BlueprintCmd::Relate { from, to, kind, why } => ("blueprint.relate", json!({"from": from, "to": to, "kind": kind, "rationale": why})),
                BlueprintCmd::Unrelate { from, to } => ("blueprint.unrelate", json!({"from": from, "to": to})),
                BlueprintCmd::Constrain { from, must_not_depend, may_depend_only, except, why, id, severity, phase, planned } => {
                    let phase = if planned { Some("planned".to_string()) } else { phase };
                    if must_not_depend.is_empty() && may_depend_only.is_empty() {
                        return Err(anyhow!("use --must-not-depend <nodes> or --may-depend-only <nodes>"));
                    }
                    if !must_not_depend.is_empty() {
                        ("blueprint.constrain", json!({"from": from, "rule": "must_not_depend", "to": strs(&must_not_depend), "except": strs(&except), "rationale": why, "id": id, "severity": severity, "phase": phase}))
                    } else {
                        ("blueprint.constrain", json!({"from": from, "rule": "may_depend_only", "allowed": strs(&may_depend_only), "rationale": why, "id": id, "severity": severity, "phase": phase}))
                    }
                }
                BlueprintCmd::Unconstrain { id } => ("blueprint.unconstrain", json!({"id": id})),
            };
            let v = api::call(&engine, op, params, &origin)?;
            out(json, &v, |v| format!("ok: {op}\n{}", render::compact(v)));
            Ok(0)
        }
        Cmd::Memory(cmd) => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                MemoryCmd::List { kind, node, tag, q } => {
                    let v = api::call(&engine, "memory.list", json!({"kind": kind, "node": node, "tag": tag, "q": q}), &origin)?;
                    out(json, &v, render::memory_list);
                }
                MemoryCmd::Show { id } => {
                    let v = api::call(&engine, "memory.get", json!({"id": id}), &origin)?;
                    out(json, &v, |v| format!("# {} [{}] ({})\n{}\n\napplies_to: {}  files: {}  tags: {}\n\n{}", v["title"].as_str().unwrap_or(""), v["kind"].as_str().unwrap_or(""), v["status"].as_str().unwrap_or(""), format!(".afwe/{}", v["path"].as_str().unwrap_or("")), v["applies_to"], v["files"], v["tags"], v["body"].as_str().unwrap_or("")));
                }
                MemoryCmd::Add { kind, title, body, body_file, id, applies_to, files, symbols, tags, status, supersedes, workflow } => {
                    let body = read_body(body, body_file)?;
                    let v = api::call(&engine, "memory.add", json!({"kind": kind, "title": title, "body": body, "id": id, "applies_to": strs(&applies_to), "files": strs(&files), "symbols": strs(&symbols), "tags": strs(&tags), "status": status, "supersedes": supersedes, "workflow": workflow}), &origin)?;
                    out(json, &v, |v| format!("recorded {} `{}` → .afwe/{}", v["kind"].as_str().unwrap_or(""), v["id"].as_str().unwrap_or(""), v["path"].as_str().unwrap_or("")));
                }
                MemoryCmd::Update { id, status, title, body_file } => {
                    let mut patch = serde_json::Map::new();
                    if let Some(s) = status {
                        patch.insert("status".into(), json!(s));
                    }
                    if let Some(t) = title {
                        patch.insert("title".into(), json!(t));
                    }
                    if body_file.is_some() {
                        patch.insert("body".into(), json!(read_body(None, body_file)?));
                    }
                    let v = api::call(&engine, "memory.update", json!({"id": id, "patch": patch}), &origin)?;
                    out(json, &v, |v| format!("updated `{}`", v["id"].as_str().unwrap_or("")));
                }
                MemoryCmd::Remove { id } => {
                    api::call(&engine, "memory.remove", json!({"id": id}), &origin)?;
                    println!("removed `{id}`");
                }
            }
            Ok(0)
        }
        Cmd::Guardrail(cmd) => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                GuardrailCmd::List => {
                    let v = api::call(&engine, "guardrail.list", json!({}), &origin)?;
                    out(json, &v, render::guardrails);
                }
                GuardrailCmd::Add { file, statement, scope, exception, exception_scope, reason, id, run, forbid_pattern, forbid_import } => {
                    let g: Value = if let Some(f) = file {
                        let text = std::fs::read_to_string(&f)?;
                        if f.extension().map(|e| e == "json").unwrap_or(false) { serde_json::from_str(&text)? } else { serde_yaml_to_json(&text)? }
                    } else {
                        let statement = statement.ok_or_else(|| anyhow!("--statement is required (or pass a file)"))?;
                        let mut checks = vec![];
                        if let Some(r) = run {
                            checks.push(json!({"type": "command", "run": r, "when": "files_changed_in_scope"}));
                        }
                        if let Some(p) = forbid_pattern {
                            checks.push(json!({"type": "forbid_pattern", "pattern": p}));
                        }
                        if !forbid_import.is_empty() {
                            checks.push(json!({"type": "forbid_import", "to_nodes": strs(&forbid_import)}));
                        }
                        json!({"id": id.unwrap_or_default(), "mode": if checks.is_empty() { "passive" } else { "active" }, "statement": statement, "reason": reason, "scope": {"nodes": strs(&scope), "global": scope.is_empty()}, "exceptions": exception, "exception_scope": {"nodes": strs(&exception_scope)}, "checks": checks})
                    };
                    let v = api::call(&engine, "guardrail.add", json!({"guardrail": g}), &origin)?;
                    out(json, &v, |v| format!("added {} guardrail `{}`", v["mode"].as_str().unwrap_or(""), v["id"].as_str().unwrap_or("")));
                }
                GuardrailCmd::Remove { id } => {
                    api::call(&engine, "guardrail.remove", json!({"id": id}), &origin)?;
                    println!("removed `{id}`");
                }
            }
            Ok(0)
        }
        Cmd::Workflow(cmd) => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                WorkflowCmd::List => {
                    let v = api::call(&engine, "workflow.list", json!({}), &origin)?;
                    out(json, &v, |v| v.as_array().map(|a| a.iter().map(|w| format!("{:<28} {:<12} {} nodes  origin={}  {}", w["id"].as_str().unwrap_or(""), w["status"].as_str().unwrap_or(""), w["nodes"], w["origin"].as_str().unwrap_or("?"), w["title"].as_str().unwrap_or(""))).collect::<Vec<_>>().join("\n")).unwrap_or_default());
                }
                WorkflowCmd::Show { id } => {
                    let v = api::call(&engine, "workflow.get", json!({"id": id}), &origin)?;
                    out(json, &v, render::workflow);
                }
                WorkflowCmd::New { title, id, description, prompt, targets, task } => {
                    let v = api::call(&engine, "workflow.new", json!({"title": title, "id": id, "description": description, "prompt": prompt, "targets": strs(&targets), "task": task}), &origin)?;
                    out(json, &v, |v| format!("created workflow `{}` → .afwe/workflows/{}.yaml", v["id"].as_str().unwrap_or(""), v["id"].as_str().unwrap_or("")));
                }
                WorkflowCmd::AddNode { workflow, title, kind, text, after, id } => {
                    let v = api::call(&engine, "workflow.add_node", json!({"workflow": workflow, "title": title, "kind": kind, "text": text, "after": after, "id": id}), &origin)?;
                    out(json, &v, |v| format!("added {} node `{}`", v["node"]["kind"].as_str().unwrap_or(""), v["node"]["id"].as_str().unwrap_or("")));
                }
                WorkflowCmd::Link { workflow, from, to, kind, remove } => {
                    let v = api::call(&engine, "workflow.link", json!({"workflow": workflow, "from": from, "to": to, "kind": kind, "remove": remove}), &origin)?;
                    out(json, &v, |_| "ok".into());
                }
                WorkflowCmd::Set { workflow, node, status, title, text, targets } => {
                    let mut patch = serde_json::Map::new();
                    for (k, v) in [("status", status), ("title", title), ("text", text)] {
                        if let Some(v) = v {
                            patch.insert(k.into(), json!(v));
                        }
                    }
                    if !targets.is_empty() {
                        patch.insert("targets".into(), strs(&targets));
                    }
                    let v = api::call(&engine, "workflow.set", json!({"workflow": workflow, "node": node, "patch": patch}), &origin)?;
                    out(json, &v, |_| "ok".into());
                }
                WorkflowCmd::Promote { workflow, parent } => {
                    let v = api::call(&engine, "workflow.promote", json!({"id": workflow, "parent": parent}), &origin)?;
                    out(json, &v, |v| format!("promoted {} component(s) into the blueprint", v.as_array().map(|a| a.len()).unwrap_or(0)));
                }
                WorkflowCmd::Remove { id } => {
                    api::call(&engine, "workflow.remove", json!({"id": id}), &origin)?;
                    println!("removed `{id}`");
                }
            }
            Ok(0)
        }
        Cmd::Lens(cmd) => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                LensCmd::List => {
                    let v = api::call(&engine, "lens.list", json!({}), &origin)?;
                    out(json, &v, |v| v.as_array().map(|a| a.iter().map(|l| format!("{:<24} {}  ({} groups)", l["id"].as_str().unwrap_or(""), l["name"].as_str().unwrap_or(""), l["groups"].as_array().map(|g| g.len()).unwrap_or(0))).collect::<Vec<_>>().join("\n")).unwrap_or_default());
                }
                LensCmd::Show { id } => {
                    let v = api::call(&engine, "lens.get", json!({"id": id}), &origin)?;
                    out(json, &v, |v| render::lens_view(&v["view"]));
                }
                LensCmd::Create { name, group, description, hide, id } => {
                    let groups: Vec<Value> = group.iter().map(|g| {
                        let (n, nodes) = g.split_once('=').unwrap_or((g.as_str(), ""));
                        json!({"name": n.trim(), "nodes": nodes.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect::<Vec<_>>()})
                    }).collect();
                    let v = api::call(&engine, "lens.save", json!({"lens": {"id": id.unwrap_or_default(), "name": name, "description": description, "groups": groups, "hide": strs(&hide)}}), &origin)?;
                    out(json, &v, |v| format!("saved lens `{}`", v["id"].as_str().unwrap_or("")));
                }
                LensCmd::Remove { id } => {
                    api::call(&engine, "lens.remove", json!({"id": id}), &origin)?;
                    println!("removed `{id}`");
                }
            }
            Ok(0)
        }
        Cmd::Contract(cmd) => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                ContractCmd::List => {
                    let v = api::call(&engine, "contract.list", json!({}), &origin)?;
                    out(json, &v, |v| v.as_array().map(|a| a.iter().map(|c| format!("{:<14} {}  [{}]", c["id"].as_str().unwrap_or(""), c["name"].as_str().unwrap_or(""), c["task_kinds"].as_array().map(|k| k.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", ")).unwrap_or_default())).collect::<Vec<_>>().join("\n")).unwrap_or_default());
                }
                ContractCmd::Show { kind } => {
                    let v = api::call(&engine, "contract.get", json!({"task_kind": kind}), &origin)?;
                    out(json, &v, render::contract);
                }
                ContractCmd::Render { write } => {
                    let v = api::call(&engine, "contract.render", json!({}), &origin)?;
                    let block = v["markdown"].as_str().unwrap_or("").to_string();
                    match write {
                        Some(p) => {
                            let p = if p.is_absolute() { p } else { engine.store.project_root.join(p) };
                            write_agents_block(&p, &block)?;
                            println!("wrote AFWE block to {}", p.display());
                        }
                        None => println!("{block}"),
                    }
                }
            }
            Ok(0)
        }
        Cmd::Task(cmd) => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                TaskCmd::Start { title, kind, files, nodes, workflow } => {
                    let v = api::call(&engine, "task.start", json!({"title": title, "kind": kind, "files": strs(&files), "nodes": strs(&nodes), "workflow": workflow}), &origin)?;
                    out(json, &v, |v| format!("task {} started under contract `{}`\n{}", v["task"]["id"].as_str().unwrap_or(""), v["task"]["contract"].as_str().unwrap_or(""), render::contract(&v["contract"])));
                }
                TaskCmd::Done { task, message } => {
                    let v = api::call(&engine, "task.done", json!({"task": task, "message": message}), &origin)?;
                    out(json, &v, |v| format!("task `{}` done{}", v["task"]["title"].as_str().unwrap_or(""), v["unfulfilled"].as_array().filter(|a| !a.is_empty()).map(|a| format!("\n⚠ unfulfilled contract steps: {}", a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "))).unwrap_or_default()));
                }
                TaskCmd::List => {
                    let v = api::call(&engine, "board.get", json!({}), &origin)?;
                    out(json, &v["tasks"], |v| v.as_array().map(|a| a.iter().map(|t| format!("{:<14} {:<6} {:<12} {}", t["id"].as_str().unwrap_or(""), t["status"].as_str().unwrap_or(""), t["kind"].as_str().unwrap_or(""), t["title"].as_str().unwrap_or(""))).collect::<Vec<_>>().join("\n")).unwrap_or_default());
                }
            }
            Ok(0)
        }
        Cmd::Board { cmd } => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                None => {
                    let v = api::call(&engine, "board.get", json!({}), &origin)?;
                    out(json, &v, render::board);
                }
                Some(BoardCmd::Dismiss { id }) => {
                    let v = api::call(&engine, "board.dismiss", json!({"id": id, "origin": origin}), &origin)?;
                    out(json, &v, |_| format!("dismissed {id}"));
                }
            }
            Ok(0)
        }
        Cmd::Proposals { cmd } => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                None => {
                    let v = api::call(&engine, "proposals.list", json!({}), &origin)?;
                    out(json, &v, render::proposals);
                }
                Some(ProposalCmd::Accept { id }) => {
                    let v = api::call(&engine, "proposal.resolve", json!({"id": id, "action": "accept"}), &origin)?;
                    out(json, &v, |v| format!("accepted {} (applied: {})", v["id"], v["applied"]));
                }
                Some(ProposalCmd::Revert { id }) => {
                    let v = api::call(&engine, "proposal.resolve", json!({"id": id, "action": "revert"}), &origin)?;
                    out(json, &v, |v| format!("reverted {}", v["id"]));
                }
                Some(ProposalCmd::Review { id }) => {
                    let v = api::call(&engine, "proposal.resolve", json!({"id": id, "action": "review"}), &origin)?;
                    out(json, &v, render::review);
                }
            }
            Ok(0)
        }
        Cmd::Log { tail, cmd } => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                None => {
                    let v = api::call(&engine, "log.get", json!({"tail": tail}), &origin)?;
                    out(json, &v, render::log);
                }
                Some(LogCmd::Add { message, kind, task }) => {
                    api::call(&engine, "log.add", json!({"message": message, "kind": kind, "task": task}), &origin)?;
                    println!("logged");
                }
            }
            Ok(0)
        }
        Cmd::Mcp { origin_name } => {
            let start = cli.dir.clone().unwrap_or(std::env::current_dir()?);
            mcp::serve(start, origin_name)?;
            Ok(0)
        }
        Cmd::Studio { port, no_open, dist, host } => {
            let start = cli.dir.clone().unwrap_or(std::env::current_dir()?);
            studio::serve(start, &host, port, !no_open, dist)?;
            Ok(0)
        }
        Cmd::Turn(cmd) => {
            let engine = engine_for(&cli.dir)?;
            let code = match cmd {
                TurnCmd::Begin { prompt, file, target, refines, kind, agent } => {
                    let text = match (prompt, file) {
                        (Some(p), _) => p,
                        (None, Some(f)) => read_text_input(&f)?,
                        _ => return Err(anyhow!("give the prompt text, or --file <path> (use `-` for stdin)")),
                    };
                    let v = api::call(&engine, "turn.begin", json!({"prompt": text, "targets": strs(&target), "refines": strs(&refines), "kind": kind, "agent": agent}), &origin)?;
                    out(json, &v, render::turn_briefing);
                    0
                }
                TurnCmd::Assume { turn, file } => {
                    let mut body = read_json_input(file)?;
                    body["turn"] = json!(turn);
                    let v = api::call(&engine, "turn.assume", body, &origin)?;
                    out(json, &v, render::turn_result);
                    if v["status"] == "redo" { 1 } else { 0 }
                }
                TurnCmd::Commit { turn, summary, footer_shown, remove, touch, overrides } => {
                    let v = api::call(&engine, "turn.commit", json!({"turn": turn, "summary": summary, "footer_shown": footer_shown, "removes": strs(&remove), "touched": strs(&touch), "overrides": parse_overrides(&overrides)?}), &origin)?;
                    out(json, &v, render::turn_result);
                    if v["status"] == "redo" { 1 } else { 0 }
                }
                TurnCmd::Confirm { turn } => {
                    let v = api::call(&engine, "turn.confirm", json!({"turn": turn}), &origin)?;
                    out(json, &v, render::turn_result);
                    0
                }
                TurnCmd::Revert { turn } => {
                    let v = api::call(&engine, "turn.revert", json!({"turn": turn}), &origin)?;
                    out(json, &v, render::turn_result);
                    0
                }
                TurnCmd::Show { turn } => {
                    let v = api::call(&engine, "turn.get", json!({"turn": turn}), &origin)?;
                    out(json, &v, |v| serde_json::to_string_pretty(v).unwrap_or_default());
                    0
                }
                TurnCmd::List => {
                    let v = api::call(&engine, "turn.list", json!({}), &origin)?;
                    out(json, &v, render::turn_list);
                    0
                }
            };
            Ok(code)
        }
        Cmd::Intent(cmd) => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                IntentCmd::List => {
                    let v = api::call(&engine, "intent.list", json!({}), &origin)?;
                    out(json, &v, render::intents);
                }
                IntentCmd::Show { id } => {
                    let v = api::call(&engine, "intent.get", json!({"id": id}), &origin)?;
                    out(json, &v, |v| serde_json::to_string_pretty(v).unwrap_or_default());
                }
            }
            Ok(0)
        }
        Cmd::Pin(cmd) => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                PinCmd::List { status } => {
                    let v = api::call(&engine, "pin.list", json!({"status": status}), &origin)?;
                    out(json, &v, render::pins);
                }
                PinCmd::Propose { statement, kind, severity, node, file, reason, intentional } => {
                    let v = api::call(&engine, "pin.propose", json!({"statement": statement, "kind": kind, "severity": severity, "nodes": strs(&node), "files": strs(&file), "reason": reason, "intentional": intentional}), &origin)?;
                    out(json, &v, |v| format!("pin {} is {}: {}", s_of(v, "id"), s_of(v, "status"), s_of(v, "statement")));
                }
                PinCmd::Accept { id } => {
                    let v = api::call(&engine, "pin.accept", json!({"id": id}), &origin)?;
                    out(json, &v, |v| format!("pin {} is active: {}", s_of(v, "id"), s_of(v, "statement")));
                }
                PinCmd::Retire { id, reason } => {
                    let v = api::call(&engine, "pin.retire", json!({"id": id, "reason": reason}), &origin)?;
                    out(json, &v, |_| format!("pin {id} retired"));
                }
                PinCmd::Budget { slider } => {
                    let v = api::call(&engine, "pin.budget", json!({"slider": slider}), &origin)?;
                    out(json, &v, render::budget);
                }
            }
            Ok(0)
        }
        Cmd::Check(cmd) => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                CheckCmd::List => {
                    let v = api::call(&engine, "check.list", json!({}), &origin)?;
                    out(json, &v, render::checks);
                }
                CheckCmd::Add { id, title, trust, authored_by, command, claim, node, file, timeout } => {
                    let claim_v: Option<Value> = match claim {
                        Some(c) => Some(serde_json::from_str(&c).map_err(|e| anyhow!("--claim must be JSON: {e}"))?),
                        None => None,
                    };
                    let check = json!({
                        "id": id.unwrap_or_default(),
                        "title": title,
                        "trust": trust,
                        "authored_by": authored_by.unwrap_or("human".into()),
                        "command": command,
                        "claim": claim_v,
                        "attaches": {"nodes": strs(&node), "files": strs(&file)},
                        "timeout_s": timeout,
                    });
                    let v = api::call(&engine, "check.add", json!({"check": check}), &origin)?;
                    out(json, &v, |v| format!("check {} registered ({} by {})", s_of(v, "id"), s_of(v, "trust"), s_of(v, "authored_by")));
                }
                CheckCmd::Remove { id } => {
                    api::call(&engine, "check.remove", json!({"id": id}), &origin)?;
                    out(json, &json!({"id": id}), |v| format!("check {} removed from the gate", s_of(v, "id")));
                }
            }
            Ok(0)
        }
        Cmd::Timeline { cmd, limit } => {
            let engine = engine_for(&cli.dir)?;
            match cmd {
                None => {
                    let v = api::call(&engine, "timeline.list", json!({"limit": limit}), &origin)?;
                    out(json, &v, render::timeline_list);
                }
                Some(TimelineCmd::Show { turn }) => {
                    let v = api::call(&engine, "timeline.get", json!({"turn": turn}), &origin)?;
                    out(json, &v, render::timeline_show);
                }
                Some(TimelineCmd::Diff { turn, file }) => {
                    let v = api::call(&engine, "timeline.diff", json!({"turn": turn, "file": file}), &origin)?;
                    out(json, &v, |v| v["patch"].as_str().unwrap_or("").to_string());
                }
                Some(TimelineCmd::Search { q }) => {
                    let v = api::call(&engine, "timeline.search", json!({"q": q}), &origin)?;
                    out(json, &v, |v| serde_json::to_string_pretty(v).unwrap_or_default());
                }
                Some(TimelineCmd::Losses) => {
                    let v = api::call(&engine, "timeline.losses", json!({}), &origin)?;
                    out(json, &v, render::losses);
                }
                Some(TimelineCmd::Restore { feature, apply }) => {
                    let v = api::call(&engine, "timeline.restore", json!({"feature": feature, "apply": apply}), &origin)?;
                    out(json, &v, render::restore);
                }
            }
            Ok(0)
        }
        Cmd::Gate { ci } => {
            let engine = engine_for(&cli.dir)?;
            let v = api::call(&engine, "gate", json!({}), &origin)?;
            out(json, &v, |v| render::gate(v, ci));
            Ok(if v["ok"].as_bool().unwrap_or(false) { 0 } else { 1 })
        }
        Cmd::Onboard { profile, check, no_git, no_baseline, no_ci, no_agents, test_command } => {
            let root = match cli.dir.clone() {
                Some(d) => d,
                None => std::env::current_dir()?,
            };
            if check {
                let v = afwe_core::onboard::detect(&root)?;
                out(json, &v, render::onboard_detect);
                return Ok(0);
            }
            let v = afwe_core::onboard::apply(
                &root,
                afwe_core::onboard::ApplyOptions { profile, init_git: !no_git, baseline_commit: !no_baseline, ci: !no_ci, agents_md: !no_agents, test_command },
            )?;
            out(json, &v, render::onboard_apply);
            Ok(0)
        }
        Cmd::Migrate => {
            let engine = engine_for(&cli.dir)?;
            let v = api::call(&engine, "migrate", json!({}), &origin)?;
            out(json, &v, |v| format!("format {} · {} workflow(s) moved to intents/", s_of(v, "format"), v["workflows_moved"]));
            Ok(0)
        }
        Cmd::Call { op, params } => {
            let engine = engine_for(&cli.dir)?;
            let params: Value = match params {
                Some(p) => serde_json::from_str(&p)?,
                None => json!({}),
            };
            let v = api::call(&engine, &op, params, &origin)?;
            println!("{}", serde_json::to_string_pretty(&v)?);
            Ok(0)
        }
    }
}

fn serde_yaml_to_json(text: &str) -> Result<Value> {
    // afwe-core already depends on serde_yaml; re-use it through the guardrail type to avoid a second dependency
    let g: afwe_core::model::Guardrail = afwe_core::store::parse_yaml(text)?;
    Ok(serde_json::to_value(g)?)
}

fn write_agents_block(path: &std::path::Path, block: &str) -> Result<()> {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let new = if let (Some(s), Some(e)) = (existing.find("<!-- afwe:begin -->"), existing.find("<!-- afwe:end -->")) {
        format!("{}{}{}", &existing[..s], block, &existing[e + "<!-- afwe:end -->".len()..].trim_start_matches('\n'))
    } else if existing.trim().is_empty() {
        block.to_string()
    } else {
        format!("{}\n\n{}", existing.trim_end(), block)
    };
    std::fs::write(path, new)?;
    Ok(())
}

// ───────────────────────────── v2 command trees ─────────────────────────────

fn s_of(v: &Value, k: &str) -> String {
    match &v[k] {
        Value::String(x) => x.clone(),
        other => other.to_string(),
    }
}

fn read_text_input(path: &str) -> Result<String> {
    if path == "-" {
        let mut s = String::new();
        std::io::Read::read_to_string(&mut std::io::stdin(), &mut s)?;
        Ok(s)
    } else {
        Ok(std::fs::read_to_string(path)?)
    }
}

fn read_json_input(file: Option<String>) -> Result<Value> {
    let path = file.ok_or_else(|| anyhow!("pass --file <path> (or `-` for stdin) with the JSON body"))?;
    let text = read_text_input(&path)?;
    serde_json::from_str(&text).map_err(|e| anyhow!("the body is not valid JSON: {e}"))
}

/// `--override pin-id=reason`
fn parse_overrides(list: &[String]) -> Result<Value> {
    let mut out = vec![];
    for o in list {
        let (pin, reason) = o.split_once('=').ok_or_else(|| anyhow!("an override looks like pin-id=reason, got `{o}`"))?;
        out.push(json!({"pin": pin.trim(), "reason": reason.trim()}));
    }
    Ok(json!(out))
}

#[derive(Subcommand)]
enum TurnCmd {
    /// Start a turn: stores the prompt verbatim and prints the briefing (scope, pins, intents, memory, checks)
    Begin {
        /// The prompt text (or --file)
        prompt: Option<String>,
        #[arg(long)]
        file: Option<String>,
        /// Nodes or files this turn is about (comma separated or repeated)
        #[arg(long = "target", num_args = 1.., value_delimiter = ',')]
        target: Vec<String>,
        /// Earlier turns this one refines
        #[arg(long, num_args = 1.., value_delimiter = ',')]
        refines: Vec<String>,
        /// code | bugfix | refactor | architecture | feature
        #[arg(long, default_value = "code")]
        kind: String,
        #[arg(long)]
        agent: Option<String>,
    },
    /// Declare intents and assumption claims (JSON via --file or stdin) before writing code
    Assume {
        turn: String,
        #[arg(long)]
        file: Option<String>,
    },
    /// Check and commit (or stage, or REDO) what changed since turn begin
    Commit {
        turn: String,
        #[arg(long)]
        summary: Option<String>,
        /// Set once the AFWE proposal notice is in your reply
        #[arg(long)]
        footer_shown: bool,
        /// Nodes removed on purpose (not collateral)
        #[arg(long = "remove", num_args = 1.., value_delimiter = ',')]
        remove: Vec<String>,
        /// Extra files AFWE cannot see changing
        #[arg(long = "touch", num_args = 1.., value_delimiter = ',')]
        touch: Vec<String>,
        /// Pin override: pin-id=reason
        #[arg(long = "override")]
        overrides: Vec<String>,
    },
    /// Confirm a staged proposal (commits it through the gate)
    Confirm { turn: String },
    /// Undo a turn as far as that is safe
    Revert { turn: String },
    /// One turn in full (JSON)
    Show { turn: String },
    /// All turns
    List,
}

#[derive(Subcommand)]
enum IntentCmd {
    /// Living intents
    List,
    /// One intent in full (JSON)
    Show { id: String },
}

#[derive(Subcommand)]
enum PinCmd {
    /// Pins (all statuses unless filtered)
    List {
        #[arg(long)]
        status: Option<String>,
    },
    /// Propose a pin. Human origin = active at once (within the budget)
    Propose {
        statement: String,
        /// decision | intentional | constraint | preference
        #[arg(long, default_value = "decision")]
        kind: String,
        /// block | confirm | warn
        #[arg(long, default_value = "confirm")]
        severity: String,
        #[arg(long = "node", num_args = 1.., value_delimiter = ',')]
        node: Vec<String>,
        #[arg(long = "file", num_args = 1.., value_delimiter = ',')]
        file: Vec<String>,
        #[arg(long)]
        reason: Option<String>,
        /// A deliberate bug or quirk that "fix all bugs" must not touch
        #[arg(long)]
        intentional: bool,
    },
    /// Accept a proposed pin (subject to the budget)
    Accept { id: String },
    /// Retire a pin
    Retire {
        id: String,
        #[arg(long)]
        reason: Option<String>,
    },
    /// Show the budget, or set the manual slider with --slider 1..5
    Budget {
        #[arg(long)]
        slider: Option<u8>,
    },
}

#[derive(Subcommand)]
enum CheckCmd {
    /// Registered checks
    List,
    /// Register a check the gate must pass: a shell command (exit 0 = pass) or a claim (JSON)
    Add {
        id: Option<String>,
        #[arg(long)]
        title: String,
        /// deterministic | generated | llm_judged
        #[arg(long, default_value = "deterministic")]
        trust: String,
        #[arg(long)]
        authored_by: Option<String>,
        #[arg(long)]
        command: Option<String>,
        #[arg(long)]
        claim: Option<String>,
        #[arg(long = "node", num_args = 1.., value_delimiter = ',')]
        node: Vec<String>,
        #[arg(long = "file", num_args = 1.., value_delimiter = ',')]
        file: Vec<String>,
        #[arg(long)]
        timeout: Option<u64>,
    },
    /// Remove a check from the gate (logged)
    Remove { id: String },
}

#[derive(Subcommand)]
enum TimelineCmd {
    /// One turn: decisions, checks, commit
    Show { turn: String },
    /// Patch of a turn, optionally one file
    Diff { turn: String, file: Option<String> },
    /// Search prompts, summaries, intents and nodes
    Search { q: String },
    /// Features that disappeared, and whether that was on purpose
    Losses,
    /// Restore a vanished feature from its last good version (3-way merge); --apply opens a restore turn
    Restore {
        feature: String,
        #[arg(long)]
        apply: bool,
    },
}
