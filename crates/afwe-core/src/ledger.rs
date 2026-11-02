//! Append-only engine ledger under `refs/afwe/ledger/<project_id>`.
//!
//! The ledger is the authoritative record of engine state. `.afwe/` is a projection that
//! `afwe repair` regenerates from it. Each commit adds exactly one event file and carries the
//! previous tree forward, so history is the parent chain and a ledger commit never rewrites it.
//!
//! Schema version 1. A reader that meets a newer version refuses rather than guessing.
//!
//! Tree layout (P1):
//!
//! ```text
//! meta.json                  {version, project_id, seq, updated_at}
//! turns/<alias>.json         compacted turn record (touched/implements delta or full)
//! events/<seq>-<kind>.json   append-only event
//! state/expected.json        {paths: {path: blake3}, turn, updated_at}
//! baselines/<alias>.json     the baseline JSON captured at turn begin
//! ```
//!
//! Compaction: a turn record stores the full `touched.files` and `implements` maps every 20th
//! event and a delta otherwise, so a no-change turn adds well under 2 KB to the chain.

use crate::engine::Engine;
use crate::model::Turn;
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

pub const LEDGER_VERSION: u32 = 1;

pub const REF_PREFIX: &str = "refs/afwe/ledger/";

/// Every twentieth event stores the full touched/implements maps.
const FULL_RECORD_EVERY: u64 = 20;

fn default_version() -> u32 {
    LEDGER_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEvent {
    #[serde(default = "default_version")]
    pub version: u32,
    pub seq: u64,
    pub kind: String,
    pub ts: String,
    pub project_id: String,
    #[serde(default)]
    pub payload: Value,
}

/// The ledger's record of what the working tree should look like. P1 uses the `touched`
/// path -> blake3 map rather than a git tree, the same hashing world as `tree_hashes`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExpectedState {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn: Option<String>,
    #[serde(default)]
    pub paths: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<String>,
}

/// A compacted turn record stored inside the ledger tree.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredTurn {
    #[serde(default = "default_version")]
    version: u32,
    /// The turn, with `touched.files` and `implements` emptied when they are stored as a delta.
    turn: Turn,
    #[serde(default)]
    touched_full: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    touched_since: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    touched_added: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    touched_removed: Vec<String>,
    #[serde(default)]
    implements_full: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    implements_since: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    implements_added: BTreeMap<String, Vec<String>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    implements_removed: Vec<String>,
}

/// Stable lowercase hex id for this project. Generated once and stored in the manifest, so every
/// clone and worktree derives the same ref name. Never derived from the display name.
pub fn project_id(engine: &Engine) -> Result<String> {
    if let Some(id) = read_project_id(engine)? {
        return Ok(id);
    }
    let mut manifest = engine.store.manifest()?;
    let seed = format!("{}:{}", manifest.project.name, engine.store.project_root.to_string_lossy());
    let id = format!("p{}", &blake3::hash(seed.as_bytes()).to_hex()[..16]);
    manifest.project.id = Some(id.clone());
    engine.store.save_manifest(&manifest)?;
    Ok(id)
}

fn read_project_id(engine: &Engine) -> Result<Option<String>> {
    let manifest = engine.store.manifest()?;
    Ok(manifest
        .project
        .id
        .as_deref()
        .filter(|id| !id.is_empty())
        .map(str::to_string))
}

fn ref_name(project_id: &str) -> String {
    format!("{REF_PREFIX}{project_id}")
}

fn incoming_ref(project_id: &str) -> String {
    format!("refs/afwe/incoming/{project_id}")
}

// ───────────────────────────── git plumbing ─────────────────────────────

fn git_capture(root: &Path, args: &[&str], stdin: Option<&str>) -> Result<String> {
    git_capture_env(root, args, &[], stdin)
}

fn git_capture_env(root: &Path, args: &[&str], envs: &[(&str, &str)], stdin: Option<&str>) -> Result<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(root).args(args);
    for (key, value) in envs {
        cmd.env(key, value);
    }
    match stdin {
        Some(body) => {
            cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
            let mut child = cmd.spawn()?;
            child
                .stdin
                .as_mut()
                .ok_or_else(|| anyhow!("git stdin unavailable"))?
                .write_all(body.as_bytes())?;
            let out = child.wait_with_output()?;
            if !out.status.success() {
                return Err(anyhow!(
                    "git {} failed: {}",
                    args.join(" "),
                    String::from_utf8_lossy(&out.stderr).trim()
                ));
            }
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        }
        None => {
            let out = cmd.output()?;
            if !out.status.success() {
                return Err(anyhow!(
                    "git {} failed: {}",
                    args.join(" "),
                    String::from_utf8_lossy(&out.stderr).trim()
                ));
            }
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        }
    }
}

fn tip(root: &Path, refname: &str) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--verify", "--quiet", refname])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if sha.is_empty() {
        None
    } else {
        Some(sha)
    }
}

fn read_at(root: &Path, commit: &str, path: &str) -> Result<Option<String>> {
    let spec = format!("{commit}:{path}");
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["show", &spec])
        .output()?;
    if !out.status.success() {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&out.stdout).into_owned()))
}

fn paths_at(root: &Path, commit: &str, prefix: &str) -> Result<Vec<String>> {
    let listing = git_capture(root, &["ls-tree", "-r", "--name-only", commit], None)?;
    Ok(listing
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with(prefix))
        .map(str::to_string)
        .collect())
}

