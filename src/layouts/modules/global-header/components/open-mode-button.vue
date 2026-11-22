<script setup lang="ts">
import { computed } from 'vue';
import type { DropdownOption } from 'naive-ui';
import { useDesktopBridge } from '@/utils/desktop-bridge';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'OpenModeButton' });

const {
  runtimeMode,
  preferredBrowser,
  installedBrowsers,
  switching,
  openInBrowserMode,
  returnToDesktopMode,
  setPreferredBrowser
} = useDesktopBridge();
const { bi } = useSctI18n();

const isTauriBrowser = computed(() => runtimeMode.value === 'tauri-browser');

const currentBrowserName = computed(
  () => installedBrowsers.value.find(b => b.id === preferredBrowser.value)?.name ?? '系统默认浏览器'
);

const browserMenuOptions = computed<DropdownOption[]>(() =>
  installedBrowsers.value.map(b => ({
    key: b.id,
    label: b.id === preferredBrowser.value ? `${b.name}（当前默认）` : b.name
  }))
);

const tooltipText = computed(() => {
  if (isTauriBrowser.value) {
    return bi(
      '已与桌面端共享本机数据，点击立即同步并唤醒三尺台桌面端窗口',
      'Synced with local desktop app — click to wake & return to desktop window'
    );
  }
  if (runtimeMode.value === 'tauri-desktop') {
    return bi(
      `使用「${currentBrowserName.value}」打开（点右侧箭头可切换浏览器，两端实时共享数据）`,
      `Open in ${currentBrowserName.value} (click arrow to switch browser, synced locally)`
    );
  }
  return bi(
    '在浏览器新标签页中打开（桌面安装包下可选择本机已安装浏览器并双向同步）',
    'Open in new browser tab (desktop app supports selecting installed browsers)'
  );
});

async function handleMainClick() {
  if (isTauriBrowser.value) {
    await returnToDesktopMode();
  } else {
    await openInBrowserMode();
  }
}

async function handleSelectBrowser(key: string) {
  await setPreferredBrowser(key);
  await openInBrowserMode(key);
}
</script>

<template>
  <!-- 浏览器模式：返回桌面端 -->
  <NTooltip v-if="isTauriBrowser" placement="bottom">
    <template #trigger>
      <NButton size="small" secondary class="open-mode-btn shrink-0" :loading="switching" @click="handleMainClick">
        <template #icon><SvgIcon icon="lucide:monitor" /></template>
        <span class="hidden text-12px sm:inline">{{ bi('返回桌面端', 'Return to Desktop') }}</span>
      </NButton>
    </template>
    {{ tooltipText }}
  </NTooltip>

  <!-- 桌面端 / 网页模式：在浏览器中打开 + 右侧选择指定浏览器 -->
  <div v-else class="inline-flex shrink-0 items-center">
    <NButtonGroup size="small">
      <NTooltip placement="bottom">
        <template #trigger>
          <NButton secondary class="open-mode-btn" :loading="switching" @click="handleMainClick">
            <template #icon><SvgIcon icon="lucide:external-link" /></template>
            <span class="hidden text-12px sm:inline">{{ bi('在浏览器中打开', 'Open in Browser') }}</span>
          </NButton>
        </template>
        {{ tooltipText }}
      </NTooltip>
      <NDropdown
        trigger="click"
        placement="bottom-end"
        :options="browserMenuOptions"
        @select="k => handleSelectBrowser(String(k))"
      >
        <NButton secondary class="open-mode-caret" :title="bi('选择要使用的浏览器', 'Choose browser')">
          <template #icon><SvgIcon icon="lucide:chevron-down" class="text-13px" /></template>
        </NButton>
      </NDropdown>
    </NButtonGroup>
  </div>
</template>

<style scoped>
.open-mode-btn {
  height: 30px;
  padding: 0 9px;
}
.open-mode-caret {
  height: 30px;
  padding: 0 6px;
}
</style>
