//! `afwe studio` — web host for the Studio UI with live SSE event streaming.
//!
//! Serves the built frontend (embedded at compile time from `apps/studio/web-dist`, or
//! any directory passed with `--dist`) and a single JSON endpoint `POST /api/call`
//! `{ "op": "...", "params": {...} }` that maps 1:1 onto the engine API.
//! Also streams live SSE events via `/api/events` to all connected clients.

use afwe_core::api;
use afwe_core::engine::Engine;
use anyhow::Result;
use include_dir::{include_dir, Dir};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tiny_http::{Header, Method, Response, Server, StatusCode};

static EMBEDDED: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../apps/studio/web-dist");

type Broadcaster = Arc<Mutex<Vec<Sender<String>>>>;

pub fn serve(start: PathBuf, host: &str, port: u16, open_browser: bool, dist: Option<PathBuf>) -> Result<()> {
    let engine = Engine::open(&start)?;
    let project = engine.store.manifest()?.project.name;
    let project_root = engine.store.project_root.clone();
    let engine = Arc::new(Mutex::new(engine));
    let dist = dist.or_else(|| std::env::var("AFWE_STUDIO_DIST").ok().map(PathBuf::from));

    // Force loopback if 0.0.0.0 requested for safety
    let bind_host = if host == "0.0.0.0" { "127.0.0.1" } else { host };
    let server = Server::http(format!("{bind_host}:{port}")).map_err(|e| anyhow::anyhow!("cannot bind {bind_host}:{port}: {e}"))?;
    let url = format!("http://{bind_host}:{port}");

    // Record daemon state in .afwe/state/daemon.json
    let _ = write_daemon_state(&project_root, port, &url);

    eprintln!("AFWE Studio for `{project}` → {url}   (API: POST {url}/api/call)   Ctrl-C to stop");
    if open_browser {
        let _ = open::that(&url);
    }

    let broadcaster: Broadcaster = Arc::new(Mutex::new(Vec::new()));
    let server = Arc::new(server);

    // Multi-threaded server loop
    for mut req in server.incoming_requests() {
        let path = req.url().split('?').next().unwrap_or("/").to_string();
        let method = req.method().clone();

        // Origin and CSRF check
        if !is_allowed_origin(&req) {
            let mut r = Response::from_string("403 Forbidden: Cross-Origin Request Blocked").with_status_code(StatusCode(403));
            r.add_header(Header::from_bytes("Content-Type", "text/plain").unwrap());
            let _ = req.respond(r);
            continue;
        }

        if path == "/api/events" {
            // Subscribe client to SSE stream
            let (tx, rx) = channel();
            let _ = tx.send("event: ping\ndata: {\"status\":\"connected\"}\n\n".to_string());
            {
                let mut b = broadcaster.lock().unwrap();
                b.push(tx);
            }

            let sse_reader = SseReader { rx, pending: Vec::new() };
            std::thread::spawn(move || {
                let resp = Response::new(
                    StatusCode(200),
                    vec![
                        Header::from_bytes("Content-Type", "text/event-stream").unwrap(),
                        Header::from_bytes("Cache-Control", "no-cache").unwrap(),
                        Header::from_bytes("Connection", "keep-alive").unwrap(),
                        Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
                    ],
                    Box::new(sse_reader) as Box<dyn Read + Send>,
                    None,
                    None,
                );
                let _ = req.respond(resp);
            });
        } else if path.starts_with("/api/action") || path == "/api/approve" || path == "/api/revert" {
            let engine = engine.clone();
            let broadcaster = broadcaster.clone();
            let full_url = req.url().to_string();
            let is_json = req.headers().iter().any(|h| h.field.as_str().as_str().eq_ignore_ascii_case("accept") && h.value.as_str().contains("application/json"));
            std::thread::spawn(move || {
                let (html, json_val) = handle_toast_action(&engine, &full_url, &broadcaster);
                if is_json {
                    let mut r = Response::from_string(serde_json::to_string(&json_val).unwrap()).with_status_code(StatusCode(200));
                    r.add_header(Header::from_bytes("Content-Type", "application/json").unwrap());
                    r.add_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());
                    let _ = req.respond(r);
                } else {
                    let mut r = Response::from_string(html).with_status_code(StatusCode(200));
                    r.add_header(Header::from_bytes("Content-Type", "text/html; charset=utf-8").unwrap());
                    let _ = req.respond(r);
                }
            });
        } else if path.starts_with("/api/") {
            let engine = engine.clone();
            let broadcaster = broadcaster.clone();
            std::thread::spawn(move || {
                let mut body = String::new();
                let _ = req.as_reader().read_to_string(&mut body);
                let (status, value, broadcast_op) = handle_api(&engine, &method, &path, &body, &broadcaster);

                if let Some(op) = broadcast_op {
                    broadcast_event(&broadcaster, &op);
                }

                let mut r = Response::from_string(serde_json::to_string(&value).unwrap()).with_status_code(StatusCode(status));
                r.add_header(Header::from_bytes("Content-Type", "application/json").unwrap());
                r.add_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap());
                r.add_header(Header::from_bytes("Access-Control-Allow-Headers", "content-type").unwrap());
                r.add_header(Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap());
                let _ = req.respond(r);
            });
        } else {
            let dist = dist.clone();
            std::thread::spawn(move || {
                let resp = serve_static(&path, dist.as_ref());
                let _ = req.respond(resp);
            });
        }
    }

    let _ = cleanup_daemon_state(&project_root);
    Ok(())
}

