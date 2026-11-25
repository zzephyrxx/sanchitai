import type { Router } from 'vue-router';
import { useTitle } from '@vueuse/core';
import { $t } from '@/locales';

const APP_BRAND_TITLE = '三尺台';

export function createDocumentTitleGuard(router: Router) {
  router.afterEach(to => {
    const { i18nKey, title } = to.meta;

    const rawPageTitle = (i18nKey ? $t(i18nKey) : title)?.trim() ?? '';
    const documentTitle =
      rawPageTitle && rawPageTitle !== APP_BRAND_TITLE ? `${rawPageTitle} · ${APP_BRAND_TITLE}` : APP_BRAND_TITLE;

    useTitle(documentTitle);
  });
}
