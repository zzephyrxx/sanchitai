<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import {
  DEV_STAGE_ORDER,
  areStagesUpToFullyArchived,
  computeNextDevNode,
  findFirstMissingPriorNode,
  nextStage
} from '@/constants/dev-nodes';
import { onTourCommand } from '@/utils/onboarding-bus';
import { useThemeStore } from '@/store/modules/theme';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import DevDetail from './modules/dev-detail.vue';
import DevTimelineModal from './modules/dev-timeline-modal.vue';

defineOptions({ name: 'DevelopmentPage' });

const workStore = useWorkDataStore();
const themeStore = useThemeStore();
const { bi, tMemberType } = useSctI18n();

interface StageThemeMeta {
  color: string;
  soft: string;
}

/** 五阶段顶部标题栏配色：深浅模式统一使用同质感半透明柔光底 + 同色系文字，消除深色模式不透明灰白块 */
const stageMetaMap = computed<Record<string, StageThemeMeta>>(() => {
  const dark = themeStore.darkMode;
  return {
    申请人: {
      color: dark ? '#cbd5e1' : '#475569',
      soft: dark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(100, 116, 139, 0.13)'
    },
    入党积极分子: {
      color: dark ? '#93c5fd' : '#1d4ed8',
      soft: dark ? 'rgba(59, 130, 246, 0.18)' : 'rgba(37, 99, 235, 0.12)'
    },
    发展对象: {
      color: dark ? '#fcd34d' : '#b45309',
      soft: dark ? 'rgba(245, 158, 11, 0.18)' : 'rgba(217, 119, 6, 0.13)'
    },
    预备党员: {
      color: dark ? '#fda4af' : '#be123c',
      soft: dark ? 'rgba(244, 63, 94, 0.18)' : 'rgba(225, 29, 72, 0.12)'
    },
    正式党员: {
      color: dark ? '#fca5a5' : '#991b1b',
      soft: dark ? 'rgba(220, 38, 38, 0.22)' : 'rgba(168, 28, 36, 0.14)'
    }
  };
});

// ---------------- 搜索框与泳道纵向折叠（持久化） ----------------
const COLLAPSE_STORAGE_KEY = 'sct:dev:collapsed-lanes:v1';
const searchKeyword = ref('');
const expandedLanes = ref<Record<string, boolean>>({});
const LANE_INITIAL_LIMIT = 40;

function loadCollapsedLanes(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

const collapsedLanes = ref<Record<string, boolean>>(loadCollapsedLanes());

watch(
  collapsedLanes,
  val => {
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(val));
    } catch {
      /* ignore */
    }
  },
  { deep: true }
);

function toggleLaneCollapse(stage: string) {
  collapsedLanes.value = {
    ...collapsedLanes.value,
    [stage]: !collapsedLanes.value[stage]
  };
}

const allCollapsed = computed(() => DEV_STAGE_ORDER.every(stage => Boolean(collapsedLanes.value[stage])));

function toggleAllLanes() {
  const nextVal = !allCollapsed.value;
  const nextMap: Record<string, boolean> = {};
  DEV_STAGE_ORDER.forEach(stage => {
    nextMap[stage] = nextVal;
  });
  collapsedLanes.value = nextMap;
}

const hasActiveSearch = computed(() => Boolean(searchKeyword.value.trim()));

interface DevCardVM {
  stage: Sct.DevStage;
  member: Sct.Member;
  daysLabel: string;
  displayNextNode: string;
  allArchivedDone: boolean;
  stageReadyDone: boolean;
  isDueSoon: boolean;
  isOverdue: boolean;
  nextStageName: string | null;
}