fn is_allowed_origin(req: &tiny_http::Request) -> bool {
    let origin_header = req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("origin"));
    if let Some(h) = origin_header {
        let val = h.value.as_str();
        val.starts_with("http://localhost")
            || val.starts_with("http://127.0.0.1")
            || val.starts_with("tauri://")
            || val.starts_with("http://tauri.localhost")
            || val.starts_with("https://tauri.localhost")
    } else {
        true
    }
}

struct SseReader {
    rx: Receiver<String>,
    pending: Vec<u8>,
}

impl Read for SseReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if !self.pending.is_empty() {
            let n = std::cmp::min(buf.len(), self.pending.len());
            buf[..n].copy_from_slice(&self.pending[..n]);
            self.pending.drain(..n);
            return Ok(n);
        }

        match self.rx.recv_timeout(Duration::from_secs(15)) {
            Ok(msg) => {
                let bytes = msg.into_bytes();
                let n = std::cmp::min(buf.len(), bytes.len());
                buf[..n].copy_from_slice(&bytes[..n]);
                if n < bytes.len() {
                    self.pending.extend_from_slice(&bytes[n..]);
                }
                Ok(n)
            }
            Err(RecvTimeoutError::Timeout) => {
                let keepalive = b": keepalive\n\n";
                let n = std::cmp::min(buf.len(), keepalive.len());
                buf[..n].copy_from_slice(&keepalive[..n]);
                if n < keepalive.len() {
                    self.pending.extend_from_slice(&keepalive[n..]);
                }
                Ok(n)
            }
            Err(RecvTimeoutError::Disconnected) => Ok(0),
        }
    }
}

fn broadcast_event(broadcaster: &Broadcaster, op: &str) {
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let msg = format!("event: update\ndata: {{\"op\":\"{}\",\"timestamp\":{}}}\n\n", op, ts);
    let mut senders = broadcaster.lock().unwrap();
    senders.retain(|s| s.send(msg.clone()).is_ok());
}

fn handle_api(engine: &Arc<Mutex<Engine>>, method: &Method, path: &str, body: &str, broadcaster: &Broadcaster) -> (u16, Value, Option<String>) {
    if *method == Method::Options {
        return (204, json!({}), None);
    }
    match path {
        "/api/health" => {
            let root = engine
                .lock()
                .map(|guard| guard.store.project_root.to_string_lossy().to_string())
                .unwrap_or_default();
            (200, json!({"ok": true, "engine": afwe_core::ENGINE_VERSION, "root": root}), None)
        }
        "/api/ops" => (200, json!(api::OPS), None),
        "/api/action" | "/api/approve" | "/api/revert" => {
            let full_url = format!("{path}?{body}");
            let (_, json_val) = handle_toast_action(engine, &full_url, broadcaster);
            (200, json_val, Some("action".to_string()))
        }
        "/api/call" => {
            let req: Value = match serde_json::from_str(body) {
                Ok(v) => v,
                Err(e) => return (400, json!({"ok": false, "error": format!("invalid json: {e}")}), None),
            };
            let op = req.get("op").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let params = req.get("params").cloned().unwrap_or(json!({}));
            let origin = req.get("origin").and_then(|v| v.as_str()).unwrap_or("human").to_string();
            let eng = engine.lock().unwrap();
            match api::call(&eng, &op, params, &origin) {
                Ok(v) => (200, json!({"ok": true, "result": v}), Some(op)),
                Err(e) => (200, json!({"ok": false, "error": format!("{e:#}")}), None),
            }
        }
        _ => (404, json!({"ok": false, "error": "not found"}), None),
    }
}

