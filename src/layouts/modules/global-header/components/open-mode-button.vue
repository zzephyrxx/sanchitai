<script setup lang="ts">
import { computed } from 'vue';
import { useDesktopBridge } from '@/utils/desktop-bridge';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'OpenModeButton' });

const { runtimeMode, switching, openInBrowserMode, returnToDesktopMode } = useDesktopBridge();
const { bi } = useSctI18n();

const isTauriBrowser = computed(() => runtimeMode.value === 'tauri-browser');

const buttonLabel = computed(() =>
  isTauriBrowser.value ? bi('返回桌面端', 'Return to Desktop') : bi('在浏览器中打开', 'Open in Browser')
);

const buttonIcon = computed(() => (isTauriBrowser.value ? 'lucide:monitor' : 'lucide:external-link'));

const tooltipText = computed(() => {
  if (isTauriBrowser.value) {
    return bi(
      '已与桌面端共享本机数据，点击立即同步并唤醒三尺台桌面端窗口',
      'Synced with local desktop app — click to wake & return to desktop window'
    );
  }
  if (runtimeMode.value === 'tauri-desktop') {
    return bi(
      '在系统默认浏览器中打开工作台，与桌面端共享同一份本机数据',
      'Open in system default browser with real-time local data sync'
    );
  }
  return bi(
    '在浏览器新标签页中打开（桌面安装包下可与浏览器双向同步切换）',
    'Open in new browser tab (desktop package supports bidirectional sync)'
  );
});

async function handleClick() {
  if (isTauriBrowser.value) {
    await returnToDesktopMode();
  } else {
    await openInBrowserMode();
  }
}
</script>

<template>
  <NTooltip placement="bottom">
    <template #trigger>
      <NButton size="small" secondary class="open-mode-btn shrink-0" :loading="switching" @click="handleClick">
        <template #icon><SvgIcon :icon="buttonIcon" /></template>
        <span class="hidden text-12px sm:inline">{{ buttonLabel }}</span>
      </NButton>
    </template>
    {{ tooltipText }}
  </NTooltip>
</template>

<style scoped>
.open-mode-btn {
  height: 30px;
  padding: 0 10px;
}
</style>