/** 泳道数据（预计算日期与状态，避免模板中每卡重复 new dayjs()；单次扫描按阶段分组） */
const lanes = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  const today = dayjs().startOf('day');
  const grouped = new Map<string, DevCardVM[]>();
  for (const s of DEV_STAGE_ORDER) {
    grouped.set(s, []);
  }

  for (const d of workStore.devStages) {
    const m = workStore.memberOf(d.member_id);
    if (!m) continue;
    const bucket = grouped.get(d.stage);
    if (!bucket) continue;

    const days = d.stage_date ? today.diff(dayjs(d.stage_date), 'day') : -1;
    const daysLabel = days >= 0 ? `${days} ${bi('天', 'd')}` : '—';
    const computedNext = computeNextDevNode(d.stage, d.materials);
    const allArchivedDone = d.stage === '正式党员' && areStagesUpToFullyArchived('正式党员', d.materials);
    const stageReadyDone = d.stage !== '正式党员' && areStagesUpToFullyArchived(d.stage, d.materials);
    const missingPrior =
      !computedNext && !allArchivedDone && !stageReadyDone ? findFirstMissingPriorNode(d.stage, d.materials) : null;
    const displayNextNode =
      allArchivedDone || stageReadyDone
        ? ''
        : computedNext ||
          (missingPrior ? `${bi('待补录前序', 'Prior missing')}：${missingPrior.node}` : d.next_node || '');

    let isDueSoon = false;
    let isOverdue = false;
    if (d.next_due && displayNextNode) {
      const dueDate = dayjs(d.next_due);
      isOverdue = dueDate.isBefore(today, 'day');
      isDueSoon = !isOverdue && dueDate.diff(today, 'day') <= 7;
    }

    bucket.push({
      stage: d,
      member: m,
      daysLabel,
      displayNextNode,
      allArchivedDone,
      stageReadyDone,
      isDueSoon,
      isOverdue,
      nextStageName: nextStage(m.type)
    });
  }

  return DEV_STAGE_ORDER.map(stage => {
    const allInStage = (grouped.get(stage) ?? []).sort((a, b) =>
      (a.stage.stage_date ?? '').localeCompare(b.stage.stage_date ?? '')
    );

    const filtered = kw
      ? allInStage.filter(({ stage: st, member: m, displayNextNode }) =>
          [m.name, m.code, m.student_id, m.group, m.grade, m.major, m.advisor, displayNextNode, st.next_node]
            .filter(Boolean)
            .some(v => String(v).toLowerCase().includes(kw))
        )
      : allInStage;

    const collapsed = kw
      ? filtered.length === 0 && Boolean(collapsedLanes.value[stage])
      : Boolean(collapsedLanes.value[stage]);

    const showAll = Boolean(expandedLanes.value[stage]) || Boolean(kw);
    const visibleMembers = showAll ? filtered : filtered.slice(0, LANE_INITIAL_LIMIT);
    const hiddenCount = Math.max(0, filtered.length - visibleMembers.length);

    return {
      stage,
      meta: stageMetaMap.value[stage],
      totalCount: allInStage.length,
      matchedCount: filtered.length,
      members: visibleMembers,
      hiddenCount,
      collapsed
    };
  });
});

// ---------------- 阶段流转二次确认（防拖拽/点击误操作） ----------------
const confirmModalShow = ref(false);
const pendingMove = reactive<{
  memberId: string;
  memberName: string;
  fromStage: string;
  toStage: string;
  source: 'drag' | 'button';
}>({
  memberId: '',
  memberName: '',
  fromStage: '',
  toStage: '',
  source: 'button'
});

function requestStageTransition(memberId: string, targetStage: string, source: 'drag' | 'button') {
  const member = workStore.memberOf(memberId);
  if (!member) return;
  const st = workStore.devStages.find(d => d.member_id === memberId);
  const currentStage = st?.stage ?? member.type;
  if (currentStage === targetStage) return;

  pendingMove.memberId = memberId;
  pendingMove.memberName = member.name;
  pendingMove.fromStage = currentStage;
  pendingMove.toStage = targetStage;
  pendingMove.source = source;
  confirmModalShow.value = true;
}

async function confirmStageTransition() {
  if (!pendingMove.memberId || !pendingMove.toStage) return;
  try {
    await workStore.moveStageTo(pendingMove.memberId, pendingMove.toStage);
    confirmModalShow.value = false;
  } catch {
    // guardWrite 已提示错误
  }
}

