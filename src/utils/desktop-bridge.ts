/**
 * 桌面端 ⇄ 浏览器 双向桥接与本机文件实时同步引擎
 *
 * - 桌面端（Tauri WebView）：通过 Tauri 原生 IPC 直接读写本机同步文件并唤起指定浏览器，
 *   不经过跨协议 fetch，兼容 macOS WKWebView 与 Windows WebView2。
 * - 浏览器（连接本机 127.0.0.1 微服务）：通过同源 /__sct_api/* 与桌面端实时共享本机数据，
 *   支持「返回桌面端」直接唤醒桌面窗口。
 */
import { readonly, ref } from 'vue';
import { exportBackup, replaceDataFromSync } from '@/db/db';
import type { BackupShape } from '@/db/db';

export type OpenModePref = 'desktop' | 'browser';
export type CloseBehaviorPref = 'ask' | 'minimize' | 'exit';
export type RuntimeMode = 'tauri-desktop' | 'tauri-browser' | 'web-standalone';

export const isMacPlatform =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || navigator.platform || '');

export interface BrowserOption {
  id: string;
  name: string;
}

const OPEN_MODE_STORAGE_KEY = 'sct:default-open-mode';
const PREFERRED_BROWSER_KEY = 'sct:preferred-browser';
const CLOSE_BEHAVIOR_KEY = 'sct:close-behavior';

const DEFAULT_BROWSERS: BrowserOption[] = [{ id: 'system', name: '系统默认浏览器' }];

interface BridgeInfoResponse {
  ok: boolean;
  port?: number;
  bridgeUrl?: string;
  defaultOpenMode?: OpenModePref;
  preferredBrowser?: string;
  closeBehavior?: CloseBehaviorPref;
  browsers?: BrowserOption[];
  desktopAvailable?: boolean;
}

interface SyncEnvelopeResponse {
  updated_at: number;
  payload: BackupShape | null;
}

