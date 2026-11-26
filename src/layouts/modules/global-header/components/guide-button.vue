<script setup lang="ts">
/**
 * 侧栏左下角极简「使用指南」入口（纯图标 + 文字，无边框无徽章；点击呼出带图标轻量菜单）
 */
import { h } from 'vue';
import type { DropdownOption } from 'naive-ui';
import { openOnboardingGuide, startSpotlightTour } from '@/utils/onboarding-bus';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import SvgIcon from '@/components/custom/svg-icon.vue';

defineOptions({ name: 'GuideButton' });

withDefaults(defineProps<{ collapsed?: boolean; floating?: boolean }>(), {
  collapsed: false,
  floating: false
});

const { bi } = useSctI18n();

function renderMenuIcon(icon: string, color?: string) {
  return () => h(SvgIcon, { icon, class: 'text-15px', style: color ? { color } : undefined });
}

const menuOptions: DropdownOption[] = [
  {
    label: '使用指南手册',
    key: 'guide',
    icon: renderMenuIcon('lucide:book-open-text', '#2563eb')
  },
  {
    label: '新手引导动画',
    key: 'spotlight',
    icon: renderMenuIcon('lucide:play-circle', '#A81C24')
  },
  { type: 'divider', key: 'd1' },
  {
    label: '配置支部场景',
    key: 'setup',
    icon: renderMenuIcon('lucide:sliders-horizontal', '#0f766e')
  }
];

function handleSelect(key: string) {
  if (key === 'spotlight') {
    startSpotlightTour();
  } else if (key === 'setup') {
    openOnboardingGuide('setup');
  } else {
    openOnboardingGuide('guide');
  }
}
</script>

<template>
  <div data-tour="guide-entry" :class="floating ? 'fixed bottom-16px left-16px z-50' : 'px-10px py-8px'">
    <NDropdown trigger="click" placement="top-start" :options="menuOptions" @select="handleSelect">
      <button
        v-if="!collapsed"
        type="button"
        class="sider-guide-trigger w-full flex items-center gap-10px px-12px py-8px text-13.5px"
        :title="bi('使用指南', 'Guide')"
      >
        <SvgIcon icon="lucide:book-open" class="shrink-0 text-17px opacity-80" />
        <span class="truncate">{{ bi('使用指南', 'Guide') }}</span>
      </button>
      <button
        v-else
        type="button"
        class="sider-guide-trigger mx-auto flex size-36px items-center justify-center"
        :title="bi('使用指南', 'Guide')"
      >
        <SvgIcon icon="lucide:book-open" class="text-18px opacity-80" />
      </button>
    </NDropdown>
  </div>
</template>

<style scoped>
.sider-guide-trigger {
  border: none;
  background: transparent;
  color: var(--sct-muted);
  border-radius: 6px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;
}

.sider-guide-trigger:hover {
  color: var(--sct-ink);
  background: var(--sct-soft);
}
</style>
