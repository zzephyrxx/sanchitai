<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Clipboard from 'clipboard';
import { $t } from '@/locales';
import { useThemeStore } from '@/store/modules/theme';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({
  name: 'ConfigOperation'
});

const themeStore = useThemeStore();
const { bi } = useSctI18n();

const domRef = ref<HTMLElement | null>(null);

function initClipboard() {
  if (!domRef.value) return;

  const clipboard = new Clipboard(domRef.value);

  clipboard.on('success', () => {
    window.$message?.success($t('theme.configOperation.copySuccessMsg'));
  });
}

function getClipboardText() {
  const reg = /"\w+":/g;

  const json = themeStore.settingsJson;

  return json.replace(reg, match => match.replace(/"/g, ''));
}

function handleReset() {
  themeStore.resetStore();

  setTimeout(() => {
    window.$message?.success($t('theme.configOperation.resetSuccessMsg'));
  }, 50);
}

const dataClipboardText = computed(() => getClipboardText());

onMounted(() => {
  initClipboard();
});
</script>

<template>
  <div class="w-full flex justify-between">
    <textarea id="themeConfigCopyTarget" v-model="dataClipboardText" class="absolute opacity-0 -z-1" />
    <NPopconfirm
      :positive-text="bi('确认重置', 'Confirm Reset')"
      :negative-text="bi('取消', 'Cancel')"
      @positive-click="handleReset"
    >
      <template #trigger>
        <NButton type="error" ghost>{{ $t('theme.configOperation.resetConfig') }}</NButton>
      </template>
      {{
        bi(
          '确认将全部主题配置（含皮肤、深浅模式、布局与颜色）恢复为默认值吗？',
          'Reset all theme settings (skin, dark mode, layout & colors) to defaults?'
        )
      }}
    </NPopconfirm>
    <div ref="domRef" data-clipboard-target="#themeConfigCopyTarget">
      <NButton type="primary">{{ $t('theme.configOperation.copyConfig') }}</NButton>
    </div>
  </div>
</template>

<style scoped></style>
