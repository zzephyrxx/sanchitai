/**
 * 三尺台 GitHub Releases 自动更新与升级前数据保护引擎
 *
 * - 桌面端（Tauri）：通过 Rust 后端拉取 zzephyrxx/sanchitai 最新 Release、按平台匹配 .dmg/.exe、
 *   流式下载到本地下载目录并可一键打开安装器。
 * - 升级前数据保护：点击下载更新前，自动先在数据目录 snapshots/protected/ 落盘一份不可被循环淘汰的
 *   `.sctpack` 保护快照，防止极端情况下回退或跨版本冲突导致数据损失。
 * - 浏览器端降级：直接请求 GitHub Releases 公开 API 提示新版本并跳转发布页下载。
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { APP_VERSION } from '@/constants/changelog';
import {
  invokeTauriCommand,
  listenTauriEvent,
  saveProtectedPreUpdateSnapshot,
  useDesktopBridge
} from '@/utils/desktop-bridge';
import { pushBackupRing } from '@/db/db';

const AUTO_CHECK_KEY = 'sct:updater:auto-check';
const USE_MIRROR_KEY = 'sct:updater:use-mirror';
const IGNORED_VER_KEY = 'sct:updater:ignored-version';

export interface UpdateReleaseInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  htmlUrl: string;
  assetName: string | null;
  assetSize: number;
  downloadUrl: string | null;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true';
  } catch {
    return fallback;
  }
}

function writeBoolPref(key: string, val: boolean) {
  try {
    localStorage.setItem(key, val ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function readIgnoredVersion(): string {
  try {
    return localStorage.getItem(IGNORED_VER_KEY) ?? '';
  } catch {
    return '';
  }
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map(n => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

interface GithubAssetItem {
  name: string;
  browser_download_url: string;
  size?: number;
}

/** 浏览器端按当前操作系统匹配安装包资产（严禁误选源码 .zip 包） */
function pickBrowserPlatformAsset(assets: GithubAssetItem[] = []): GithubAssetItem | null {
  const installers = assets.filter(a => {
    const n = a.name.toLowerCase();
    return !n.endsWith('.zip') && !n.endsWith('.tar.gz') && !n.endsWith('.sha256') && !n.endsWith('.sig');
  });
  if (!installers.length) return null;

  const ua = typeof navigator !== 'undefined' ? `${navigator.userAgent} ${navigator.platform}`.toLowerCase() : '';
  const isMac = /mac|darwin/.test(ua);
  const isWin = /win/.test(ua);

  if (isMac) {
    const dmgs = installers.filter(a => a.name.toLowerCase().endsWith('.dmg'));
    if (!dmgs.length) return null;
    const preferred = dmgs.find(a => /aarch64|arm64|apple/i.test(a.name));
    return preferred ?? dmgs[0];
  }

  if (isWin) {
    return (
      installers.find(a => /[-_]setup\.exe$/i.test(a.name)) ??
      installers.find(a => a.name.toLowerCase().endsWith('.exe')) ??
      installers.find(a => a.name.toLowerCase().endsWith('.msi')) ??
      null
    );
  }

  return (
    installers.find(a => a.name.toLowerCase().endsWith('.appimage')) ??
    installers.find(a => a.name.toLowerCase().endsWith('.deb')) ??
    null
  );
}

