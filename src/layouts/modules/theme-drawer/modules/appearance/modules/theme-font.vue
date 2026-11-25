<script setup lang="ts">
import { computed } from 'vue';
import { $t } from '@/locales';
import { useThemeStore } from '@/store/modules/theme';
import SettingItem from '../../../components/setting-item.vue';

defineOptions({
  name: 'ThemeFont'
});

const themeStore = useThemeStore();

const sansOptions = computed<Array<{ label: string; value: UnionKey.ThemeFontSans }>>(() => [
  { label: $t('theme.appearance.themeFont.options.sans.system'), value: 'system' },
  { label: $t('theme.appearance.themeFont.options.sans.pingfang'), value: 'pingfang' },
  { label: $t('theme.appearance.themeFont.options.sans.yahei'), value: 'yahei' },
  { label: $t('theme.appearance.themeFont.options.sans.harmony'), value: 'harmony' },
  { label: $t('theme.appearance.themeFont.options.sans.noto-sans'), value: 'noto-sans' },
  { label: $t('theme.appearance.themeFont.options.sans.inter'), value: 'inter' },
  { label: $t('theme.appearance.themeFont.options.sans.georgia'), value: 'georgia' },
  { label: $t('theme.appearance.themeFont.options.sans.songti'), value: 'songti' },
  { label: $t('theme.appearance.themeFont.options.sans.kaiti'), value: 'kaiti' },
  { label: $t('theme.appearance.themeFont.options.sans.fangsong'), value: 'fangsong' }
]);

const headingOptions = computed<Array<{ label: string; value: UnionKey.ThemeFontHeading }>>(() => [
  { label: $t('theme.appearance.themeFont.options.heading.follow-sans'), value: 'follow-sans' },
  { label: $t('theme.appearance.themeFont.options.heading.songti'), value: 'songti' },
  { label: $t('theme.appearance.themeFont.options.heading.kaiti'), value: 'kaiti' },
  { label: $t('theme.appearance.themeFont.options.heading.fangsong'), value: 'fangsong' },
  { label: $t('theme.appearance.themeFont.options.heading.heiti'), value: 'heiti' },
  { label: $t('theme.appearance.themeFont.options.heading.georgia'), value: 'georgia' },
  { label: $t('theme.appearance.themeFont.options.heading.inter'), value: 'inter' }
]);

const monoOptions = computed<Array<{ label: string; value: UnionKey.ThemeFontMono }>>(() => [
  { label: $t('theme.appearance.themeFont.options.mono.ibm-plex'), value: 'ibm-plex' },
  { label: $t('theme.appearance.themeFont.options.mono.jetbrains'), value: 'jetbrains' },
  { label: $t('theme.appearance.themeFont.options.mono.fira-code'), value: 'fira-code' },
  { label: $t('theme.appearance.themeFont.options.mono.sf-mono'), value: 'sf-mono' },
  { label: $t('theme.appearance.themeFont.options.mono.consolas'), value: 'consolas' },
  { label: $t('theme.appearance.themeFont.options.mono.source-code'), value: 'source-code' }
]);
</script>

<template>
  <NDivider>{{ $t('theme.appearance.themeFont.title') }}</NDivider>
  <TransitionGroup tag="div" name="setting-list" class="flex-col-stretch gap-12px">
    <SettingItem key="scale" :label="$t('theme.appearance.themeFont.scale')">
      <div class="flex items-center gap-6px">
        <NInputNumber
          v-model:value="themeStore.fontConfig.scale"
          size="small"
          :step="5"
          :min="85"
          :max="150"
          class="w-120px"
        >
          <template #suffix>%</template>
        </NInputNumber>
        <NButton
          v-if="themeStore.fontConfig.scale !== 100"
          size="tiny"
          quaternary
          @click="themeStore.fontConfig.scale = 100"
        >
          100%
        </NButton>
      </div>
    </SettingItem>
    <SettingItem key="sans" :label="$t('theme.appearance.themeFont.sans')">
      <NSelect v-model:value="themeStore.fontConfig.sans" :options="sansOptions" size="small" class="w-176px" />
    </SettingItem>
    <SettingItem key="heading" :label="$t('theme.appearance.themeFont.heading')">
      <NSelect v-model:value="themeStore.fontConfig.heading" :options="headingOptions" size="small" class="w-176px" />
    </SettingItem>
    <SettingItem key="mono" :label="$t('theme.appearance.themeFont.mono')">
      <NSelect v-model:value="themeStore.fontConfig.mono" :options="monoOptions" size="small" class="w-176px" />
    </SettingItem>
  </TransitionGroup>
</template>

<style scoped></style>