fn url_decode(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let h1 = chars.next().unwrap_or('0');
            let h2 = chars.next().unwrap_or('0');
            let hex = format!("{h1}{h2}");
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                out.push(byte as char);
            } else {
                out.push('%');
                out.push(h1);
                out.push(h2);
            }
        } else if c == '+' {
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

fn handle_toast_action(
    engine: &Arc<Mutex<Engine>>,
    path: &str,
    broadcaster: &Arc<Mutex<Vec<Sender<String>>>>,
) -> (String, Value) {
    let query_str = path.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut act = String::new();
    let mut id = String::new();
    let mut reply = String::new();
    for pair in query_str.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == "act" {
                act = v.to_string();
            } else if k == "id" {
                id = v.to_string();
            } else if k == "reply" || k == "answer" {
                reply = url_decode(v);
            }
        }
    }

    let mut result_msg = String::new();
    let mut success = false;
    let eng = engine.lock().unwrap();

    if act == "approve" {
        let mut committed = false;
        if id.starts_with('t') {
            let turn_status = eng.store.turn(&id).ok().flatten().map(|t| t.status);
            if let Some(status) = turn_status {
                if status == "staged" {
                    match api::call(&eng, "turn.confirm", json!({"turn": id}), "human") {
                        Ok(_) => {
                            result_msg = format!("Turn {} proposal confirmed and committed.", id);
                            success = true;
                            committed = true;
                        }
                        Err(e) => {
                            result_msg = format!("turn.confirm note: {e}");
                        }
                    }
                } else if status == "committed" || status == "ready" {
                    result_msg = format!("Turn {} is already committed and approved.", id);
                    success = true;
                    committed = true;
                } else {
                    match api::call(&eng, "turn.commit", json!({"turn": id, "summary": "Approved via Windows notification", "footer_shown": true, "confirmed": true}), "human") {
                        Ok(_) => {
                            result_msg = format!("Turn {} committed and approved.", id);
                            success = true;
                            committed = true;
                        }
                        Err(e) => {
                            result_msg = format!("turn.commit note: {e}");
                        }
                    }
                }
            } else {
                match api::call(&eng, "turn.confirm", json!({"turn": id}), "human") {
                    Ok(_) => {
                        result_msg = format!("Turn {} confirmed.", id);
                        success = true;
                        committed = true;
                    }
                    Err(_) => {
                        match api::call(&eng, "turn.commit", json!({"turn": id, "summary": "Approved via Windows notification", "footer_shown": true, "confirmed": true}), "human") {
                            Ok(_) => {
                                result_msg = format!("Turn {} committed.", id);
                                success = true;
                                committed = true;
                            }
                            Err(e) => {
                                result_msg = format!("turn commit note: {e}");
                            }
                        }
                    }
                }
            }
        }
        if !committed {
            match api::call(&eng, "queue.act", json!({"item": id, "action": "approve"}), "human") {
                Ok(_) => {
                    result_msg = format!("Action approved for item {}.", id);
                    success = true;
                }
                Err(e) => {
                    if !result_msg.is_empty() {
                        result_msg.push_str(&format!(" | queue.act error: {e}"));
                    } else {
                        result_msg = format!("Approval failed: {e}");
                    }
                }
            }
        }
        if success {
            broadcast_event(broadcaster, "turn.commit");
            broadcast_event(broadcaster, "queue.act");
        }
    } else if act == "revert" {
        let mut reverted = false;
        if id.starts_with('t') {
            match api::call(&eng, "turn.redo", json!({"turn": id}), "human") {
                Ok(_) => {
                    result_msg = format!("Turn {} successfully reverted/reset to baseline.", id);
                    success = true;
                    reverted = true;
                }
                Err(e) => {
                    result_msg = format!("turn.redo note: {e}");
                }
            }
        }
        if !reverted {
            match api::call(&eng, "queue.act", json!({"item": id, "action": "revert"}), "human") {
                Ok(_) => {
                    result_msg = format!("Item {} successfully reverted.", id);
                    success = true;
                }
                Err(e) => {
                    if !result_msg.is_empty() {
                        result_msg.push_str(&format!(" | queue.act error: {e}"));
                    } else {
                        result_msg = format!("Revert failed: {e}");
                    }
                }
            }
        }
        if success {
            broadcast_event(broadcaster, "turn.redo");
            broadcast_event(broadcaster, "queue.act");
        }
    } else if act == "resume" {
        let answer = if reply.is_empty() { "Approved via desktop notification".to_string() } else { reply };
        match api::call(&eng, "turn.resume", json!({"turn": id, "answer": answer}), "human") {
            Ok(_) => {
                result_msg = format!("Turn {} resumed with answer: {}", id, answer);
                success = true;
            }
            Err(e) => {
                result_msg = format!("turn.resume error: {e}");
            }
        }
        if success {
            broadcast_event(broadcaster, "turn.resume");
            broadcast_event(broadcaster, "queue.act");
        }
    } else if act == "adopt" {
        match api::call(&eng, "drift.verdict", json!({"id": id, "verdict": {"verdict": "adopt", "tune": false}}), "human") {
            Ok(_) => {
                result_msg = format!("Drift {} adopted.", id);
                success = true;
            }
            Err(e) => {
                result_msg = format!("drift.verdict error: {e}");
            }
        }
        if success {
            broadcast_event(broadcaster, "drift.verdict");
            broadcast_event(broadcaster, "queue.act");
        }
    } else if act == "tolerate" {
        let note = if reply.is_empty() { None } else { Some(reply) };
        match api::call(&eng, "drift.verdict", json!({"id": id, "verdict": {"verdict": "tolerate", "note": note}}), "human") {
            Ok(_) => {
                result_msg = format!("Drift {} tolerated.", id);
                success = true;
            }
            Err(e) => {
                result_msg = format!("drift.verdict error: {e}");
            }
        }
        if success {
            broadcast_event(broadcaster, "drift.verdict");
            broadcast_event(broadcaster, "queue.act");
        }
    } else {
        result_msg = format!("Unknown action '{}'", act);
    }

    let status_color = if success { "#4A6150" } else { "#C4513F" };
    let status_badge = if success { "✔ SUCCESS" } else { "✕ ACTION NOTICE" };

    let html = format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AFWE Action: {act}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {{
      background: #191816;
      color: #EDE8DC;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }}
    .card {{
      background: #22211E;
      border: 1px solid #34322D;
      border-radius: 16px;
      padding: 32px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      text-align: center;
    }}
    .badge {{
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: {status_color};
      color: #F4F1E8;
      margin-bottom: 16px;
    }}
    h1 {{
      font-size: 20px;
      margin: 0 0 10px 0;
      font-weight: 600;
      color: #EDE8DC;
    }}
    p {{
      font-size: 13.5px;
      color: #9C968A;
      line-height: 1.5;
      margin: 0 0 24px 0;
    }}
    .btn {{
      display: inline-block;
      padding: 10px 20px;
      background: #4A6150;
      color: #F4F1E8;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      margin: 0 6px;
      border: none;
      cursor: pointer;
      transition: opacity 0.2s;
    }}
    .btn:hover {{ opacity: 0.9; }}
    .btn-secondary {{
      background: #34322D;
      color: #EDE8DC;
    }}
    .brand {{
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 24px;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img src="/afwe-icon.svg" style="width: 32px; height: 32px;" alt="AFWE" />
      <svg viewBox="0 0 240 50" style="width: 100px; height: 20px; color: #EDE8DC;" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="square">
        <path d="M 6,45 L 26,7 L 46,45" />
        <path d="M 64,7 L 100,7" />
        <path d="M 66,22 L 66,45" />
        <path d="M 64,22 L 100,22" />
        <path d="M 120,4 L 120,45" />
        <path d="M 136,12 L 136,45" />
        <path d="M 152,4 L 152,45" />
        <path d="M 172,11 L 210,11" />
        <path d="M 172,26 L 210,26" />
        <path d="M 172,41 L 210,41" />
      </svg>
    </div>
    <div class="badge">{status_badge}</div>
    <h1>ACTION: {act}</h1>
    <p>{result_msg}</p>
    <div>
      <a href="/?view=timeline&turn={id}" class="btn">View Turn in Studio</a>
      <button class="btn btn-secondary" onclick="window.close()">Close Window</button>
    </div>
  </div>
</body>
</html>"#);

    (html, json!({"ok": success, "message": result_msg, "turn": id, "action": act}))
}

fn write_daemon_state(root: &Path, port: u16, url: &str) -> Result<()> {
    let state_dir = root.join(".afwe").join("state");
    std::fs::create_dir_all(&state_dir)?;
    let daemon_file = state_dir.join("daemon.json");
    let state = json!({
        "pid": std::process::id(),
        "port": port,
        "url": url,
        "root": root.canonicalize().unwrap_or_else(|_| root.to_path_buf()).to_string_lossy(),
        "started_at": chrono_like_now(),
    });
    std::fs::write(daemon_file, serde_json::to_string_pretty(&state)?)?;
    Ok(())
}

fn cleanup_daemon_state(root: &Path) -> Result<()> {
    let daemon_file = root.join(".afwe").join("state").join("daemon.json");
    if daemon_file.exists() {
        let _ = std::fs::remove_file(daemon_file);
    }
    Ok(())
}

fn chrono_like_now() -> String {
    let s = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    format!("{s}")
}

/// Helper called on `turn.begin` to ensure background studio daemon is running.
/// Returns an error when the daemon could not be spawned or did not answer, so auto-start is
/// observable instead of silently failing.
pub fn ensure_daemon_running(project_root: &Path) -> Result<()> {
    if std::env::var_os("AFWE_NO_AUTOSTART").is_some() {
        return Ok(());
    }
    let requested_port = std::fs::read_to_string(project_root.join(".afwe").join("state").join("daemon.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .and_then(|value| value.get("port").and_then(|port| port.as_u64()))
        .map(|port| port as u16)
        .unwrap_or(4242);

    if daemon_serves(project_root, requested_port) {
        return Ok(());
    }

    // Check if an existing daemon is already running for this project on any port in range
    for port in 4242..=4260 {
        if daemon_serves(project_root, port) {
            let url = format!("http://127.0.0.1:{port}");
            let _ = write_daemon_state(project_root, port, &url);
            return Ok(());
        }
    }

    // Find the first available port not occupied by another project or process
    let mut chosen_port = None;
    for port in 4242..=4260 {
        if daemon_health(port).is_none() && std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            chosen_port = Some(port);
            break;
        }
    }

    let target_port = match chosen_port {
        Some(p) => p,
        None => return Err(anyhow::anyhow!(
            "all Studio ports in range 4242-4260 are currently occupied; cannot auto-start Studio"
        )),
    };

    let exe = std::env::current_exe()?;
    std::process::Command::new(exe)
        .arg("studio")
        .arg("--no-open")
        .arg("--port")
        .arg(target_port.to_string())
        .current_dir(project_root)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?;

    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(100));
        if daemon_serves(project_root, target_port) {
            return Ok(());
        }
    }
    Err(anyhow::anyhow!(
        "studio daemon was spawned on port {target_port} but is not answering for this project on 127.0.0.1:{target_port}"
    ))
}

fn daemon_health(port: u16) -> Option<Value> {
    let mut stream = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(300),
    )
    .ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(700))).ok()?;
    write!(
        stream,
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .ok()?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let body = response.split("\r\n\r\n").nth(1)?;
    serde_json::from_str(body.trim()).ok()
}

fn daemon_serves(project_root: &Path, port: u16) -> bool {
    let expected = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();
    daemon_health(port)
        .and_then(|health| {
            health
                .get("root")
                .and_then(|root| root.as_str())
                .map(|root| root.replace('\\', "/").to_lowercase() == expected)
        })
        .unwrap_or(false)
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "json" | "map" => "application/json",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "application/octet-stream",
    }
}

fn serve_static(path: &str, dist: Option<&PathBuf>) -> Response<std::io::Cursor<Vec<u8>>> {
    let rel = path.trim_start_matches('/');
    let candidates = if rel.is_empty() { vec!["index.html".to_string()] } else { vec![rel.to_string(), "index.html".to_string()] };
    for c in &candidates {
        if let Some(d) = dist {
            let p = d.join(c);
            if p.is_file() {
                if let Ok(bytes) = std::fs::read(&p) {
                    return with_mime(Response::from_data(bytes), c);
                }
            }
        } else if let Some(f) = EMBEDDED.get_file(c) {
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
