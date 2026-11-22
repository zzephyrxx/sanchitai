<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { DEV_STAGE_ORDER, nextStage } from '@/constants/dev-nodes';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import DevDetail from './modules/dev-detail.vue';

defineOptions({ name: 'DevelopmentPage' });

const workStore = useWorkDataStore();
const { bi, tMemberType } = useSctI18n();

const STAGE_META: Record<string, { color: string; soft: string }> = {
  申请人: { color: '#8a8f99', soft: '#F1F2F4' },
  入党积极分子: { color: '#2080f0', soft: 'var(--sct-info-soft)' },
  发展对象: { color: '#d97706', soft: 'var(--sct-warn-soft)' },
  预备党员: { color: '#b98486', soft: '#F7F1F1' },
  正式党员: { color: '#2B2926', soft: '#EFEEEC' }
};

// ---------------- 搜索框与泳道纵向折叠（持久化） ----------------
const COLLAPSE_STORAGE_KEY = 'sct:dev:collapsed-lanes:v1';
const searchKeyword = ref('');

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

/** 泳道数据（支持搜索过滤，保留总人数与命中人数） */
const lanes = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  return DEV_STAGE_ORDER.map(stage => {
    const allInStage = workStore.devStages
      .filter(d => d.stage === stage)
      .map(d => ({ stage: d, member: workStore.memberOf(d.member_id) }))
      .filter((x): x is { stage: Sct.DevStage; member: Sct.Member } => Boolean(x.member))
      .sort((a, b) => (a.stage.stage_date ?? '').localeCompare(b.stage.stage_date ?? ''));

    const filtered = kw
      ? allInStage.filter(({ stage: st, member: m }) =>
          [m.name, m.code, m.student_id, m.group, m.grade, m.major, m.advisor, st.next_node]
            .filter(Boolean)
            .some(v => String(v).toLowerCase().includes(kw))
        )
      : allInStage;

    // 搜索命中时自动临时展开对应泳道，清空搜索后自动恢复原折叠态
    const collapsed = kw
      ? filtered.length === 0 && Boolean(collapsedLanes.value[stage])
      : Boolean(collapsedLanes.value[stage]);

    return {
      stage,
      meta: STAGE_META[stage],
      totalCount: allInStage.length,
      members: filtered,
      collapsed
    };
  });
});

function stageDays(stageDate?: string) {
  if (!stageDate) return null;
  const days = dayjs().diff(dayjs(stageDate), 'day');
  return days >= 0 ? `${days} ${bi('天', 'd')}` : null;
}

/** 时间窗临近（±7 天）高亮 */
function dueSoon(due?: string) {
  if (!due) return false;
  const diff = dayjs(due).diff(dayjs(), 'day');
  return diff <= 7;
}

function overdue(due?: string) {
  if (!due) return false;
  return dayjs(due).isBefore(dayjs(), 'day');
}

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

// ---------------- 拖拽流转（HTML5 原生 DnD + 弹窗确认，支持落入折叠泳道头） ----------------
const dragOverStage = ref<string | null>(null);
const draggingId = ref<string | null>(null);

function onDragStart(memberId: string, e: DragEvent) {
  draggingId.value = memberId;
  e.dataTransfer?.setData('text/plain', memberId);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}

function onLaneDragLeave(stage: string, e: DragEvent) {
  const current = e.currentTarget as HTMLElement | null;
  const related = e.relatedTarget as Node | null;
  if (current && related && current.contains(related)) return;
  if (dragOverStage.value === stage) {
    dragOverStage.value = null;
  }
}

function onDrop(stage: string, e: DragEvent) {
  dragOverStage.value = null;
  const memberId = e.dataTransfer?.getData('text/plain') || draggingId.value;
  draggingId.value = null;
  if (memberId) {
    requestStageTransition(memberId, stage, 'drag');
  }
}

