mod local_server;

use local_server::{
    focus_main_window, minimize_main_window, open_system_browser, start_local_server,
    LocalServerState,
};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
fn get_local_bridge_info(state: State<'_, LocalServerState>) -> serde_json::Value {
    let prefs = state.read_prefs();
    serde_json::json!({
        "ok": true,
        "port": state.port,
        "bridgeUrl": state.bridge_url(),
        "defaultOpenMode": prefs.default_open_mode,
        "desktopAvailable": true
    })
}

#[tauri::command]
fn open_in_browser(app: AppHandle, state: State<'_, LocalServerState>) -> Result<String, String> {
    let url = state.bridge_url();
    open_system_browser(&url)?;
    minimize_main_window(&app);
    Ok(url)
}

#[tauri::command]
fn focus_desktop_window(app: AppHandle) {
    focus_main_window(&app);
}

#[tauri::command]
fn set_default_open_mode(state: State<'_, LocalServerState>, mode: String) -> Result<String, String> {
    let saved = state.write_prefs(&mode)?;
    Ok(saved.default_open_mode)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = start_local_server(app.handle().clone())
                .map_err(std::io::Error::other)?;
            let prefs = state.read_prefs();
            let launch_url = state.bridge_url();
            app.manage(state);

            if prefs.default_open_mode == "browser" {
                let _ = open_system_browser(&launch_url);
                minimize_main_window(&app.handle().clone());
            } else {
                focus_main_window(&app.handle().clone());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_local_bridge_info,
            open_in_browser,
            focus_desktop_window,
            set_default_open_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running 三尺台");
}