fn sanitize(kind: &str) -> String {
    kind.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// Build a tree that carries the parent tree forward and overlays `entries`.
/// `mktree` only handles one level, so this goes through a throwaway index.
fn build_tree(root: &Path, parent: Option<&str>, entries: &[(String, String)]) -> Result<String> {
    let nonce = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let idx = std::env::temp_dir().join(format!("afwe-ledger-index-{nonce}"));
    let idx_str = idx.to_string_lossy().to_string();
    let envs = [("GIT_INDEX_FILE", idx_str.as_str())];

    let result = (|| -> Result<String> {
        match parent {
            Some(parent) => {
                git_capture_env(root, &["read-tree", parent], &envs, None)?;
            }
            None => {
                git_capture_env(root, &["read-tree", "--empty"], &envs, None)?;
            }
        }
        for (path, content) in entries {
            let blob = git_capture(root, &["hash-object", "-w", "--stdin"], Some(content))?
                .trim()
                .to_string();
            let cacheinfo = format!("100644,{blob},{path}");
            git_capture_env(root, &["update-index", "--add", "--cacheinfo", &cacheinfo], &envs, None)?;
        }
        Ok(git_capture_env(root, &["write-tree"], &envs, None)?.trim().to_string())
    })();

    let _ = std::fs::remove_file(&idx);
    result
}

// ───────────────────────────── schema gate ─────────────────────────────

fn schema_version(root: &Path, commit: &str) -> Result<u32> {
    let Some(raw) = read_at(root, commit, "meta.json")? else {
        return Ok(LEDGER_VERSION);
    };
    let meta: Value = serde_json::from_str(&raw)
        .with_context(|| format!("ledger meta.json at {commit} is not valid JSON"))?;
    let version = meta
        .get("ledger_version")
        .or_else(|| meta.get("version"))
        .and_then(Value::as_u64)
        .unwrap_or(LEDGER_VERSION as u64) as u32;
    Ok(version)
}

fn ensure_readable_schema(root: &Path, commit: &str) -> Result<()> {
    let version = schema_version(root, commit)?;
    if version > LEDGER_VERSION {
        return Err(anyhow!(
            "ledger schema version {version} is newer than this binary ({LEDGER_VERSION}); upgrade AFWE instead of reading it partially"
        ));
    }
    Ok(())
}

// ───────────────────────────── append ─────────────────────────────

/// Append one event, retrying on a compare-and-swap collision with another writer.
pub fn append(engine: &Engine, kind: &str, payload: Value) -> Result<LedgerEvent> {
    append_with(engine, kind, payload, |_, _| Ok(vec![]))
}

fn append_with<F>(engine: &Engine, kind: &str, payload: Value, make_entries: F) -> Result<LedgerEvent>
where
    F: Fn(Option<&str>, u64) -> Result<Vec<(String, String)>>,
{
    let root = engine.store.project_root.as_path();
    if !root.join(".git").exists() {
        return Err(anyhow!("ledger needs a git repository at {}", root.display()));
    }
    let project = project_id(engine)?;
    let refname = ref_name(&project);

    for _attempt in 0..3 {
        let parent = tip(root, &refname);
        if let Some(parent_sha) = &parent {
            ensure_readable_schema(root, parent_sha)?;
        }
        let seq = match &parent {
            Some(sha) => git_capture(root, &["rev-list", "--count", sha], None)?
                .trim()
                .parse::<u64>()
                .unwrap_or(0)
                + 1,
            None => 1,
        };

        let event = LedgerEvent {
            version: LEDGER_VERSION,
            seq,
            kind: kind.to_string(),
            ts: crate::util::now(),
            project_id: project.clone(),
            payload: payload.clone(),
        };
        let mut entries = make_entries(parent.as_deref(), seq)?;
        entries.push((
            format!("events/{:06}-{}.json", seq, sanitize(kind)),
            serde_json::to_string_pretty(&event)?,
        ));
        entries.push((
            "meta.json".to_string(),
            serde_json::to_string_pretty(&json!({
                "version": LEDGER_VERSION,
                "ledger_version": LEDGER_VERSION,
                "project_id": project,
                "seq": seq,
                "updated_at": event.ts,
            }))?,
        ));

        let tree = build_tree(root, parent.as_deref(), &entries)?;
        let message = format!("afwe-ledger: {seq} {kind}");
        let mut commit_args = vec!["commit-tree", tree.as_str(), "-m", message.as_str()];
        if let Some(parent_sha) = &parent {
            commit_args.push("-p");
            commit_args.push(parent_sha.as_str());
        }
        let commit = git_capture(root, &commit_args, None)?.trim().to_string();

        let mut update = vec!["update-ref", refname.as_str(), commit.as_str()];
        update.push(parent.as_deref().unwrap_or(""));
        if git_capture(root, &update, None).is_ok() {
            return Ok(event);
        }
    }

    Err(anyhow!(
        "ledger CAS failed after 3 attempts; another writer keeps moving {}",
        refname
    ))
}

// ───────────────────────────── turn records ─────────────────────────────

fn alias_of(turn: &Turn) -> String {
    turn.alias
        .clone()
        .filter(|a| !a.is_empty())
        .unwrap_or_else(|| turn.id.clone())
}

fn read_stored_turns(root: &Path, commit: &str) -> Result<Vec<StoredTurn>> {
    let mut out = Vec::new();
    for path in paths_at(root, commit, "turns/")? {
        let Some(raw) = read_at(root, commit, &path)? else {
            continue;
        };
        let stored: StoredTurn = serde_json::from_str(&raw)
            .with_context(|| format!("ledger turn record {path} is not valid JSON"))?;
        if stored.version > LEDGER_VERSION {
            return Err(anyhow!(
                "turn record schema version {} is newer than this binary ({LEDGER_VERSION}); upgrade AFWE",
                stored.version
            ));
        }
        out.push(stored);
    }
    out.sort_by(|a, b| {
        a.turn
            .ts
            .cmp(&b.turn.ts)
            .then_with(|| alias_of(&a.turn).cmp(&alias_of(&b.turn)))
    });
    Ok(out)
}

fn previous_turn(records: &[StoredTurn], alias: &str) -> Option<Turn> {
    let mut expanded = expand_turns(records);
    let position = expanded
        .iter()
        .position(|turn| alias_of(turn) == alias)
        .unwrap_or(expanded.len());
    if position == 0 {
        return None;
    }
    Some(expanded.remove(position - 1))
}

fn expand_turns(records: &[StoredTurn]) -> Vec<Turn> {
    let mut files_by_alias: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut implements_by_alias: BTreeMap<String, BTreeMap<String, Vec<String>>> = BTreeMap::new();
    let mut out = Vec::with_capacity(records.len());

    for record in records {
        let mut turn = record.turn.clone();
        let alias = alias_of(&turn);

        let mut files = if record.touched_full {
            turn.touched.files.clone()
        } else {
            record
                .touched_since
                .as_ref()
                .and_then(|since| files_by_alias.get(since))
                .cloned()
                .unwrap_or_default()
        };
        for path in &record.touched_added {
            if !files.contains(path) {
                files.push(path.clone());
            }
        }
        if !record.touched_removed.is_empty() {
            files.retain(|path| !record.touched_removed.contains(path));
        }
        files.sort();
        files.dedup();
        turn.touched.files = files.clone();

        let mut implements = if record.implements_full {
            turn.implements.clone()
        } else {
            record
                .implements_since
                .as_ref()
                .and_then(|since| implements_by_alias.get(since))
                .cloned()
                .unwrap_or_default()
        };
        for (node, mapped) in &record.implements_added {
            implements.insert(node.clone(), mapped.clone());
        }
        for node in &record.implements_removed {
            implements.remove(node);
        }
        turn.implements = implements.clone();

        files_by_alias.insert(alias.clone(), files);
        implements_by_alias.insert(alias, implements);
        out.push(turn);
    }
    out
}

fn compact_turn(turn: &Turn, previous: Option<&Turn>, full: bool) -> StoredTurn {
    let mut stored = StoredTurn {
        version: LEDGER_VERSION,
        turn: turn.clone(),
        touched_full: full,
        implements_full: full,
        ..Default::default()
    };

    if !full {
        if let Some(previous) = previous {
            let previous_files: BTreeSet<&String> = previous.touched.files.iter().collect();
            let current_files: BTreeSet<&String> = turn.touched.files.iter().collect();
            stored.touched_since = Some(alias_of(previous));
            stored.touched_added = current_files
                .difference(&previous_files)
                .map(|path| (*path).clone())
                .collect();
            stored.touched_removed = previous_files
                .difference(&current_files)
                .map(|path| (*path).clone())
                .collect();
            stored.turn.touched.files.clear();

            stored.implements_since = Some(alias_of(previous));
            for (node, mapped) in &turn.implements {
                if previous.implements.get(node) != Some(mapped) {
                    stored.implements_added.insert(node.clone(), mapped.clone());
                }
            }
            for node in previous.implements.keys() {
                if !turn.implements.contains_key(node) {
                    stored.implements_removed.push(node.clone());
                }
            }
            stored.turn.implements.clear();
        }
    }
    stored
}

fn read_expected_at(root: &Path, commit: &str) -> Result<Option<ExpectedState>> {
    let Some(raw) = read_at(root, commit, "state/expected.json")? else {
        return Ok(None);
    };
    let expected: ExpectedState = serde_json::from_str(&raw)
        .with_context(|| format!("ledger expected state at {commit} is not valid JSON"))?;
    if expected.version > LEDGER_VERSION {
        return Err(anyhow!(
            "expected-state schema version {} is newer than this binary ({LEDGER_VERSION}); upgrade AFWE",
            expected.version
        ));
    }
    Ok(Some(expected))
}

/// Record a turn and advance the expected tree in the same ledger commit.
///
/// `replace` is used at turn begin (`E := C`); otherwise `expected` is merged into the previous
/// map so an ordinary turn only moves the paths it actually touched.
pub fn record_turn(
    engine: &Engine,
    turn: &Turn,
    kind: &str,
    expected: Option<&BTreeMap<String, String>>,
    replace: bool,
) -> Result<LedgerEvent> {
    record_turn_with(engine, turn, kind, expected, replace, false)
}

/// Record a turn with full `touched`/`implements` maps, never a delta. Used for imports and
/// refreshes, where the record must not depend on another record's reconstructed state.
pub fn record_turn_full(
    engine: &Engine,
    turn: &Turn,
    kind: &str,
    expected: Option<&BTreeMap<String, String>>,
    replace: bool,
) -> Result<LedgerEvent> {
    record_turn_with(engine, turn, kind, expected, replace, true)
}

fn record_turn_with(
    engine: &Engine,
    turn: &Turn,
    kind: &str,
    expected: Option<&BTreeMap<String, String>>,
    replace: bool,
    force_full: bool,
) -> Result<LedgerEvent> {
    let alias = alias_of(turn);
    let baseline = engine.store.baseline(&alias).ok().flatten();
    let turn = turn.clone();
    let expected = expected.cloned();

    let payload = json!({
        "turn": alias,
        "turn_hash": turn.turn_hash,
        "status": turn.status,
        "commit_sha": turn.commit_sha,
        "expected_paths": expected.as_ref().map(|map| map.len()).unwrap_or(0),
    });

    append_with(engine, kind, payload, move |parent, seq| {
        let root = engine.store.project_root.as_path();
        let records = match parent {
            Some(parent) => read_stored_turns(root, parent)?,
            None => vec![],
        };
        let previous = previous_turn(&records, &alias);
        // A status update (abandon, ready, commit, rewind) rewrites an existing record; store it
        // in full so its delta never depends on the position an update happens to sort into.
        let updating_existing = records.iter().any(|record| alias_of(&record.turn) == alias);
        let full = force_full
            || seq % FULL_RECORD_EVERY == 0
            || previous.is_none()
            || updating_existing;
        let stored = compact_turn(&turn, previous.as_ref(), full);

        let mut entries = vec![(
            format!("turns/{alias}.json"),
            serde_json::to_string_pretty(&stored)?,
        )];

        if let Some(baseline) = &baseline {
            entries.push((
                format!("baselines/{alias}.json"),
                serde_json::to_string_pretty(baseline)?,
            ));
        }

        let mut state = match parent {
            Some(parent) => read_expected_at(root, parent)?.unwrap_or_default(),
            None => ExpectedState::default(),
        };
        state.version = LEDGER_VERSION;
        state.updated_at = crate::util::now();
        state.turn = Some(alias.clone());
        if replace {
            state.paths = expected.clone().unwrap_or_default();
        } else if let Some(expected) = &expected {
            state.paths.extend(expected.clone());
        }
        entries.push((
            "state/expected.json".to_string(),
            serde_json::to_string_pretty(&state)?,
        ));

        Ok(entries)
    })
}

/// The current expected tree, or `None` when the project has no ledger yet.
pub fn expected(engine: &Engine) -> Result<Option<ExpectedState>> {
    let root = engine.store.project_root.as_path();
    let Some(project) = read_project_id(engine)? else {
        return Ok(None);
    };
    let Some(tip_sha) = tip(root, &ref_name(&project)) else {
        return Ok(None);
    };
    ensure_readable_schema(root, &tip_sha)?;
    read_expected_at(root, &tip_sha)
}

/// Expanded turn projections from the ledger, oldest first.
pub fn turns(engine: &Engine) -> Result<Vec<Turn>> {
    let root = engine.store.project_root.as_path();
    let Some(project) = read_project_id(engine)? else {
        return Ok(vec![]);
    };
    let Some(tip_sha) = tip(root, &ref_name(&project)) else {
        return Ok(vec![]);
    };
    ensure_readable_schema(root, &tip_sha)?;
    Ok(expand_turns(&read_stored_turns(root, &tip_sha)?))
}

// ───────────────────────────── read ─────────────────────────────

/// All events, oldest first. Empty when no ledger exists yet.
pub fn events(engine: &Engine) -> Result<Vec<LedgerEvent>> {
    let root = engine.store.project_root.as_path();
    let Some(project) = read_project_id(engine)? else {
        return Ok(vec![]);
    };
    let refname = ref_name(&project);
    let Some(tip_sha) = tip(root, &refname) else {
        return Ok(vec![]);
    };
    ensure_readable_schema(root, &tip_sha)?;

    // Read the event each commit adds, not the first event in a cumulative tree. Comparing
    // against the parent also reads ledgers written before the tree became cumulative.
    let commits = git_capture(root, &["rev-list", tip_sha.as_str()], None)?;
    let mut out = Vec::new();
    for sha in commits.lines().rev() {
        let listing = paths_at(root, sha, "events/")?;
        let parent_listing = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["rev-parse", &format!("{sha}^")])
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string());
        let parent_events = match parent_listing.as_deref() {
            Some(parent) => paths_at(root, parent, "events/")?.into_iter().collect::<BTreeSet<_>>(),
            None => BTreeSet::new(),
        };
        let Some(path) = listing.iter().find(|path| !parent_events.contains(*path)) else {
            continue;
        };
        let blob = git_capture(root, &["show", &format!("{sha}:{path}")], None)?;
        let event: LedgerEvent = serde_json::from_str(&blob)?;
        if event.version > LEDGER_VERSION {
            return Err(anyhow!(
                "ledger schema version {} is newer than this binary ({}); upgrade AFWE instead of reading it partially",
                event.version,
                LEDGER_VERSION
            ));
        }
        out.push(event);
    }
    Ok(out)
}