// ---------------- Pointer Events 跨平台拖拽流转（彻底兼容 Tauri 桌面端 WKWebView/WebView2） ----------------
const dragOverStage = ref<string | null>(null);
const draggingMember = ref<{ id: string; name: string; stage: string } | null>(null);
const dragPos = reactive({ x: 0, y: 0 });
let pointerOrigin: { x: number; y: number; member: { id: string; name: string; stage: string } } | null = null;
let suppressNextClick = false;

function hitTestLaneStage(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  const laneEl = el?.closest?.('[data-dev-lane]') as HTMLElement | null;
  return laneEl?.dataset?.devLane ?? null;
}

function onPointerMove(e: PointerEvent) {
  if (!pointerOrigin) return;
  const dx = e.clientX - pointerOrigin.x;
  const dy = e.clientY - pointerOrigin.y;
  if (!draggingMember.value && Math.hypot(dx, dy) < 6) return;

  if (!draggingMember.value) {
    draggingMember.value = pointerOrigin.member;
    suppressNextClick = true;
  }
  dragPos.x = e.clientX;
  dragPos.y = e.clientY;
  dragOverStage.value = hitTestLaneStage(e.clientX, e.clientY);
}

function cleanupPointerDrag() {
  pointerOrigin = null;
  draggingMember.value = null;
  dragOverStage.value = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', cleanupPointerDrag);
  window.removeEventListener('keydown', onDragKeydown);
}

function onPointerUp(e: PointerEvent) {
  const dragged = draggingMember.value;
  const targetStage = dragged ? hitTestLaneStage(e.clientX, e.clientY) : null;
  cleanupPointerDrag();
  if (dragged && targetStage && targetStage !== dragged.stage) {
    requestStageTransition(dragged.id, targetStage, 'drag');
  }
  if (suppressNextClick) {
    setTimeout(() => {
      suppressNextClick = false;
    }, 60);
  }
}

function onDragKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    cleanupPointerDrag();
  }
}

function onCardPointerDown(member: Sct.Member, stageName: string, e: PointerEvent) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('button, a, input, [data-no-drag]')) return;
  pointerOrigin = {
    x: e.clientX,
    y: e.clientY,
    member: { id: member.id, name: member.name, stage: stageName }
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', cleanupPointerDrag);
  window.addEventListener('keydown', onDragKeydown);
}

onBeforeUnmount(cleanupPointerDrag);

// ---------------- 详情抽屉 & S 型时间线弹窗 ----------------
const detailMemberId = ref<string | null>(null);
const detailShow = ref(false);
const timelineMemberId = ref<string | null>(null);
const timelineShow = ref(false);

function openDetail(memberId: string) {
  if (suppressNextClick) return;
  detailMemberId.value = memberId;
  detailShow.value = true;
}

function openTimeline(memberId: string) {
  timelineMemberId.value = memberId;
  timelineShow.value = true;
}

function pickBestDemoDevMemberId(): string | null {
  const preferOrder: string[] = ['发展对象', '预备党员', '入党积极分子', '申请人', '正式党员'];
  for (const st of preferOrder) {
    const lane = lanes.value.find(l => l.stage === st);
    if (lane?.members.length) return lane.members[0].member.id;
  }
  return workStore.devStages[0]?.member_id ?? null;
}

const offDevTour = onTourCommand(cmd => {
  if (cmd === 'dev:open-first-drawer') {
    const id = detailMemberId.value || pickBestDemoDevMemberId();
    if (!id) return;
    timelineShow.value = false;
    detailMemberId.value = id;
    detailShow.value = true;
  } else if (cmd === 'dev:open-timeline') {
    const id = detailMemberId.value || pickBestDemoDevMemberId();
    if (!id) return;
    detailMemberId.value = id;
    detailShow.value = true;
    timelineMemberId.value = id;
    timelineShow.value = true;
  } else if (cmd === 'dev:close-timeline') {
    timelineShow.value = false;
  } else if (cmd === 'dev:reset' || cmd === 'tour:cleanup') {
    timelineShow.value = false;
    detailShow.value = false;
  }
});
onBeforeUnmount(offDevTour);

// ---------------- 按钮触发流转（同样走确认弹窗） ----------------
function requestAdvance(member: Sct.Member) {
  const target = nextStage(member.type);
  if (!target) return;
  requestStageTransition(member.id, target, 'button');
}
</script>

