/**
 * 自毁式 Service Worker（仅用于平滑清理旧版 v0.2.3 在 Windows WebView2 与浏览器中遗留的 Workbox 缓存）
 *
 * 三尺台桌面端（Tauri）已将全部静态资源打包进二进制内，本机 127.0.0.1 服务同样零延迟离线可用，
 * 不应再由 Service Worker 接管缓存（否则 Windows WebView2 升级安装包后会一直命中的旧版缓存）。
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      } catch {
        /* ignore */
      }
      try {
        await self.registration.unregister();
      } catch {
        /* ignore */
      }
      try {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
          if ('navigate' in client) {
            await client.navigate(client.url).catch(() => {});
          }
        }
      } catch {
        /* ignore */
      }
    })()
  );
});