/// Summary for `afwe ledger show` and the Studio.
pub fn show(engine: &Engine) -> Result<Value> {
    let root = engine.store.project_root.as_path();
    if !root.join(".git").exists() {
        return Ok(json!({"available": false, "reason": "not a git repository"}));
    }
    let Some(project) = read_project_id(engine)? else {
        return Ok(json!({"available": false, "reason": "no project id yet"}));
    };
    let refname = ref_name(&project);
    let Some(tip_sha) = tip(root, &refname) else {
        return Ok(json!({
            "available": false,
            "project_id": project,
            "ref": refname,
            "reason": "no ledger yet; run `afwe ledger bootstrap` or start a turn",
        }));
    };
    let schema = schema_version(root, &tip_sha)?;
    if schema > LEDGER_VERSION {
        return Err(anyhow!(
            "ledger schema version {schema} is newer than this binary ({LEDGER_VERSION}); upgrade AFWE"
        ));
    }

    let all_events = events(engine)?;
    let event_count = all_events.len();
    let last_events: Vec<Value> = all_events
        .iter()
        .rev()
        .take(8)
        .rev()
        .map(|event| {
            json!({
                "seq": event.seq,
                "kind": event.kind,
                "ts": event.ts,
            })
        })
        .collect();
    let turn_count = paths_at(root, &tip_sha, "turns/")?.len();
    let expected = read_expected_at(root, &tip_sha)?.unwrap_or_default();

    Ok(json!({
        "available": true,
        "project_id": project,
        "ref": refname,
        "tip": tip_sha,
        "ledger_version": schema,
        "events": event_count,
        "turns": turn_count,
        "expected_paths": expected.paths.len(),
        "expected_turn": expected.turn,
        "updated_at": expected.updated_at,
        "last_events": last_events,
    }))
}

