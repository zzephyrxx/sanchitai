<script setup lang="ts">
import { computed, ref } from 'vue';
import dayjs from 'dayjs';
import { useWorkDataStore } from '@/store/modules/work-data';
import { DEV_STAGE_ORDER, nextStage } from '@/constants/dev-nodes';
import DevDetail from './modules/dev-detail.vue';

defineOptions({ name: 'DevelopmentPage' });

const workStore = useWorkDataStore();

const STAGE_META: Record<string, { color: string; soft: string }> = {
  申请人: { color: '#8a8f99', soft: '#F1F2F4' },
  入党积极分子: { color: '#2080f0', soft: '#E3EEFB' },
  发展对象: { color: '#d97706', soft: '#FCEFDC' },
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
  return days >= 0 ? `${days} 天` : null;
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

// ---------------- 拖拽流转（HTML5 原生 DnD） ----------------
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
  if (memberId) void workStore.moveStageTo(memberId, stage);
}

// ---------------- 详情 ----------------
const detailMemberId = ref<string | null>(null);
const detailShow = ref(false);
function openDetail(memberId: string) {
  detailMemberId.value = memberId;
  detailShow.value = true;
}

// ---------------- 流转 ----------------
async function advance(memberId: string) {
  await workStore.advanceStage(memberId);
}
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">党员发展台账</span>
          <span class="text-12px text-gray-400">五阶段泳道 · 点击人员看节点时间线 · 可流转阶段</span>
        </div>
      </template>

      <div class="dev-lanes">
        <div v-for="lane in lanes" :key="lane.stage" class="dev-lane">
          <div class="dev-lane__head" :style="{ background: lane.meta.soft, color: lane.meta.color }">
            {{ lane.stage }}
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
              @dragend="dragOverStage = null; draggingId = null"
              @click="openDetail(m!.id)"
            >
              <div class="dev-card__head">
                <span class="dev-card__name">{{ m!.name }}</span>
                <span class="dev-card__days">{{ stageDays(st.stage_date) ?? '—' }}</span>
              </div>
              <div class="dev-card__next" :class="{ 'dev-card__next--soon': dueSoon(st.next_due), 'dev-card__next--over': overdue(st.next_due) }">
                {{ st.next_node || '无待办节点' }}
              </div>
              <div class="dev-card__due" :class="{ 'dev-card__due--soon': dueSoon(st.next_due), 'dev-card__due--over': overdue(st.next_due) }">
                {{ st.next_due ? `预计 ${st.next_due}` : '' }}
              </div>
              <div class="dev-card__ops" @click.stop>
                <NButton
                  v-if="nextStage(m!.type)"
                  size="tiny"
                  quaternary
                  type="primary"
                  @click="advance(m!.id)"
                >
                  流转到{{ nextStage(m!.type) }}
                </NButton>
              </div>
            </div>
            <div v-if="!lane.members.length" class="dev-lane__empty">暂无人员</div>
          </div>
        </div>
      </div>
    </NCard>

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
  background: #faf8f4;
  border-radius: 0 0 8px 8px;
}
.dev-lane__body--over {
  outline: 2px dashed #2b2926;
  outline-offset: -4px;
  background: #f3f1ec;
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
  background: #fff;
  border: 1px solid #e7e4de;
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
  color: #2b2b2b;
}
.dev-card__days {
  font-size: 11px;
  color: #9c9994;
}
.dev-card__next {
  margin-top: 4px;
  font-size: 12px;
  color: #52525b;
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
  color: #9c9994;
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
