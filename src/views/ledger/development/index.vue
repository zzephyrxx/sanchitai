<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import { DEV_STAGE_ORDER, nextStage } from '@/constants/dev-nodes';
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

/** 泳道数据 */
const lanes = computed(() =>
  DEV_STAGE_ORDER.map(stage => ({
    stage,
    meta: STAGE_META[stage],
    members: workStore.devStages
      .filter(d => d.stage === stage)
      .map(d => ({ stage: d, member: workStore.memberOf(d.member_id) }))
      .filter(x => x.member)
      .sort((a, b) => (a.stage.stage_date ?? '').localeCompare(b.stage.stage_date ?? ''))
  }))
);

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
  await workStore.moveStageTo(pendingMove.memberId, pendingMove.toStage);
  confirmModalShow.value = false;
}

// ---------------- 拖拽流转（HTML5 原生 DnD + 弹窗确认） ----------------
const dragOverStage = ref<string | null>(null);
const draggingId = ref<string | null>(null);

function onDragStart(memberId: string, e: DragEvent) {
  draggingId.value = memberId;
  e.dataTransfer?.setData('text/plain', memberId);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
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
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">{{ bi('党员发展', 'Member Development') }}</span>
          <span class="text-12px text-gray-400">
            {{
              bi(
                '五阶段泳道 · 点击人员查看节点时间线与材料状态 · 拖拽或点击流转均受二次确认保护',
                '5-stage kanban · Click member to inspect timeline & materials · Drag or click transitions require confirmation'
              )
            }}
          </span>
        </div>
      </template>

      <div class="dev-lanes">
        <div v-for="lane in lanes" :key="lane.stage" class="dev-lane">
          <div class="dev-lane__head" :style="{ background: lane.meta.soft, color: lane.meta.color }">
            {{ tMemberType(lane.stage) }}
            <span class="dev-lane__count">{{ lane.members.length }}</span>
          </div>
          <div
            class="dev-lane__body"
            :class="{ 'dev-lane__body--over': dragOverStage === lane.stage }"
            @dragover.prevent="dragOverStage = lane.stage"
            @dragleave="dragOverStage === lane.stage && (dragOverStage = null)"
            @drop.prevent="onDrop(lane.stage, $event)"
          >
            <div
              v-for="{ stage: st, member: m } in lane.members"
              :key="m!.id"
              class="dev-card"
              :class="{ 'dev-card--dragging': draggingId === m!.id }"
              draggable="true"
              @dragstart="onDragStart(m!.id, $event)"
              @dragend="
                dragOverStage = null;
                draggingId = null;
              "
              @click="openDetail(m!.id)"
            >
              <div class="dev-card__head">
                <span class="dev-card__name">{{ m!.name }}</span>
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
                <NButton
                  v-if="nextStage(m!.type)"
                  size="tiny"
                  secondary
                  type="primary"
                  @click="requestAdvance(m!)"
                >
                  <template #icon><SvgIcon icon="lucide:arrow-right-circle" /></template>
                  {{ bi(`流转到${nextStage(m!.type)}`, `Advance to ${tMemberType(nextStage(m!.type)!)}`) }}
                </NButton>
              </div>
            </div>
            <div v-if="!lane.members.length" class="dev-lane__empty">{{ bi('暂无人员', 'No members') }}</div>
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
.dev-lanes {
  display: grid;
  grid-template-columns: repeat(5, minmax(190px, 1fr));
  gap: 10px;
  overflow-x: auto;
}
.dev-lane__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 8px 8px 0 0;
  font-size: 13px;
  font-weight: 700;
}
.dev-lane__count {
  font-size: 12px;
  opacity: 0.8;
}
.dev-lane__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
  padding: 8px;
  background: var(--sct-soft);
  border-radius: 0 0 8px 8px;
}
.dev-lane__body--over {
  outline: 2px dashed #2b2926;
  outline-offset: -4px;
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
  padding: 8px 10px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
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