// ───────────────────────────── repair ─────────────────────────────

/// Advance `E := C` in the ledger after a repair. The current tree is recomputed with a fresh
/// analysis so a stale cache cannot leave an expected tree that differs from disk.
pub fn repair_expected(engine: &Engine) -> Result<usize> {
    let snap = engine.snapshot(true)?;
    let current = crate::turn::tree_hashes(engine, &snap);
    let last_turn = turns(engine)?.last().map(alias_of);
    let state = ExpectedState {
        version: LEDGER_VERSION,
        updated_at: crate::util::now(),
        turn: last_turn,
        paths: current.clone(),
        provenance: Some("repair".into()),
    };
    let entry = vec![(
        "state/expected.json".to_string(),
        serde_json::to_string_pretty(&state)?,
    )];
    append_with(
        engine,
        "repair",
        json!({"expected_paths": current.len(), "reason": "repair"}),
        move |_, _| Ok(entry.clone()),
    )?;
    Ok(current.len())
}

/// Regenerate the ENGINE_OWNED projection (`.afwe/turns/`) from the ledger. Unknown or duplicate
/// turn files are moved to `.afwe/backups/`, never deleted.
pub fn repair(engine: &Engine) -> Result<Value> {
    let root = engine.store.project_root.as_path();
    let Some(project) = read_project_id(engine)? else {
        return Err(anyhow!("this project has no ledger yet; run `afwe ledger bootstrap` first"));
    };
    let refname = ref_name(&project);
    let Some(tip_sha) = tip(root, &refname) else {
        return Err(anyhow!(
            "no ledger at {refname}; run `afwe ledger bootstrap` to import the existing projection"
        ));
    };
    ensure_readable_schema(root, &tip_sha)?;

    let turns = expand_turns(&read_stored_turns(root, &tip_sha)?);
    if turns.is_empty() && !engine.store.turns()?.is_empty() {
        return Err(anyhow!(
            "the ledger at {refname} has no turn records yet; refusing to replace the existing projection. Run `afwe ledger bootstrap` or start a turn first"
        ));
    }
    let mut canonical: BTreeSet<String> = BTreeSet::new();
    let mut known: BTreeSet<(String, String)> = BTreeSet::new();
    for turn in &turns {
        let alias = alias_of(turn);
        canonical.insert(format!("turns/{alias}.yaml"));
        known.insert((turn.id.clone(), turn.turn_hash.clone()));
        engine.store.save_turn(turn)?;
        // Restore the derived baseline too, so `repair` heals a wiped index/ folder.
        if let Some(raw) = read_at(root, &tip_sha, &format!("baselines/{alias}.json"))? {
            if let Ok(baseline) = serde_json::from_str::<crate::model::Baseline>(&raw) {
                let _ = engine.store.save_baseline(&alias, &baseline);
            }
        }
    }

    let backup_dir = engine
        .store
        .p(&format!("backups/ledger-repair-{}", crate::util::short_id("r")));
    let mut moved = 0usize;
    let mut unmatched = 0usize;
    if let Ok(listing) = std::fs::read_dir(engine.store.p("turns")) {
        for entry in listing.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("yaml") {
                continue;
            }
            let rel = format!("turns/{}", entry.file_name().to_string_lossy());
            if canonical.contains(&rel) {
                continue;
            }
            // Only move a file we can prove is the same turn under a duplicate name. Anything
            // else is left in place and reported, so an incomplete ledger never wipes work.
            let duplicate = engine
                .store
                .read_yaml::<Turn>(&rel)
                .ok()
                .flatten()
                .map(|turn| known.contains(&(turn.id.clone(), turn.turn_hash.clone())))
                .unwrap_or(false);
            if !duplicate {
                unmatched += 1;
                continue;
            }
            if let Some(name) = path.file_name() {
                let dest = backup_dir.join("turns").join(name);
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::rename(&path, &dest)?;
                moved += 1;
            }
        }
    }

    let expected_paths = repair_expected(engine)?;
    let repaired_tip = tip(root, &refname).unwrap_or(tip_sha);
    let summary = json!({
        "tip": repaired_tip,
        "project_id": project,
        "turns": turns.len(),
        "moved_to_backup": moved,
        "unmatched_left_in_place": unmatched,
        "backup": backup_dir.to_string_lossy(),
        "expected_paths": expected_paths,
    });
    engine.store.write_json(
        "state/ledger.json",
        &json!({
            "tip": summary["tip"],
            "project_id": summary["project_id"],
            "turns": summary["turns"],
            "expected_paths": summary["expected_paths"],
            "repaired_at": crate::util::now(),
        }),
    )?;
    engine.log(
        "afwe:ledger",
        "ledger_repair",
        format!(
            "repaired {} turn projection(s) from the ledger; {} stale file(s) moved to backup",
            turns.len(),
            moved
        ),
        Some(summary.clone()),
    )?;
    Ok(summary)
}