// ---------------- 详情 ----------------
const detailMemberId = ref<string | null>(null);
const detailShow = ref(false);
function openDetail(memberId: string) {
  detailMemberId.value = memberId;
  detailShow.value = true;
}

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
                '五阶段泳道 · 支持折叠与泳道内独立滚动 · 拖拽或点击流转均受二次确认保护',
                '5-stage kanban · Collapsible scrollable lanes · Confirmation required on transition'
              )
            }}
          </span>
        </div>
      </template>
      <template #header-extra>
        <div class="flex flex-nowrap items-center gap-8px">
          <div class="w-220px shrink-0">
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

      <div class="dev-lanes">
        <div
          v-for="lane in lanes"
          :key="lane.stage"
          class="dev-lane"
          :class="{ 'dev-lane--over': dragOverStage === lane.stage }"
          @dragover.prevent="dragOverStage = lane.stage"
          @dragleave="onLaneDragLeave(lane.stage, $event)"
          @drop.prevent="onDrop(lane.stage, $event)"
        >
          <div
            class="dev-lane__head"
            :class="{ 'dev-lane__head--collapsed': lane.collapsed }"
            :style="{ background: lane.meta.soft, color: lane.meta.color }"
            @click="toggleLaneCollapse(lane.stage)"
          >
            <span class="inline-flex items-center gap-6px truncate">
              <span>{{ tMemberType(lane.stage) }}</span>
              <span class="dev-lane__count">
                {{ hasActiveSearch ? `${lane.members.length}/${lane.totalCount}` : lane.totalCount }}
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
              v-for="{ stage: st, member: m } in lane.members"
              :key="m.id"
              class="dev-card"
              :class="{ 'dev-card--dragging': draggingId === m.id }"
              draggable="true"
              @dragstart="onDragStart(m.id, $event)"
              @dragend="
                dragOverStage = null;
                draggingId = null;
              "
              @click="openDetail(m.id)"
            >
              <div class="dev-card__head">
                <span class="dev-card__name">{{ m.name }}</span>
                <span class="dev-card__days">{{ stageDays(st.stage_date) ?? '—' }}</span>
              </div>
              <div
                class="dev-card__next"
                :class="{ 'dev-card__next--soon': dueSoon(st.next_due), 'dev-card__next--over': overdue(st.next_due) }"
              >
                {{ st.next_node || bi('无待办节点', 'No pending milestone') }}
              </div>
              <div
                class="dev-card__due"
                :class="{ 'dev-card__due--soon': dueSoon(st.next_due), 'dev-card__due--over': overdue(st.next_due) }"
              >
                {{ st.next_due ? `${bi('预计', 'Due')} ${st.next_due}` : '' }}
              </div>
              <div class="dev-card__ops" @click.stop>
                <NButton v-if="nextStage(m.type)" size="tiny" secondary type="primary" @click="requestAdvance(m)">
                  <template #icon><SvgIcon icon="lucide:arrow-right-circle" /></template>
                  {{ bi(`流转到${nextStage(m.type)}`, `Advance to ${tMemberType(nextStage(m.type)!)}`) }}
                </NButton>
              </div>
            </div>
            <div v-if="!lane.members.length" class="dev-lane__empty">
              {{ hasActiveSearch ? bi('无匹配成员', 'No matches') : bi('暂无人员', 'No members') }}
            </div>
          </div>
        </div>
      </div>
    </NCard>

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

    <DevDetail v-model:show="detailShow" :member-id="detailMemberId" />
  </div>
</template>

<style scoped>
.dev-page {
  min-height: 480px;
}
.dev-lanes {
  display: grid;
  grid-template-columns: repeat(5, minmax(190px, 1fr));
  gap: 10px;
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
  padding: 6px 10px;
  border-radius: 8px 8px 0 0;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
}
.dev-lane__head--collapsed {
  border-radius: 8px;
}
.dev-lane__count {
  font-size: 12px;
  opacity: 0.8;
}
.dev-lane__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 110px;
  max-height: max(240px, calc(100vh - 235px));
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  padding: 8px;
  background: var(--sct-soft);
  border-radius: 0 0 8px 8px;
}
.dev-lane__body--over {
  background: var(--sct-soft);
}
.dev-card--dragging {
  opacity: 0.45;
}
.dev-lane__empty {
  font-size: 12px;
  color: #c4c1ba;
  text-align: center;
  padding: 16px 0;
}
.dev-card {
  flex-shrink: 0;
  padding: 8px 10px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 8px;
  cursor: pointer;
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
}
.dev-card__name {
  font-size: 13px;
  font-weight: 700;
  color: var(--sct-ink);
}
.dev-card__days {
  font-size: 11px;
  color: var(--sct-muted);
}
.dev-card__next {
  margin-top: 4px;
  font-size: 12px;
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
  font-size: 11px;
  color: var(--sct-muted);
}
.dev-card__due--soon {
  color: #d97706;
}
.dev-card__due--over {
  color: #d43030;
}
.dev-card__ops {
  margin-top: 4px;
  display: flex;
  justify-content: flex-end;
}
</style>
