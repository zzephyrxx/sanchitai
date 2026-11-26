<script setup lang="ts">
/**
 * 三尺台 v0.2.7：
 * 1. 首次启动：精简 2 步高校支部初始化弹窗（支部名称 → 初始数据）→ 完成后可自动播放「新手引导动画」
 * 2. 左下角「使用指南」：全站 15 模块详尽可检索手册弹窗
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { GUIDE_GROUPS, USER_GUIDE_CHAPTERS } from '@/constants/user-guide';
import type { GuideChapter } from '@/constants/user-guide';
import { DEFAULT_BRANCH_NAME, ONBOARDING_CURRENT_VERSION } from '@/constants/workspace-presets';
import {
  closeOnboardingGuide,
  onboardingStage,
  onboardingVisible,
  registerSpotlightLauncher,
  startSpotlightTour,
  unregisterSpotlightLauncher
} from '@/utils/onboarding-bus';
import { runSpotlightTour, stopSpotlightTour } from '@/utils/spotlight-tour';
import { useWorkDataStore } from '@/store/modules/work-data';
import { clearAllData } from '@/db/db';

defineOptions({ name: 'OnboardingGuideModal' });

const router = useRouter();
const workStore = useWorkDataStore();

function launchTour(startStepId?: string) {
  void runSpotlightTour(router, startStepId);
}

onMounted(() => {
  registerSpotlightLauncher(launchTour);
  if (!workStore.workspaceConfig.onboardingCompleted) {
    onboardingStage.value = 'setup';
    onboardingVisible.value = true;
  }
});

onBeforeUnmount(() => {
  unregisterSpotlightLauncher(launchTour);
  stopSpotlightTour();
});

// ---------------- 阶段 A：2 步高校支部初始化弹窗 ----------------
const setupStep = ref(1);
const setupBusy = ref(false);
const setupForm = reactive({
  branchName: workStore.branchName,
  dataMode: 'keep_demo' as 'keep_demo' | 'clear_blank'
});

watch(onboardingVisible, visible => {
  if (!visible) return;
  setupStep.value = 1;
  setupForm.branchName = workStore.branchName;
  setupForm.dataMode = 'keep_demo';
  guideSearch.value = '';
});

async function commitSetup(runTourAfter: boolean) {
  setupBusy.value = true;
  try {
    await workStore.setBranchName(setupForm.branchName.trim() || DEFAULT_BRANCH_NAME);
    await workStore.updateWorkspaceConfig({
      onboardingCompleted: true,
      onboardingVersion: ONBOARDING_CURRENT_VERSION
    });
    if (setupForm.dataMode === 'clear_blank') {
      await clearAllData();
      window.$message?.success('已完成初始化并清空演示数据');
    } else {
      window.$message?.success('支部工作台初始化完成');
    }
    closeOnboardingGuide();
    if (runTourAfter) {
      window.setTimeout(() => {
        startSpotlightTour();
      }, 260);
    }
  } finally {
    setupBusy.value = false;
  }
}

async function handleCloseModal() {
  if (onboardingStage.value === 'setup' && !workStore.workspaceConfig.onboardingCompleted) {
    await workStore.updateWorkspaceConfig({
      onboardingCompleted: true,
      onboardingVersion: ONBOARDING_CURRENT_VERSION
    });
  }
  closeOnboardingGuide();
}

// ---------------- 阶段 B：完整可检索「使用指南」手册弹窗 ----------------
const guideSearch = ref('');
const activeChapterId = ref<string>(USER_GUIDE_CHAPTERS[0].id);

const filteredChapters = computed<GuideChapter[]>(() => {
  const q = guideSearch.value.trim().toLowerCase();
  if (!q) return [...USER_GUIDE_CHAPTERS];
  return USER_GUIDE_CHAPTERS.filter(ch => {
    const haystack = [
      ch.title,
      ch.badge,
      ch.group,
      ch.summary,
      ...ch.features.flatMap(f => [f.name, f.desc, f.howTo]),
      ...ch.tips,
      ...ch.faq.flatMap(x => [x.q, x.a])
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
});

watch(filteredChapters, list => {
  if (list.length && !list.some(c => c.id === activeChapterId.value)) {
    activeChapterId.value = list[0].id;
  }
});

const groupedChapters = computed(() =>
  GUIDE_GROUPS.map(group => ({
    group,
    items: filteredChapters.value.filter(c => c.group === group)
  })).filter(g => g.items.length > 0)
);

const currentChapter = computed<GuideChapter>(
  () =>
    filteredChapters.value.find(c => c.id === activeChapterId.value) ??
    filteredChapters.value[0] ??
    USER_GUIDE_CHAPTERS[0]
);

const currentChapterIdx = computed(() => filteredChapters.value.findIndex(c => c.id === currentChapter.value.id));

function goPrevChapter() {
  if (currentChapterIdx.value > 0) {
    activeChapterId.value = filteredChapters.value[currentChapterIdx.value - 1].id;
  }
}

function goNextChapter() {
  if (currentChapterIdx.value < filteredChapters.value.length - 1) {
    activeChapterId.value = filteredChapters.value[currentChapterIdx.value + 1].id;
  }
}

async function jumpToRoute(routePath: string) {
  closeOnboardingGuide();
  await router.push(routePath);
}

function handlePlayAnimation(startStepId?: string) {
  closeOnboardingGuide();
  window.setTimeout(() => {
    startSpotlightTour(startStepId);
  }, 180);
}
</script>

<template>
  <NModal
    :show="onboardingVisible"
    preset="card"
    :mask-closable="onboardingStage === 'guide'"
    :closable="true"
    class="sct-guide-modal"
    :class="onboardingStage === 'setup' ? 'w-720px max-w-95vw' : 'w-980px max-w-96vw'"
    @update:show="v => !v && handleCloseModal()"
  >
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-10px">
        <div class="flex items-center gap-10px">
          <span
            class="inline-flex size-26px items-center justify-center rounded-6px bg-[#A81C24] text-13px font-bold text-white"
          >
            台
          </span>
          <span class="text-15px font-bold">
            {{ onboardingStage === 'setup' ? '欢迎使用三尺台 · 支部工作台初始化' : '使用指南 · 完整功能手册' }}
          </span>
          <NTag size="tiny" :bordered="false" class="font-mono">v0.2.7</NTag>
        </div>

        <div v-if="onboardingStage === 'guide'" class="flex items-center gap-6px">
          <NButton size="tiny" type="primary" secondary @click="handlePlayAnimation()">
            <template #icon><SvgIcon icon="lucide:play" /></template>
            播放完整新手引导动画
          </NButton>
          <NButton size="tiny" secondary @click="onboardingStage = 'setup'">
            <template #icon><SvgIcon icon="lucide:sliders-horizontal" /></template>
            初始化设置
          </NButton>
        </div>
      </div>
    </template>

    <!-- ==================== 模式 A：精简 2 步高校支部初始化弹窗 ==================== -->
    <div v-if="onboardingStage === 'setup'" class="flex flex-col gap-16px">
      <div class="grid grid-cols-2 gap-8px">
        <button
          v-for="s in [
            { n: 1, label: '01 · 支部名称' },
            { n: 2, label: '02 · 初始数据状态' }
          ]"
          :key="s.n"
          type="button"
          class="sct-inset-card px-12px py-9px text-left text-12.5px font-semibold"
          :class="{ 'is-active': setupStep === s.n, 'is-done': setupStep > s.n }"
          :style="
            setupStep > s.n
              ? { '--bar-color': '#16a34a', '--bar-soft': 'rgba(22, 163, 74, 0.08)' }
              : { '--bar-color': '#A81C24', '--bar-soft': 'rgba(168, 28, 36, 0.07)' }
          "
          @click="setupStep = s.n"
        >
          <span class="sct-inset-card__bar" />
          <span class="truncate">{{ s.label }}</span>
        </button>
      </div>

      <!-- Step 1 -->
      <div v-if="setupStep === 1" class="flex flex-col gap-14px">
        <div>
          <div class="mb-6px text-13px font-bold">支部名称</div>
          <NInput v-model:value="setupForm.branchName" maxlength="40" placeholder="请输入你的高校党支部名称" />
        </div>
        <div
          class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-14px py-10px text-12px text-[var(--sct-muted)] leading-relaxed"
        >
          已面向高校党建工作预置：学生花名册字段（学号 / 层次 / 年级 / 专业 / 班级 / 导师 / 宿舍）、学生党费默认 0.2
          元/月、60+40 党员积分方案，以及组织关系转接与志愿时长台账。后续可在「设置 →
          工作台模块工坊」按需启停扩展模块或添加自定义字段。
        </div>
      </div>

      <!-- Step 2 -->
      <div v-else class="flex flex-col gap-12px">
        <div class="text-12.5px text-[var(--sct-muted)]">选择初始数据模式，完成后可开启全站「新手引导动画」：</div>
        <div class="grid grid-cols-1 gap-10px sm:grid-cols-2">
          <button
            type="button"
            class="sct-inset-card flex-col p-14px text-left"
            :class="{ 'is-active': setupForm.dataMode === 'keep_demo' }"
            style="--bar-color: #16a34a; --bar-soft: rgba(22, 163, 74, 0.08)"
            @click="setupForm.dataMode = 'keep_demo'"
          >
            <span class="sct-inset-card__bar" />
            <div class="flex items-center gap-6px text-13.5px font-bold">
              <SvgIcon icon="lucide:sparkles" class="text-16px text-[#16a34a]" />
              <span>保留脱敏演示数据（推荐）</span>
            </div>
            <div class="mt-6px text-12px text-[var(--sct-muted)] leading-relaxed">
              内置全化名虚拟台账，便于跟随新手引导动画快速熟悉各页操作；随时可在设置页一键清空。
            </div>
          </button>
          <button
            type="button"
            class="sct-inset-card flex-col p-14px text-left"
            :class="{ 'is-active': setupForm.dataMode === 'clear_blank' }"
            style="--bar-color: #2563eb; --bar-soft: rgba(37, 99, 235, 0.08)"
            @click="setupForm.dataMode = 'clear_blank'"
          >
            <span class="sct-inset-card__bar" />
            <div class="flex items-center gap-6px text-13.5px font-bold">
              <SvgIcon icon="lucide:file-plus-2" class="text-16px text-[#2563eb]" />
              <span>清空演示数据，从零起步</span>
            </div>
            <div class="mt-6px text-12px text-[var(--sct-muted)] leading-relaxed">
              清除演示台账（保留内置标准公文模板），立即导入你的真实支部名册。
            </div>
          </button>
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="flex items-center justify-between border-t border-[var(--sct-border)] pt-12px">
        <NButton v-if="setupStep > 1" size="small" secondary @click="setupStep -= 1">← 上一步</NButton>
        <span v-else class="text-11.5px text-[var(--sct-muted)]">支部名称与扩展模块均可随时在「设置」调整</span>
        <div class="flex items-center gap-8px">
          <NButton v-if="setupStep < 2" size="small" type="primary" @click="setupStep += 1">下一步 →</NButton>
          <template v-else>
            <NButton size="small" secondary :loading="setupBusy" @click="commitSetup(false)">直接进入工作台</NButton>
            <NButton size="small" type="primary" :loading="setupBusy" @click="commitSetup(true)">
              完成并开启新手引导动画 →
            </NButton>
          </template>
        </div>
      </div>
    </div>

    <!-- ==================== 模式 B：完整可检索「使用指南」手册弹窗 ==================== -->
    <div v-else class="flex flex-col gap-12px">
      <!-- 顶部即时检索栏 -->
      <div class="flex flex-wrap items-center justify-between gap-8px">
        <NInput
          v-model:value="guideSearch"
          size="small"
          clearable
          class="max-w-360px"
          placeholder="搜索任意功能点，如：撕纸、转出、S型时间线、接龙、快照…"
        >
          <template #prefix><SvgIcon icon="lucide:search" class="text-[var(--sct-muted)]" /></template>
        </NInput>
        <span class="text-11.5px text-[var(--sct-muted)]">
          共收录
          <strong>{{ USER_GUIDE_CHAPTERS.length }}</strong>
          大模块 · 随时翻阅，支持从任意章节起播引导动画
        </span>
      </div>

      <div class="grid grid-cols-1 gap-14px md:grid-cols-12">
        <!-- 左侧分组目录（严格对齐台历事项卡片的内缩圆头竖条样式） -->
        <div class="max-h-540px flex flex-col gap-10px overflow-y-auto pr-4px md:col-span-4">
          <div v-if="!groupedChapters.length" class="py-24px text-center text-12.5px text-[var(--sct-muted)]">
            未找到匹配的功能说明，请换个关键词试试
          </div>
          <div v-for="grp in groupedChapters" :key="grp.group" class="flex flex-col gap-5px">
            <div class="px-4px text-11px font-bold tracking-wider text-[var(--sct-muted)]">
              {{ grp.group }}
            </div>
            <button
              v-for="item in grp.items"
              :key="item.id"
              type="button"
              class="sct-inset-card items-center gap-7px px-10px py-7px text-left"
              :class="{ 'is-active': currentChapter.id === item.id }"
              :style="{ '--bar-color': item.color, '--bar-soft': item.soft }"
              @click="activeChapterId = item.id"
            >
              <span class="sct-inset-card__bar" />
              <span class="font-mono text-11px opacity-60">{{ item.no }}</span>
              <span class="min-w-0 flex-1 truncate text-12.5px font-semibold">{{ item.title }}</span>
            </button>
          </div>
        </div>

        <!-- 右侧详尽手册正文区 -->
        <div class="max-h-540px flex flex-col gap-12px overflow-y-auto pr-4px md:col-span-8">
          <!-- 本章概览卡 -->
          <div
            class="sct-inset-card is-active flex-col gap-8px p-14px"
            :style="{ '--bar-color': currentChapter.color, '--bar-soft': currentChapter.soft }"
          >
            <span class="sct-inset-card__bar" />
            <div class="flex flex-wrap items-start justify-between gap-10px">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-6px">
                  <SvgIcon :icon="currentChapter.icon" class="text-16px" :style="{ color: currentChapter.color }" />
                  <span class="font-mono text-11.5px font-bold" :style="{ color: currentChapter.color }">
                    {{ currentChapter.no }} · {{ currentChapter.group }}
                  </span>
                  <NTag size="tiny" :bordered="false">{{ currentChapter.badge }}</NTag>
                </div>
                <h3 class="mt-4px text-16px font-bold text-[var(--sct-ink)]">{{ currentChapter.title }}</h3>
                <p class="mt-4px mb-0 text-12.5px leading-relaxed text-[var(--sct-muted)]">
                  {{ currentChapter.summary }}
                </p>
              </div>
              <div class="flex shrink-0 flex-wrap items-center gap-6px">
                <NButton size="tiny" secondary @click="handlePlayAnimation(currentChapter.tourStepId)">
                  <template #icon><SvgIcon icon="lucide:play" /></template>
                  本章引导动画
                </NButton>
                <NButton size="tiny" type="primary" @click="jumpToRoute(currentChapter.route)">
                  {{ currentChapter.routeLabel }} →
                </NButton>
              </div>
            </div>
          </div>

          <!-- 逐项功能与操作说明 -->
          <div class="flex flex-col gap-8px">
            <div class="flex items-center gap-6px text-12.5px font-bold text-[var(--sct-ink)]">
              <SvgIcon icon="lucide:list-checks" class="text-15px" :style="{ color: currentChapter.color }" />
              <span>逐项功能与操作说明（共 {{ currentChapter.features.length }} 项）</span>
            </div>

            <div
              v-for="(fp, fIdx) in currentChapter.features"
              :key="fIdx"
              class="sct-inset-card is-active flex-col gap-5px p-12px"
              style="cursor: default"
              :style="{ '--bar-color': currentChapter.color, '--bar-soft': 'var(--sct-container)' }"
            >
              <span class="sct-inset-card__bar" />
              <div class="flex items-center gap-6px text-13px font-bold text-[var(--sct-ink)]">
                <span class="font-mono text-11px" :style="{ color: currentChapter.color }">
                  {{ String(fIdx + 1).padStart(2, '0') }}
                </span>
                <span>{{ fp.name }}</span>
              </div>
              <div class="text-12px leading-relaxed text-[var(--sct-ink)]">{{ fp.desc }}</div>
              <div
                class="rounded-5px bg-[var(--sct-soft)] px-9px py-6px text-11.5px leading-relaxed text-[var(--sct-muted)]"
              >
                <strong class="text-[var(--sct-ink)]">怎么操作：</strong>
                {{ fp.howTo }}
              </div>
            </div>
          </div>

          <!-- 实用技巧 -->
          <div
            v-if="currentChapter.tips.length"
            class="rounded-7px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-11px"
          >
            <div class="mb-6px flex items-center gap-5px text-12px font-bold text-[var(--sct-ink)]">
              <SvgIcon icon="lucide:lightbulb" class="text-14px text-[#d97706]" />
              <span>实用技巧与隐藏联动</span>
            </div>
            <ul class="m-0 flex flex-col gap-5px pl-16px text-12px leading-relaxed text-[var(--sct-muted)]">
              <li v-for="(tip, tIdx) in currentChapter.tips" :key="tIdx">{{ tip }}</li>
            </ul>
          </div>

          <!-- 常见问题 -->
          <div
            v-if="currentChapter.faq.length"
            class="rounded-7px border border-[var(--sct-border)] bg-[var(--sct-container)] p-11px"
          >
            <div class="mb-6px flex items-center gap-5px text-12px font-bold text-[var(--sct-ink)]">
              <SvgIcon icon="lucide:help-circle" class="text-14px text-[#2563eb]" />
              <span>常见问题解答</span>
            </div>
            <div v-for="(qa, qIdx) in currentChapter.faq" :key="qIdx" class="flex flex-col gap-3px text-12px">
              <div class="font-semibold text-[var(--sct-ink)]">问：{{ qa.q }}</div>
              <div class="leading-relaxed text-[var(--sct-muted)]">答：{{ qa.a }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部翻章栏 -->
      <div
        class="flex items-center justify-between border-t border-[var(--sct-border)] pt-10px text-12px text-[var(--sct-muted)]"
      >
        <span>提示：随时可从侧边栏左下角「使用指南」再次翻阅本手册或重放新手引导动画</span>
        <div class="flex items-center gap-6px">
          <NButton size="tiny" secondary :disabled="currentChapterIdx <= 0" @click="goPrevChapter">← 上一章</NButton>
          <NButton
            size="tiny"
            secondary
            :disabled="currentChapterIdx < 0 || currentChapterIdx >= filteredChapters.length - 1"
            @click="goNextChapter"
          >
            下一章 →
          </NButton>
        </div>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
/* 台历事项卡片同源风格：1px 细框 + 浅色底 + 独立内缩圆头竖条（无圆角贴边红弧） */
.sct-inset-card {
  position: relative;
  display: flex;
  padding-left: 16px;
  border-radius: var(--sct-radius, 7px);
  border: 1px solid var(--sct-border);
  background: var(--sct-container);
  color: var(--sct-ink);
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease;
}

.sct-inset-card:hover {
  border-color: color-mix(in srgb, var(--bar-color, #a81c24) 45%, var(--sct-border));
}

.sct-inset-card__bar {
  position: absolute;
  left: 6px;
  top: 6px;
  bottom: 6px;
  width: 3.5px;
  border-radius: 999px;
  background: transparent;
  transition: background-color 0.14s ease;
}

.sct-inset-card.is-active,
.sct-inset-card.is-done {
  border-color: color-mix(in srgb, var(--bar-color, #a81c24) 42%, transparent);
  background: var(--bar-soft, rgba(168, 28, 36, 0.08));
}

.sct-inset-card.is-active .sct-inset-card__bar,
.sct-inset-card.is-done .sct-inset-card__bar {
  background: var(--bar-color, #a81c24);
}
</style>
