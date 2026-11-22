<script setup lang="ts">
import { ref } from 'vue';
import { APP_RELEASE_DATE, APP_VERSION, LATEST_CHANGELOG } from '@/constants/changelog';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'ChangelogButton' });

const SEEN_KEY = 'sct:changelog:seen-version';
const { bi } = useSctI18n();

function readHasUnread(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== APP_VERSION;
  } catch {
    return false;
  }
}

const show = ref(false);
const hasUnread = ref(readHasUnread());

function markSeen() {
  hasUnread.value = false;
  try {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
  } catch {
    /* ignore */
  }
}

function handleUpdateShow(val: boolean) {
  show.value = val;
  if (val && hasUnread.value) {
    markSeen();
  }
}
</script>

<template>
  <NPopover
    :show="show"
    trigger="click"
    placement="bottom-end"
    :width="390"
    :show-arrow="true"
    @update:show="handleUpdateShow"
  >
    <template #trigger>
      <NTooltip placement="bottom" :disabled="show">
        <template #trigger>
          <button
            type="button"
            class="changelog-trigger relative flex-center rounded-6px p-6px text-18px transition-colors hover:bg-[var(--sct-soft)]"
            :aria-label="bi('更新内容', 'What’s New')"
          >
            <SvgIcon icon="lucide:sparkles" />
            <span v-if="hasUnread" class="changelog-dot" />
          </button>
        </template>
        {{ bi(`更新内容（${APP_VERSION}）`, `What's New (${APP_VERSION})`) }}
      </NTooltip>
    </template>

    <div class="flex flex-col gap-10px p-4px">
      <div class="flex items-center justify-between border-b border-[var(--sct-border)] pb-8px">
        <div class="flex items-center gap-6px">
          <SvgIcon icon="lucide:sparkles" class="text-16px text-[var(--sct-accent)]" />
          <span class="text-14px font-bold text-[var(--sct-ink)]">{{ bi('更新内容', "What's New") }}</span>
          <NTag size="tiny" type="error" :bordered="false">{{ APP_VERSION }}</NTag>
        </div>
        <span class="text-11px text-gray-400">{{ APP_RELEASE_DATE }}</span>
      </div>

      <div class="flex flex-col gap-10px">
        <div v-for="sec in LATEST_CHANGELOG" :key="sec.titleZh" class="flex flex-col gap-4px">
          <div class="flex items-center gap-5px text-12px font-semibold text-[var(--sct-ink)]">
            <SvgIcon :icon="sec.icon" class="text-13px text-[var(--sct-accent)]" />
            <span>{{ bi(sec.titleZh, sec.titleEn) }}</span>
          </div>
          <ul class="m-0 flex flex-col gap-3px pl-18px text-12px leading-snug text-gray-600 dark:text-gray-300">
            <li v-for="(item, idx) in sec.itemsZh" :key="idx">
              {{ bi(item, sec.itemsEn[idx] ?? item) }}
            </li>
          </ul>
        </div>
      </div>

      <div class="flex items-center justify-end border-t border-[var(--sct-border)] pt-8px">
        <NButton size="tiny" type="primary" secondary @click="show = false">
          {{ bi('我知道了', 'Got it') }}
        </NButton>
      </div>
    </div>
  </NPopover>
</template>

<style scoped>
.changelog-trigger {
  color: inherit;
  cursor: pointer;
}
.changelog-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #a81c24;
}
</style>
