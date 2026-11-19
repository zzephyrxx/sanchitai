import { createApp } from 'vue';
import { setupAppVersionNotification, setupDayjs, setupIconifyOffline, setupLoading, setupNProgress } from './plugins';
import './plugins/assets';
import { getLocale, setupI18n } from './locales';
import { setupStore } from './store';
import { ensureSeeded } from './db/seed';
import { ensureProbationCandidates } from './db/probation';
import { setupRouter } from './router';
import App from './App.vue';

async function setupApp() {
  setupLoading();

  setupNProgress();

  setupIconifyOffline();

  setupDayjs();

  const app = createApp(App);

  setupStore(app);

  // 三尺台：首次启动自动导入演示种子数据
  await ensureSeeded();

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
