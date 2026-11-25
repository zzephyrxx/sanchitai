<script setup lang="ts">
import { computed, ref } from 'vue';
import { APP_VERSION, CHANGELOG_HISTORY } from '@/constants/changelog';
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
/** 当前查看的版本索引：0 为最新版本，向右（+1）查看更早历史版本，向左（-1）回到更新版本 */
const currentIdx = ref(0);

const currentRelease = computed(() => CHANGELOG_HISTORY[currentIdx.value] ?? CHANGELOG_HISTORY[0]);
const canPrevVersion = computed(() => currentIdx.value < CHANGELOG_HISTORY.length - 1);
const canNextVersion = computed(() => currentIdx.value > 0);

function goOlderVersion() {
  if (canPrevVersion.value) {
    currentIdx.value += 1;
  }
}

function goNewerVersion() {
  if (canNextVersion.value) {
    currentIdx.value -= 1;
  }
}

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
  if (val) {
    currentIdx.value = 0;
    if (hasUnread.value) {
      markSeen();
    }
  }
}
</script>

<template>
  <NPopover
    :show="show"
    trigger="click"
    placement="bottom-end"
    :width="468"
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
      <!-- 顶栏：当前版本 + 左右切换历史版本按钮 -->
      <div class="flex items-center justify-between border-b border-[var(--sct-border)] pb-8px">
        <div class="flex items-center gap-6px">
          <SvgIcon icon="lucide:sparkles" class="text-16px text-[var(--sct-accent)]" />
          <span class="text-14px font-bold text-[var(--sct-ink)]">{{ bi('更新内容', "What's New") }}</span>
          <NTag size="tiny" :type="currentIdx === 0 ? 'error' : 'default'" :bordered="false">
            {{ currentRelease.version }}
          </NTag>
          <NTag v-if="currentIdx === 0" size="tiny" type="success" :bordered="false" round class="text-10px">
            {{ bi('当前', 'Latest') }}
          </NTag>
          <span class="text-11px text-gray-400">{{ currentRelease.date }}</span>
        </div>

        <div class="flex items-center gap-4px">
          <NButton
            size="tiny"
            quaternary
            :disabled="!canPrevVersion"
            :title="bi('查看上一版本', 'Older version')"
            @click="goOlderVersion"
          >
            <template #icon><SvgIcon icon="lucide:chevron-left" class="text-14px" /></template>
          </NButton>
          <span class="min-w-28px text-center font-mono text-11px text-gray-400">
            {{ CHANGELOG_HISTORY.length - currentIdx }}/{{ CHANGELOG_HISTORY.length }}
          </span>
          <NButton
            size="tiny"
            quaternary
            :disabled="!canNextVersion"
            :title="bi('查看下一版本', 'Newer version')"
            @click="goNewerVersion"
          >
            <template #icon><SvgIcon icon="lucide:chevron-right" class="text-14px" /></template>
          </NButton>
        </div>
      </div>

      <!-- 版本更新条目（无底色无边框通透排版，每条小功能配专属小图标 + 悬浮「更多」） -->
      <div class="changelog-scroll flex flex-col gap-12px">
        <div v-for="sec in currentRelease.sections" :key="sec.titleZh" class="flex flex-col gap-5px">
          <div class="flex items-center gap-5px text-12px font-semibold text-[var(--sct-ink)]">
            <SvgIcon :icon="sec.icon" class="text-13px text-[var(--sct-accent)]" />
            <span>{{ bi(sec.titleZh, sec.titleEn) }}</span>
          </div>
          <ul
            class="m-0 flex flex-col text-12px leading-snug text-gray-600 dark:text-gray-300"
            :class="[
              sec.items.some(i => i.icon) ? 'list-none pl-4px' : 'pl-18px',
              sec.items.some(i => i.titleZh) ? 'gap-8px' : 'gap-5px'
            ]"
          >
            <li v-for="(item, idx) in sec.items" :key="idx" :class="item.icon ? 'flex items-start gap-7px' : ''">
              <SvgIcon
                v-if="item.icon"
                :icon="item.icon"
                class="mt-3px shrink-0 text-13px text-[var(--sct-accent)] opacity-85"
              />
              <!-- 两行式排版：第一行粗体简要标题（+ Preview），第二行缩进详细解释（+ 更多悬浮） -->
              <div v-if="item.titleZh" class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-5px leading-snug">
                  <strong class="text-12.5px font-semibold text-[var(--sct-ink)]">
                    {{ bi(item.titleZh, item.titleEn || item.titleZh) }}
                  </strong>
                  <NTag v-if="item.badge" size="tiny" type="warning" :bordered="false" round class="text-10px">
                    {{ item.badge }}
                  </NTag>
                </div>
                <div class="mt-2px text-11.5px leading-relaxed text-gray-500 dark:text-gray-400">
                  <span class="align-middle">{{ bi(item.zh, item.en) }}</span>
                  <NTooltip v-if="item.detailZh" trigger="hover" placement="top" :style="{ maxWidth: '320px' }">
                    <template #trigger>
                      <span class="changelog-more-pill ml-5px align-middle">
                        {{ bi('更多', 'More') }}
                      </span>
                    </template>
                    <div class="text-12px leading-relaxed">
                      {{ bi(item.detailZh, item.detailEn || item.detailZh) }}
                    </div>
                  </NTooltip>
                </div>
              </div>
              <!-- 紧凑单行式排版（用于体验优化、问题修复及历史版本） -->
              <span v-else class="flex-1 leading-relaxed">
                <span class="align-middle">{{ bi(item.zh, item.en) }}</span>
                <NTag
                  v-if="item.badge"
                  size="tiny"
                  type="warning"
                  :bordered="false"
                  round
                  class="ml-5px align-middle text-10px"
                >
                  {{ item.badge }}
                </NTag>
                <NTooltip v-if="item.detailZh" trigger="hover" placement="top" :style="{ maxWidth: '320px' }">
                  <template #trigger>
                    <span class="changelog-more-pill ml-5px align-middle">
                      {{ bi('更多', 'More') }}
                    </span>
                  </template>
                  <div class="text-12px leading-relaxed">
                    {{ bi(item.detailZh, item.detailEn || item.detailZh) }}
                  </div>
                </NTooltip>
              </span>
            </li>
          </ul>
        </div>
      </div>

      <!-- 底栏：快速跳回最新 + 关闭 -->
      <div class="flex items-center justify-between border-t border-[var(--sct-border)] pt-8px">
        <span class="text-11px text-gray-400">
          {{
            currentIdx === 0
              ? bi('点击右上角 ‹ 可翻阅历史版本更新', 'Click ‹ to browse previous releases')
              : bi(`正在浏览历史版本 ${currentRelease.version}`, `Viewing historical release ${currentRelease.version}`)
          }}
        </span>
        <div class="flex items-center gap-6px">
          <NButton v-if="currentIdx !== 0" size="tiny" quaternary @click="currentIdx = 0">
            {{ bi('回到最新', 'Back to Latest') }}
          </NButton>
          <NButton size="tiny" type="primary" secondary @click="show = false">
            {{ bi('我知道了', 'Got it') }}
          </NButton>
        </div>
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
.changelog-scroll {
  max-height: 440px;
  overflow-y: auto;
  padding-right: 4px;
}
.changelog-more-pill {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  color: var(--sct-accent, #a81c24);
  background: transparent;
  border: 1px dashed rgba(168, 28, 36, 0.38);
  cursor: help;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.changelog-more-pill:hover {
  background: rgba(168, 28, 36, 0.08);
  border-style: solid;
}
:global(.dark) .changelog-more-pill {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.45);
}
:global(.dark) .changelog-more-pill:hover {
  background: rgba(239, 68, 68, 0.14);
}
</style>
