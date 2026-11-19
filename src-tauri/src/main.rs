// 三尺台桌面壳入口（Tauri v2）
// 纯离线应用：前端为 Vite 产物，本地数据在 WebView IndexedDB 中
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sanchitai_lib::run()
}
