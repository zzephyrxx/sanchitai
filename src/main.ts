import { createApp } from 'vue';
import { initDesktopBridge } from './utils/desktop-bridge';
import { setupAppVersionNotification, setupDayjs, setupIconifyOffline, setupLoading, setupNProgress } from './plugins';
import './plugins/assets';
import { setupI18n } from './locales';
import { setupStore } from './store';
import { setupRouter } from './router';
import App from './App.vue';
import { syncMemberPartyStatuses } from './db/db';
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

// PWA：离线 Service Worker。防御式动态加载（评审轮2 P1-4）：
// 若 dev server 先于 vite 配置（PWA 插件）启动，静态导入会 500 白屏；动态导入失败则静默跳过
import('virtual:pwa-register')
  .then(m => m.registerSW({ immediate: true }))
  .catch(() => {
    /* dev 或插件未挂载：忽略 */
  });

setupApp();