export const useUpdaterStore = defineStore('sct-updater', () => {
  const desktopBridge = useDesktopBridge();

  const autoCheckEnabled = ref<boolean>(readBoolPref(AUTO_CHECK_KEY, true));
  const useMirror = ref<boolean>(readBoolPref(USE_MIRROR_KEY, false));
  const ignoredVersion = ref<string>(readIgnoredVersion());

  const checking = ref(false);
  const downloading = ref(false);
  const backingUpBeforeUpdate = ref(false);
  const lastCheckedAt = ref<string>('');
  const checkError = ref<string>('');
  const release = ref<UpdateReleaseInfo | null>(null);
  const popupVisible = ref(false);
  const downloadedPath = ref<string>('');
  const protectedSnapshotPath = ref<string>('');
  const progress = ref<DownloadProgress>({ downloaded: 0, total: 0, percent: 0 });

  let autoCheckScheduled = false;

  const hasAvailableUpdate = computed(() => Boolean(release.value?.hasUpdate));
  const isDesktopNative = computed(() => desktopBridge.runtimeMode.value === 'tauri-desktop');

  function setAutoCheckEnabled(val: boolean) {
    autoCheckEnabled.value = val;
    writeBoolPref(AUTO_CHECK_KEY, val);
  }

  function setUseMirror(val: boolean) {
    useMirror.value = val;
    writeBoolPref(USE_MIRROR_KEY, val);
  }

  function ignoreCurrentRelease() {
    if (release.value?.latestVersion) {
      ignoredVersion.value = release.value.latestVersion;
      try {
        localStorage.setItem(IGNORED_VER_KEY, ignoredVersion.value);
      } catch {
        /* ignore */
      }
    }
    popupVisible.value = false;
  }

  function dismissPopup() {
    popupVisible.value = false;
  }

  async function checkForUpdates(options?: { silent?: boolean }): Promise<UpdateReleaseInfo | null> {
    if (checking.value) return release.value;
    checking.value = true;
    checkError.value = '';
    const silent = Boolean(options?.silent);

    try {
      let result: UpdateReleaseInfo | null = null;

      // 桌面端优先通过 Rust 后端请求 GitHub Releases API（无 CORS 限制，自动识别平台资产）
      const nativeRes = await invokeTauriCommand<UpdateReleaseInfo>('check_github_update', {
        currentVersion: APP_VERSION,
        useMirror: useMirror.value
      });

      if (nativeRes) {
        result = nativeRes;
      } else {
        // 浏览器端降级查询公开 API
        const apiUrl = 'https://api.github.com/repos/zzephyrxx/sanchitai/releases/latest';
        const targetUrl = useMirror.value ? `https://gh-proxy.com/${apiUrl}` : apiUrl;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const resp = await fetch(targetUrl, {
            headers: { Accept: 'application/vnd.github+json' },
            signal: controller.signal
          });
          if (!resp.ok) {
            throw new Error(`GitHub 接口返回 ${resp.status}`);
          }
          const data = (await resp.json()) as {
            tag_name?: string;
            name?: string;
            body?: string;
            published_at?: string;
            html_url?: string;
            assets?: Array<{ name: string; browser_download_url: string; size?: number }>;
          };
          const latest = (data.tag_name ?? '').trim();
          const hasUpdate = Boolean(latest) && compareSemver(latest, APP_VERSION) > 0;
          const matchedAsset = pickBrowserPlatformAsset(data.assets);
          result = {
            hasUpdate,
            currentVersion: APP_VERSION,
            latestVersion: latest || APP_VERSION,
            releaseName: data.name || latest || APP_VERSION,
            releaseNotes: data.body || '',
            publishedAt: data.published_at || '',
            htmlUrl: data.html_url || 'https://github.com/zzephyrxx/sanchitai/releases/latest',
            assetName: matchedAsset?.name ?? null,
            assetSize: matchedAsset?.size ?? 0,
            downloadUrl: matchedAsset?.browser_download_url ?? null
          };
        } finally {
          clearTimeout(timer);
        }
      }

      release.value = result;
      lastCheckedAt.value = new Date().toLocaleTimeString();

      if (result.hasUpdate) {
        if (!silent || ignoredVersion.value !== result.latestVersion) {
          popupVisible.value = true;
        }
        if (!silent) {
          window.$message?.success(`发现新版本 ${result.latestVersion}，可在右上角弹窗下载更新`);
        }
      } else if (!silent) {
        window.$message?.success(`当前已是最新版本（${APP_VERSION}）`);
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checkError.value = msg;
      if (!silent) {
        window.$message?.warning(`检查更新失败：${msg}（可在设置中切换国内镜像加速后重试）`);
      }
      return null;
    } finally {
      checking.value = false;
    }
  }

  /** 启动 3 秒后静默检查一次（仅在启用自动更新检测时） */
  function scheduleAutoCheck() {
    if (autoCheckScheduled || !autoCheckEnabled.value) return;
    autoCheckScheduled = true;
    setTimeout(() => {
      void checkForUpdates({ silent: true });
    }, 3000);
  }

  /** 下载安装包并在下载前自动落盘一份受保护的「升级前安全快照」 */
  async function startDownloadUpdate() {
    if (!release.value?.hasUpdate || downloading.value) return;
    const rel = release.value;

    // 步骤 1：先写入「设置 → 自动快照」列表（立即可见可恢复），桌面端同时在 snapshots/protected/ 落盘一份不可淘汰的 .sctpack
    backingUpBeforeUpdate.value = true;
    try {
      const snapLabel = `升级前保护快照 (${APP_VERSION} → ${rel.latestVersion})`;
      const [ringSnap, diskSnap] = await Promise.all([
        pushBackupRing('auto', snapLabel).catch(() => null),
        saveProtectedPreUpdateSnapshot(rel.latestVersion).catch(() => null)
      ]);
      if (diskSnap || ringSnap) {
        protectedSnapshotPath.value = diskSnap || `auto-ring:${ringSnap?.key ?? ''}`;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('sct-snapshots-updated'));
        }
      }
    } finally {
      backingUpBeforeUpdate.value = false;
    }

    // 非桌面端或未匹配到对应平台安装包时，打开 GitHub Release 页面手动下载
    if (!isDesktopNative.value || !rel.downloadUrl || !rel.assetName) {
      window.open(rel.htmlUrl || 'https://github.com/zzephyrxx/sanchitai/releases/latest', '_blank', 'noopener');
      window.$message?.info('已为您在浏览器打开 GitHub Release 发布页');
      return;
    }

    downloading.value = true;
    downloadedPath.value = '';
    progress.value = { downloaded: 0, total: rel.assetSize, percent: 0 };

    const unlisten = await listenTauriEvent<DownloadProgress>('sct-update-progress', payload => {
      progress.value = payload;
    });

    try {
      const savedPath = await invokeTauriCommand<string>('download_update_asset', {
        downloadUrl: rel.downloadUrl,
        assetName: rel.assetName,
        expectedSize: rel.assetSize,
        useMirror: useMirror.value
      });
      if (savedPath) {
        downloadedPath.value = savedPath;
        progress.value = { downloaded: rel.assetSize || 1, total: rel.assetSize || 1, percent: 100 };
        window.$message?.success('更新安装包下载完成，点击「立即安装」即可升级');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.$message?.error(`自动下载失败：${msg}`);
    } finally {
      unlisten();
      downloading.value = false;
    }
  }

  async function installDownloadedUpdate() {
    if (!downloadedPath.value) return;
    try {
      await invokeTauriCommand('open_downloaded_installer', { filePath: downloadedPath.value });
      window.$message?.success('已打开安装程序，请按系统提示完成覆盖升级（原有数据目录不会丢失）');
    } catch (err) {
      window.$message?.error(`打开安装程序失败：${String(err)}`);
    }
  }

  return {
    autoCheckEnabled,
    useMirror,
    checking,
    downloading,
    backingUpBeforeUpdate,
    lastCheckedAt,
    checkError,
    release,
    popupVisible,
    downloadedPath,
    protectedSnapshotPath,
    progress,
    hasAvailableUpdate,
    isDesktopNative,
    setAutoCheckEnabled,
    setUseMirror,
    ignoreCurrentRelease,
    dismissPopup,
    checkForUpdates,
    scheduleAutoCheck,
    startDownloadUpdate,
    installDownloadedUpdate
  };
});
