//! `afwe docs` — web host for the AFWE ReBorn documentation & concepts site.
//!
//! Serves the built static documentation frontend (embedded at compile time from
//! `apps/website/dist`, or any directory passed with `--dist`).

use anyhow::Result;
use include_dir::{include_dir, Dir};
use std::path::PathBuf;
use tiny_http::{Header, Response, Server, StatusCode};

static EMBEDDED_DOCS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../apps/website/dist");

pub fn serve(host: &str, port: u16, open_browser: bool, dist: Option<PathBuf>) -> Result<()> {
    let dist = dist.or_else(|| std::env::var("AFWE_DOCS_DIST").ok().map(PathBuf::from));
    let server = Server::http(format!("{host}:{port}")).map_err(|e| anyhow::anyhow!("cannot bind {host}:{port}: {e}"))?;
    let url = format!("http://{}:{port}", if host == "0.0.0.0" { "localhost" } else { host });
    eprintln!("AFWE ReBorn Docs → {url}   Ctrl-C to stop");
    if open_browser {
        let _ = open::that(&url);
    }
    for req in server.incoming_requests() {
        let path = req.url().split('?').next().unwrap_or("/").to_string();
        let resp = serve_static(&path, dist.as_ref());
        let _ = req.respond(resp);
    }
    Ok(())
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "json" | "map" => "application/json",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "application/octet-stream",
    }
}

fn serve_static(path: &str, dist: Option<&PathBuf>) -> Response<std::io::Cursor<Vec<u8>>> {
    let rel = path.trim_start_matches('/');
    let mut candidates = Vec::new();
    if rel.is_empty() {
        candidates.push("index.html".to_string());
    } else {
        candidates.push(rel.to_string());
        if !rel.contains('.') {
            candidates.push(format!("{rel}/index.html"));
            candidates.push(format!("{rel}.html"));
        }
        candidates.push("index.html".to_string());
    }

    for c in &candidates {
        if let Some(d) = dist {
            let p = d.join(c);
            if p.is_file() {
                if let Ok(bytes) = std::fs::read(&p) {
                    return with_mime(Response::from_data(bytes), c);
                }
            }
        } else if let Some(f) = EMBEDDED_DOCS.get_file(c) {
            return with_mime(Response::from_data(f.contents().to_vec()), c);
        }
    }
    Response::from_string("not found").with_status_code(StatusCode(404))
}

fn with_mime(mut r: Response<std::io::Cursor<Vec<u8>>>, name: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    r.add_header(Header::from_bytes("Content-Type", mime(name)).unwrap());
    if name != "index.html" {
        r.add_header(Header::from_bytes("Cache-Control", "public, max-age=3600").unwrap());
    }
    r
}
