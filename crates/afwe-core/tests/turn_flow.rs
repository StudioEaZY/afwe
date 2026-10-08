//! The v2 turn protocol against a real git repository: begin → assume → commit, with REDO loops,
//! collateral-loss detection, restore by 3-way merge, pins with overrides, staged proposals that are
//! folded into later turns, revert, and the whole-project gate. Everything goes through `api::call`.

use afwe_core::api::call;
use afwe_core::engine::Engine;
use afwe_core::init::{init, InitOptions};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn c(e: &Engine, op: &str, p: Value) -> Value {
    call(e, op, p, "human").unwrap_or_else(|err| panic!("{op} failed: {err:#}"))
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git must be installed");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn write(dir: &Path, rel: &str, body: &str) {
    let p = dir.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, body).unwrap();
}

fn fresh(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("afwe-v2-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    write(&dir, "src/identity/user.ts", "export interface User { id: string }\n");
    write(&dir, "src/ui/Button.tsx", "export function Button() { return null }\n");
    write(&dir, "src/payments/checkout.ts", "import { User } from '../identity/user';\nexport function checkout(u: User) { return u }\n");
    write(&dir, "src/payments/stripe.ts", "export function charge(amount: number) { return amount }\n");
    write(&dir, "src/notify/mail.ts", "export function sendMail(to: string) { return to }\n");
    dir
}

fn blueprint(e: &Engine) {
    c(e, "blueprint.add", json!({"name": "Payments", "kind": "subsystem", "purpose": "charging", "files": ["src/payments/**"]}));
    c(e, "blueprint.add", json!({"name": "Identity", "files": ["src/identity/**"]}));
    c(e, "blueprint.add", json!({"name": "UI", "kind": "library", "files": ["src/ui/**"]}));
    c(e, "blueprint.add", json!({"name": "Notifications", "files": ["src/notify/**"]}));
    c(e, "blueprint.constrain", json!({"from": "payments", "rule": "must_not_depend", "to": ["ui"], "rationale": "payments stay headless"}));
    c(e, "sync", json!({}));
}

fn turn_id(v: &Value) -> String {
    v["turn"].as_str().expect("turn id").to_string()
}

#[test]
fn turn_protocol_gates_commits_with_git() {
    let dir = fresh("gate");
    git(&dir, &["init", "-q"]);
    init(&dir, InitOptions { name: Some("Shop".into()), description: None, root: None, force: false }).unwrap();
    let e = Engine::open(&dir).unwrap();
    blueprint(&e);
    git(&dir, &["add", "-A"]);
    git(&dir, &["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "-m", "baseline"]);

    // t0001 — a clean turn with a claim: committed with a trailer; checkgen turns the claim into a standing check
    let b1 = c(&e, "turn.begin", json!({"prompt": "Add a charge2 helper to payments", "origin": "llm:test", "targets": ["payments"]}));
    let t1 = turn_id(&b1);
    assert_eq!(t1, "t0001");
    assert_eq!(b1["status"], "open");
    let a1 = c(&e, "turn.assume", json!({
        "turn": t1,
        "intents": [{"id": "charge2", "action": "create", "targets": ["payments"], "title": "Charge helper"}],
        "assumptions": [{"id": "no-ui", "text": "payments never imports the UI", "claim": {"type": "forbid_import", "to_nodes": ["ui"], "files": ["src/payments/**"]}}]
    }));
    assert_eq!(a1["status"], "accepted", "{a1}");
    write(&dir, "src/payments/charge.ts", "export function charge2(a: number) { return a * 2 }\n");
    let k1 = c(&e, "turn.commit", json!({"turn": t1, "summary": "Add charge2 helper"}));
    assert_eq!(k1["status"], "committed", "{k1}");
    assert_eq!(k1["strength"], "deterministic");
    assert!(k1["commit"]["sha"].is_string(), "{k1}");
    assert!(git(&dir, &["log", "-1", "--format=%B"]).contains("AFWE-Turn: t0001"));
    let files = git(&dir, &["show", "--name-only", "--format=", "HEAD"]);
    assert!(files.contains("src/payments/charge.ts") && files.contains(".afwe/turns/t0001.yaml"), "{files}");
    let checks = c(&e, "check.list", json!({}));
    assert!(checks.as_array().unwrap().iter().any(|x| x["authored_by"] == "checkgen"), "checkgen should register the claim: {checks}");

    // t0002 — breaks the boundary: REDO, nothing committed; a corrected version commits
    let b2 = c(&e, "turn.begin", json!({"prompt": "Let checkout show the button", "origin": "llm:test", "targets": ["payments"]}));
    let t2 = turn_id(&b2);
    c(&e, "turn.assume", json!({"turn": t2, "intents": [{"id": "checkout-button", "action": "update", "targets": ["payments"]}]}));
    write(&dir, "src/payments/checkout.ts", "import { User } from '../identity/user';\nimport { Button } from '../ui/Button';\nexport function checkout(u: User) { return Button }\n");
    let head_before = git(&dir, &["rev-parse", "HEAD"]);
    let r2 = c(&e, "turn.commit", json!({"turn": t2}));
    assert_eq!(r2["status"], "redo", "{r2}");
    assert_eq!(git(&dir, &["rev-parse", "HEAD"]), head_before, "a REDO must not commit anything");
    let fails = r2["failures"].to_string();
    assert!(fails.contains("VERIFY_FAILED") && fails.contains("CHECK_FAILED"), "{fails}");
    write(&dir, "src/payments/checkout.ts", "import { User } from '../identity/user';\nexport function checkout(u: User) { return u.id }\n");
    let r2b = c(&e, "turn.commit", json!({"turn": t2, "summary": "checkout returns the id"}));
    assert_eq!(r2b["status"], "committed", "{r2b}");

    // t0003 — a feature disappears without being declared: collateral loss → REDO; declared → committed
    let b3 = c(&e, "turn.begin", json!({"prompt": "Remove the notification module", "origin": "llm:test", "targets": ["notifications"]}));
    let t3 = turn_id(&b3);
    let a3 = c(&e, "turn.assume", json!({"turn": t3, "intents": [{"id": "drop-notify", "action": "remove", "targets": ["notifications"]}]}));
    assert_eq!(a3["status"], "accepted", "{a3}");
    fs::remove_file(dir.join("src/notify/mail.ts")).unwrap();
    let r3 = c(&e, "turn.commit", json!({"turn": t3}));
    assert_eq!(r3["status"], "redo", "{r3}");
    assert!(r3["failures"].to_string().contains("COLLATERAL_LOSS: notifications"), "{r3}");
    let r3b = c(&e, "turn.commit", json!({"turn": t3, "removes": ["notifications"], "summary": "Remove notifications"}));
    assert_eq!(r3b["status"], "committed", "{r3b}");
    let losses = c(&e, "timeline.losses", json!({}));
    let history = losses["history"].to_string();
    assert!(history.contains("\"node\":\"notifications\"") && history.contains("\"on_purpose\":true"), "{losses}");

    // t0004 — restore: the last good version is merged back on top of the current tree, gated as a turn
    let plan = c(&e, "timeline.restore", json!({"feature": "notifications"}));
    assert_eq!(plan["status"], "plan", "{plan}");
    assert_eq!(plan["from_turn"], "t0002", "the last turn that realised notifications: {plan}");
    let applied = c(&e, "timeline.restore", json!({"feature": "notifications", "apply": true}));
    assert_eq!(applied["status"], "applied", "{applied}");
    let t4 = turn_id(&applied);
    assert_eq!(t4, "t0004");
    let k4 = c(&e, "turn.commit", json!({"turn": t4}));
    assert_eq!(k4["status"], "committed", "{k4}");
    assert_eq!(fs::read_to_string(dir.join("src/notify/mail.ts")).unwrap(), "export function sendMail(to: string) { return to }\n");

    // t0005 — a human pins payments: an agent change is blocked until it is overridden with a reason
    let pin = c(&e, "pin.propose", json!({"statement": "Charging stays as it is unless finance signs off", "kind": "decision", "severity": "block", "nodes": ["payments"], "origin": "human:test"}));
    assert_eq!(pin["status"], "active", "{pin}");
    let pid = pin["id"].as_str().unwrap().to_string();
    let b5 = c(&e, "turn.begin", json!({"prompt": "Round the stripe charge", "origin": "llm:test", "targets": ["payments"]}));
    let t5 = turn_id(&b5);
    assert!(b5["pins"].to_string().contains(&pid), "the briefing must carry the pin: {b5}");
    c(&e, "turn.assume", json!({"turn": t5, "intents": [{"id": "round-charge", "action": "update", "targets": ["payments"]}]}));
    write(&dir, "src/payments/stripe.ts", "export function charge(amount: number) { return Math.round(amount) }\n");
    let r5 = c(&e, "turn.commit", json!({"turn": t5}));
    assert_eq!(r5["status"], "redo", "{r5}");
    assert!(r5["failures"].to_string().contains("PIN_CONFLICT"), "{r5}");
    let r5b = c(&e, "turn.commit", json!({"turn": t5, "overrides": [{"pin": pid, "reason": "finance signed off"}]}));
    assert_eq!(r5b["status"], "committed", "{r5b}");
    assert!(r5b["notices"].to_string().contains("OVERRIDDEN"), "{r5b}");

    // t0006 — unmapped work is not trusted enough to commit: it becomes a proposal, uncommitted
    let b6 = c(&e, "turn.begin", json!({"prompt": "Add a maintenance script for payments", "origin": "llm:test", "targets": ["payments"]}));
    let t6 = turn_id(&b6);
    write(&dir, "scripts/maintain.py", "print('maintain')\n");
    let r6 = c(&e, "turn.commit", json!({"turn": t6, "summary": "Maintenance script"}));
    assert_eq!(r6["status"], "staged", "{r6}");
    assert!(r6["reasons"].to_string().contains("LOW_CONFIDENCE"), "{r6}");
    assert!(git(&dir, &["status", "--porcelain", "scripts/maintain.py"]).contains("??"), "a proposal stays uncommitted");

    // t0007 — the next turn shows the footer; a commit without it is refused; the proposal is folded in
    let b7 = c(&e, "turn.begin", json!({"prompt": "Tidy the checkout", "origin": "llm:test", "targets": ["payments"]}));
    assert!(b7["unresolved_proposals"].to_string().contains(&t6), "{b7}");
    assert!(b7["footer"].as_str().unwrap_or("").contains("AFWE Notice"), "{b7}");
    let t7 = turn_id(&b7);
    c(&e, "turn.assume", json!({"turn": t7, "intents": [{"id": "tidy-checkout", "action": "update", "targets": ["payments"]}]}));
    write(&dir, "src/payments/checkout.ts", "import { User } from '../identity/user';\nexport function checkout(u: User) { return u.id.trim() }\n");
    // the block-pin on payments also covers this edit: the footer and the pin both refuse the first try
    let r7 = c(&e, "turn.commit", json!({"turn": t7}));
    assert_eq!(r7["status"], "redo", "{r7}");
    assert!(r7["failures"].to_string().contains("FOOTER_REQUIRED"), "{r7}");
    assert!(r7["failures"].to_string().contains("PIN_CONFLICT"), "{r7}");
    let r7b = c(&e, "turn.commit", json!({"turn": t7, "footer_shown": true, "overrides": [{"pin": pid, "reason": "the finance sign-off covers the checkout tidy-up"}]}));
    assert_eq!(r7b["status"], "committed", "{r7b}");
    assert!(r7b["implicitly_accepted"].to_string().contains(&t6), "{r7b}");
    let rec6 = c(&e, "turn.get", json!({"turn": t6}));
    assert_eq!(rec6["status"], "folded");
    assert_eq!(rec6["folded_into"], json!(t7));
    assert!(git(&dir, &["show", "--name-only", "--format=", "HEAD"]).contains("scripts/maintain.py"));

    // t0008 — a staged proposal can be reverted: the files it created are removed
    let b8 = c(&e, "turn.begin", json!({"prompt": "Add a throwaway helper", "origin": "llm:test"}));
    let t8 = turn_id(&b8);
    write(&dir, "tools/throwaway.py", "print('x')\n");
    let r8 = c(&e, "turn.commit", json!({"turn": t8}));
    assert_eq!(r8["status"], "staged", "{r8}");
    let rv = c(&e, "turn.revert", json!({"turn": t8}));
    assert_eq!(rv["status"], "reverted", "{rv}");
    assert!(!dir.join("tools/throwaway.py").exists());

    // t0009 — nothing changed: an empty turn is reported as such
    let b9 = c(&e, "turn.begin", json!({"prompt": "Just checking", "origin": "llm:test"}));
    let r9 = c(&e, "turn.commit", json!({"turn": turn_id(&b9)}));
    assert_eq!(r9["status"], "empty", "{r9}");

    // the whole project passes the gate, the history is intent-indexed and every commit carries its trailer
    let g = c(&e, "gate", json!({}));
    assert_eq!(g["ok"], true, "{g}");
    let trailers = git(&dir, &["log", "--format=%B"]).matches("AFWE-Turn: t").count();
    assert_eq!(trailers, 6, "t0001 t0002 t0003 t0004 t0005 t0007 are committed");
    let tl = c(&e, "timeline.list", json!({}));
    let text = tl.to_string();
    assert!(text.contains("\"folded\"") && text.contains("\"reverted\"") && text.contains("\"committed\""), "{tl}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn assume_refuses_bad_schema_and_registers_nothing() {
    let dir = fresh("schema");
    init(&dir, InitOptions { name: Some("Shop".into()), description: None, root: None, force: false }).unwrap();
    let e = Engine::open(&dir).unwrap();
    blueprint(&e);
    let b = c(&e, "turn.begin", json!({"prompt": "Do a thing", "origin": "llm:test", "targets": ["payments"]}));
    let t = turn_id(&b);
    let r = c(&e, "turn.assume", json!({
        "turn": t,
        "intents": [{"id": "Bad Id", "action": "frobnicate", "targets": ["nowhere"]}],
        "assumptions": [{"id": "x", "text": "t", "claim": {"type": "forbid_pattern"}}]
    }));
    assert_eq!(r["status"], "redo", "{r}");
    let codes = r["errors"].to_string();
    assert!(codes.contains("SCHEMA_INVALID") && codes.contains("UNKNOWN_TARGET") && codes.contains("BAD_CLAIM"), "{r}");
    let intents = c(&e, "intent.list", json!({}));
    assert!(intents.as_array().unwrap().iter().all(|i| i["id"] != "Bad Id"), "nothing may be half-registered: {intents}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn projects_without_version_control_record_turns_without_a_commit() {
    let dir = fresh("novcs");
    init(&dir, InitOptions { name: Some("Shop".into()), description: None, root: None, force: false }).unwrap();
    let e = Engine::open(&dir).unwrap();
    blueprint(&e);
    let b = c(&e, "turn.begin", json!({"prompt": "Add charge helper to payments", "origin": "llm:test", "targets": ["payments"]}));
    let t = turn_id(&b);
    c(&e, "turn.assume", json!({"turn": t, "intents": [{"id": "charge2", "action": "create", "targets": ["payments"]}]}));
    write(&dir, "src/payments/charge.ts", "export function charge2(a: number) { return a * 2 }\n");
    let k = c(&e, "turn.commit", json!({"turn": t}));
    assert_eq!(k["status"], "committed", "{k}");
    assert!(k["commit"].is_null(), "{k}");
    assert!(k["reasons"].to_string().contains("NO_VCS"), "{k}");
    let bud = c(&e, "pin.budget", json!({}));
    assert!(bud["limit"].as_u64().unwrap() >= 3, "{bud}");
    let _ = fs::remove_dir_all(&dir);
}
