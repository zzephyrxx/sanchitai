import type { PluginOption } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import progress from 'vite-plugin-progress';
import vueRootValidator from 'vite-plugin-vue-transition-root-validator';
import { VitePWA } from 'vite-plugin-pwa';
import { setupElegantRouter } from './router';
import { setupDevtoolsPlugin } from './devtools';
import { setupHtmlPlugin } from './html';
import { setupUnocss } from './unocss';
import { setupUnplugin } from './unplugin';

/** 三尺台 PWA：离线可用（浏览器形态）；Tauri 桌面形态会忽略 SW，无害 */
function setupPwa() {
  return VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
    manifest: {
      name: '三尺台 · 学工工作台',
      short_name: '三尺台',
      description: '学工个人离线工作台——台历、三会一课、发展台账、党费、谈话与材料库',
      lang: 'zh-CN',
      start_url: '/',
      display: 'standalone',
      background_color: '#faf8f4',
      theme_color: '#A81C24',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
      // 紧跟导航与静态资源；IndexedDB 数据不进 SW 缓存
      navigateFallback: '/',
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
    }
  });
}

export function setupVitePlugins(viteEnv: Env.ImportMeta, buildTime: string) {
  const plugins: PluginOption = [
    vue(),
    vueJsx(),
    setupDevtoolsPlugin(viteEnv),
    setupElegantRouter(),
    setupUnocss(viteEnv),
    ...setupUnplugin(viteEnv),
    progress(),
    setupHtmlPlugin(buildTime),
    vueRootValidator(),
    setupPwa()
  ];

  return plugins;
}