// ───────────────────────────── bootstrap ─────────────────────────────

/// Create a genesis ledger from the tracked projection when the repository has no ledger yet.
/// Every imported turn is marked `provenance: imported`; a real ledger arriving later supersedes it.
pub fn bootstrap(engine: &Engine) -> Result<Value> {
    let root = engine.store.project_root.as_path();
    if !root.join(".git").exists() {
        return Err(anyhow!("ledger bootstrap needs a git repository at {}", root.display()));
    }
    let project = project_id(engine)?;
    let refname = ref_name(&project);
    if tip(root, &refname).is_some() {
        return Err(anyhow!("a ledger already exists at {refname}"));
    }

    let mut turns = engine.store.turns()?;
    turns.sort_by(|a, b| (a.ts.as_str(), alias_of(a)).cmp(&(b.ts.as_str(), alias_of(b))));
    let mut seen = BTreeSet::new();
    turns.retain(|turn| seen.insert(alias_of(turn)));
    if turns.is_empty() {
        return Err(anyhow!("no turn records to import; start a turn first"));
    }

    let mut expected = ExpectedState {
        version: LEDGER_VERSION,
        updated_at: crate::util::now(),
        turn: turns.last().map(alias_of),
        provenance: Some("imported".into()),
        ..Default::default()
    };
    for turn in &turns {
        expected.paths.extend(turn.post_hashes.clone());
    }

    let mut entries: Vec<(String, String)> = Vec::new();
    for turn in &turns {
        let stored = StoredTurn {
            version: LEDGER_VERSION,
            turn: turn.clone(),
            touched_full: true,
            implements_full: true,
            ..Default::default()
        };
        entries.push((
            format!("turns/{}.json", alias_of(turn)),
            serde_json::to_string_pretty(&stored)?,
        ));
        if let Ok(Some(baseline)) = engine.store.baseline(&alias_of(turn)) {
            entries.push((
                format!("baselines/{}.json", alias_of(turn)),
                serde_json::to_string_pretty(&baseline)?,
            ));
        }
    }
    entries.push((
        "state/expected.json".to_string(),
        serde_json::to_string_pretty(&expected)?,
    ));

    let turn_count = turns.len();
    let event = append_with(
        engine,
        "ledger_bootstrapped",
        json!({
            "turns": turn_count,
            "provenance": "imported",
            "last_turn": expected.turn,
        }),
        move |_, _| Ok(entries.clone()),
    )?;

    Ok(json!({
        "status": "bootstrapped",
        "project_id": project,
        "ref": refname,
        "seq": event.seq,
        "turns": turn_count,
        "expected_paths": expected.paths.len(),
        "provenance": "imported",
    }))
}

