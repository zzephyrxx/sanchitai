import { addAPIProvider, addCollection, type IconifyJSON } from '@iconify/vue';
// 本地全集按需注册：菜单/运行时图标离线可用（lucide 现代线条图标集，615KB）
import lucideCollection from '@iconify/json/json/lucide.json';

/** Setup the iconify offline */
export function setupIconifyOffline() {
  addCollection(lucideCollection as unknown as IconifyJSON);

  const { VITE_ICONIFY_URL } = import.meta.env;

  if (VITE_ICONIFY_URL) {
    addAPIProvider('', { resources: [VITE_ICONIFY_URL] });
  }
}
