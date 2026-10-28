//! Production-Grade Concurrent Turn Architecture (Plan v4) Test Suite.
//! Verifies:
//! 1. Parallel in-flight turn reservation (zero collisions across threads).
//! 2. Hard-stop file contention (disjoint files succeed, shared files hard-rejected).
//! 3. Advisory node overlap (same architectural subsystem generates warnings, not blocks).
//! 4. Lost update rejection (blob hash verification against git HEAD).
//! 5. Virtual overlay isolation (uncommitted peer edits on disk do not leak into commits).

use afwe_core::api::call;
use afwe_core::engine::Engine;
use afwe_core::init::{init, InitOptions};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

fn c(e: &Engine, op: &str, p: Value) -> Value {
    call(e, op, p, "human").unwrap_or_else(|err| panic!("{op} failed: {err:#}"))
}

fn try_c(e: &Engine, op: &str, p: Value) -> anyhow::Result<Value> {
    call(e, op, p, "human")
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git must be installed");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn write(dir: &Path, rel: &str, body: &str) {
    let p = dir.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, body).unwrap();
}

fn fresh(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("afwe-concurrent-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    write(&dir, "src/identity/user.ts", "export interface User { id: string }\n");
    write(&dir, "src/ui/Button.tsx", "export function Button() { return null }\n");
    write(&dir, "src/payments/checkout.ts", "import { User } from '../identity/user';\nexport function checkout(u: User) { return u.id }\n");
    write(&dir, "src/payments/stripe.ts", "export function charge(amount: number) { return amount }\n");
    write(&dir, "src/notify/mail.ts", "export function sendMail(to: string) { return to }\n");
    dir
}

fn setup_repo(dir: &Path) -> Engine {
    git(dir, &["init", "-q"]);
    init(dir, InitOptions { name: Some("Shop".into()), description: None, root: None, force: false }).unwrap();
    let e = Engine::open(dir).unwrap();
    c(&e, "blueprint.add", json!({"name": "Payments", "kind": "subsystem", "purpose": "charging", "files": ["src/payments/**"]}));
    c(&e, "blueprint.add", json!({"name": "Identity", "files": ["src/identity/**"]}));
    c(&e, "blueprint.add", json!({"name": "UI", "kind": "library", "files": ["src/ui/**"]}));
    c(&e, "blueprint.add", json!({"name": "Notifications", "files": ["src/notify/**"]}));
    c(&e, "sync", json!({}));
    git(dir, &["add", "-A"]);
    git(dir, &["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "baseline"]);
    e
}

#[test]
fn scenario_1_parallel_reservation_zero_collisions() {
    let dir = fresh("parallel-res");
    let engine = Arc::new(setup_repo(&dir));

    let mut handles = vec![];
    for i in 0..10 {
        let e = Arc::clone(&engine);
        handles.push(std::thread::spawn(move || {
            let res = c(&e, "turn.begin", json!({
                "prompt": format!("Concurrent task {i}"),
                "origin": "llm:test",
                "targets": ["payments"]
            }));
            let hash = res["turn_hash"].as_str().expect("turn_hash").to_string();
            let token = res["token"].as_str().expect("token").to_string();
            let alias = res["turn"].as_str().expect("alias").to_string();
            (hash, token, alias)
        }));
    }

    let mut hashes = HashSet::new();
    let mut tokens = HashSet::new();
    for h in handles {
        let (hash, token, _alias) = h.join().expect("thread failed");
        assert!(hash.starts_with("turn-"), "turn_hash must start with turn-: {hash}");
        assert!(token.starts_with("afwe_tok_"), "token must start with afwe_tok_: {token}");
        assert!(hashes.insert(hash.clone()), "Duplicate turn_hash detected: {hash}");
        assert!(tokens.insert(token), "Duplicate token detected");
    }
    assert_eq!(hashes.len(), 10, "Expected 10 unique hashes for 10 concurrent reservations");
}

#[test]
fn scenario_2_hard_stop_file_contention() {
    let dir = fresh("contention");
    let e = setup_repo(&dir);

    // Turn 1 claims src/payments/stripe.ts
    let b1 = c(&e, "turn.begin", json!({
        "prompt": "Optimize stripe payments",
        "origin": "llm:agent1",
        "targets": ["payments"],
        "claims": ["src/payments/stripe.ts"]
    }));
    let t1 = b1["turn"].as_str().unwrap();
    assert_eq!(b1["status"], "open");

    // Turn 2 attempts to claim the same file src/payments/stripe.ts at begin -> Rejected with CONTENTION
    let res2 = try_c(&e, "turn.begin", json!({
        "prompt": "Refactor stripe payment provider",
        "origin": "llm:agent2",
        "targets": ["payments"],
        "claims": ["src/payments/stripe.ts"]
    }));
    assert!(res2.is_err(), "Concurrent claim on same file must fail");
    let err_msg = res2.unwrap_err().to_string();
    assert!(err_msg.contains("CONTENTION"), "Error must contain CONTENTION: {err_msg}");

    // Turn 3 begins without initial claim, but tries to assume the same file -> Rejected with CONTENTION
    let b3 = c(&e, "turn.begin", json!({
        "prompt": "Update payments",
        "origin": "llm:agent3",
        "targets": ["payments"]
    }));
    let t3 = b3["turn"].as_str().unwrap();
    let a3 = c(&e, "turn.assume", json!({
        "turn": t3,
        "claims": ["src/payments/stripe.ts"],
        "intents": [{"id": "stripe-edit", "action": "update", "targets": ["payments"]}]
    }));
    assert_eq!(a3["status"], "redo", "Assume with conflicting file claim must trigger redo");
    assert_eq!(a3["error_code"], "CONTENTION");

    // Abandon Turn 1 -> Releases claims
    let ab1 = c(&e, "turn.abandon", json!({"turn": t1}));
    assert_eq!(ab1["status"], "abandoned");

    // Now Turn 3 can claim src/payments/stripe.ts successfully
    let a3_retry = c(&e, "turn.assume", json!({
        "turn": t3,
        "claims": ["src/payments/stripe.ts"],
        "intents": [{"id": "stripe-edit", "action": "update", "targets": ["payments"]}]
    }));
    assert_eq!(a3_retry["status"], "accepted");
}

#[test]
fn scenario_3_advisory_node_overlap() {
    let dir = fresh("advisory-node");
    let e = setup_repo(&dir);

    // Turn 1 claims checkout.ts under subsystem `payments`
    let b1 = c(&e, "turn.begin", json!({
        "prompt": "Update checkout flow",
        "origin": "llm:agent1",
        "targets": ["payments"],
        "claims": ["src/payments/checkout.ts"]
    }));
    assert_eq!(b1["status"], "open");

    // Turn 2 claims stripe.ts under the same subsystem `payments`
    let b2 = c(&e, "turn.begin", json!({
        "prompt": "Adjust fee calculation",
        "origin": "llm:agent2",
        "targets": ["payments"],
        "claims": ["src/payments/stripe.ts"]
    }));
    let t2 = b2["turn"].as_str().unwrap();

    let a2 = c(&e, "turn.assume", json!({
        "turn": t2,
        "claims": ["src/payments/stripe.ts"],
        "intents": [{"id": "fee-calc", "action": "update", "targets": ["payments"]}]
    }));
    // Should be accepted (not blocked)
    assert_eq!(a2["status"], "accepted");

    // Must include advisory NODE_OVERLAP notice
    let notices = a2["notices"].as_array().expect("notices array");
    let has_overlap = notices.iter().any(|w| w.as_str().unwrap_or("").contains("NODE_OVERLAP: Node `payments`"));
    assert!(has_overlap, "Expected advisory NODE_OVERLAP notice in: {notices:?}");
}

#[test]
fn scenario_4_lost_update_rejection() {
    let dir = fresh("lost-update");
    let e = setup_repo(&dir);

    // Agent A and Agent B begin
    let b_a = c(&e, "turn.begin", json!({
        "prompt": "Agent A updates user model",
        "origin": "llm:agentA",
        "claims": ["src/identity/user.ts"]
    }));
    let t_a = b_a["turn"].as_str().unwrap();

    let b_b = c(&e, "turn.begin", json!({
        "prompt": "Agent B updates notifications",
        "origin": "llm:agentB",
        "claims": ["src/notify/mail.ts"]
    }));
    let t_b = b_b["turn"].as_str().unwrap();

    c(&e, "turn.assume", json!({
        "turn": t_a,
        "intents": [{"id": "user-field", "action": "update", "targets": ["identity"]}]
    }));
    c(&e, "turn.assume", json!({
        "turn": t_b,
        "intents": [{"id": "mail-format", "action": "update", "targets": ["notifications"]}]
    }));

    // In Agent B's turn record, manually simulate a stale claim on user.ts with base_blob matching initial HEAD
    let initial_user_blob = git(&dir, &["rev-parse", "HEAD:src/identity/user.ts"]).trim().to_string();
    let mut turn_b_obj = e.store.turn(t_b).unwrap().unwrap();
    turn_b_obj.claims.push(afwe_core::model::FileClaim::new(
        "src/identity/user.ts".to_string(),
        Some(initial_user_blob),
        Some("identity".to_string()),
    ));
    e.store.save_turn(&turn_b_obj).unwrap();

    // Agent A writes to user.ts and commits
    write(&dir, "src/identity/user.ts", "export interface User { id: string; email: string }\n");
    let c_a = c(&e, "turn.commit", json!({
        "turn": t_a,
        "summary": "Add email to User"
    }));
    assert_eq!(c_a["status"], "committed");

    // Agent B now writes to mail.ts and attempts commit
    write(&dir, "src/notify/mail.ts", "export function sendMail(to: string, subj: string) { return to + subj }\n");
    let c_b = try_c(&e, "turn.commit", json!({
        "turn": t_b,
        "summary": "Agent B tries to commit with stale user baseline"
    }));
    assert!(c_b.is_err(), "Commit with clobbered baseline blob must fail");
    let err = c_b.unwrap_err().to_string();
    assert!(err.contains("LOST_UPDATE"), "Failure must cite LOST_UPDATE: {err}");
}

#[test]
fn scenario_5_virtual_overlay_isolation() {
    let dir = fresh("overlay-iso");
    let e = setup_repo(&dir);

    // Agent A and Agent B begin concurrently on disjoint files
    let b_a = c(&e, "turn.begin", json!({
        "prompt": "Agent A edits stripe",
        "origin": "llm:agentA",
        "claims": ["src/payments/stripe.ts"]
    }));
    let t_a = b_a["turn"].as_str().unwrap().to_string();

    let b_b = c(&e, "turn.begin", json!({
        "prompt": "Agent B edits mail",
        "origin": "llm:agentB",
        "claims": ["src/notify/mail.ts"]
    }));
    let t_b = b_b["turn"].as_str().unwrap().to_string();

    c(&e, "turn.assume", json!({
        "turn": t_a,
        "claims": ["src/payments/stripe.ts"],
        "intents": [{"id": "stripe-edit", "action": "update", "targets": ["payments"]}]
    }));
    c(&e, "turn.assume", json!({
        "turn": t_b,
        "claims": ["src/notify/mail.ts"],
        "intents": [{"id": "mail-edit", "action": "update", "targets": ["notifications"]}]
    }));

    // Agent B writes uncommitted changes to mail.ts on disk (dirty working tree!)
    write(&dir, "src/notify/mail.ts", "export function sendMail() { return 'UNCOMMITTED PEER WORK'; }\n");

    // Agent A writes changes to stripe.ts on disk
    write(&dir, "src/payments/stripe.ts", "export function charge(amount: number) { return amount * 10; }\n");

    // Agent A commits. Agent B's turn is open and mail.ts is uncommitted!
    let c_a = c(&e, "turn.commit", json!({
        "turn": t_a,
        "summary": "Agent A charges 10x"
    }));
    assert_eq!(c_a["status"], "committed");

    // Verify git commit created by Agent A contains ONLY Agent A's files and .afwe source files.
    // Agent B's mail.ts MUST NOT have leaked into the commit!
    let committed_files = git(&dir, &["show", "--name-only", "--format=", "HEAD"]);
    assert!(committed_files.contains("src/payments/stripe.ts"), "Commit must contain stripe.ts: {committed_files}");
    assert!(!committed_files.contains("src/notify/mail.ts"), "Peer uncommitted file MUST NOT leak into commit: {committed_files}");

    // Verify Agent B's file on disk still has Agent B's uncommitted content
    let mail_on_disk = fs::read_to_string(dir.join("src/notify/mail.ts")).unwrap();
    assert!(mail_on_disk.contains("UNCOMMITTED PEER WORK"), "Agent B disk edits must be preserved");

    // Now Agent B commits cleanly
    let c_b = c(&e, "turn.commit", json!({
        "turn": t_b,
        "summary": "Agent B commits mail"
    }));
    assert_eq!(c_b["status"], "committed");

    let final_files = git(&dir, &["show", "--name-only", "--format=", "HEAD"]);
    assert!(final_files.contains("src/notify/mail.ts"), "Agent B commit contains mail.ts: {final_files}");
}