<template>
  <div class="dev-page">
    <NCard :bordered="false">
      <template #header>
        <div class="flex flex-wrap items-center gap-10px">
          <span class="text-16px font-bold">{{ bi('党员发展', 'Member Development') }}</span>
          <span class="text-12px text-gray-400">
            {{
              bi(
                '五阶段泳道 · 支持跨阶段材料查看、S型发展时间线 · 拖拽与流转均受二次确认保护',
                '5-stage kanban · Cross-stage checklist & S-curve timeline · Confirmation protected'
              )
            }}
          </span>
        </div>
      </template>
      <template #header-extra>
        <div data-tour="development-toolbar" class="flex flex-nowrap items-center gap-8px">
          <div class="w-240px shrink-0">
            <NInput
              v-model:value="searchKeyword"
              size="small"
              clearable
              :placeholder="bi('搜索姓名、编号、待办节点…', 'Search name, code, milestone…')"
            >
              <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
            </NInput>
          </div>
          <NButton size="small" secondary class="shrink-0" @click="toggleAllLanes">
            <template #icon>
              <SvgIcon :icon="allCollapsed ? 'lucide:chevrons-down' : 'lucide:chevrons-up'" />
            </template>
            {{ allCollapsed ? bi('全部展开', 'Expand All') : bi('全部折叠', 'Collapse All') }}
          </NButton>
        </div>
      </template>

      <div data-tour="development-lanes" class="dev-lanes">
        <div
          v-for="lane in lanes"
          :key="lane.stage"
          :data-dev-lane="lane.stage"
          class="dev-lane"
          :class="{ 'dev-lane--over': dragOverStage === lane.stage }"
        >
          <div
            class="dev-lane__head"
            :class="{ 'dev-lane__head--collapsed': lane.collapsed }"
            :style="{
              background: lane.meta.soft,
              color: lane.meta.color
            }"
            @click="toggleLaneCollapse(lane.stage)"
          >
            <span class="inline-flex items-center gap-6px truncate">
              <span>{{ tMemberType(lane.stage) }}</span>
              <span class="dev-lane__count">
                {{ hasActiveSearch ? `${lane.matchedCount}/${lane.totalCount}` : lane.totalCount }}
              </span>
            </span>
            <NButton
              size="tiny"
              quaternary
              circle
              :title="lane.collapsed ? bi('展开此泳道', 'Expand lane') : bi('折叠此泳道', 'Collapse lane')"
              @click.stop="toggleLaneCollapse(lane.stage)"
            >
              <template #icon>
                <SvgIcon :icon="lane.collapsed ? 'lucide:chevron-down' : 'lucide:chevron-up'" class="text-14px" />
              </template>
            </NButton>
          </div>

          <div
            v-if="!lane.collapsed"
            class="dev-lane__body"
            :class="{ 'dev-lane__body--over': dragOverStage === lane.stage }"
          >
            <div
              v-for="item in lane.members"
              :key="item.member.id"
              class="dev-card"
              :class="{ 'dev-card--dragging': draggingMember?.id === item.member.id }"
              @pointerdown="onCardPointerDown(item.member, lane.stage, $event)"
              @click="openDetail(item.member.id)"
            >
              <div class="dev-card__head">
                <span class="dev-card__name">{{ item.member.name }}</span>
                <span class="dev-card__days">{{ item.daysLabel }}</span>
              </div>
              <div v-if="item.allArchivedDone" class="dev-card__done">
                <SvgIcon icon="lucide:check-circle-2" class="text-12px shrink-0" />
                <span>{{ bi('全部材料已归档', 'All archived') }}</span>
              </div>
              <div
                v-else-if="item.stageReadyDone"
                class="dev-card__stage-ready"
                :style="{ background: lane.meta.soft, color: lane.meta.color }"
              >
                <SvgIcon icon="lucide:check-circle-2" class="text-12px shrink-0" />
                <span>{{ bi('本阶段材料已备齐', 'Stage ready') }}</span>
              </div>
              <div
                v-else
                class="dev-card__next"
                :class="{ 'dev-card__next--soon': item.isDueSoon, 'dev-card__next--over': item.isOverdue }"
              >
                {{ item.displayNextNode }}
              </div>
              <div
                v-if="item.stage.next_due && item.displayNextNode"
                class="dev-card__due"
                :class="{ 'dev-card__due--soon': item.isDueSoon, 'dev-card__due--over': item.isOverdue }"
              >
                {{ `${bi('预计', 'Due')} ${item.stage.next_due}` }}
              </div>
              <div class="dev-card__ops" data-no-drag @click.stop>
                <NButton
                  size="tiny"
                  quaternary
                  type="default"
                  :title="bi('查看 S 型发展时间线', 'View Development Timeline')"
                  @click="openTimeline(item.member.id)"
                >
                  <template #icon><SvgIcon icon="lucide:git-branch" /></template>
                  {{ bi('时间线', 'Timeline') }}
                </NButton>
                <NButton
                  v-if="item.nextStageName"
                  size="tiny"
                  secondary
                  type="primary"
                  @click="requestAdvance(item.member)"
                >
                  <template #icon><SvgIcon icon="lucide:arrow-right-circle" /></template>
                  {{ bi(`流转到${item.nextStageName}`, `Advance`) }}
                </NButton>
              </div>
            </div>

            <NButton
              v-if="lane.hiddenCount > 0"
              size="tiny"
              dashed
              block
              @click="expandedLanes = { ...expandedLanes, [lane.stage]: true }"
            >
              展开其余 {{ lane.hiddenCount }} 人
            </NButton>

            <div v-if="!lane.members.length" class="dev-lane__empty">
              {{ hasActiveSearch ? bi('无匹配成员', 'No matches') : bi('暂无人员', 'No members') }}
            </div>
          </div>
        </div>
      </div>
    </NCard>

    <!-- Pointer 拖拽悬浮预览幽灵卡片 -->
    <Teleport to="body">
      <div
        v-if="draggingMember"
        class="dev-drag-ghost"
        :style="{ left: `${dragPos.x + 12}px`, top: `${dragPos.y + 12}px` }"
      >
        <SvgIcon icon="lucide:grip-vertical" class="text-13px text-[#A81C24]" />
        <span class="font-bold">{{ draggingMember.name }}</span>
        <span class="text-11px opacity-75">
          {{ dragOverStage && dragOverStage !== draggingMember.stage ? `→ ${dragOverStage}` : '拖到目标泳道' }}
        </span>
      </div>
    </Teleport>

    <!-- 阶段流转二次确认弹窗 -->
    <NModal
      v-model:show="confirmModalShow"
      preset="card"
      :title="bi('确认发展阶段流转', 'Confirm Stage Transition')"
      class="w-460px"
      :mask-closable="false"
    >
      <div class="flex flex-col gap-12px">
        <div class="text-13px leading-relaxed text-[var(--sct-ink)]">
          {{
            bi(
              `您正在通过${pendingMove.source === 'drag' ? '拖拽泳道' : '阶段推进按钮'}将成员 `,
              'You are advancing member '
            )
          }}
          <b class="text-[#A81C24]">{{ pendingMove.memberName }}</b>
          {{ bi(' 的发展阶段进行变更：', ' to a new development stage:') }}
        </div>
        <div class="flex items-center justify-center gap-12px rounded-10px bg-[var(--sct-soft)] px-14px py-12px">
          <NTag size="medium" :bordered="false">{{ tMemberType(pendingMove.fromStage) }}</NTag>
          <SvgIcon icon="lucide:arrow-right" class="text-16px text-[#A81C24]" />
          <NTag size="medium" type="error" :bordered="false">{{ tMemberType(pendingMove.toStage) }}</NTag>
        </div>
        <div class="text-12px leading-relaxed text-gray-500">
          {{
            bi(
              `确认流转后，系统将同步更新该同志在人员台账中的政治面貌/类型、写入发展时间线，并自动初始化「${pendingMove.toStage}」阶段的培养考察材料清单。`,
              `Confirming will update this member's type in the roster, append a timeline record, and initialize the material checklist for "${tMemberType(pendingMove.toStage)}".`
            )
          }}
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="confirmModalShow = false">{{ bi('取消', 'Cancel') }}</NButton>
          <NButton size="small" type="primary" @click="confirmStageTransition">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            {{ bi('确认流转', 'Confirm') }}
          </NButton>
        </div>
      </template>
    </NModal>

    <DevDetail v-model:show="detailShow" :member-id="detailMemberId" @open-timeline="openTimeline" />
    <DevTimelineModal v-model:show="timelineShow" :member-id="timelineMemberId" />
  </div>
