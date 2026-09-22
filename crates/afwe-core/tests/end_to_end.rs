//! End-to-end tests on a throw-away project: init → blueprint → sync → context → verify → drift policy →
//! contract bookkeeping. Everything goes through `api::call`, i.e. the same surface the CLI/MCP/Studio use.

use afwe_core::api::call;
use afwe_core::engine::Engine;
use afwe_core::init::{init, InitOptions};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn tmp_project(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("afwe-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/payments")).unwrap();
    fs::create_dir_all(dir.join("src/ui")).unwrap();
    fs::create_dir_all(dir.join("src/identity")).unwrap();
    fs::create_dir_all(dir.join("services")).unwrap();
    fs::write(dir.join("src/identity/user.ts"), "export interface User { id: string }\n").unwrap();
    fs::write(dir.join("src/ui/Button.tsx"), "export function Button() { return null }\n").unwrap();
    fs::write(
        dir.join("src/payments/checkout.ts"),
        "import { User } from '../identity/user';\nimport { Button } from '../ui/Button';\nexport function checkout(u: User) { console.log(u, Button) }\n",
    )
    .unwrap();
    fs::write(dir.join("src/payments/stripe.ts"), "export function charge(amount: number) { return amount }\n").unwrap();
    fs::write(dir.join("services/worker.py"), "import os\n\nclass Worker:\n    def run(self):\n        return os.getpid()\n").unwrap();
    dir
}

fn engine(dir: &Path) -> Engine {
    init(dir, InitOptions { name: Some("Test Product".into()), description: None, root: None, force: false }).unwrap();
    Engine::open(dir).unwrap()
}

fn c(e: &Engine, op: &str, p: Value) -> Value {
    call(e, op, p, "human").unwrap_or_else(|err| panic!("{op} failed: {err:#}"))
}

