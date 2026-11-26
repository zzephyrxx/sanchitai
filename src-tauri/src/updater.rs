use crate::local_server::open_path_in_os;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const GITHUB_OWNER: &str = "zzephyrxx";
const GITHUB_REPO: &str = "sanchitai";
const GH_MIRROR_PREFIX: &str = "https://gh-proxy.com/";

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    tag_name: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    published_at: String,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_name: String,
    pub release_notes: String,
    pub published_at: String,
    pub html_url: String,
    pub asset_name: Option<String>,
    pub asset_size: u64,
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressPayload {
    downloaded: u64,
    total: u64,
    percent: f64,
}

fn parse_semver(raw: &str) -> (u64, u64, u64) {
    let clean = raw
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .split(['-', '+'])
        .next()
        .unwrap_or("0.0.0");
    let mut parts = clean.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    let patch = parts.next().unwrap_or(0);
    (major, minor, patch)
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    parse_semver(latest) > parse_semver(current)
}

fn pick_platform_asset(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    #[cfg(target_os = "macos")]
    {
        let is_arm = cfg!(target_arch = "aarch64");
        let dmgs: Vec<&GithubAsset> = assets
            .iter()
            .filter(|a| a.name.to_ascii_lowercase().ends_with(".dmg"))
            .collect();
        if let Some(exact) = dmgs.iter().find(|a| {
            let lower = a.name.to_ascii_lowercase();
            if is_arm {
                lower.contains("aarch64") || lower.contains("arm64") || lower.contains("apple")
            } else {
                lower.contains("x64") || lower.contains("x86_64") || lower.contains("intel")
            }
        }) {
            return Some(*exact);
        }
        if let Some(any_dmg) = dmgs.first() {
            return Some(*any_dmg);
        }
        None
    }

    #[cfg(target_os = "windows")]
    {
        let lower_assets: Vec<(&GithubAsset, String)> = assets
            .iter()
            .map(|a| (a, a.name.to_ascii_lowercase()))
            .collect();
        if let Some((a, _)) = lower_assets
            .iter()
            .find(|(_, n)| n.ends_with("-setup.exe") || n.ends_with("_setup.exe"))
        {
            return Some(*a);
        }
        if let Some((a, _)) = lower_assets.iter().find(|(_, n)| n.ends_with(".exe")) {
            return Some(*a);
        }
        if let Some((a, _)) = lower_assets.iter().find(|(_, n)| n.ends_with(".msi")) {
            return Some(*a);
        }
        None
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_ascii_lowercase().ends_with(".appimage"))
        {
            return Some(a);
        }
        if let Some(a) = assets
            .iter()
            .find(|a| a.name.to_ascii_lowercase().ends_with(".deb"))
        {
            return Some(a);
        }
        None
    }
}

fn curl_bin() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "curl.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "/usr/bin/curl"
    }
}

fn new_curl_command() -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(curl_bin());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn is_allowed_download_url(url: &str) -> bool {
    let prefix_repo = format!("https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/");
    url.starts_with(&prefix_repo) || url.starts_with("https://objects.githubusercontent.com/")
}

fn sanitize_asset_filename(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("sanchitai-update.bin");
    base.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .take(120)
        .collect()
}

pub fn check_github_update(current_version: &str, use_mirror: bool) -> Result<UpdateCheckResult, String> {
    let api_url = format!("https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest");
    let mut urls = vec![api_url.clone()];
    if use_mirror {
        urls.insert(0, format!("{GH_MIRROR_PREFIX}{api_url}"));
    }

    let mut last_err = String::from("无法连接 GitHub Releases");
    let mut release: Option<GithubRelease> = None;

    for url in urls {
        let out = new_curl_command()
            .args([
                "-fsSL",
                "--max-time",
                "12",
                "-H",
                "Accept: application/vnd.github+json",
                "-H",
                "User-Agent: SanChiTai-Updater",
                &url,
            ])
            .output();
        match out {
            Ok(o) if o.status.success() => {
                match serde_json::from_slice::<GithubRelease>(&o.stdout) {
                    Ok(parsed) => {
                        release = Some(parsed);
                        break;
                    }
                    Err(e) => {
                        last_err = format!("解析更新信息失败: {e}");
                    }
                }
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
                last_err = if stderr.is_empty() {
                    format!("请求失败 (HTTP/exit {})", o.status)
                } else {
                    stderr
                };
            }
            Err(e) => {
                last_err = format!("调用系统网络工具失败: {e}");
            }
        }
    }

    let rel = release.ok_or(last_err)?;
    let latest_version = rel.tag_name.trim().to_string();
    let has_update = is_newer_version(&latest_version, current_version);
    let matched = pick_platform_asset(&rel.assets);

    Ok(UpdateCheckResult {
        has_update,
        current_version: current_version.to_string(),
        latest_version,
        release_name: if rel.name.trim().is_empty() {
            rel.tag_name
        } else {
            rel.name
        },
        release_notes: rel.body,
        published_at: rel.published_at,
        html_url: rel.html_url,
        asset_name: matched.map(|a| a.name.clone()),
        asset_size: matched.map(|a| a.size).unwrap_or(0),
        download_url: matched.map(|a| a.browser_download_url.clone()),
    })
}

