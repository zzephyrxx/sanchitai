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
        dashboard: 'lucide:layout-dashboard',
        settings: 'lucide:settings-2',
        ledger: 'lucide:briefcase-business',
        ledger_members: 'lucide:users-round',
        ledger_meetings: 'lucide:presentation',
        ledger_development: 'lucide:route',
        ledger_fees: 'lucide:coins',
        ledger_talks: 'lucide:messages-square',
        ledger_points: 'lucide:award',
        library: 'lucide:library-big',
        library_knowledge: 'lucide:graduation-cap',
        library_policy: 'lucide:landmark',
        library_docs: 'lucide:folder-open',
        library_birthday: 'lucide:gift',
        structure: 'lucide:network'
      };

      const routeOrders: Partial<Record<RouteKey, number>> = {
        calendar: 1,
        dashboard: 2,
        ledger: 3,
        ledger_members: 1,
        ledger_meetings: 2,
        ledger_development: 3,
        ledger_fees: 4,
        ledger_talks: 5,
        ledger_points: 6,
        library: 4,
        library_knowledge: 1,
        library_policy: 2,
        library_docs: 3,
        library_birthday: 4,
        structure: 5,
        settings: 99
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

      const order = routeOrders[key];
      if (order !== undefined) {
        meta.order = order;
      }

      return meta;
    }
  });
}
