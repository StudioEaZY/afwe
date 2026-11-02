//! End-to-end snapshot ref coverage: a parentless commit, a private index and a listed record.

use afwe_core::init::{init, InitOptions};
use afwe_core::snapshots::{self, SnapshotMeta};
use afwe_core::Engine;
use std::path::Path;
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git must be installed");
    assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn snapshot_ref_roundtrip_is_parentless_and_listed() {
    let dir = std::env::temp_dir().join(format!("afwe-snapshot-it-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/lib.rs"), "pub fn lib() {}\n").unwrap();
    git(&dir, &["init", "-q"]);
    let store = init(
        &dir,
        InitOptions { name: Some("snapshot-it".into()), description: None, root: None, force: true },
    )
    .unwrap();
    let engine = Engine { store };

    let meta: SnapshotMeta = snapshots::create(&engine, "manual", Some("t0001")).unwrap();
    assert!(meta.project_id.starts_with('p'), "{}", meta.project_id);
    assert_eq!(meta.phase, "manual");
    assert!(meta.files >= 1);
    assert!(!meta.commit.is_empty());

    let parents = git(&dir, &["rev-list", "--parents", "-n", "1", &meta.commit]);
    assert_eq!(parents.split_whitespace().count(), 1, "snapshot commit must have no parent");

    let listed = snapshots::list(&engine).unwrap();
    assert!(listed.iter().any(|item| item.id == meta.id));
    let shown = snapshots::show(&engine, &meta.id[..8]).unwrap();
    assert!(shown.is_some());

    let _ = std::fs::remove_dir_all(&dir);
}
