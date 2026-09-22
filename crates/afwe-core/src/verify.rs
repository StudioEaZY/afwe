//! Active guardrails: verification against the blueprint. Errors are the mechanism
//! that forces an agent to do things your way.

use crate::analyze::build_globset;
use crate::drift::violates_constraint;
use crate::engine::Snapshot;
use crate::model::*;
use std::collections::HashSet;
use std::path::Path;
use std::process::Command;

pub struct VerifyOptions {
    pub changed: Vec<String>,
    /// run `command` checks (can be slow)
    pub run_commands: bool,
    /// include informational drift findings
    pub include_drift: bool,
}

pub fn verify(snap: &Snapshot, project_root: &Path, opts: &VerifyOptions) -> VerifyReport {
    let mut issues: Vec<VerifyIssue> = vec![];
    let mut ran = vec![];
    let table = &snap.table;
    let changed: Vec<String> = opts.changed.iter().map(|f| f.trim_start_matches("./").to_string()).collect();
    let changed_set: HashSet<&str> = changed.iter().map(|s| s.as_str()).collect();
    let scoped = !changed.is_empty();

    // ── integrity of the blueprint itself ──
    {
        let mut seen = HashSet::new();
        let mut ids = vec![];
        crate::mapping::all_ids(&snap.sources.blueprint.nodes, &mut ids);
        for id in ids {
            if !seen.insert(id.clone()) {
                issues.push(VerifyIssue { severity: "error".into(), source: "integrity".into(), id: "duplicate-node-id".into(), message: format!("blueprint node id `{id}` is defined twice"), files: vec![], nodes: vec![id], hint: Some("node ids must be unique; rename one of them".into()) });
            }
        }
        ran.push("integrity".into());
    }

    // ── structural constraints on the import graph ──
    for f in &snap.code.files {
        if scoped && !changed_set.contains(f.path.as_str()) {
            continue;
        }
        let Some(a) = snap.mapping.primary(&f.path) else { continue };
        for imp in &f.resolved_imports {
            let Some(b) = snap.mapping.primary(imp) else { continue };
            if a == b {
                continue;
            }
            if let Some(c) = violates_constraint(snap, a, b) {
                let paths = |refs: &[String]| refs.iter().map(|r| table.resolve(r).map(|id| table.path_of(&id)).unwrap_or(r.clone())).collect::<Vec<_>>().join(", ");
                let from_path = table.resolve(&c.from).map(|id| table.path_of(&id)).unwrap_or(c.from.clone());
                let rule = match c.rule.as_str() {
                    "must_not_depend" => format!("{from_path} must not depend on {}", paths(&c.to)),
                    _ => format!("{from_path} may only depend on {}", paths(&c.except.iter().chain(c.to.iter()).cloned().collect::<Vec<_>>())),
                };
                issues.push(VerifyIssue {
                    severity: c.severity.clone(),
                    source: "constraint".into(),
                    id: c.id.clone(),
                    message: format!("{} imports {} ({} → {}) — violates `{}`: {}", f.path, imp, table.path_of(a), table.path_of(b), c.id, rule),
                    files: vec![f.path.clone(), imp.clone()],
                    nodes: vec![a.to_string(), b.to_string()],
                    hint: c.rationale.clone().or(c.description.clone()).or_else(|| Some("move the dependency behind an allowed node, or record an explicit exception in .afwe/memory/exceptions".into())),
                });
            }
        }
    }
    ran.push("constraints".into());

    // ── active guardrails ──
    for g in snap.sources.guardrails.iter().filter(|g| g.mode == "active" && g.status.as_deref() != Some("retired")) {
        let scope_nodes: Vec<String> = if g.scope.global { table.ids().to_vec() } else { g.scope.nodes.iter().filter_map(|r| table.resolve(r)).collect() };
        let in_scope = |file: &str| -> bool {
            if g.scope.global {
                return true;
            }
            if let Some(claims) = snap.mapping.files.get(file) {
                for c in claims {
                    if scope_nodes.iter().any(|s| table.is_ancestor_or_same(s, &c.node)) {
                        return true;
                    }
                }
            }
            if !g.scope.files.is_empty() {
                if let Ok(gs) = build_globset(&g.scope.files) {
                    if gs.is_match(file) {
                        return true;
                    }
                }
            }
            false
        };
        let scope_files: Vec<&FileInfo> = snap.code.files.iter().filter(|f| in_scope(&f.path)).collect();
        let touched: Vec<&FileInfo> = scope_files.iter().copied().filter(|f| !scoped || changed_set.contains(f.path.as_str())).collect();
        if scoped && touched.is_empty() && !g.scope.global {
            continue;
        }
        for (ci, check) in g.checks.iter().enumerate() {
            let sev = check.severity.clone().unwrap_or("error".into());
            let cid = format!("{}#{}", g.id, ci + 1);
            match check.kind.as_str() {
                "forbid_import" => {
                    let targets: Vec<String> = check.to_nodes.iter().filter_map(|r| table.resolve(r)).collect();
                    for f in &touched {
                        for imp in &f.resolved_imports {
                            if let Some(b) = snap.mapping.primary(imp) {
                                if targets.iter().any(|t| table.is_ancestor_or_same(t, b)) {
                                    issues.push(VerifyIssue { severity: sev.clone(), source: "guardrail".into(), id: cid.clone(), message: check.message.clone().unwrap_or(format!("{} imports {} which is inside {} — forbidden by guardrail `{}`: {}", f.path, imp, table.path_of(b), g.id, g.statement)), files: vec![f.path.clone(), imp.clone()], nodes: vec![b.to_string()], hint: g.reason.clone() });
                                }
                            }
                        }
                    }
                }
                "forbid_pattern" | "require_pattern" => {
                    let Some(pat) = &check.pattern else { continue };
                    let Ok(re) = regex::Regex::new(pat) else {
                        issues.push(VerifyIssue { severity: "warn".into(), source: "guardrail".into(), id: cid.clone(), message: format!("invalid regex in guardrail `{}`: {pat}", g.id), files: vec![], nodes: vec![], hint: None });
                        continue;
                    };
                    let files_gs = if check.files.is_empty() { None } else { build_globset(&check.files).ok() };
                    let mut candidates: Vec<&FileInfo> = if check.files.is_empty() { touched.clone() } else { snap.code.files.iter().filter(|f| files_gs.as_ref().map(|g| g.is_match(&f.path)).unwrap_or(true)).filter(|f| !scoped || changed_set.contains(f.path.as_str())).collect() };
                    candidates.sort_by(|a, b| a.path.cmp(&b.path));
                    for f in candidates {
                        let Ok(src) = std::fs::read_to_string(project_root.join(&f.path)) else { continue };
                        let found = re.is_match(&src);
                        if check.kind == "forbid_pattern" && found {
                            let line = src.lines().position(|l| re.is_match(l)).map(|i| i + 1).unwrap_or(0);
                            issues.push(VerifyIssue { severity: sev.clone(), source: "guardrail".into(), id: cid.clone(), message: check.message.clone().unwrap_or(format!("{}:{} matches forbidden pattern /{}/ — guardrail `{}`: {}", f.path, line, pat, g.id, g.statement)), files: vec![f.path.clone()], nodes: vec![], hint: g.reason.clone() });
                        } else if check.kind == "require_pattern" && !found {
                            issues.push(VerifyIssue { severity: sev.clone(), source: "guardrail".into(), id: cid.clone(), message: check.message.clone().unwrap_or(format!("{} lacks required pattern /{}/ — guardrail `{}`: {}", f.path, pat, g.id, g.statement)), files: vec![f.path.clone()], nodes: vec![], hint: g.reason.clone() });
                        }
                    }
                }
                "require_file" => {
                    if let Some(p) = &check.path {
                        if !project_root.join(p).exists() {
                            issues.push(VerifyIssue { severity: sev.clone(), source: "guardrail".into(), id: cid.clone(), message: check.message.clone().unwrap_or(format!("required file `{p}` is missing — guardrail `{}`: {}", g.id, g.statement)), files: vec![p.clone()], nodes: vec![], hint: g.reason.clone() });
                        }
                    }
                }
                "command" => {
                    if !opts.run_commands {
                        continue;
                    }
                    let Some(cmd) = &check.run else { continue };
                    let when = check.when.as_deref().unwrap_or("files_changed_in_scope");
                    if when == "files_changed_in_scope" && scoped && touched.is_empty() {
                        continue;
                    }
                    ran.push(format!("command:{cid}"));
                    let files_arg = touched.iter().map(|f| f.path.clone()).collect::<Vec<_>>().join(" ");
                    let cmdline = cmd.replace("{files}", &files_arg);
                    let output = if cfg!(windows) { Command::new("cmd").args(["/C", &cmdline]).current_dir(project_root).output() } else { Command::new("sh").args(["-c", &cmdline]).current_dir(project_root).output() };
                    match output {
                        Ok(o) if o.status.success() => {}
                        Ok(o) => {
                            let mut out = String::from_utf8_lossy(&o.stdout).to_string();
                            out.push_str(&String::from_utf8_lossy(&o.stderr));
                            let tail: String = out.lines().rev().take(15).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
                            issues.push(VerifyIssue { severity: sev.clone(), source: "guardrail".into(), id: cid.clone(), message: check.message.clone().unwrap_or(format!("`{cmdline}` failed (exit {}) — guardrail `{}`: {}\n{tail}", o.status.code().unwrap_or(-1), g.id, g.statement)), files: touched.iter().map(|f| f.path.clone()).collect(), nodes: scope_nodes.clone(), hint: g.reason.clone() });
                        }
                        Err(e) => issues.push(VerifyIssue { severity: "warn".into(), source: "guardrail".into(), id: cid.clone(), message: format!("could not run `{cmdline}`: {e}"), files: vec![], nodes: vec![], hint: None }),
                    }
                }
                other => issues.push(VerifyIssue { severity: "warn".into(), source: "guardrail".into(), id: cid.clone(), message: format!("unknown check type `{other}` in guardrail `{}`", g.id), files: vec![], nodes: vec![], hint: None }),
            }
        }
    }
    ran.push("guardrails".into());

    // ── drift (as warnings/info) ──
    if opts.include_drift {
        let findings = crate::drift::detect(snap, if scoped { Some(&changed) } else { None });
        for f in findings {
            let sev = match f.kind.as_str() {
                "unmapped_file" | "missing_file" | "missing_symbol" | "broken_reference" => "warn",
                _ => "info",
            };
            issues.push(VerifyIssue { severity: sev.into(), source: "drift".into(), id: f.id.clone(), message: f.summary.clone(), files: f.files.clone(), nodes: f.nodes.clone(), hint: f.change.as_ref().map(|c| format!("proposed: {}", describe_change(c, table))) });
        }
        ran.push("drift".into());
    }

    let errors = issues.iter().filter(|i| i.severity == "error").count();
    let warnings = issues.iter().filter(|i| i.severity == "warn").count();
    VerifyReport { ok: errors == 0, errors, warnings, issues, checked_files: changed, ran_checks: ran }
}

