/**
 * 桌面端 ⇄ 浏览器 双向桥接与本机文件实时同步引擎
 *
 * - 桌面端（Tauri WebView）：通过 Tauri IPC 获取本机 127.0.0.1 微服务地址，支持「在浏览器中打开」
 * - 浏览器（连接本机微服务）：通过同源 /__sct_api/* 与桌面端读写同一份本机文件，支持「返回桌面端」唤醒窗口
 * - 纯网页模式（无桌面端进程）：本地保存默认打开方式偏好，点击按钮在新标签页打开当前页面
 */
import { readonly, ref } from 'vue';
import { exportBackup, replaceDataFromSync } from '@/db/db';
import type { BackupShape } from '@/db/db';

export type OpenModePref = 'desktop' | 'browser';
export type RuntimeMode = 'tauri-desktop' | 'tauri-browser' | 'web-standalone';

const OPEN_MODE_STORAGE_KEY = 'sct:default-open-mode';

interface BridgeInfoResponse {
  ok: boolean;
  port?: number;
  bridgeUrl?: string;
  defaultOpenMode?: OpenModePref;
  desktopAvailable?: boolean;
}

interface SyncEnvelopeResponse {
  updated_at: number;
  payload: BackupShape | null;
}

interface TauriInternalsLike {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function getTauriInternals(): TauriInternalsLike | null {
  const win = window as unknown as { __TAURI_INTERNALS__?: TauriInternalsLike };
  return win.__TAURI_INTERNALS__ && typeof win.__TAURI_INTERNALS__.invoke === 'function'
    ? win.__TAURI_INTERNALS__
    : null;
}

function readLocalOpenMode(): OpenModePref {
  try {
    return localStorage.getItem(OPEN_MODE_STORAGE_KEY) === 'browser' ? 'browser' : 'desktop';
  } catch {
    return 'desktop';
  }
}

function writeLocalOpenMode(mode: OpenModePref) {
  try {
    localStorage.setItem(OPEN_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

const runtimeMode = ref<RuntimeMode>('web-standalone');
const bridgeUrl = ref('');
const defaultOpenMode = ref<OpenModePref>(readLocalOpenMode());
const syncing = ref(false);
const switching = ref(false);

let lastSyncedAt = 0;
let isApplyingRemote = false;
let initialized = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit, timeoutMs = 1500): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 从本机微服务拉取最新数据（若远端时间更新则静默覆盖本地 IndexedDB） */
export async function pullFromBridge(): Promise<boolean> {
  if (!bridgeUrl.value || isApplyingRemote) return false;
  syncing.value = true;
  try {
    const env = await fetchJsonWithTimeout<SyncEnvelopeResponse>(`${bridgeUrl.value}/__sct_api/data`, undefined, 2500);
    if (!env || !env.payload || typeof env.updated_at !== 'number') {
      return false;
    }
    if (env.updated_at > lastSyncedAt && Array.isArray(env.payload.members)) {
      isApplyingRemote = true;
      try {
        await replaceDataFromSync(env.payload);
        lastSyncedAt = env.updated_at;
        return true;
      } finally {
        // 短暂延迟释放锁，避免 liveQuery 响应式回流立刻触发反向 push
        setTimeout(() => {
          isApplyingRemote = false;
        }, 450);
      }
    }
    return false;
  } finally {
    syncing.value = false;
  }
}

const LOCAL_POST_HEADERS = {
  'Content-Type': 'application/json',
  'X-Sct-Local': '1'
};

/** 将当前 IndexedDB 快照推送至本机微服务持久化文件 */
export async function pushToBridge(): Promise<boolean> {
  if (!bridgeUrl.value || isApplyingRemote) return false;
  syncing.value = true;
  try {
    const shape = await exportBackup();
    const res = await fetchJsonWithTimeout<{ ok: boolean; updated_at?: number }>(
      `${bridgeUrl.value}/__sct_api/data`,
      {
        method: 'POST',
        headers: LOCAL_POST_HEADERS,
        body: JSON.stringify(shape)
      },
      3000
    );
    if (res?.ok && typeof res.updated_at === 'number') {
      lastSyncedAt = res.updated_at;
      return true;
    }
    return false;
  } finally {
    syncing.value = false;
  }
}

/** 防抖推送（供 App 根组件监听业务数据变更后调用） */
export function schedulePushToBridge() {
  if (!bridgeUrl.value || isApplyingRemote) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushToBridge();
  }, 1000);
}

/** 启动时初始化桥接状态并建立窗口聚焦双向同步 */
export async function initDesktopBridge(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const tauri = getTauriInternals();
  if (tauri) {
    try {
      const info = await tauri.invoke<BridgeInfoResponse>('get_local_bridge_info');
      if (info?.ok && info.bridgeUrl) {
        runtimeMode.value = 'tauri-desktop';
        bridgeUrl.value = info.bridgeUrl;
        if (info.defaultOpenMode === 'browser' || info.defaultOpenMode === 'desktop') {
          defaultOpenMode.value = info.defaultOpenMode;
          writeLocalOpenMode(info.defaultOpenMode);
        }
      }
    } catch {
      runtimeMode.value = 'tauri-desktop';
    }
  } else {
    const host = window.location.hostname;
    if (host === '127.0.0.1' || host === 'localhost') {
      const info = await fetchJsonWithTimeout<BridgeInfoResponse>(
        `${window.location.origin}/__sct_api/info`,
        undefined,
        1000
      );
      if (info?.ok && info.desktopAvailable) {
        runtimeMode.value = 'tauri-browser';
        bridgeUrl.value = window.location.origin;
        if (info.defaultOpenMode === 'browser' || info.defaultOpenMode === 'desktop') {
          defaultOpenMode.value = info.defaultOpenMode;
          writeLocalOpenMode(info.defaultOpenMode);
        }
      }
    }
  }

  if (bridgeUrl.value) {
    const pulled = await pullFromBridge();
    // 仅桌面端在首次启动且本机同步文件尚为空时主动种子推送，防止新开浏览器页因超时反向覆盖桌面端数据
    if (!pulled && runtimeMode.value === 'tauri-desktop') {
      await pushToBridge();
    }

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void pullFromBridge();
      }
    };
    const onPageHide = () => {
      if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
        void pushToBridge();
      }
    };
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('pagehide', onPageHide);
  }
}

