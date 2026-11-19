<script setup lang="ts">
import { computed } from 'vue';
import { LAYOUT_SCROLL_EL_ID } from '@sa/materials';
import { useAppStore } from '@/store/modules/app';
import { useRouteStore } from '@/store/modules/route';
import { useTabStore } from '@/store/modules/tab';
import { useThemeStore } from '@/store/modules/theme';

defineOptions({
  name: 'GlobalContent'
});

interface Props {
  /** Show padding for content */
  showPadding?: boolean;
}

withDefaults(defineProps<Props>(), {
  showPadding: true
});

const appStore = useAppStore();
const themeStore = useThemeStore();
const routeStore = useRouteStore();
const tabStore = useTabStore();

const transitionName = computed(() => (themeStore.page.animate ? themeStore.page.animateMode : ''));

function resetScroll() {
  const el = document.querySelector(`#${LAYOUT_SCROLL_EL_ID}`);

  el?.scrollTo({ left: 0, top: 0 });
}
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <!-- 关键修复：animate=false 时 transitionName 为空会生成 "-leave-active" 等无 CSS 对应的类，
         而元素自带 transition-300（all .3s）会让 Vue 等一个永不触发的 transitionend → 路由视图卡死。
         故动画关闭时不包 Transition。 -->
    <Transition
      v-if="themeStore.page.animate"
      :name="transitionName"
      mode="out-in"
      @before-leave="appStore.setContentXScrollable(true)"
      @after-leave="resetScroll"
      @after-enter="appStore.setContentXScrollable(false)"
    >
      <KeepAlive :include="routeStore.cacheRoutes" :exclude="routeStore.excludeCacheRoutes">
        <component
          :is="Component"
          v-if="appStore.reloadFlag"
          :key="tabStore.getTabIdByRoute(route)"
          :class="{ 'p-16px': showPadding }"
          class="flex-grow bg-layout"
        />
      </KeepAlive>
    </Transition>
    <KeepAlive v-else :include="routeStore.cacheRoutes" :exclude="routeStore.excludeCacheRoutes">
      <component
        :is="Component"
        v-if="appStore.reloadFlag"
        :key="tabStore.getTabIdByRoute(route)"
        :class="{ 'p-16px': showPadding }"
        class="flex-grow bg-layout"
      />
    </KeepAlive>
  </RouterView>
</template>

<style></style>