pub fn describe_change(c: &Change, table: &crate::mapping::NodeTable) -> String {
    match c {
        Change::MapFile { node, file } => format!("map `{file}` → {}", table.path_of(node)),
        Change::RemapFile { node, from, to } => format!("in {}: `{from}` → `{to}`", table.path_of(node)),
        Change::UnmapFile { node, file } => format!("unmap `{file}` from {}", table.path_of(node)),
        Change::RemapSymbol { node, from, to } => format!("in {}: symbol `{from}` → `{to}`", table.path_of(node)),
        Change::UnmapSymbol { node, symbol } => format!("unmap symbol `{symbol}` from {}", table.path_of(node)),
        Change::AddRelation { from, to, kind } => format!("declare {} {kind} {}", table.path_of(from), table.path_of(to)),
        Change::RemoveRelation { from, to } => format!("remove relation {} → {}", table.path_of(from), table.path_of(to)),
        Change::CreateNode { parent, name, files } => format!("create node `{name}`{} for {:?}", parent.as_ref().map(|p| format!(" under {}", table.path_of(p))).unwrap_or_default(), files),
        Change::Note { text } => text.clone(),
    }
}

pub fn render_report(r: &VerifyReport) -> String {
    let mut s = String::new();
    s.push_str(&format!("AFWE verify: {} — {} error(s), {} warning(s)\n", if r.ok { "OK" } else { "FAILED" }, r.errors, r.warnings));
    for i in &r.issues {
        let icon = match i.severity.as_str() {
            "error" => "✗",
            "warn" => "!",
            _ => "·",
        };
        s.push_str(&format!("{icon} [{}:{}] {}\n", i.source, i.id, i.message));
        if let Some(h) = &i.hint {
            s.push_str(&format!("    ↳ {h}\n"));
        }
    }
    s
}
