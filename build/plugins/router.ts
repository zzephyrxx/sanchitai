import type { RouteMeta } from 'vue-router';
import type { RouteKey } from '@elegant-router/types';
import ElegantVueRouter from '@elegant-router/vue/vite';

export function setupElegantRouter() {
  return ElegantVueRouter({
    layouts: {
      base: 'src/layouts/base-layout/index.vue',
      blank: 'src/layouts/blank-layout/index.vue'
    },
    routePathTransformer(routeName, routePath) {
      return routePath;
    },
    onRouteMetaGen(routeName) {
      const key = routeName as RouteKey;

      const constantRoutes: RouteKey[] = ['403', '404', '500'];

      /** 三尺台菜单图标（lucide 现代线条集，离线注册于 plugins/iconify.ts） */
      const routeIcons: Partial<Record<RouteKey, string>> = {
        calendar: 'lucide:calendar-days',
        members: 'lucide:users-round',
        meetings: 'lucide:presentation',
        development: 'lucide:route',
        fees: 'lucide:coins',
        talks: 'lucide:messages-square',
        docs: 'lucide:folder-open',
        dashboard: 'lucide:layout-dashboard',
        settings: 'lucide:settings-2'
      };

      const meta: Partial<RouteMeta> = {
        title: key,
        i18nKey: `route.${key}` as App.I18n.I18nKey
      };

      if (constantRoutes.includes(key)) {
        meta.constant = true;
      }

      const icon = routeIcons[key];
      if (icon) {
        meta.icon = icon;
      }

      return meta;
    }
  });
}