</template>

<style scoped>
.dev-page {
  min-height: 480px;
}
.dev-lanes {
  display: grid;
  grid-template-columns: repeat(5, minmax(calc(190px * var(--sct-font-scale-boost, 1)), 1fr));
  gap: calc(10px * var(--sct-density-scale, 1));
  align-items: start;
  overflow-x: auto;
}
.dev-lane {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
}
.dev-lane--over {
  outline: 2px dashed var(--sct-accent, #a81c24);
  outline-offset: -2px;
}
.dev-lane__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: calc(6px * var(--sct-density-scale, 1)) calc(10px * var(--sct-density-scale, 1));
  border-radius: 8px 8px 0 0;
  font-size: calc(13px * var(--sct-font-scale-boost, 1));
  font-weight: 700;
  cursor: pointer;
  user-select: none;
}
.dev-lane__head--collapsed {
  border-radius: 8px;
}
.dev-lane__count {
  font-size: calc(12px * var(--sct-font-scale-boost, 1));
  opacity: 0.85;
}
.dev-lane__body {
  display: flex;
  flex-direction: column;
  gap: calc(8px * var(--sct-density-scale, 1));
  min-height: 110px;
  max-height: max(240px, calc(100vh - 235px));
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  padding: calc(8px * var(--sct-density-scale, 1));
  background: var(--sct-soft);
  border-radius: 0 0 8px 8px;
}
.dev-lane__body--over {
  background: var(--sct-soft);
}
.dev-card--dragging {
  opacity: 0.35;
}
.dev-lane__empty {
  font-size: calc(12px * var(--sct-font-scale-boost, 1));
  color: #c4c1ba;
  text-align: center;
  padding: 16px 0;
}
.dev-card {
  flex-shrink: 0;
  padding: calc(8px * var(--sct-density-scale, 1)) calc(10px * var(--sct-density-scale, 1));
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 8px;
  cursor: grab;
  user-select: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.dev-card:hover {
  border-color: #a81c24;
  box-shadow: 0 2px 8px rgba(168, 28, 36, 0.08);
}
.dev-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.dev-card__name {
  font-size: calc(13.5px * var(--sct-font-scale-boost, 1));
  font-weight: 700;
  color: var(--sct-ink);
}
.dev-card__days {
  font-size: calc(11.5px * var(--sct-font-scale-boost, 1));
  color: var(--sct-muted);
  white-space: nowrap;
}
.dev-card__done,
.dev-card__stage-ready {
  margin-top: 5px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 6px;
  font-size: calc(11.5px * var(--sct-font-scale-boost, 1));
  font-weight: 600;
  line-height: 1.45;
  width: fit-content;
}
.dev-card__done {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
}
:global(.dark) .dev-card__done {
  color: #4ade80;
  background: rgba(34, 197, 94, 0.18);
}
.dev-card__next {
  margin-top: 4px;
  font-size: calc(12.5px * var(--sct-font-scale-boost, 1));
  color: var(--sct-muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dev-card__next--soon {
  color: #d97706;
  font-weight: 600;
}
.dev-card__next--over {
  color: #d43030;
  font-weight: 600;
}
.dev-card__due {
  margin-top: 2px;
  font-size: calc(11.5px * var(--sct-font-scale-boost, 1));
  color: var(--sct-muted);
}
.dev-card__due--soon {
  color: #d97706;
}
.dev-card__due--over {
  color: #d43030;
}
.dev-card__ops {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.dev-drag-ghost {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--sct-container, #fff);
  border: 1.5px solid #a81c24;
  color: var(--sct-ink, #1f2937);
  font-size: 12px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
}
</style>
