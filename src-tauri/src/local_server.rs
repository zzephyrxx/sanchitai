use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const DEFAULT_PORT: u16 = 19527;
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
const MAX_HEADERS: usize = 128;
const MAX_HEADER_LINE_BYTES: usize = 65536;
const MAX_CONCURRENT_CONNS: usize = 128;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserOption {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchPrefs {
    #[serde(rename = "defaultOpenMode", default = "default_open_mode_str")]
    pub default_open_mode: String,
    #[serde(rename = "preferredBrowser", default = "default_browser_str")]
    pub preferred_browser: String,
    #[serde(rename = "closeBehavior", default = "default_close_behavior_str")]
    pub close_behavior: String,
}

fn default_open_mode_str() -> String {
    "desktop".to_string()
}

fn default_browser_str() -> String {
    "system".to_string()
}

fn default_close_behavior_str() -> String {
    "ask".to_string()
}

impl Default for LaunchPrefs {
    fn default() -> Self {
        Self {
            default_open_mode: default_open_mode_str(),
            preferred_browser: default_browser_str(),
            close_behavior: default_close_behavior_str(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrefsPatch {
    #[serde(rename = "defaultOpenMode")]
    pub default_open_mode: Option<String>,
    #[serde(rename = "preferredBrowser")]
    pub preferred_browser: Option<String>,
    #[serde(rename = "closeBehavior")]
    pub close_behavior: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct OpenBrowserReq {
    #[serde(rename = "browserId")]
    browser_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEnvelope {
    pub updated_at: u64,
    pub payload: serde_json::Value,
}

#[derive(Clone)]
pub struct LocalServerState {
    pub port: u16,
    pub data_dir: PathBuf,
    io_lock: Arc<Mutex<()>>,
}

/// 跨平台原子写文件（兼容 Windows：目标文件已存在时先移除再 rename）
fn atomic_write_file(dir: &Path, target: &Path, tmp_name: &str, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(tmp_name);
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        if target.exists() {
            let _ = fs::remove_file(target);
        }
    }
    fs::rename(&tmp, target).map_err(|e| e.to_string())
}

fn sanitize_browser_id(id: &str) -> String {
    match id.trim().to_ascii_lowercase().as_str() {
        "chrome" | "edge" | "safari" | "firefox" | "arc" | "brave" => {
            id.trim().to_ascii_lowercase()
        }
        _ => "system".to_string(),
    }
}

fn sanitize_close_behavior(val: &str) -> String {
    match val.trim().to_ascii_lowercase().as_str() {
        "minimize" | "exit" | "ask" => val.trim().to_ascii_lowercase(),
        _ => "ask".to_string(),
    }
}

/// 探测本机已安装的常见浏览器（始终包含「系统默认浏览器」作为首项）
pub fn detect_installed_browsers() -> Vec<BrowserOption> {
    let mut list = vec![BrowserOption {
        id: "system".to_string(),
        name: "系统默认浏览器".to_string(),
    }];

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let candidates: &[(&str, &str, &[&str])] = &[
            ("chrome", "Google Chrome", &["/Applications/Google Chrome.app"]),
            ("edge", "Microsoft Edge", &["/Applications/Microsoft Edge.app"]),
            (
                "safari",
                "Safari 浏览器",
                &[
                    "/Applications/Safari.app",
                    "/System/Cryptexes/App/System/Applications/Safari.app",
                ],
            ),
            ("arc", "Arc", &["/Applications/Arc.app"]),
            ("firefox", "Firefox", &["/Applications/Firefox.app"]),
            ("brave", "Brave", &["/Applications/Brave Browser.app"]),
        ];
        for (id, name, paths) in candidates {
            let exists_sys = paths.iter().any(|p| Path::new(p).exists());
            let exists_user = home.as_ref().is_some_and(|h| {
                paths.iter().any(|p| {
                    p.strip_prefix("/Applications/")
                        .is_some_and(|rel| h.join("Applications").join(rel).exists())
                })
            });
            if exists_sys || exists_user {
                list.push(BrowserOption {
                    id: (*id).to_string(),
                    name: (*name).to_string(),
                });
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let candidates: &[(&str, &str)] = &[
            ("edge", "Microsoft Edge"),
            ("chrome", "Google Chrome"),
            ("firefox", "Firefox"),
            ("brave", "Brave"),
        ];
        for (id, name) in candidates {
            if find_windows_browser_exe(id).is_some() {
                list.push(BrowserOption {
                    id: (*id).to_string(),
                    name: (*name).to_string(),
                });
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let candidates: &[(&str, &str, &str)] = &[
            ("chrome", "Google Chrome", "google-chrome"),
            ("edge", "Microsoft Edge", "microsoft-edge"),
            ("firefox", "Firefox", "firefox"),
            ("brave", "Brave", "brave-browser"),
        ];
        for (id, name, bin) in candidates {
            if Command::new("which")
                .arg(bin)
                .output()
                .is_ok_and(|o| o.status.success())
            {
                list.push(BrowserOption {
                    id: (*id).to_string(),
                    name: (*name).to_string(),
                });
            }
        }
    }

    list
}

#[cfg(target_os = "windows")]
fn find_windows_browser_exe(browser_id: &str) -> Option<PathBuf> {
    let rel_paths: &[&str] = match browser_id {
        "chrome" => &[r"Google\Chrome\Application\chrome.exe"],
        "edge" => &[r"Microsoft\Edge\Application\msedge.exe"],
        "firefox" => &[r"Mozilla Firefox\firefox.exe"],
        "brave" => &[r"BraveSoftware\Brave-Browser\Application\brave.exe"],
        _ => return None,
    };
    let roots = [
        std::env::var_os("ProgramFiles"),
        std::env::var_os("ProgramFiles(x86)"),
        std::env::var_os("LocalAppData"),
    ];
    for root in roots.into_iter().flatten() {
        for rel in rel_paths {
            let full = PathBuf::from(&root).join(rel);
            if full.exists() {
                return Some(full);
            }
        }
    }
    None
}

impl LocalServerState {
    pub fn bridge_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn prefs_path(&self) -> PathBuf {
        self.data_dir.join("launch-prefs.json")
    }

    fn sync_data_path(&self) -> PathBuf {
        self.data_dir.join("sync-data.json")
    }

    pub fn read_prefs(&self) -> LaunchPrefs {
        let _guard = self.io_lock.lock().ok();
        fs::read_to_string(self.prefs_path())
            .ok()
            .and_then(|s| serde_json::from_str::<LaunchPrefs>(&s).ok())
            .map(|mut p| {
                if p.default_open_mode != "browser" {
                    p.default_open_mode = "desktop".to_string();
                }
                p.preferred_browser = sanitize_browser_id(&p.preferred_browser);
                p.close_behavior = sanitize_close_behavior(&p.close_behavior);
                p
            })
            .unwrap_or_default()
    }

    pub fn update_prefs(&self, patch: PrefsPatch) -> Result<LaunchPrefs, String> {
        let _guard = self.io_lock.lock().map_err(|_| "lock poisoned".to_string())?;
        let mut prefs = fs::read_to_string(self.prefs_path())
            .ok()
            .and_then(|s| serde_json::from_str::<LaunchPrefs>(&s).ok())
            .unwrap_or_default();

        if let Some(mode) = patch.default_open_mode {
            prefs.default_open_mode = if mode == "browser" {
                "browser".to_string()
            } else {
                "desktop".to_string()
            };
        }
        if let Some(browser) = patch.preferred_browser {
            prefs.preferred_browser = sanitize_browser_id(&browser);
        }
        if let Some(close_b) = patch.close_behavior {
            prefs.close_behavior = sanitize_close_behavior(&close_b);
        }

        let content = serde_json::to_vec_pretty(&prefs).map_err(|e| e.to_string())?;
        atomic_write_file(&self.data_dir, &self.prefs_path(), "launch-prefs.json.tmp", &content)?;
        Ok(prefs)
    }

    pub fn read_sync_data(&self) -> SyncEnvelope {
        let _guard = self.io_lock.lock().ok();
        fs::read_to_string(self.sync_data_path())
            .ok()
            .and_then(|s| serde_json::from_str::<SyncEnvelope>(&s).ok())
            .unwrap_or(SyncEnvelope {
                updated_at: 0,
                payload: serde_json::Value::Null,
            })
    }

    pub fn write_sync_data(&self, payload: serde_json::Value) -> Result<u64, String> {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let env = SyncEnvelope {
            updated_at: now_ms,
            payload,
        };
        let _guard = self.io_lock.lock().map_err(|_| "lock poisoned".to_string())?;
        let bytes = serde_json::to_vec(&env).map_err(|e| e.to_string())?;
        atomic_write_file(&self.data_dir, &self.sync_data_path(), "sync-data.json.tmp", &bytes)?;
        Ok(now_ms)
    }

    pub fn build_info_json(&self) -> serde_json::Value {
        let prefs = self.read_prefs();
        let browsers = detect_installed_browsers();
        serde_json::json!({
            "ok": true,
            "port": self.port,
            "bridgeUrl": self.bridge_url(),
            "defaultOpenMode": prefs.default_open_mode,
            "preferredBrowser": prefs.preferred_browser,
            "closeBehavior": prefs.close_behavior,
            "browsers": browsers,
            "desktopAvailable": true
        })
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos_default_browser() -> Option<&'static str> {
    let out = Command::new("/usr/bin/defaults")
        .args([
            "read",
            "com.apple.LaunchServices/com.apple.launchservices.secure",
            "LSHandlers",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut block_role: Option<String> = None;
    let mut block_is_https = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line == "{" {
            block_role = None;
            block_is_https = false;
        } else if let Some(rest) = line.strip_prefix("LSHandlerRoleAll = ") {
            let cleaned = rest
                .trim_end_matches(';')
                .trim()
                .trim_matches('"')
                .to_ascii_lowercase();
            block_role = Some(cleaned);
        } else if line == "LSHandlerURLScheme = https;" || line == "LSHandlerURLScheme = \"https\";" {
            block_is_https = true;
        } else if line.starts_with('}') && block_is_https {
            if let Some(ref role) = block_role {
                return match role.as_str() {
                    "com.google.chrome" => Some("chrome"),
                    "com.microsoft.edgemac" => Some("edge"),
                    "com.brave.browser" => Some("brave"),
                    "org.mozilla.firefox" => Some("firefox"),
                    "com.apple.safari" => Some("safari"),
                    "company.thebrowser.browser" => Some("arc"),
                    _ => None,
                };
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn find_macos_browser_bin(browser: &str) -> Option<PathBuf> {
    let rel = match browser {
        "chrome" => "Google Chrome.app/Contents/MacOS/Google Chrome",
        "edge" => "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "brave" => "Brave Browser.app/Contents/MacOS/Brave Browser",
        "firefox" => "Firefox.app/Contents/MacOS/firefox",
        _ => return None,
    };
    let sys_path = PathBuf::from("/Applications").join(rel);
    if sys_path.exists() {
        return Some(sys_path);
    }
    if let Some(home) = std::env::var_os("HOME") {
        let user_path = PathBuf::from(home).join("Applications").join(rel);
        if user_path.exists() {
            return Some(user_path);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn activate_macos_gui_browser(bin_path: &Path) {
    let needle = bin_path.to_string_lossy();
    let Ok(out) = Command::new("/bin/ps").args(["-eo", "pid=,args="]).output() else {
        return;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut target_pid: Option<u32> = None;
    for line in text.lines() {
        let trimmed = line.trim_start();
        let Some((pid_str, args)) = trimmed.split_once(char::is_whitespace) else {
            continue;
        };
        let args = args.trim_start();
        if args.starts_with(needle.as_ref())
            && !args.contains("--type=")
            && !args.contains("--headless")
            && !args.contains("--user-data-dir=")
        {
            if let Ok(pid) = pid_str.parse::<u32>() {
                target_pid = Some(pid);
            }
        }
    }
    if let Some(pid) = target_pid {
        let script = format!(
            "ObjC.import('AppKit'); const a = $.NSRunningApplication.runningApplicationWithProcessIdentifier({pid}); a && a.activateWithOptions(3);"
        );
        let _ = Command::new("/usr/bin/osascript")
            .args(["-l", "JavaScript", "-e", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

pub fn open_system_browser(url: &str, browser_id: &str) -> Result<(), String> {
    if !url.starts_with("http://127.0.0.1:") {
        return Err("only loopback URLs are allowed".to_string());
    }
    let normalized_url = if url.ends_with('/') {
        url.to_string()
    } else {
        format!("{url}/")
    };
    let browser = sanitize_browser_id(browser_id);

    #[cfg(target_os = "macos")]
    {
        // macOS 上当系统后台存在第三方工具拉起的 --headless Chrome/Edge 进程时，
        // LaunchServices (`open -b` / `open -a`) 会把 URL 错误派发到无头进程导致“无反应”。
        // 直接拉起浏览器原生可执行文件会通过默认配置目录的 SingletonSocket 精准交给真实 GUI 浏览器。
        let effective = if browser == "system" {
            resolve_macos_default_browser().unwrap_or("system")
        } else {
            browser.as_str()
        };

        if let Some(bin_path) = find_macos_browser_bin(effective) {
            if Command::new(&bin_path)
                .arg(&normalized_url)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .is_ok()
            {
                activate_macos_gui_browser(&bin_path);
                return Ok(());
            }
        }

        let target_meta: Option<(&str, &str)> = match effective {
            "chrome" => Some(("com.google.Chrome", "/Applications/Google Chrome.app")),
            "edge" => Some(("com.microsoft.edgemac", "/Applications/Microsoft Edge.app")),
            "safari" => Some(("com.apple.Safari", "/Applications/Safari.app")),
            "arc" => Some(("company.thebrowser.Browser", "/Applications/Arc.app")),
            "firefox" => Some(("org.mozilla.firefox", "/Applications/Firefox.app")),
            "brave" => Some(("com.brave.Browser", "/Applications/Brave Browser.app")),
            _ => None,
        };
        if let Some((bundle_id, app_path)) = target_meta {
            let by_bundle = Command::new("/usr/bin/open")
                .args(["-b", bundle_id, &normalized_url])
                .status();
            if by_bundle.is_ok_and(|s| s.success()) {
                return Ok(());
            }
            if Path::new(app_path).exists() {
                let by_path = Command::new("/usr/bin/open")
                    .args(["-a", app_path, &normalized_url])
                    .status();
                if by_path.is_ok_and(|s| s.success()) {
                    return Ok(());
                }
            }
        }
        Command::new("/usr/bin/open")
            .arg(&normalized_url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        if browser != "system" {
            if let Some(exe) = find_windows_browser_exe(&browser) {
                if Command::new(exe).arg(&normalized_url).spawn().is_ok() {
                    return Ok(());
                }
            }
        }
        Command::new("cmd")
            .args(["/C", "start", "", &normalized_url])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let bin = match browser.as_str() {
            "chrome" => Some("google-chrome"),
            "edge" => Some("microsoft-edge"),
            "firefox" => Some("firefox"),
            "brave" => Some("brave-browser"),
            _ => None,
        };
        if let Some(b) = bin {
            if Command::new(b).arg(&normalized_url).spawn().is_ok() {
                return Ok(());
            }
        }
        Command::new("xdg-open")
            .arg(&normalized_url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub fn minimize_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

/// 关闭窗口但保留后台运行：macOS 隐藏到程序坞（点程序坞图标恢复），Windows 最小化到任务栏
pub fn hide_or_minimize_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        {
            let _ = win.hide();
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = win.minimize();
        }
    }
}

fn is_allowed_origin(origin: &str) -> bool {
    origin.starts_with("http://127.0.0.1:")
        || origin.starts_with("http://localhost:")
        || origin == "tauri://localhost"
        || origin == "http://tauri.localhost"
        || origin == "https://tauri.localhost"
}

fn is_allowed_host(host: &str, port: u16) -> bool {
    host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")
}

fn write_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    cors_origin: Option<&str>,
    head_only: bool,
) {
    let mut header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(origin) = cors_origin {
        if is_allowed_origin(origin) {
            header.push_str(&format!(
                "Access-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Methods: GET, HEAD, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Sct-Local\r\nVary: Origin\r\n"
            ));
        }
    }
    header.push_str("\r\n");
    let _ = stream.write_all(header.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
    let _ = stream.flush();
}

struct ConnGuard(Arc<AtomicUsize>);
impl Drop for ConnGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

fn read_header_line_lossy<R: BufRead>(reader: &mut R) -> Option<String> {
    let mut buf = Vec::with_capacity(256);
    let n = reader.read_until(b'\n', &mut buf).ok()?;
    if n == 0 || n > MAX_HEADER_LINE_BYTES {
        return None;
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

fn handle_client(mut stream: TcpStream, app: AppHandle, state: LocalServerState) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let mut reader = match stream.try_clone() {
        Ok(s) => BufReader::new(s),
        Err(_) => return,
    };

    let request_line = match read_header_line_lossy(&mut reader) {
        Some(l) => l,
        None => return,
    };
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let raw_target = parts[1];
    let path_only = raw_target.split('?').next().unwrap_or("/");

    let mut content_length: usize = 0;
    let mut origin: Option<String> = None;
    let mut host: Option<String> = None;
    let mut has_local_header = false;

    for _ in 0..MAX_HEADERS {
        let line = match read_header_line_lossy(&mut reader) {
            Some(l) => l,
            None => return,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            let key_lower = k.trim().to_ascii_lowercase();
            let val = v.trim();
            match key_lower.as_str() {
                "content-length" => content_length = val.parse::<usize>().unwrap_or(0),
                "origin" => origin = Some(val.to_string()),
                "host" => host = Some(val.to_string()),
                "x-sct-local" => has_local_header = val == "1",
                _ => {}
            }
        }
    }

    if let Some(ref h) = host {
        if !is_allowed_host(h, state.port) {
            write_http_response(&mut stream, "403 Forbidden", "text/plain", b"Forbidden Host", None, false);
            return;
        }
    }

    let cors = origin.as_deref();

    if method == "OPTIONS" {
        write_http_response(&mut stream, "204 No Content", "text/plain", b"", cors, false);
        return;
    }

    if method == "POST" && path_only.starts_with("/__sct_api/") {
        let origin_ok = cors.is_none_or(is_allowed_origin);
        if !origin_ok || !has_local_header {
            write_http_response(
                &mut stream,
                "403 Forbidden",
                "application/json; charset=utf-8",
                br#"{"ok":false,"error":"forbidden origin or missing local header"}"#,
                cors,
                false,
            );
            return;
        }
    }

    let mut body = Vec::new();
    if content_length > 0 {
        if content_length > MAX_BODY_BYTES {
            write_http_response(
                &mut stream,
                "413 Payload Too Large",
                "application/json; charset=utf-8",
                br#"{"ok":false,"error":"payload too large"}"#,
                cors,
                false,
            );
            return;
        }
        body.resize(content_length, 0);
        if reader.read_exact(&mut body).is_err() {
            return;
        }
    }

    // ---------------- Local Bridge API ----------------
    if path_only == "/__sct_api/info" && method == "GET" {
        let resp = state.build_info_json();
        let bytes = serde_json::to_vec(&resp).unwrap_or_default();
        write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes, cors, false);
        return;
    }

    if path_only == "/__sct_api/data" && method == "GET" {
        let env = state.read_sync_data();
        let bytes = serde_json::to_vec(&env).unwrap_or_default();
        write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes, cors, false);
        return;
    }

    if path_only == "/__sct_api/data" && method == "POST" {
        match serde_json::from_slice::<serde_json::Value>(&body) {
            Ok(val) => match state.write_sync_data(val) {
                Ok(updated_at) => {
                    let resp = serde_json::json!({ "ok": true, "updated_at": updated_at });
                    let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                    write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes, cors, false);
                }
                Err(e) => {
                    let resp = serde_json::json!({ "ok": false, "error": e });
                    let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                    write_http_response(&mut stream, "500 Internal Server Error", "application/json; charset=utf-8", &bytes, cors, false);
                }
            },
            Err(e) => {
                let resp = serde_json::json!({ "ok": false, "error": e.to_string() });
                let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                write_http_response(&mut stream, "400 Bad Request", "application/json; charset=utf-8", &bytes, cors, false);
            }
        }
        return;
    }

    if path_only == "/__sct_api/prefs" && method == "POST" {
        match serde_json::from_slice::<PrefsPatch>(&body) {
            Ok(req) => match state.update_prefs(req) {
                Ok(saved) => {
                    let resp = serde_json::json!({
                        "ok": true,
                        "defaultOpenMode": saved.default_open_mode,
                        "preferredBrowser": saved.preferred_browser,
                        "closeBehavior": saved.close_behavior
                    });
                    let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                    write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes, cors, false);
                }
                Err(e) => {
                    let resp = serde_json::json!({ "ok": false, "error": e });
                    let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                    write_http_response(&mut stream, "500 Internal Server Error", "application/json; charset=utf-8", &bytes, cors, false);
                }
            },
            Err(e) => {
                let resp = serde_json::json!({ "ok": false, "error": e.to_string() });
                let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                write_http_response(&mut stream, "400 Bad Request", "application/json; charset=utf-8", &bytes, cors, false);
            }
        }
        return;
    }

    if path_only == "/__sct_api/open-browser" && method == "POST" {
        let req_browser = serde_json::from_slice::<OpenBrowserReq>(&body)
            .ok()
            .and_then(|r| r.browser_id);
        let target_browser = req_browser.unwrap_or_else(|| state.read_prefs().preferred_browser);
        let url = state.bridge_url();
        let res = open_system_browser(&url, &target_browser);
        if res.is_ok() {
            minimize_main_window(&app);
        }
        let resp = match res {
            Ok(_) => serde_json::json!({ "ok": true, "url": url, "browser": target_browser }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        };
        let bytes = serde_json::to_vec(&resp).unwrap_or_default();
        write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes, cors, false);
        return;
    }

    if path_only == "/__sct_api/focus-desktop" && method == "POST" {
        focus_main_window(&app);
        write_http_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            br#"{"ok":true}"#,
            cors,
            false,
        );
        return;
    }

    // ---------------- Static Embedded Frontend Assets ----------------
    if method != "GET" && method != "HEAD" {
        write_http_response(&mut stream, "405 Method Not Allowed", "text/plain", b"Method Not Allowed", cors, false);
        return;
    }
    let head_only = method == "HEAD";

    let rel = path_only.trim_start_matches('/');
    if rel.contains("..") {
        write_http_response(&mut stream, "400 Bad Request", "text/plain", b"Invalid Path", cors, head_only);
        return;
    }

    let lookup = if rel.is_empty() { "index.html" } else { rel };
    let resolver = app.asset_resolver();
    let asset = resolver
        .get(lookup.to_string())
        .or_else(|| resolver.get("index.html".to_string()));

    if let Some(a) = asset {
        write_http_response(&mut stream, "200 OK", &a.mime_type, &a.bytes, cors, head_only);
    } else {
        let fallback = b"<!doctype html><html><meta charset='utf-8'><body><h3>SanChiTai Local Bridge Ready</h3><p>Dev mode: please open http://localhost:9527/</p></body></html>";
        write_http_response(&mut stream, "200 OK", "text/html; charset=utf-8", fallback, cors, head_only);
    }
}

pub fn start_local_server(app: AppHandle) -> Result<LocalServerState, String> {
    let listener = TcpListener::bind(("127.0.0.1", DEFAULT_PORT))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|e| format!("failed to bind loopback port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from(".sanchitai-data"));
    let _ = fs::create_dir_all(&data_dir);

    let state = LocalServerState {
        port,
        data_dir,
        io_lock: Arc::new(Mutex::new(())),
    };

    let bg_state = state.clone();
    let active_conns = Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            if active_conns.load(Ordering::Relaxed) >= MAX_CONCURRENT_CONNS {
                write_http_response(&mut stream, "503 Service Unavailable", "text/plain", b"Busy", None, false);
                continue;
            }
            active_conns.fetch_add(1, Ordering::Relaxed);
            let guard = ConnGuard(Arc::clone(&active_conns));
            let app_clone = app.clone();
            let st_clone = bg_state.clone();
            std::thread::spawn(move || {
                let _g = guard;
                handle_client(stream, app_clone, st_clone);
            });
        }
    });

    Ok(state)
}
