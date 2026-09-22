// Make sure the embedded Studio directory exists even if the frontend was not built,
// so `cargo build` never fails on a fresh checkout.
use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = manifest.join("../../apps/studio/web-dist");
    if !dist.join("index.html").exists() {
        std::fs::create_dir_all(&dist).ok();
        std::fs::write(
            dist.join("index.html"),
            "<!doctype html><meta charset=utf-8><title>AFWE Studio</title><body style=\"font-family:system-ui;padding:2rem;background:#0f1115;color:#e6e6e6\"><h1>AFWE Studio (web) — frontend not built</h1><p>Run <code>cd apps/studio && npm install && npm run build</code>, then rebuild <code>afwe</code> (or pass <code>--dist apps/studio/web-dist</code>).</p><p>The API is live at <code>POST /api/call</code>.</p></body>",
        )
        .ok();
    }
    println!("cargo:rerun-if-changed={}", dist.display());
}
