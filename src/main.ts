import { createApp } from 'vue';
import { initDesktopBridge } from './utils/desktop-bridge';
import { setupAppVersionNotification, setupDayjs, setupIconifyOffline, setupLoading, setupNProgress } from './plugins';
import './plugins/assets';
import { setupI18n } from './locales';
import { setupStore } from './store';
import { setupRouter } from './router';
import App from './App.vue';
import { ensureDefaultDocTemplates, syncMemberPartyStatuses } from './db/db';
import { ensureProbationCandidates } from './db/probation';
import { ensureSeeded } from './db/seed';

async function setupApp() {
  setupLoading();

  setupNProgress();

  setupIconifyOffline();

  setupDayjs();

  const app = createApp(App);

  setupStore(app);

  // 三尺台：首次启动自动导入演示种子数据
  await ensureSeeded();

  // 按入党/转正时间自动同步党员身份（预备期满自动转为正式党员，无需手动确认）
  await syncMemberPartyStatuses();

  // 初始化桌面端 ⇄ 浏览器本机微服务桥接与双向同步
  await initDesktopBridge();

  // 桥接拉取旧版数据后再次确保新增内置党支部公文模板补齐（无损合并）
  await ensureDefaultDocTemplates();

  // 预备期满临近时自动生成转正大会候选事项（不阻塞启动）
  void ensureProbationCandidates().catch(err => {
    // eslint-disable-next-line no-console
    console.error('[probation-candidates]', err);
  });

  await setupRouter(app);

  setupI18n(app);

  setupAppVersionNotification();

  // 注：页面切换动画已关闭（见 theme settings.page.animate），根级过渡校验器一并停用
  // setupVueRootValidator(app, { lang: getLocale() === 'zh-CN' ? 'zh' : 'en' });

  app.mount('#app');
}

// 清理旧版（如 v0.2.3）在 Windows WebView2 (http://tauri.localhost) 或本地浏览器残留的 Service Worker 与 Workbox 缓存，
// 防止覆盖安装新版本后仍加载旧版静态资源。
async function cleanupLegacyServiceWorkers() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    if (regs.length === 0) return;
    const hadController = Boolean(navigator.serviceWorker.controller);
    await Promise.all(regs.map(r => r.unregister().catch(() => false)));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => false)));
    }
    if (hadController && !sessionStorage.getItem('sct:sw-cleaned')) {
      sessionStorage.setItem('sct:sw-cleaned', '1');
      window.location.reload();
    }
  } catch {
    /* ignore */
  }
}

void cleanupLegacyServiceWorkers();

setupApp();
