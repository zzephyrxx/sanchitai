<script setup lang="ts">
import { useThemeStore } from '@/store/modules/theme';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'ThemeDensity' });

const themeStore = useThemeStore();
const { bi } = useSctI18n();

const DENSITY_OPTIONS: Array<{ value: UnionKey.ThemeDensity; zh: string; en: string }> = [
  { value: 'compact', zh: '紧凑', en: 'Compact' },
  { value: 'comfortable', zh: '舒适（默认）', en: 'Comfortable' },
  { value: 'loose', zh: '宽松', en: 'Loose' }
];
</script>

<template>
  <NDivider>{{ bi('界面密度', 'Interface Density') }}</NDivider>
  <div class="flex flex-col gap-8px">
    <NRadioGroup
      :value="themeStore.density"
      size="small"
      class="w-full"
      @update:value="v => themeStore.setDensity(v as UnionKey.ThemeDensity)"
    >
      <div class="grid w-full grid-cols-3">
        <NRadioButton v-for="opt in DENSITY_OPTIONS" :key="opt.value" :value="opt.value" class="text-center">
          {{ bi(opt.zh, opt.en) }}
        </NRadioButton>
      </div>
    </NRadioGroup>
    <div class="text-11px text-gray-400">
      {{ bi('同步调节卡片内边距、表格行高与泳道卡片间距', 'Adjusts card padding, table rows & lane spacing') }}
    </div>
  </div>
</template>

<style scoped></style>
