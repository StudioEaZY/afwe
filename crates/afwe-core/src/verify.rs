//! Active guardrails: verification against the blueprint. Errors are the mechanism
//! that forces an agent to do things your way.

use crate::analyze::build_globset;
use crate::drift::violates_constraint;
use crate::engine::Snapshot;
use crate::model::*;
use std::collections::HashSet;
use std::path::Path;

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
                let a_node = table.nodes.get(a);
                let b_node = table.nodes.get(b);
                let is_planned = c.phase.as_deref() == Some("planned")
                    || a_node.and_then(|n| n.status.as_deref()) == Some("planned")
                    || b_node.and_then(|n| n.status.as_deref()) == Some("planned");
                let severity = if is_planned { "info".into() } else { c.severity.clone() };

                let paths = |refs: &[String]| refs.iter().map(|r| table.resolve(r).map(|id| table.path_of(&id)).unwrap_or(r.clone())).collect::<Vec<_>>().join(", ");
                let from_path = table.resolve(&c.from).map(|id| table.path_of(&id)).unwrap_or(c.from.clone());
                let rule = match c.rule.as_str() {
                    "must_not_depend" => format!("{from_path} must not depend on {}", paths(&c.to)),
                    _ => format!("{from_path} may only depend on {}", paths(&c.except.iter().chain(c.to.iter()).cloned().collect::<Vec<_>>())),
                };
                let status_suffix = if is_planned { " [PLANNED DIRECTION: non-blocking]" } else { "" };
                issues.push(VerifyIssue {
                    severity,
                    source: "constraint".into(),
                    id: c.id.clone(),
                    message: format!("{} imports {} ({} → {}) — violates `{}`: {}{status_suffix}", f.path, imp, table.path_of(a), table.path_of(b), c.id, rule),
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
            if check.kind == "command" {
                if !opts.run_commands {
                    continue;
                }
                let Some(cmd) = &check.run else { continue };
                let when = check.when.as_deref().unwrap_or("files_changed_in_scope");
                if when == "files_changed_in_scope" && scoped && touched.is_empty() {
                    continue;
                }
                ran.push(format!("command:{cid}"));
                let touched_paths: Vec<String> = touched.iter().map(|f| f.path.clone()).collect();
                let files_arg = touched_paths.join(" ");
                let cmdline = cmd.replace("{files}", &files_arg);
                let (ok, msg) = crate::intent::run_command(&cmdline, project_root, &touched_paths, 120);
                if !ok {
                    issues.push(VerifyIssue {
                        severity: sev.clone(),
                        source: "guardrail".into(),
                        id: cid.clone(),
                        message: check.message.clone().unwrap_or(format!("`{cmdline}` failed — guardrail `{}`: {}{}", g.id, g.statement, msg.map(|m| format!("\n{m}")).unwrap_or_default())),
                        files: touched.iter().map(|f| f.path.clone()).collect(),
                        nodes: scope_nodes.clone(),
                        hint: g.reason.clone(),
                    });
                }
            } else {
                let claim = check.to_claim();
                let scope_paths: Vec<String> = if scoped {
                    touched.iter().map(|f| f.path.clone()).collect()
                } else {
                    vec![]
                };
                match crate::claims::evaluate_scoped(&claim, snap, project_root, &scope_paths, scoped) {
                    Ok(None) => {}
                    Ok(Some(why)) => {
                        issues.push(VerifyIssue {
                            severity: sev.clone(),
                            source: "guardrail".into(),
                            id: cid.clone(),
                            message: check.message.clone().unwrap_or_else(|| format!("{why} — guardrail `{}`: {}", g.id, g.statement)),
                            files: if check.files.is_empty() { touched.iter().map(|f| f.path.clone()).collect() } else { check.files.clone() },
                            nodes: scope_nodes.clone(),
                            hint: g.reason.clone(),
                        });
                    }
                    Err(e) => {
                        issues.push(VerifyIssue {
                            severity: "warn".into(),
                            source: "guardrail".into(),
                            id: cid.clone(),
                            message: format!("guardrail check `{}` could not be evaluated: {e}", g.id),
                            files: vec![],
                            nodes: vec![],
                            hint: None,
                        });
                    }
                }
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

    // Check against pre-existing debt baseline
    let base_opt = crate::baseline::load(&crate::Engine::at(project_root)).ok();
    if let Some(base) = base_opt {
        for issue in &mut issues {
            if issue.severity == "error" && crate::baseline::is_covered(&base, issue) {
                issue.severity = "warn".into();
                issue.message = format!("{} [pre-existing debt: baseline covered]", issue.message);
            }
        }
    }

    // Explore mode (`afwe unlock`): temporarily downgrade errors to warnings so prototyping does not block
    if snap.manifest.policy.explore_mode {
        for issue in &mut issues {
            if issue.severity == "error" {
                issue.severity = "warn".into();
                issue.message = format!("{} [explore mode unlocked: non-blocking]", issue.message);
            }
        }
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
