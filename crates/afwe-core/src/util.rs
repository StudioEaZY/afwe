use std::path::Path;

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

/// Lower‑case, ASCII, dash separated slug. `Dashboard.Widget` -> `dashboard-widget`.
pub fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true;
    for ch in s.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "item".into()
    } else {
        out
    }
}

pub fn short_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = chrono::Utc::now().timestamp_millis();
    let c = COUNTER.fetch_add(1, Ordering::Relaxed);
    let h = blake3::hash(format!("{n}{prefix}{}{c}", std::process::id()).as_bytes());
    format!("{prefix}-{}", &h.to_hex()[..6])
}

pub fn hash_bytes(b: &[u8]) -> String {
    blake3::hash(b).to_hex()[..16].to_string()
}

pub fn hash_str(s: &str) -> String {
    hash_bytes(s.as_bytes())
}

/// Normalise whitespace so a fingerprint survives re‑formatting.
pub fn normalise_code(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut ws = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !ws {
                out.push(' ');
                ws = true;
            }
        } else {
            out.push(ch);
            ws = false;
        }
    }
    out
}

pub fn to_unix(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

pub fn is_glob(s: &str) -> bool {
    s.contains('*') || s.contains('?') || s.contains('[') || s.contains('{')
}

pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let t: String = s.chars().take(max).collect();
        format!("{t}…")
    }
}

/// Parse `origin` strings; anything unknown is kept verbatim.
pub fn origin_or(o: Option<&str>, default: &str) -> String {
    match o {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => default.to_string(),
    }
}

pub fn clamp01(x: f64) -> f64 {
    x.clamp(0.0, 1.0)
}