interface TauriInternalsLike {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

const LOCAL_POST_HEADERS = {
  'Content-Type': 'application/json',
  'X-Sct-Local': '1'
};

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

function readLocalPreferredBrowser(): string {
  try {
    return localStorage.getItem(PREFERRED_BROWSER_KEY) || 'system';
  } catch {
    return 'system';
  }
}

function writeLocalPreferredBrowser(browserId: string) {
  try {
    localStorage.setItem(PREFERRED_BROWSER_KEY, browserId);
  } catch {
    /* ignore */
  }
}

function readLocalCloseBehavior(): CloseBehaviorPref {
  try {
    const val = localStorage.getItem(CLOSE_BEHAVIOR_KEY);
    if (val === 'minimize' || val === 'exit' || val === 'ask') return val;
    return 'ask';
  } catch {
    return 'ask';
  }
}

function writeLocalCloseBehavior(behavior: CloseBehaviorPref) {
  try {
    localStorage.setItem(CLOSE_BEHAVIOR_KEY, behavior);
  } catch {
    /* ignore */
  }
}

const runtimeMode = ref<RuntimeMode>('web-standalone');
const bridgeUrl = ref('');
const defaultOpenMode = ref<OpenModePref>(readLocalOpenMode());
const preferredBrowser = ref<string>(readLocalPreferredBrowser());
const closeBehavior = ref<CloseBehaviorPref>(readLocalCloseBehavior());
const installedBrowsers = ref<BrowserOption[]>([...DEFAULT_BROWSERS]);
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

function applyBridgeInfo(info: BridgeInfoResponse) {
  if (info.defaultOpenMode === 'browser' || info.defaultOpenMode === 'desktop') {
    defaultOpenMode.value = info.defaultOpenMode;
    writeLocalOpenMode(info.defaultOpenMode);
  }
  if (typeof info.preferredBrowser === 'string' && info.preferredBrowser) {
    preferredBrowser.value = info.preferredBrowser;
    writeLocalPreferredBrowser(info.preferredBrowser);
  }
  if (info.closeBehavior === 'ask' || info.closeBehavior === 'minimize' || info.closeBehavior === 'exit') {
    closeBehavior.value = info.closeBehavior;
    writeLocalCloseBehavior(info.closeBehavior);
  }
  if (Array.isArray(info.browsers) && info.browsers.length > 0) {
    installedBrowsers.value = info.browsers;
  }
}

/** 从本机同步文件拉取最新数据（桌面端走原生 IPC，浏览器端走同源 HTTP） */
export async function pullFromBridge(): Promise<boolean> {
  const tauri = getTauriInternals();
  if ((!tauri && !bridgeUrl.value) || isApplyingRemote) return false;
  syncing.value = true;
  try {
    let env: SyncEnvelopeResponse | null = null;
    if (tauri && runtimeMode.value === 'tauri-desktop') {
      env = await tauri.invoke<SyncEnvelopeResponse>('pull_sync_data').catch(() => null);
    } else if (bridgeUrl.value) {
      env = await fetchJsonWithTimeout<SyncEnvelopeResponse>(`${bridgeUrl.value}/__sct_api/data`, undefined, 2500);
    }

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

/** 将当前 IndexedDB 快照推送至本机持久化文件 */
export async function pushToBridge(): Promise<boolean> {
  const tauri = getTauriInternals();
  if ((!tauri && !bridgeUrl.value) || isApplyingRemote) return false;
  syncing.value = true;
  try {
    const shape = await exportBackup();
    if (tauri && runtimeMode.value === 'tauri-desktop') {
      const updatedAt = await tauri.invoke<number>('push_sync_data', { payload: shape }).catch(() => null);
      if (typeof updatedAt === 'number') {
        lastSyncedAt = updatedAt;
        return true;
      }
      return false;
    }

    if (bridgeUrl.value) {
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
    }
    return false;
  } finally {
    syncing.value = false;
  }
}

/** 防抖推送（供 App 根组件监听业务数据变更后调用） */
export function schedulePushToBridge() {
  if (runtimeMode.value === 'web-standalone' || isApplyingRemote) return;
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
    runtimeMode.value = 'tauri-desktop';
    try {
      const info = await tauri.invoke<BridgeInfoResponse>('get_local_bridge_info');
      if (info?.ok) {
        if (info.bridgeUrl) bridgeUrl.value = info.bridgeUrl;
        applyBridgeInfo(info);
      }
    } catch {
      /* 保留 tauri-desktop 模式 */
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
        applyBridgeInfo(info);
      }
    }
  }

  if (runtimeMode.value !== 'web-standalone') {
    const pulled = await pullFromBridge();
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

/** 切换到指定（或默认）浏览器打开（先同步数据再拉起） */
export async function openInBrowserMode(overrideBrowserId?: string): Promise<void> {
  if (switching.value) return;
  switching.value = true;
  try {
    const targetBrowser = overrideBrowserId || preferredBrowser.value || 'system';
    const browserLabel = installedBrowsers.value.find(b => b.id === targetBrowser)?.name ?? '系统默认浏览器';
    const tauri = getTauriInternals();

    if (runtimeMode.value === 'tauri-desktop' || tauri) {
      await pushToBridge().catch(() => false);
      if (tauri) {
        await tauri.invoke('open_in_browser', { browserId: targetBrowser });
        window.$message?.success(`已同步本机数据并在「${browserLabel}」中打开`);
        return;
      }
      if (bridgeUrl.value) {
        await fetchJsonWithTimeout(
          `${bridgeUrl.value}/__sct_api/open-browser`,
          {
            method: 'POST',
            headers: LOCAL_POST_HEADERS,
            body: JSON.stringify({ browserId: targetBrowser })
          },
          2000
        );
        window.$message?.success(`已同步本机数据并在「${browserLabel}」中打开`);
        return;
      }
    }

    window.open(window.location.href, '_blank', 'noopener,noreferrer');
    window.$message?.info('已在新浏览器标签页中打开（桌面端安装包支持选择已安装浏览器并实时同步）');
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
    await pushToBridge().catch(() => false);
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
    await tauri.invoke('set_launch_prefs', { defaultOpenMode: normalized }).catch(() => {});
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

/** 保存默认用于打开的浏览器（系统默认 / Chrome / Safari / Edge 等） */
export async function setPreferredBrowser(browserId: string): Promise<void> {
  const clean = browserId.trim() || 'system';
  preferredBrowser.value = clean;
  writeLocalPreferredBrowser(clean);

  const tauri = getTauriInternals();
  if (tauri) {
    await tauri.invoke('set_launch_prefs', { preferredBrowser: clean }).catch(() => {});
  } else if (bridgeUrl.value) {
    await fetchJsonWithTimeout(
      `${bridgeUrl.value}/__sct_api/prefs`,
      {
        method: 'POST',
        headers: LOCAL_POST_HEADERS,
        body: JSON.stringify({ preferredBrowser: clean })
      },
      2000
    );
  }
}

/** 保存关闭窗口时的默认行为（每次询问 / 隐藏至程序坞或任务栏 / 直接退出） */
export async function setCloseBehavior(behavior: CloseBehaviorPref): Promise<void> {
  const normalized: CloseBehaviorPref =
    behavior === 'minimize' || behavior === 'exit' || behavior === 'ask' ? behavior : 'ask';
  closeBehavior.value = normalized;
  writeLocalCloseBehavior(normalized);

  const tauri = getTauriInternals();
  if (tauri) {
    await tauri.invoke('set_launch_prefs', { closeBehavior: normalized }).catch(() => {});
  } else if (bridgeUrl.value) {
    await fetchJsonWithTimeout(
      `${bridgeUrl.value}/__sct_api/prefs`,
      {
        method: 'POST',
        headers: LOCAL_POST_HEADERS,
        body: JSON.stringify({ closeBehavior: normalized })
      },
      2000
    );
  }
}

/** 响应首次关闭弹窗的选择：同步数据后收起窗口或退出软件 */
export async function applyCloseAction(action: 'minimize' | 'exit', remember: boolean): Promise<void> {
  const normalized: 'minimize' | 'exit' = action === 'exit' ? 'exit' : 'minimize';
  if (remember) {
    closeBehavior.value = normalized;
    writeLocalCloseBehavior(normalized);
  }
  await pushToBridge().catch(() => false);
  const tauri = getTauriInternals();
  if (tauri) {
    await tauri.invoke('apply_close_action', { action: normalized, remember }).catch(() => {});
  }
}

export function useDesktopBridge() {
  return {
    runtimeMode: readonly(runtimeMode),
    bridgeUrl: readonly(bridgeUrl),
    defaultOpenMode: readonly(defaultOpenMode),
    preferredBrowser: readonly(preferredBrowser),
    closeBehavior: readonly(closeBehavior),
    installedBrowsers: readonly(installedBrowsers),
    syncing: readonly(syncing),
    switching: readonly(switching),
    openInBrowserMode,
    returnToDesktopMode,
    setDefaultOpenMode,
    setPreferredBrowser,
    setCloseBehavior,
    applyCloseAction,
    pushToBridge,
    pullFromBridge
  };
}
