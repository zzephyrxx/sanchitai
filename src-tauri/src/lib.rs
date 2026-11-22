mod local_server;

use local_server::{
    focus_main_window, minimize_main_window, open_system_browser, start_local_server,
    LocalServerState, PrefsPatch, SyncEnvelope,
};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
fn get_local_bridge_info(state: State<'_, LocalServerState>) -> serde_json::Value {
    state.build_info_json()
}

#[tauri::command]
fn pull_sync_data(state: State<'_, LocalServerState>) -> SyncEnvelope {
    state.read_sync_data()
}

#[tauri::command]
fn push_sync_data(state: State<'_, LocalServerState>, payload: serde_json::Value) -> Result<u64, String> {
    state.write_sync_data(payload)
}

#[tauri::command]
fn open_in_browser(
    app: AppHandle,
    state: State<'_, LocalServerState>,
    browser_id: Option<String>,
) -> Result<String, String> {
    let target = browser_id.unwrap_or_else(|| state.read_prefs().preferred_browser);
    let url = state.bridge_url();
    open_system_browser(&url, &target)?;
    minimize_main_window(&app);
    Ok(url)
}

#[tauri::command]
fn focus_desktop_window(app: AppHandle) {
    focus_main_window(&app);
}

#[tauri::command]
fn set_launch_prefs(
    state: State<'_, LocalServerState>,
    default_open_mode: Option<String>,
    preferred_browser: Option<String>,
) -> Result<serde_json::Value, String> {
    let saved = state.update_prefs(PrefsPatch {
        default_open_mode,
        preferred_browser,
    })?;
    Ok(serde_json::json!({
        "ok": true,
        "defaultOpenMode": saved.default_open_mode,
        "preferredBrowser": saved.preferred_browser
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = start_local_server(app.handle().clone()).map_err(std::io::Error::other)?;
            let prefs = state.read_prefs();
            let launch_url = state.bridge_url();
            app.manage(state);

            if prefs.default_open_mode == "browser" {
                let _ = open_system_browser(&launch_url, &prefs.preferred_browser);
                minimize_main_window(&app.handle().clone());
            } else {
                focus_main_window(&app.handle().clone());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_local_bridge_info,
            pull_sync_data,
            push_sync_data,
            open_in_browser,
            focus_desktop_window,
            set_launch_prefs
        ])
        .run(tauri::generate_context!())
        .expect("error while running 三尺台");
}
