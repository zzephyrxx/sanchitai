<script setup lang="ts">
import { computed } from 'vue';
import { themeSchemaRecord } from '@/constants/app';
import { $t } from '@/locales';
import { useThemeStore } from '@/store/modules/theme';
import SettingItem from '../../../components/setting-item.vue';

defineOptions({
  name: 'ThemeSchema'
});

const themeStore = useThemeStore();

const icons: Record<UnionKey.ThemeScheme, string> = {
  light: 'lucide:sun',
  dark: 'lucide:moon',
  auto: 'lucide:monitor'
};

function handleSegmentChange(value: string | number) {
  themeStore.setThemeScheme(value as UnionKey.ThemeScheme);
}

/** 三尺台主题皮肤（默认 / 电子纸 KONTUR Ledger CRM） */
const presetOptions: Array<{ label: string; value: UnionKey.ThemePreset; desc: string }> = [
  { label: '默认（墨韵）', value: 'default', desc: '中式简约墨韵' },
  { label: '电子纸 (KONTUR)', value: 'crm-frosted-glass', desc: '瑞士暖纸台账 · 棱角分明' }
];

function handlePresetChange(value: UnionKey.ThemePreset, e?: MouseEvent) {
  themeStore.setThemePreset(value, e);
}

function handleGrayscaleChange(value: boolean) {
  themeStore.setGrayscale(value);
}

function handleColourWeaknessChange(value: boolean) {
  themeStore.setColourWeakness(value);
}

const showSiderInverted = computed(() => !themeStore.darkMode && themeStore.layout.mode.includes('vertical'));
</script>

<template>
  <NDivider>{{ $t('theme.appearance.themeSchema.title') }}</NDivider>
  <div class="flex-col-stretch gap-16px">
    <div class="i-flex-center">
      <NTabs
        :key="themeStore.themeScheme"
        type="segment"
        size="small"
        class="relative w-214px"
        :value="themeStore.themeScheme"
        @update:value="handleSegmentChange"
      >
        <NTab v-for="(_, key) in themeSchemaRecord" :key="key" :name="key">
          <SvgIcon :icon="icons[key]" class="h-23px text-icon-small" />
        </NTab>
      </NTabs>
    </div>
    <div class="grid grid-cols-2 gap-8px">
      <button
        v-for="opt in presetOptions"
        :key="opt.value"
        type="button"
        class="flex flex-col items-start rounded-8px border px-10px py-8px text-left transition"
        :style="{
          background: (themeStore.themePreset ?? 'default') === opt.value ? 'var(--sct-soft)' : 'var(--sct-container)',
          borderColor: (themeStore.themePreset ?? 'default') === opt.value ? 'var(--sct-accent)' : 'var(--sct-border)'
        }"
        @click="handlePresetChange(opt.value, $event)"
      >
        <span class="text-12px font-bold" style="color: var(--sct-ink)">{{ opt.label }}</span>
        <span class="mt-2px text-10px" style="color: var(--sct-muted)">{{ opt.desc }}</span>
      </button>
    </div>
    <Transition name="sider-inverted">
      <SettingItem v-if="showSiderInverted" :label="$t('theme.layout.sider.inverted')">
        <NSwitch v-model:value="themeStore.sider.inverted" />
      </SettingItem>
    </Transition>
    <SettingItem :label="$t('theme.appearance.grayscale')">
      <NSwitch :value="themeStore.grayscale" @update:value="handleGrayscaleChange" />
    </SettingItem>
    <SettingItem :label="$t('theme.appearance.colourWeakness')">
      <NSwitch :value="themeStore.colourWeakness" @update:value="handleColourWeaknessChange" />
    </SettingItem>
  </div>
</template>

<style scoped>
.sider-inverted-enter-active,
.sider-inverted-leave-active {
  --uno: h-22px transition-all-300;
}

.sider-inverted-enter-from,
.sider-inverted-leave-to {
  --uno: translate-x-20px opacity-0 h-0;
}
</style>
