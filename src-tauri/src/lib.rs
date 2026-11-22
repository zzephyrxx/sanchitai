mod local_server;

use local_server::{
    focus_main_window, hide_or_minimize_main_window, minimize_main_window, open_system_browser,
    start_local_server, LocalServerState, PrefsPatch, SyncEnvelope,
};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, State, WindowEvent};

struct ExitFlag(AtomicBool);

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
    close_behavior: Option<String>,
) -> Result<serde_json::Value, String> {
    let saved = state.update_prefs(PrefsPatch {
        default_open_mode,
        preferred_browser,
        close_behavior,
    })?;
    Ok(serde_json::json!({
        "ok": true,
        "defaultOpenMode": saved.default_open_mode,
        "preferredBrowser": saved.preferred_browser,
        "closeBehavior": saved.close_behavior
    }))
}

#[tauri::command]
fn apply_close_action(
    app: AppHandle,
    state: State<'_, LocalServerState>,
    exit_flag: State<'_, ExitFlag>,
    action: String,
    remember: bool,
) -> Result<(), String> {
    let normalized = if action == "exit" { "exit" } else { "minimize" };
    if remember {
        let _ = state.update_prefs(PrefsPatch {
            default_open_mode: None,
            preferred_browser: None,
            close_behavior: Some(normalized.to_string()),
        });
    }
    if normalized == "exit" {
        exit_flag.0.store(true, Ordering::SeqCst);
        app.exit(0);
    } else {
        hide_or_minimize_main_window(&app);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(ExitFlag(AtomicBool::new(false)))
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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app_handle = window.app_handle();
                if app_handle.state::<ExitFlag>().0.load(Ordering::SeqCst) {
                    return;
                }
                let behavior = app_handle.state::<LocalServerState>().read_prefs().close_behavior;
                match behavior.as_str() {
                    "exit" => {
                        app_handle.state::<ExitFlag>().0.store(true, Ordering::SeqCst);
                        app_handle.exit(0);
                    }
                    "minimize" => {
                        api.prevent_close();
                        hide_or_minimize_main_window(app_handle);
                    }
                    _ => {
                        api.prevent_close();
                        if let Some(wv) = app_handle.get_webview_window("main") {
                            let _ = wv.eval("window.dispatchEvent(new CustomEvent('sct-close-requested'))");
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_local_bridge_info,
            pull_sync_data,
            push_sync_data,
            open_in_browser,
            focus_desktop_window,
            set_launch_prefs,
            apply_close_action
        ])
        .build(tauri::generate_context!())
        .expect("error while building 三尺台");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if !has_visible_windows {
                focus_main_window(app_handle);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}
