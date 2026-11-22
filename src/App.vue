<script setup lang="ts">
import { computed, watch } from 'vue';
import { NConfigProvider, darkTheme } from 'naive-ui';
import type { WatermarkProps } from 'naive-ui';
import { schedulePushToBridge } from './utils/desktop-bridge';
import { naiveDateLocales, naiveLocales } from './locales/naive';
import { useAppStore } from './store/modules/app';
import { useThemeStore } from './store/modules/theme';
import { useWorkDataStore } from './store/modules/work-data';
import AppLockOverlay from './components/custom/app-lock-overlay.vue';
import CloseConfirmModal from './components/custom/close-confirm-modal.vue';

defineOptions({
  name: 'App'
});

const appStore = useAppStore();
const themeStore = useThemeStore();
const workStore = useWorkDataStore();

// 当桌面端本机桥接启用时，业务数据发生变更后防抖推送至本机磁盘同步文件
watch(
  () => [
    workStore.branchName,
    workStore.members,
    workStore.seatMaps,
    workStore.calEvents,
    workStore.devStages,
    workStore.feeRecords,
    workStore.talks,
    workStore.docsList,
    workStore.attendance,
    workStore.pointRecords,
    workStore.pointVetoes,
    workStore.pointRules,
    workStore.partyGroupNames,
    workStore.youthCommitteeSlots
  ],
  () => {
    schedulePushToBridge();
  }
);

const naiveDarkTheme = computed(() => (themeStore.darkMode ? darkTheme : undefined));

const naiveLocale = computed(() => {
  return naiveLocales[appStore.locale];
});

const naiveDateLocale = computed(() => {
  return naiveDateLocales[appStore.locale];
});

const watermarkProps = computed<WatermarkProps>(() => {
  return {
    content: themeStore.watermarkContent,
    cross: true,
    fullscreen: true,
    fontSize: 16,
    lineHeight: 16,
    width: 384,
    height: 384,
    xOffset: 12,
    yOffset: 60,
    rotate: -15,
    zIndex: 9999
  };
});
</script>

<template>
  <NConfigProvider
    :theme="naiveDarkTheme"
    :theme-overrides="themeStore.naiveTheme"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    class="h-full"
  >
    <AppProvider>
      <RouterView class="bg-layout" />
      <NWatermark v-if="themeStore.watermark.visible" v-bind="watermarkProps" />
      <!-- 三尺台：应用锁锁屏（设置中启用后生效） -->
      <AppLockOverlay />
      <!-- 三尺台：桌面端首次关闭窗口行为确认弹窗 -->
      <CloseConfirmModal />
    </AppProvider>
  </NConfigProvider>
</template>

<style scoped></style>