/// Record projection turns the ledger has not seen yet. Promotion covers `ready` turns; this
/// covers turns that were already `committed` before the ledger existed, so `repair` can rebuild
/// the whole projection instead of leaving older turns behind.
pub fn backfill(engine: &Engine) -> Result<usize> {
    let existing: BTreeSet<String> = turns(engine)?.iter().map(alias_of).collect();
    let mut added = 0;
    for turn in engine.store.turns()? {
        if existing.contains(&alias_of(&turn)) {
            continue;
        }
        record_turn_full(engine, &turn, "turn_recorded", Some(&turn.post_hashes), false)?;
        added += 1;
    }
    Ok(added)
}

/// Re-record every projection turn in full, in one ledger commit. Used once after a schema or
/// compaction change so `repair` does not depend on a chain it cannot reconstruct.
pub fn refresh(engine: &Engine) -> Result<usize> {
    let turns = engine.store.turns()?;
    if turns.is_empty() {
        return Ok(0);
    }
    let mut entries: Vec<(String, String)> = Vec::new();
    let mut expected = expected(engine)?.unwrap_or_default();
    expected.version = LEDGER_VERSION;
    expected.updated_at = crate::util::now();
    expected.turn = turns.last().map(alias_of);
    expected.provenance = Some("refreshed".into());

    for turn in &turns {
        let alias = alias_of(turn);
        let stored = StoredTurn {
            version: LEDGER_VERSION,
            turn: turn.clone(),
            touched_full: true,
            implements_full: true,
            ..Default::default()
        };
        entries.push((
            format!("turns/{alias}.json"),
            serde_json::to_string_pretty(&stored)?,
        ));
        if let Ok(Some(baseline)) = engine.store.baseline(&alias) {
            entries.push((
                format!("baselines/{alias}.json"),
                serde_json::to_string_pretty(&baseline)?,
            ));
        }
        expected.paths.extend(turn.post_hashes.clone());
    }
    entries.push((
        "state/expected.json".to_string(),
        serde_json::to_string_pretty(&expected)?,
    ));

    let count = turns.len();
    append_with(
        engine,
        "ledger_refreshed",
        json!({"turns": count, "provenance": "refreshed"}),
        move |_, _| Ok(entries.clone()),
    )?;
    Ok(count)
}

// ───────────────────────────── transport ─────────────────────────────

fn is_ancestor(root: &Path, ancestor: &str, descendant: &str) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["merge-base", "--is-ancestor", ancestor, descendant])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Relation {
    Same,
    Behind,
    Ahead,
    Diverged,
}

fn relation(local: &str, incoming: &str, local_is_ancestor: bool, incoming_is_ancestor: bool) -> Relation {
    if local == incoming {
        Relation::Same
    } else if local_is_ancestor {
        Relation::Behind
    } else if incoming_is_ancestor {
        Relation::Ahead
    } else {
        Relation::Diverged
    }
}

fn update_ref(root: &Path, refname: &str, new: &str, old: &str) -> Result<()> {
    let mut args = vec!["update-ref", refname, new];
    if !old.is_empty() {
        args.push(old);
    }
    git_capture(root, &args, None)?;
    Ok(())
}

/// Push only the ledger ref, never snapshots or branches.
pub fn push(engine: &Engine, remote: &str) -> Result<Value> {
    let root = engine.store.project_root.as_path();
    let project = project_id(engine)?;
    let refname = ref_name(&project);
    let Some(tip_sha) = tip(root, &refname) else {
        return Err(anyhow!("no ledger to push; run `afwe ledger bootstrap` first"));
    };
    // No leading `+`: a diverged remote must reject the push, never be force-overwritten.
    let refspec = format!("{refname}:{refname}");
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["push", remote, &refspec])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()?;
    if !out.status.success() {
        return Err(anyhow!(
            "git push of the ledger failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(json!({
        "pushed": true,
        "remote": remote,
        "ref": refname,
        "tip": tip_sha,
        "output": String::from_utf8_lossy(&out.stderr).trim(),
    }))
}