/** 切换到系统浏览器打开（先同步数据再拉起） */
export async function openInBrowserMode(): Promise<void> {
  if (switching.value) return;
  switching.value = true;
  try {
    const tauri = getTauriInternals();
    if (runtimeMode.value === 'tauri-desktop') {
      await pushToBridge();
      if (tauri) {
        await tauri.invoke('open_in_browser');
        window.$message?.success('已同步本机数据并在系统默认浏览器中打开');
        return;
      }
      if (bridgeUrl.value) {
        await fetchJsonWithTimeout(
          `${bridgeUrl.value}/__sct_api/open-browser`,
          { method: 'POST', headers: LOCAL_POST_HEADERS },
          2000
        );
        window.$message?.success('已同步本机数据并在系统默认浏览器中打开');
        return;
      }
    }

    // 纯网页模式：在新标签页打开，并提示桌面端能力
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
    window.$message?.info('已在新浏览器标签页中打开（桌面端安装包支持与浏览器双向实时同步切换）');
  } catch (err) {
    window.$message?.error(`打开浏览器失败：${(err as Error).message}`);
  } finally {
    switching.value = false;
  }
}

/** 从浏览器返回并唤醒桌面端窗口（先同步最新数据） */
export async function returnToDesktopMode(): Promise<void> {
  if (switching.value) return;
  switching.value = true;
  try {
    await pushToBridge();
    if (bridgeUrl.value) {
      const res = await fetchJsonWithTimeout<{ ok: boolean }>(
        `${bridgeUrl.value}/__sct_api/focus-desktop`,
        { method: 'POST', headers: LOCAL_POST_HEADERS },
        2000
      );
      if (res?.ok) {
        window.$message?.success('数据已同步，已唤醒三尺台桌面端窗口');
        return;
      }
    }
    window.$message?.warning('未检测到运行中的桌面端进程，请直接启动三尺台桌面应用');
  } finally {
    switching.value = false;
  }
}

/** 保存默认打开方式（桌面端 / 浏览器） */
export async function setDefaultOpenMode(mode: OpenModePref): Promise<void> {
  const normalized: OpenModePref = mode === 'browser' ? 'browser' : 'desktop';
  defaultOpenMode.value = normalized;
  writeLocalOpenMode(normalized);

  const tauri = getTauriInternals();
  if (tauri) {
    await tauri.invoke('set_default_open_mode', { mode: normalized }).catch(() => {});
  } else if (bridgeUrl.value) {
    await fetchJsonWithTimeout(
      `${bridgeUrl.value}/__sct_api/prefs`,
      {
        method: 'POST',
        headers: LOCAL_POST_HEADERS,
        body: JSON.stringify({ defaultOpenMode: normalized })
      },
      2000
    );
  }
}

export function useDesktopBridge() {
  return {
    runtimeMode: readonly(runtimeMode),
    bridgeUrl: readonly(bridgeUrl),
    defaultOpenMode: readonly(defaultOpenMode),
    syncing: readonly(syncing),
    switching: readonly(switching),
    openInBrowserMode,
    returnToDesktopMode,
    setDefaultOpenMode,
    pushToBridge,
    pullFromBridge
  };
}