fn run_curl_download(
    app: &AppHandle,
    url: &str,
    part_path: &Path,
    expected_size: u64,
) -> Result<(), String> {
    if part_path.exists() {
        let _ = fs::remove_file(part_path);
    }

    let mut child = new_curl_command()
        .args([
            "-fL",
            "-sS",
            "--connect-timeout",
            "15",
            "-H",
            "User-Agent: SanChiTai-Updater",
            "-o",
            &part_path.to_string_lossy(),
            url,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动下载进程: {e}"))?;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    let final_size = fs::metadata(part_path).map(|m| m.len()).unwrap_or(0);
                    let total = expected_size.max(final_size);
                    let _ = app.emit(
                        "sct-update-progress",
                        DownloadProgressPayload {
                            downloaded: final_size,
                            total,
                            percent: 100.0,
                        },
                    );
                    return Ok(());
                }
                let err_msg = child
                    .stderr
                    .take()
                    .and_then(|mut s| {
                        let mut buf = String::new();
                        std::io::Read::read_to_string(&mut s, &mut buf).ok()?;
                        Some(buf)
                    })
                    .unwrap_or_default();
                return Err(format!("下载失败: {}", err_msg.trim()));
            }
            Ok(None) => {
                let downloaded = fs::metadata(part_path).map(|m| m.len()).unwrap_or(0);
                let percent = if expected_size > 0 {
                    ((downloaded as f64 / expected_size as f64) * 100.0).min(99.0)
                } else {
                    0.0
                };
                let _ = app.emit(
                    "sct-update-progress",
                    DownloadProgressPayload {
                        downloaded,
                        total: expected_size,
                        percent,
                    },
                );
                thread::sleep(Duration::from_millis(220));
            }
            Err(e) => return Err(format!("轮询下载状态失败: {e}")),
        }
    }
}

pub fn download_update_asset(
    app: &AppHandle,
    download_url: &str,
    asset_name: &str,
    expected_size: u64,
    use_mirror: bool,
) -> Result<String, String> {
    if !is_allowed_download_url(download_url) {
        return Err("拒绝下载非官方仓库来源的安装包链接".to_string());
    }

    let safe_name = sanitize_asset_filename(asset_name);
    let download_dir = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = fs::create_dir_all(&download_dir);

    let final_path: PathBuf = download_dir.join(&safe_name);
    let part_path: PathBuf = download_dir.join(format!("{safe_name}.sctpart"));

    let mut urls = vec![download_url.to_string()];
    if use_mirror {
        urls.insert(0, format!("{GH_MIRROR_PREFIX}{download_url}"));
    }

    let mut last_err = String::from("下载安装包失败");
    let mut ok = false;
    for url in urls {
        match run_curl_download(app, &url, &part_path, expected_size) {
            Ok(_) => {
                let size = fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
                if size > 1024 {
                    ok = true;
                    break;
                }
                last_err = "下载文件异常为空".to_string();
            }
            Err(e) => {
                last_err = e;
            }
        }
    }

    if !ok {
        let _ = fs::remove_file(&part_path);
        return Err(last_err);
    }

    if let Err(first_err) = fs::rename(&part_path, &final_path) {
        #[cfg(target_os = "windows")]
        if final_path.exists() {
            let _ = fs::remove_file(&final_path);
            if fs::rename(&part_path, &final_path).is_ok() {
                return Ok(final_path.to_string_lossy().to_string());
            }
        }
        return Err(format!("保存安装包失败: {first_err}"));
    }
    Ok(final_path.to_string_lossy().to_string())
}

pub fn open_downloaded_installer(file_path: &str) -> Result<(), String> {
    let path = Path::new(file_path);
    let lower = file_path.to_ascii_lowercase();
    let allowed = lower.ends_with(".dmg")
        || lower.ends_with(".exe")
        || lower.ends_with(".msi")
        || lower.ends_with(".appimage")
        || lower.ends_with(".deb");
    if !allowed {
        return Err("不支持的安装包文件类型".to_string());
    }
    open_path_in_os(path)
}
