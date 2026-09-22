//! AFWE Studio desktop shell (Tauri v2).
//!
//! The shell is deliberately thin: it owns a single `Engine` (the currently open project) and
//! exposes the engine's JSON surface as one command, `call(op, params, origin)` — exactly the same
//! contract the browser build reaches over `POST /api/call`. The React frontend does not know or
//! care which shell it is running in (see `src/api.ts`).

use afwe_core::engine::Engine;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    engine: Mutex<Option<Engine>>,
}

fn open_engine(path: &PathBuf) -> anyhow::Result<Engine> {
    Engine::open(path)
}

/// Single JSON entry point shared with the CLI, MCP server and HTTP host.
#[tauri::command]
fn call(state: State<'_, AppState>, op: String, params: Option<Value>, origin: Option<String>) -> Result<Value, String> {
    let guard = state.engine.lock().map_err(|e| e.to_string())?;
    let engine = guard.as_ref().ok_or_else(|| "no project open — use File ▸ Open (open_project_dialog)".to_string())?;
    afwe_core::api::call(engine, &op, params.unwrap_or(Value::Null), origin.as_deref().unwrap_or("human")).map_err(|e| format!("{e:#}"))
}

/// Ask the user for a project folder (one that contains `.afwe/`, or will after `afwe init`).
#[tauri::command]
async fn open_project_dialog(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(folder) = picked else { return Ok(None) };
    let path = folder.into_path().map_err(|e| e.to_string())?;
    let engine = open_engine(&path).map_err(|e| format!("{e:#}"))?;
    *state.engine.lock().map_err(|e| e.to_string())? = Some(engine);
    app.emit_to("main", "afwe://project-changed", path.to_string_lossy().to_string()).ok();
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn current_project(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let guard = state.engine.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().map(|e| e.store.project_root.to_string_lossy().to_string()))
}

/// Open a project by path (used by the CLI: `afwe studio --desktop <path>` or deep links).
#[tauri::command]
fn open_project(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let engine = open_engine(&p).map_err(|e| format!("{e:#}"))?;
    *state.engine.lock().map_err(|e| e.to_string())? = Some(engine);
    Ok(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Project comes from argv (`afwe-studio /path/to/project`), else $AFWE_PROJECT, else cwd if it has .afwe.
    let initial = std::env::args().nth(1).map(PathBuf::from).or_else(|| std::env::var("AFWE_PROJECT").ok().map(PathBuf::from)).or_else(|| {
        let cwd = std::env::current_dir().ok()?;
        if cwd.join(".afwe").is_dir() { Some(cwd) } else { None }
    });
    let engine = initial.and_then(|p| open_engine(&p).ok());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { engine: Mutex::new(engine) })
        .invoke_handler(tauri::generate_handler![call, open_project_dialog, current_project, open_project])
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_title("AFWE Studio");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AFWE Studio");
}