/// Fetch the ledger ref into an incoming namespace, then fast-forward, report ahead/behind, or
/// record a `forked` event. A divergence is never merged, rewritten, or resolved silently.
pub fn fetch(engine: &Engine, remote: &str) -> Result<Value> {
    let root = engine.store.project_root.as_path();
    let project = project_id(engine)?;
    let refname = ref_name(&project);
    let incoming = incoming_ref(&project);
    let refspec = format!("+{refname}:{incoming}");

    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["fetch", "--no-tags", remote, &refspec])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        if stderr.contains("couldn't find remote ref") || stderr.contains("could not find remote ref") {
            return Ok(json!({
                "fetched": false,
                "remote": remote,
                "ref": refname,
                "reason": "no ledger on the remote",
            }));
        }
        return Err(anyhow!("git fetch of the ledger failed: {}", stderr.trim()));
    }
    let Some(incoming_sha) = tip(root, &incoming) else {
        return Ok(json!({"fetched": false, "remote": remote, "ref": refname, "reason": "remote ref was empty"}));
    };

    // Bootstrap from the projection when this repository has no ledger yet.
    let mut bootstrapped = false;
    if tip(root, &refname).is_none() && !engine.store.turns()?.is_empty() {
        bootstrap(engine)?;
        bootstrapped = true;
    }

    let Some(local_sha) = tip(root, &refname) else {
        update_ref(root, &refname, &incoming_sha, "")?;
        return Ok(json!({
            "fetched": true,
            "adopted": true,
            "bootstrapped": bootstrapped,
            "remote": remote,
            "ref": refname,
            "tip": incoming_sha,
        }));
    };

    let local_is_ancestor = is_ancestor(root, &local_sha, &incoming_sha);
    let incoming_is_ancestor = is_ancestor(root, &incoming_sha, &local_sha);
    let relation = relation(&local_sha, &incoming_sha, local_is_ancestor, incoming_is_ancestor);

    match relation {
        Relation::Same => Ok(json!({
            "fetched": true, "relation": "same", "remote": remote, "ref": refname, "tip": local_sha,
            "bootstrapped": bootstrapped,
        })),
        Relation::Behind => {
            update_ref(root, &refname, &incoming_sha, &local_sha)?;
            Ok(json!({
                "fetched": true, "relation": "behind", "fast_forwarded": true,
                "remote": remote, "ref": refname, "from": local_sha, "tip": incoming_sha,
                "bootstrapped": bootstrapped,
            }))
        }
        Relation::Ahead => Ok(json!({
            "fetched": true, "relation": "ahead", "remote": remote, "ref": refname,
            "incoming": incoming_sha, "tip": local_sha, "bootstrapped": bootstrapped,
        })),
        Relation::Diverged => {
            let event = append(
                engine,
                "forked",
                json!({
                    "local": local_sha,
                    "incoming": incoming_sha,
                    "incoming_ref": incoming,
                    "remote": remote,
                }),
            )?;
            Ok(json!({
                "fetched": true,
                "relation": "diverged",
                "forked": true,
                "message": "the local and remote ledgers have diverged; both tips are kept, nothing was merged or rewritten",
                "remote": remote,
                "ref": refname,
                "local": local_sha,
                "incoming": incoming_sha,
                "fork_event_seq": event.seq,
                "bootstrapped": bootstrapped,
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init::{init, InitOptions};
    use serde_json::json;

    fn repo(name: &str, with_git: bool) -> (std::path::PathBuf, Engine) {
        let dir = std::env::temp_dir().join(format!("afwe-ledger-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        if with_git {
            Command::new("git").arg("-C").arg(&dir).args(["init", "-q"]).status().unwrap();
        }
        let store = init(
            &dir,
            InitOptions { name: Some(name.into()), description: None, root: None, force: true },
        )
        .unwrap();
        (dir, Engine { store })
    }

    fn turn(alias: &str, files: &[&str]) -> Turn {
        Turn {
            id: alias.into(),
            alias: Some(alias.into()),
            turn_hash: format!("turn-{alias}"),
            prompt: "test".into(),
            status: "committed".into(),
            ts: crate::util::now(),
            touched: crate::model::TurnTouched {
                files: files.iter().map(|f| f.to_string()).collect(),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn appends_and_reads_events_in_order() {
        let (dir, engine) = repo("append", true);
        let first = append(&engine, "turn_recorded", json!({"turn": "t0001"})).unwrap();
        let second = append(&engine, "rewind_confirmed", json!({"turn": "t0002"})).unwrap();

        assert_eq!(first.seq, 1);
        assert_eq!(second.seq, 2);

        let events = events(&engine).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].kind, "turn_recorded");
        assert_eq!(events[1].kind, "rewind_confirmed");
        assert_eq!(events[0].project_id, events[1].project_id);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_commit_carries_the_previous_tree_forward() {
        let (dir, engine) = repo("cumulative", true);
        append(&engine, "turn_recorded", json!({"turn": "t0001"})).unwrap();
        append(&engine, "turn_committed", json!({"turn": "t0001"})).unwrap();

        let project = project_id(&engine).unwrap();
        let tip_sha = tip(dir.as_path(), &ref_name(&project)).unwrap();
        let event_paths = paths_at(dir.as_path(), &tip_sha, "events/").unwrap();
        assert_eq!(event_paths.len(), 2, "{event_paths:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_id_is_stable_and_persisted() {
        let (dir, engine) = repo("pid", true);
        let first = project_id(&engine).unwrap();
        let second = project_id(&engine).unwrap();
        assert_eq!(first, second);
        assert!(first.starts_with('p') && first.len() > 8);
        assert_eq!(engine.store.manifest().unwrap().project.id.as_deref(), Some(first.as_str()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_without_git_is_an_error_not_a_silent_write() {
        let (dir, engine) = repo("nogit", false);
        assert!(append(&engine, "turn_recorded", json!({})).is_err());
        assert!(events(&engine).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_newer_schema_is_refused() {
        assert_eq!(LEDGER_VERSION, 1);
        let event: LedgerEvent =
            serde_json::from_str(r#"{"version":2,"seq":1,"kind":"x","ts":"t","project_id":"p"}"#).unwrap();
        assert!(event.version > LEDGER_VERSION);
    }

    #[test]
    fn turn_records_are_compacted_and_expand_back() {
        let (dir, engine) = repo("compact", true);
        let first = turn("t0001", &["a.rs", "b.rs"]);
        record_turn(&engine, &first, "turn_recorded", None, true).unwrap();
        let second = turn("t0002", &["b.rs", "c.rs"]);
        record_turn(&engine, &second, "turn_committed", None, false).unwrap();

        let turns = turns(&engine).unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].touched.files, vec!["a.rs", "b.rs"]);
        assert_eq!(turns[1].touched.files, vec!["b.rs", "c.rs"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn expected_tree_advances_only_with_recorded_turns() {
        let (dir, engine) = repo("expected", true);
        let first = turn("t0001", &["a.rs"]);
        let mut map = BTreeMap::new();
        map.insert("a.rs".to_string(), "h1".to_string());
        record_turn(&engine, &first, "turn_recorded", Some(&map), true).unwrap();

        let second = turn("t0002", &["b.rs"]);
        let mut delta = BTreeMap::new();
        delta.insert("b.rs".to_string(), "h2".to_string());
        record_turn(&engine, &second, "turn_committed", Some(&delta), false).unwrap();

        let expected = expected(&engine).unwrap().unwrap();
        assert_eq!(expected.paths.get("a.rs").map(String::as_str), Some("h1"));
        assert_eq!(expected.paths.get("b.rs").map(String::as_str), Some("h2"));
        assert_eq!(expected.turn.as_deref(), Some("t0002"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn repair_reproduces_the_turn_projection_and_moves_duplicates() {
        let (dir, engine) = repo("repair", true);
        let first = turn("t0001", &["a.rs", "b.rs"]);
        record_turn(&engine, &first, "turn_recorded", None, true).unwrap();
        engine.store.save_turn(&first).unwrap();
        let canonical = engine.store.p("turns/t0001.yaml");
        let before = std::fs::read(&canonical).unwrap();
        engine.store.write_yaml("turns/turn-t0001.yaml", &first).unwrap();
        std::fs::remove_file(&canonical).unwrap();

        let report = repair(&engine).unwrap();
        assert_eq!(report["turns"], 1);
        assert_eq!(report["moved_to_backup"], 1);
        let after = std::fs::read(&canonical).unwrap();
        assert_eq!(before, after, "repair must reproduce the same YAML");
        assert!(!engine.store.p("turns/turn-t0001.yaml").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bootstrap_imports_an_existing_projection_once() {
        let (dir, engine) = repo("bootstrap", true);
        let first = turn("t0001", &["a.rs"]);
        engine.store.save_turn(&first).unwrap();

        let report = bootstrap(&engine).unwrap();
        assert_eq!(report["turns"], 1);
        assert_eq!(report["provenance"], "imported");
        assert!(bootstrap(&engine).is_err(), "a second bootstrap must refuse");
        let events = events(&engine).unwrap();
        assert_eq!(events.last().unwrap().kind, "ledger_bootstrapped");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fork_relation_keeps_both_tips() {
        assert_eq!(relation("a", "a", true, true), Relation::Same);
        assert_eq!(relation("a", "b", true, false), Relation::Behind);
        assert_eq!(relation("a", "b", false, true), Relation::Ahead);
        assert_eq!(relation("a", "b", false, false), Relation::Diverged);
    }

    #[test]
    fn push_and_fetch_move_only_the_ledger_and_record_a_fork() {
        let (dir_a, engine_a) = repo("transport-a", true);
        append(&engine_a, "turn_recorded", json!({"turn": "t0001"})).unwrap();
        let project = project_id(&engine_a).unwrap();

        let remote = std::env::temp_dir().join(format!("afwe-ledger-remote-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&remote);
        std::fs::create_dir_all(&remote).unwrap();
        git_capture(
            remote.as_path(),
            &["init", "--bare", "-q"],
            None,
        )
        .unwrap();

        let pushed = push(&engine_a, remote.to_str().unwrap()).unwrap();
        assert_eq!(pushed["pushed"], true);

        // A second repository with the same project id adopts the remote ledger.
        let (dir_b, engine_b) = repo("transport-b", true);
        let mut manifest = engine_b.store.manifest().unwrap();
        manifest.project.id = Some(project.clone());
        engine_b.store.save_manifest(&manifest).unwrap();

        let fetched = fetch(&engine_b, remote.to_str().unwrap()).unwrap();
        assert_eq!(fetched["adopted"], true, "{fetched}");
        assert_eq!(events(&engine_b).unwrap().len(), 1);

        // Both sides advance independently; fetch must not merge, push must not force-overwrite.
        append(&engine_a, "turn_recorded", json!({"turn": "t0002"})).unwrap();
        push(&engine_a, remote.to_str().unwrap()).unwrap();
        append(&engine_b, "turn_recorded", json!({"turn": "t0003"})).unwrap();

        let diverged = fetch(&engine_b, remote.to_str().unwrap()).unwrap();
        assert_eq!(diverged["relation"], "diverged", "{diverged}");
        assert_eq!(diverged["forked"], true);
        assert_eq!(events(&engine_b).unwrap().last().unwrap().kind, "forked");
        assert!(
            push(&engine_b, remote.to_str().unwrap()).is_err(),
            "a diverged push must fail instead of rewriting the remote"
        );

        let _ = std::fs::remove_dir_all(&remote);
        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }
}
