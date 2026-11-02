//! A file revert is classified at the next turn begin, and the following commit still succeeds.

use afwe_core::api;
use afwe_core::init::{init, InitOptions};
use afwe_core::Engine;
use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;

fn c(engine: &Engine, op: &str, params: Value) -> Value {
    api::call(engine, op, params, "llm:test").unwrap_or_else(|error| panic!("{op}: {error:#}"))
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git");
    assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn file_revert_is_rewound_and_the_next_commit_succeeds() {
    let dir = std::env::temp_dir().join(format!("afwe-rewind-it-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/a.txt"), "one\n").unwrap();
    git(&dir, &["init", "-q"]);
    init(
        &dir,
        InitOptions { name: Some("rewind-it".into()), description: None, root: None, force: true },
    )
    .unwrap();
    let engine = Engine::open(&dir).unwrap();
    git(&dir, &["add", "-A"]);
    git(
        &dir,
        &["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-q", "-m", "baseline"],
    );

    let begin1 = c(
        &engine,
        "turn.begin",
        json!({"prompt": "change a", "origin": "llm:test", "targets": ["src/a.txt"]}),
    );
    let t1 = begin1["turn"].as_str().unwrap().to_string();
    assert!(
        begin1["snapshot"]["id"].is_string(),
        "turn begin must take a snapshot: {begin1}"
    );
    c(
        &engine,
        "turn.assume",
        json!({"turn": t1, "intents": [{"id": "change-a", "action": "create", "targets": ["src/a.txt"]}]}),
    );
    std::fs::write(dir.join("src/a.txt"), "two\n").unwrap();
    let commit1 = c(&engine, "turn.commit", json!({"turn": t1, "summary": "change a to two"}));
    assert_ne!(commit1["status"], "redo", "{commit1}");

    // T3-style file revert: put the pre-turn bytes back, then begin the next turn.
    std::fs::write(dir.join("src/a.txt"), "one\n").unwrap();
    let begin2 = c(
        &engine,
        "turn.begin",
        json!({"prompt": "next change", "origin": "llm:test", "targets": ["src/a.txt"]}),
    );
    let receipts = begin2["rewind_receipts"].as_array().cloned().unwrap_or_default();
    assert_eq!(receipts.len(), 1, "expected one rewind receipt: {begin2}");
    assert_eq!(receipts[0]["verdict"], "REWOUND", "{}", receipts[0]);
    assert!(
        receipts[0]["turns_undone"].to_string().contains(&t1),
        "receipt must name the undone turn: {}",
        receipts[0]
    );
    assert!(begin2["rewind_notice"].as_str().unwrap_or("").contains("REWOUND"));

    // The advisory receipt must not block the next turn's commit.
    let t2 = begin2["turn"].as_str().unwrap().to_string();
    c(
        &engine,
        "turn.assume",
        json!({"turn": t2, "intents": [{"id": "next-change", "action": "create", "targets": ["src/a.txt"]}]}),
    );
    std::fs::write(dir.join("src/a.txt"), "three\n").unwrap();
    let commit2 = c(&engine, "turn.commit", json!({"turn": t2, "summary": "change a to three"}));
    assert_ne!(commit2["status"], "redo", "commit must still succeed: {commit2}");
    assert!(commit2["status"] == "ready" || commit2["status"] == "committed", "{commit2}");

    let listed = c(&engine, "rewind.list", json!({}));
    assert_eq!(listed["count"], 1, "{listed}");
    let typed: Vec<afwe_core::rewind::RewindReceipt> = afwe_core::rewind::receipts(&engine).unwrap();
    assert_eq!(typed.len(), 1);
    assert_eq!(typed[0].verdict, "REWOUND");

    // Advisory action queue integration
    let queue = c(&engine, "queue", json!({}));
    let items = queue["items"].as_array().expect("queue items");
    let rewind_item = items.iter().find(|i| i["kind"] == "external_rewind");
    assert!(rewind_item.is_some(), "rewind receipt must surface in action queue: {queue}");
    let receipt_id = typed[0].id.clone();

    // Snapshot retention pruning test
    c(&engine, "snapshot.take", json!({"phase": "manual"}));
    c(&engine, "snapshot.take", json!({"phase": "manual"}));
    let before_prune = c(&engine, "snapshot.list", json!({}));
    let snap_count = before_prune.as_array().map(|a| a.len()).unwrap_or(0);
    assert!(snap_count >= 3);
    let prune_res = c(&engine, "snapshot.prune", json!({"keep": 2}));
    assert_eq!(prune_res["remaining"], 2);
    let after_prune = c(&engine, "snapshot.list", json!({}));
    assert_eq!(after_prune.as_array().map(|a| a.len()).unwrap_or(0), 2);

    // Resolve rewind receipt by dismissal
    let dismissed = c(&engine, "rewind.resolve", json!({"id": receipt_id, "action": "dismiss"}));
    assert_eq!(dismissed["status"], "dismissed");
    let listed_after = c(&engine, "rewind.list", json!({}));
    assert_eq!(listed_after["count"], 0);

    let _ = std::fs::remove_dir_all(&dir);
}
