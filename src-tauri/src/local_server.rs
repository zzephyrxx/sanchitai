use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const DEFAULT_PORT: u16 = 19527;
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
const MAX_HEADERS: usize = 64;
const MAX_HEADER_LINE_BYTES: usize = 8192;
const MAX_CONCURRENT_CONNS: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchPrefs {
    #[serde(rename = "defaultOpenMode")]
    pub default_open_mode: String,
}

impl Default for LaunchPrefs {
    fn default() -> Self {
        Self {
            default_open_mode: "desktop".to_string(),
        }
    }
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
                p
            })
            .unwrap_or_default()
    }

    pub fn write_prefs(&self, mode: &str) -> Result<LaunchPrefs, String> {
        let normalized = if mode == "browser" {
            "browser"
        } else {
            "desktop"
        };
        let prefs = LaunchPrefs {
            default_open_mode: normalized.to_string(),
        };
        let _guard = self.io_lock.lock().map_err(|_| "lock poisoned".to_string())?;
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
}

pub fn open_system_browser(url: &str) -> Result<(), String> {
    if !url.starts_with("http://127.0.0.1:") {
        return Err("only loopback URLs are allowed".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url)
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
) {
    let mut header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(origin) = cors_origin {
        if is_allowed_origin(origin) {
            header.push_str(&format!(
                "Access-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Sct-Local\r\nVary: Origin\r\n"
            ));
        }
    }
    header.push_str("\r\n");
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

struct ConnGuard(Arc<AtomicUsize>);
impl Drop for ConnGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

fn handle_client(mut stream: TcpStream, app: AppHandle, state: LocalServerState) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let mut reader = match stream.try_clone() {
        Ok(s) => BufReader::new(s),
        Err(_) => return,
    };

    let mut request_line = String::new();
    let req_bytes = reader.read_line(&mut request_line).unwrap_or(0);
    if req_bytes == 0 || req_bytes > MAX_HEADER_LINE_BYTES {
        return;
    }
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
        let mut line = String::new();
        let n = reader.read_line(&mut line).unwrap_or(0);
        if n == 0 || n > MAX_HEADER_LINE_BYTES {
            return;
        }
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

    // 防御 DNS Rebinding：严格校验 Host 为本机回环地址
    if let Some(ref h) = host {
        if !is_allowed_host(h, state.port) {
            write_http_response(&mut stream, "403 Forbidden", "text/plain", b"Forbidden Host", None);
            return;
        }
    }

    let cors = origin.as_deref();

    if method == "OPTIONS" {
        write_http_response(&mut stream, "204 No Content", "text/plain", b"", cors);
        return;
    }

    // 防御跨站 CSRF：所有写入/动作 POST 接口必须携带自定义头且 Origin 合法
    if method == "POST" && path_only.starts_with("/__sct_api/") {
        let origin_ok = cors.is_none_or(is_allowed_origin);
        if !origin_ok || !has_local_header {
            write_http_response(
                &mut stream,
                "403 Forbidden",
                "application/json; charset=utf-8",
                br#"{"ok":false,"error":"forbidden origin or missing local header"}"#,
                cors,
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
        let prefs = state.read_prefs();
        let resp = serde_json::json!({
            "ok": true,
            "port": state.port,
            "bridgeUrl": state.bridge_url(),
            "defaultOpenMode": prefs.default_open_mode,
            "desktopAvailable": true
        });
        let bytes = serde_json::to_vec(&resp).unwrap_or_default();
        write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes, cors);
        return;
    }

    if path_only == "/__sct_api/data" && method == "GET" {
        let env = state.read_sync_data();
        let bytes = serde_json::to_vec(&env).unwrap_or_default();
        write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes, cors);
        return;
    }

    if path_only == "/__sct_api/data" && method == "POST" {
        match serde_json::from_slice::<serde_json::Value>(&body) {
            Ok(val) => match state.write_sync_data(val) {
                Ok(updated_at) => {
                    let resp = serde_json::json!({ "ok": true, "updated_at": updated_at });
                    let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                    write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes, cors);
                }
                Err(e) => {
                    let resp = serde_json::json!({ "ok": false, "error": e });
                    let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                    write_http_response(&mut stream, "500 Internal Server Error", "application/json; charset=utf-8", &bytes, cors);
                }
            },
            Err(e) => {
                let resp = serde_json::json!({ "ok": false, "error": e.to_string() });
                let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                write_http_response(&mut stream, "400 Bad Request", "application/json; charset=utf-8", &bytes, cors);
            }
        }
        return;
    }

    if path_only == "/__sct_api/prefs" && method == "POST" {
        match serde_json::from_slice::<LaunchPrefs>(&body) {
            Ok(req) => match state.write_prefs(&req.default_open_mode) {
                Ok(saved) => {
                    let resp = serde_json::json!({ "ok": true, "defaultOpenMode": saved.default_open_mode });
                    let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                    write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes, cors);
                }
                Err(e) => {
                    let resp = serde_json::json!({ "ok": false, "error": e });
                    let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                    write_http_response(&mut stream, "500 Internal Server Error", "application/json; charset=utf-8", &bytes, cors);
                }
            },
            Err(e) => {
                let resp = serde_json::json!({ "ok": false, "error": e.to_string() });
                let bytes = serde_json::to_vec(&resp).unwrap_or_default();
                write_http_response(&mut stream, "400 Bad Request", "application/json; charset=utf-8", &bytes, cors);
            }
        }
        return;
    }

    if path_only == "/__sct_api/open-browser" && method == "POST" {
        let url = state.bridge_url();
        let res = open_system_browser(&url);
        if res.is_ok() {
            minimize_main_window(&app);
        }
        let resp = match res {
            Ok(_) => serde_json::json!({ "ok": true, "url": url }),
            Err(e) => serde_json::json!({ "ok": false, "error": e }),
        };
        let bytes = serde_json::to_vec(&resp).unwrap_or_default();
        write_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes, cors);
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
        );
        return;
    }

    // ---------------- Static Embedded Frontend Assets ----------------
    if method != "GET" {
        write_http_response(&mut stream, "405 Method Not Allowed", "text/plain", b"Method Not Allowed", cors);
        return;
    }

    let rel = path_only.trim_start_matches('/');
    if rel.contains("..") {
        write_http_response(&mut stream, "400 Bad Request", "text/plain", b"Invalid Path", cors);
        return;
    }

    let lookup = if rel.is_empty() { "index.html" } else { rel };
    let resolver = app.asset_resolver();
    let asset = resolver
        .get(lookup.to_string())
        .or_else(|| resolver.get("index.html".to_string()));

    if let Some(a) = asset {
        write_http_response(&mut stream, "200 OK", &a.mime_type, &a.bytes, cors);
    } else {
        let fallback = b"<!doctype html><html><meta charset='utf-8'><body><h3>SanChiTai Local Bridge Ready</h3><p>Dev mode: please open http://localhost:9527/</p></body></html>";
        write_http_response(&mut stream, "200 OK", "text/html; charset=utf-8", fallback, cors);
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
                write_http_response(&mut stream, "503 Service Unavailable", "text/plain", b"Busy", None);
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