#[test]
fn blueprint_sync_context_verify_roundtrip() {
    let dir = tmp_project("roundtrip");
    let e = engine(&dir);
    assert!(dir.join(".afwe/afwe.yaml").exists());
    assert!(dir.join(".afwe/contracts/default.yaml").exists());

    c(&e, "blueprint.add", json!({"name": "Payments", "kind": "subsystem", "purpose": "Charging users", "files": ["src/payments/**"]}));
    c(&e, "blueprint.add", json!({"name": "Identity", "purpose": "User model", "files": ["src/identity/**"]}));
    c(&e, "blueprint.add", json!({"name": "UI", "kind": "library", "files": ["src/ui/**"]}));
    c(&e, "blueprint.add", json!({"name": "Worker", "kind": "service", "files": ["services/worker.py"]}));
    c(&e, "blueprint.relate", json!({"from": "payments", "to": "identity", "rationale": "charges are per user"}));
    c(&e, "blueprint.constrain", json!({"from": "payments", "rule": "must_not_depend", "to": ["ui"], "rationale": "headless"}));
    c(&e, "memory.add", json!({"kind": "decision", "title": "Charges are idempotent", "applies_to": ["payments"], "body": "## Decision\nUse idempotency keys."}));
    c(&e, "memory.add", json!({"kind": "exception", "title": "Worker may shell out", "files": ["services/**"], "body": "ok"}));

    // sync: everything is mapped, python + typescript analysed
    let sync = c(&e, "sync", json!({}));
    assert_eq!(sync["unmapped_code_files"], 0, "{sync}");
    assert!(sync["symbols"].as_u64().unwrap() >= 5, "{sync}");
    assert!(sync["languages"]["python"].as_u64().unwrap() >= 1);
    assert!(sync["languages"]["typescript"].as_u64().unwrap() >= 3);

    // context is scoped: payments file sees the payments decision, not the worker exception
    let ctx = c(&e, "context", json!({"files": ["src/payments/checkout.ts"]}));
    let titles: Vec<&str> = ctx["memory"].as_array().unwrap().iter().map(|m| m["title"].as_str().unwrap()).collect();
    assert!(titles.contains(&"Charges are idempotent"), "{titles:?}");
    assert!(!titles.contains(&"Worker may shell out"), "{titles:?}");
    assert!(ctx["constraints"].as_array().unwrap().iter().any(|k| k["id"] == "payments-must-not-ui"), "{}", ctx["constraints"]);
    assert!(ctx["markdown"].as_str().unwrap().contains("Payments"));
    let wctx = c(&e, "context", json!({"files": ["services/worker.py"]}));
    let wt: Vec<&str> = wctx["memory"].as_array().unwrap().iter().map(|m| m["title"].as_str().unwrap()).collect();
    assert_eq!(wt, vec!["Worker may shell out"]);

    // verify: the checkout.ts → Button.tsx import violates the constraint
    let v = c(&e, "verify", json!({"files": ["src/payments/checkout.ts"], "run_commands": false}));
    assert_eq!(v["ok"], false, "{v}");
    assert!(v["issues"].as_array().unwrap().iter().any(|i| i["source"] == "constraint" && i["id"] == "payments-must-not-ui"), "{v}");

    // graph op reports the violating code edge
    let g = c(&e, "graph", json!({}));
    assert!(g["code_edges"].as_array().unwrap().iter().any(|ce| ce["from"] == "payments" && ce["to"] == "ui" && ce["violation"] == "payments-must-not-ui"));

    // an active guardrail with a forbidden pattern is enforced too
    c(&e, "guardrail.add", json!({"guardrail": {"id": "quiet-payments", "mode": "active", "statement": "No console.log in payments", "scope": {"nodes": ["payments"]}, "checks": [{"type": "forbid_pattern", "pattern": "console\\.log", "files": ["src/payments/**"]}]}}));
    let v2 = c(&e, "verify", json!({"files": ["src/payments/checkout.ts"], "run_commands": false}));
    assert!(v2["issues"].as_array().unwrap().iter().any(|i| i["source"] == "guardrail" && i["id"].as_str().unwrap().starts_with("quiet-payments")), "{v2}");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn drift_policy_maps_confident_files_and_proposes_uncertain_ones() {
    let dir = tmp_project("drift");
    let e = engine(&dir);
    // Only list explicit files, so a new sibling is drift.
    c(&e, "blueprint.add", json!({"name": "Payments", "files": ["src/payments/checkout.ts", "src/payments/stripe.ts"]}));
    c(&e, "blueprint.add", json!({"name": "Identity", "files": ["src/identity/user.ts"]}));
    c(&e, "blueprint.add", json!({"name": "UI", "files": ["src/ui/Button.tsx"]}));
    c(&e, "blueprint.add", json!({"name": "Worker", "files": ["services/worker.py"]}));
    c(&e, "sync", json!({}));

    // 1. a new file whose siblings all belong to Payments → high confidence → auto-mapped
    fs::write(dir.join("src/payments/refunds.ts"), "export function refund() {}\n").unwrap();
    // 2. a file in a directory nobody owns → low confidence → proposal (new node)
    fs::create_dir_all(dir.join("src/notifications")).unwrap();
    fs::write(dir.join("src/notifications/mailer.ts"), "export function send() {}\n").unwrap();

    let d = c(&e, "drift", json!({}));
    let findings = d["findings"].as_array().unwrap();
    let refunds = findings.iter().find(|f| f["finding"]["files"].as_array().map(|a| a.contains(&json!("src/payments/refunds.ts"))).unwrap_or(false)).expect("finding for refunds.ts");
    assert_eq!(refunds["bucket"], "auto", "{refunds}");
    let mailer = findings.iter().find(|f| f["finding"]["files"].as_array().map(|a| a.contains(&json!("src/notifications/mailer.ts"))).unwrap_or(false)).expect("finding for mailer.ts");
    assert_eq!(mailer["bucket"], "proposal", "{mailer}");

    let s = c(&e, "sync", json!({}));
    assert_eq!(s["applied"].as_array().unwrap().len(), 1, "{s}");
    assert_eq!(s["proposed"].as_array().unwrap().len(), 1, "{s}");

    // refunds.ts is now part of Payments in the blueprint file itself
    let bp = fs::read_to_string(dir.join(".afwe/blueprint/blueprint.yaml")).unwrap();
    assert!(bp.contains("src/payments/refunds.ts"), "{bp}");
    assert!(!bp.contains("mailer.ts"), "uncertain change must not be applied: {bp}");

    // the proposal can be reviewed and accepted → creates the node
    let props = c(&e, "proposals.list", json!({}));
    let id = props[0]["id"].as_str().unwrap().to_string();
    let review = c(&e, "proposal.resolve", json!({"id": id, "action": "review"}));
    assert!(review["finding"]["summary"].as_str().unwrap().contains("mailer.ts"));
    let acc = c(&e, "proposal.resolve", json!({"id": id, "action": "accept"}));
    assert_eq!(acc["status"], "accepted");
    let bp = fs::read_to_string(dir.join(".afwe/blueprint/blueprint.yaml")).unwrap();
    assert!(bp.contains("notifications"), "{bp}");

    // the log records origins and confidence
    let log = fs::read_to_string(dir.join(".afwe/log/changes.jsonl")).unwrap();
    assert!(log.contains("\"confidence\""));
    assert!(log.contains("Accepted proposal"));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_detection_keeps_identity_without_line_numbers() {
    let dir = tmp_project("rename");
    let e = engine(&dir);
    c(&e, "blueprint.add", json!({"name": "Payments", "files": ["src/payments/checkout.ts"], "symbols": ["src/payments/stripe.ts::charge"]}));
    c(&e, "blueprint.add", json!({"name": "Identity", "files": ["src/identity/**"]}));
    c(&e, "blueprint.add", json!({"name": "UI", "files": ["src/ui/**"]}));
    c(&e, "blueprint.add", json!({"name": "Worker", "files": ["services/**"]}));
    c(&e, "sync", json!({}));

    // move the file and rename the module: same content → same fingerprint → confident remap
    fs::create_dir_all(dir.join("src/billing")).unwrap();
    fs::rename(dir.join("src/payments/stripe.ts"), dir.join("src/billing/stripe_gateway.ts")).unwrap();
    let s = c(&e, "sync", json!({}));
    let applied = s["applied"].as_array().unwrap();
    assert!(!applied.is_empty(), "expected a confident remap, got {s}");
    let bp = fs::read_to_string(dir.join(".afwe/blueprint/blueprint.yaml")).unwrap();
    assert!(bp.contains("src/billing/stripe_gateway.ts::charge"), "{bp}");
    assert!(!bp.contains("src/payments/stripe.ts"), "{bp}");
    assert!(!bp.contains("line"), "no line numbers anywhere in the blueprint");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn contracts_track_obligations_and_lenses_do_not_touch_the_blueprint() {
    let dir = tmp_project("contract");
    let e = engine(&dir);
    c(&e, "blueprint.add", json!({"name": "Payments", "files": ["src/payments/**"]}));
    c(&e, "blueprint.add", json!({"name": "Identity", "files": ["src/identity/**"]}));
    c(&e, "blueprint.add", json!({"name": "UI", "files": ["src/ui/**"]}));
    c(&e, "blueprint.add", json!({"name": "Worker", "files": ["services/**"]}));

    let t = c(&e, "task.start", json!({"title": "Add refunds", "kind": "code", "files": ["src/payments/checkout.ts"]}));
    let task = t["task"]["id"].as_str().unwrap().to_string();
    assert_eq!(t["obligations"].as_array().unwrap().len(), 5); // context, verify, update, sync, log (implement is the harness's)
    let ids: std::collections::HashSet<String> = t["obligations"].as_array().unwrap().iter().map(|o| o["id"].as_str().unwrap().to_string()).collect();
    assert_eq!(ids.len(), 5, "board item ids must be unique");

    c(&e, "context", json!({"files": ["src/payments/checkout.ts"], "task": task}));
    c(&e, "memory.add", json!({"kind": "decision", "title": "Refunds are async", "applies_to": ["payments"], "task": task}));
    c(&e, "sync", json!({"task": task}));
    let done = c(&e, "task.done", json!({"task": task, "message": "refunds added"}));
    // verify was never run successfully → still owed
    assert_eq!(done["unfulfilled"], json!(["afwe_verify"]), "{done}");

    let before = fs::read_to_string(dir.join(".afwe/blueprint/blueprint.yaml")).unwrap();
    c(&e, "lens.save", json!({"lens": {"id": "", "name": "Money view", "groups": [{"name": "Money", "nodes": ["payments", "identity"]}]}}));
    let lens = c(&e, "lens.get", json!({"id": "money-view"}));
    assert_eq!(lens["view"]["groups"][0]["children"].as_array().unwrap().len(), 2);
    let after = fs::read_to_string(dir.join(".afwe/blueprint/blueprint.yaml")).unwrap();
    assert_eq!(before, after, "a lens must have zero impact on the blueprint");

    // workflow: prompt retained as provenance, component promoted into a planned node
    let w = c(&e, "workflow.new", json!({"title": "Refund flow", "prompt": "Please add refunds", "origin": "llm:test-model"}));
    assert_eq!(w["nodes"][0]["kind"], "prompt");
    assert_eq!(w["nodes"][0]["origin"], "llm:test-model");
    c(&e, "workflow.add_node", json!({"workflow": "refund-flow", "kind": "component", "title": "Refund service", "text": "issues refunds"}));
    let created = c(&e, "workflow.promote", json!({"id": "refund-flow", "parent": "payments"}));
    assert_eq!(created[0]["status"], "planned");
    let g = c(&e, "graph", json!({}));
    assert!(g["nodes"].as_array().unwrap().iter().any(|n| n["name"] == "Refund service" && n["parent"] == "payments"));

    let _ = fs::remove_dir_all(&dir);
}
