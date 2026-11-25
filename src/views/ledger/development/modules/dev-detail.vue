<script setup lang="ts">
/**
 * 发展台账个人详情：
 * - 支持切换查看上一阶段 / 下一阶段（覆盖全五阶段独立视图，不拼接）
 * - 支持跨阶段编辑/补录材料归档状态，归档日期支持选择「无」
 * - 自动重算「下一步待办」，全部归档后不再残留「材料归档」待办
 * - 内置「查看发展时间线」S 型流程图入口
 */
import { computed, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import {
  DEV_STAGE_ORDER,
  areStagesUpToFullyArchived,
  computeNextDevNode,
  findFirstMissingPriorNode,
  nextStage,
  nodesOfStage,
  prevStage,
  resolveNodeMaterials
} from '@/constants/dev-nodes';
import type { DevStageName } from '@/constants/dev-nodes';
import { useThemeStore } from '@/store/modules/theme';
import { useWorkDataStore } from '@/store/modules/work-data';
import DevBatchArchiveModal from './dev-batch-archive-modal.vue';

defineOptions({ name: 'DevDetail' });

const props = defineProps<{ show: boolean; memberId: string | null }>();
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void;
  (e: 'open-timeline', memberId: string): void;
}>();

const workStore = useWorkDataStore();
const themeStore = useThemeStore();

const show = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
});

const member = computed(() => (props.memberId ? workStore.memberOf(props.memberId) : undefined));
const stage = computed(() =>
  props.memberId ? workStore.devStages.find(d => d.member_id === props.memberId) : undefined
);

/** 当前抽屉正在查看的阶段（默认跟随党员当前所处阶段，可切至上一/下一阶段独立浏览） */
const viewingStage = ref<DevStageName>('申请人');

watch(
  [() => props.show, () => props.memberId, () => stage.value?.stage],
  ([visible, , actualStage]) => {
    if (visible && actualStage && DEV_STAGE_ORDER.includes(actualStage as DevStageName)) {
      viewingStage.value = actualStage as DevStageName;
    }
  },
  { immediate: true }
);

const actualStageIdx = computed(() => {
  const s = stage.value?.stage ?? '申请人';
  return Math.max(0, DEV_STAGE_ORDER.indexOf(s as DevStageName));
});

const viewingStageIdx = computed(() => Math.max(0, DEV_STAGE_ORDER.indexOf(viewingStage.value)));

const viewingStageRelation = computed<'past' | 'current' | 'future'>(() => {
  if (viewingStageIdx.value < actualStageIdx.value) return 'past';
  if (viewingStageIdx.value > actualStageIdx.value) return 'future';
  return 'current';
});

const canGoPrev = computed(() => Boolean(prevStage(viewingStage.value)));
const canGoNext = computed(() => Boolean(nextStage(viewingStage.value)));

function goPrevStage() {
  const target = prevStage(viewingStage.value);
  if (target) viewingStage.value = target;
}

function goNextStage() {
  const target = nextStage(viewingStage.value);
  if (target) viewingStage.value = target;
}

function resetToCurrentStage() {
  if (stage.value?.stage && DEV_STAGE_ORDER.includes(stage.value.stage as DevStageName)) {
    viewingStage.value = stage.value.stage as DevStageName;
  }
}

/** 正在查看阶段的节点清单（独立页面，仅展示该阶段） */
const viewingStageNodes = computed(() =>
  nodesOfStage(viewingStage.value).map(node => ({
    node,
    materials: resolveNodeMaterials(node, stage.value?.materials)
  }))
);

const viewingStageProgress = computed(() => {
  let total = 0;
  let archived = 0;
  for (const item of viewingStageNodes.value) {
    total += item.materials.length;
    archived += item.materials.filter(m => m.status === '已归档').length;
  }
  return { archived, total };
});

/** 实时重算当前阶段的「下一步待办」 */
const effectiveNextNode = computed(() => {
  if (!stage.value) return '';
  return computeNextDevNode(stage.value.stage, stage.value.materials);
});

/** 仅当全部 5 个阶段的材料均已归档时，才视为「全部材料已归档」 */
const isAllCompleted = computed(() =>
  Boolean(
    stage.value && stage.value.stage === '正式党员' && areStagesUpToFullyArchived('正式党员', stage.value.materials)
  )
);

/** 非正式党员：当前阶段及之前全部阶段材料均已归档 */
const isStageReadyCompleted = computed(() =>
  Boolean(
    stage.value &&
    stage.value.stage !== '正式党员' &&
    areStagesUpToFullyArchived(stage.value.stage, stage.value.materials)
  )
);

/** 当前阶段材料已归档，但前序阶段仍有材料未归档时，定位首个缺失的前序节点 */
const missingPriorNode = computed(() => {
  if (!stage.value || effectiveNextNode.value || isAllCompleted.value || isStageReadyCompleted.value) return null;
  return findFirstMissingPriorNode(stage.value.stage, stage.value.materials);
});

function jumpToMissingPrior() {
  if (missingPriorNode.value && DEV_STAGE_ORDER.includes(missingPriorNode.value.stage as DevStageName)) {
    viewingStage.value = missingPriorNode.value.stage as DevStageName;
  }
}

const daysInStage = computed(() => {
  if (!stage.value?.stage_date) return null;
  return dayjs().diff(dayjs(stage.value.stage_date), 'day');
});

const timeline = computed(() => [...(stage.value?.timeline ?? [])].sort((a, b) => a.date.localeCompare(b.date)));

const MATERIAL_STATUS_OPTIONS = [
  { label: '未开始', value: '未开始' },
  { label: '进行中', value: '进行中' },
  { label: '已归档', value: '已归档' }
];

const NEXT_STATUS_CYCLE: Record<string, string> = {
  未开始: '进行中',
  进行中: '已归档',
  已归档: '未开始'
};

const matModalShow = ref(false);
const batchArchiveShow = ref(false);
const matForm = reactive<{
  nodeNo: string;
  no: string;
  name: string;
  currentStatus: string;
  targetStatus: string;
  dateMode: 'date' | 'none';
  date: string | null;
}>({
  nodeNo: '',
  no: '',
  name: '',
  currentStatus: '未开始',
  targetStatus: '进行中',
  dateMode: 'date',
  date: null
});

function openMaterialConfirm(nodeNo: string, mat: Sct.DevMaterial) {
  matForm.nodeNo = nodeNo;
  matForm.no = mat.no;
  matForm.name = mat.name;
  matForm.currentStatus = mat.status;
  matForm.targetStatus = NEXT_STATUS_CYCLE[mat.status] ?? '进行中';
  if (mat.status === '已归档' && !mat.date) {
    matForm.dateMode = 'none';
    matForm.date = null;
  } else {
    matForm.dateMode = 'date';
    matForm.date = mat.date || dayjs().format('YYYY-MM-DD');
  }
  matModalShow.value = true;
}

async function confirmMaterialChange() {
  if (!stage.value || !matForm.no) return;
  const finalDate = matForm.targetStatus === '已归档' && matForm.dateMode === 'date' ? (matForm.date ?? '').trim() : '';

  await workStore.upsertStageMaterial(stage.value.member_id, matForm.nodeNo, {
    no: matForm.no,
    name: matForm.name,
    status: matForm.targetStatus,
    date: finalDate
  });
  matModalShow.value = false;
  window.$message?.success(`已将「${matForm.no} ${matForm.name}」状态更新为「${matForm.targetStatus}」`);
}

function statusStyle(status: string) {
  const dark = themeStore.darkMode;
  if (status === '已归档') {
    return { bg: 'var(--sct-ok-soft)', color: dark ? '#4ade80' : '#15803d', dot: '#16a34a' };
  }
  if (status === '进行中') {
    return { bg: 'var(--sct-warn-soft)', color: dark ? '#fbbf24' : '#b45309', dot: '#d97706' };
  }
  return { bg: 'var(--sct-container)', color: dark ? '#cbd5e1' : '#64748b', dot: '#94a3b8' };
}
</script>

<template>
  <NDrawer v-model:show="show" :width="600">
    <NDrawerContent v-if="member && stage" :title="`${member.name} · 发展详情与材料清单`" closable>
      <template #header>
        <div class="flex w-full items-center justify-between gap-10px pr-8px">
          <span class="truncate font-bold">{{ member.name }} · 发展详情与材料清单</span>
          <NButton size="tiny" type="primary" secondary @click="emit('open-timeline', member.id)">
            <template #icon><SvgIcon icon="lucide:git-branch" /></template>
            查看发展时间线
          </NButton>
        </div>
      </template>

      <NSpace vertical size="large">
        <!-- 当前所处阶段概要 -->
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <div class="flex items-center gap-8px">
            <NTag :bordered="false" size="small" :color="{ color: 'var(--sct-err-soft)', textColor: '#A81C24' }">
              当前阶段：{{ stage.stage }}
            </NTag>
            <span class="text-12px text-gray-500">自 {{ stage.stage_date }} 起 · {{ daysInStage }} 天</span>
          </div>
          <NButton
            v-if="viewingStageRelation !== 'current'"
            size="tiny"
            text
            type="primary"
            @click="resetToCurrentStage"
          >
            <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
            返回当前阶段
          </NButton>
        </div>

        <!-- 下一步待办 / 全部归档完成状态 -->
        <div v-if="effectiveNextNode" class="rounded-10px border border-[#A81C24]/30 bg-[var(--sct-err-soft)] p-12px">
          <div class="text-12px font-bold text-[#A81C24]">当前阶段下一步待办</div>
          <div class="mt-4px text-13px leading-relaxed text-[var(--sct-ink)]">{{ effectiveNextNode }}</div>
          <div v-if="stage.next_due" class="mt-4px text-12px text-[#d97706]">预计 {{ stage.next_due }}</div>
        </div>
        <div
          v-else-if="isAllCompleted"
          class="flex items-center gap-8px rounded-10px border border-[#16a34a]/35 bg-[var(--sct-ok-soft)] p-12px text-[#15803d] dark:text-[#4ade80]"
        >
          <SvgIcon icon="lucide:check-circle-2" class="text-18px shrink-0" />
          <div>
            <div class="text-13px font-bold">全部材料已归档</div>
            <div class="mt-2px text-11px opacity-85">全五阶段发展材料已 100% 归档完成，无待办提醒</div>
          </div>
        </div>
        <div
          v-else-if="isStageReadyCompleted"
          class="flex items-center gap-8px rounded-10px border border-[#16a34a]/35 bg-[var(--sct-ok-soft)] p-12px text-[#15803d] dark:text-[#4ade80]"
        >
          <SvgIcon icon="lucide:check-circle-2" class="text-16px shrink-0" />
          <div class="text-12px font-semibold">「{{ stage.stage }}」及前序阶段材料已备齐，可推进至下一阶段</div>
        </div>
        <div
          v-else-if="missingPriorNode"
          class="flex items-center justify-between gap-8px rounded-10px border border-[#d97706]/35 bg-[var(--sct-warn-soft)] p-12px text-[#b45309] dark:text-[#fbbf24]"
        >
          <div class="flex items-center gap-8px min-w-0">
            <SvgIcon icon="lucide:alert-circle" class="text-16px shrink-0" />
            <div class="min-w-0 text-12px">
              <div class="font-bold">当前阶段已归档，前序阶段尚有材料待补录</div>
              <div class="mt-2px truncate opacity-90">{{ missingPriorNode.stage }} · {{ missingPriorNode.node }}</div>
            </div>
          </div>
          <NButton size="tiny" type="warning" secondary @click="jumpToMissingPrior">前往补录</NButton>
        </div>

        <!-- 跨阶段独立步进轨道（1~5 编号圆点 + 阶段名 + 左右翻页，与下方材料卡片彻底区分） -->
        <div class="dev-stepper">
          <div class="dev-stepper__top">
            <div class="flex items-center gap-6px">
              <SvgIcon icon="lucide:footprints" class="text-14px text-[#A81C24]" />
              <span class="text-12px font-bold text-[var(--sct-ink)]">发展阶段材料翻页器</span>
              <span class="dev-stepper__badge" :class="`dev-stepper__badge--${viewingStageRelation}`">
                {{
                  viewingStageRelation === 'current'
                    ? '当前所处阶段'
                    : viewingStageRelation === 'past'
                      ? '历史阶段 · 可补录'
                      : '后续阶段 · 可预填'
                }}
              </span>
            </div>
            <div class="flex items-center gap-6px">
              <button type="button" class="dev-stepper__nav" :disabled="!canGoPrev" @click="goPrevStage">
                <SvgIcon icon="lucide:chevron-left" class="text-13px" />
                <span>上一阶段</span>
              </button>
              <button type="button" class="dev-stepper__nav" :disabled="!canGoNext" @click="goNextStage">
                <span>下一阶段</span>
                <SvgIcon icon="lucide:chevron-right" class="text-13px" />
              </button>
            </div>
          </div>

          <!-- 1~5 横向步骤轨道 -->
          <div class="dev-stepper__track">
            <button
              v-for="(sName, sIdx) in DEV_STAGE_ORDER"
              :key="sName"
              type="button"
              class="dev-step-pill"
              :class="{
                'dev-step-pill--active': viewingStage === sName,
                'dev-step-pill--actual': viewingStage !== sName && sName === stage.stage,
                'dev-step-pill--passed': viewingStage !== sName && sIdx < actualStageIdx
              }"
              @click="viewingStage = sName"
            >
              <span class="dev-step-pill__num">{{ sIdx + 1 }}</span>
              <span class="dev-step-pill__label">{{ sName }}</span>
              <span
                v-if="sName === stage.stage && viewingStage !== sName"
                class="dev-step-pill__dot"
                title="该同志当前所处阶段"
              />
            </button>
          </div>

          <div class="dev-stepper__foot">
            <span>
              正在独立浏览「
              <strong>{{ viewingStage }}</strong>
              」阶段清单（共 {{ viewingStageNodes.length }} 个节点）
            </span>
            <div class="flex items-center gap-8px">
              <span class="font-mono font-semibold text-[#16a34a]">
                已归档 {{ viewingStageProgress.archived }} / {{ viewingStageProgress.total }} 项
              </span>
              <NButton size="tiny" type="primary" secondary @click="batchArchiveShow = true">
                <template #icon><SvgIcon icon="lucide:folder-check" /></template>
                一键归档
              </NButton>
            </div>
          </div>
        </div>

        <!-- 所选阶段节点材料清单 -->
        <div>
          <div class="mb-8px flex items-center justify-between">
            <span class="text-13px font-bold">「{{ viewingStage }}」阶段节点与材料清单</span>
            <span class="text-11px text-gray-400">点击右侧状态按钮可变更进度与归档日期</span>
          </div>
          <div class="flex flex-col gap-10px">
            <div
              v-for="{ node: n, materials } in viewingStageNodes"
              :key="n.no"
              class="rounded-10px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-10px"
            >
              <div class="flex items-center justify-between gap-8px text-12px font-bold">
                <div>
                  <span class="mr-4px text-[#A81C24]">{{ n.no }}</span>
                  <span>{{ n.node }}</span>
                </div>
                <NTag v-if="n.deadline" size="tiny" type="warning" :bordered="false">{{ n.deadline }}</NTag>
              </div>

              <div class="mt-8px flex flex-col gap-6px">
                <div
                  v-for="mat in materials"
                  :key="`${n.no}-${mat.no}-${mat.name}`"
                  class="flex items-center justify-between gap-8px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-container)] px-10px py-6px"
                >
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-12px font-medium text-[var(--sct-ink)]">
                      <span class="mr-4px font-mono text-11px text-gray-400">{{ mat.no }}</span>
                      <span>{{ mat.name }}</span>
                    </div>
                    <div v-if="mat.status === '已归档'" class="mt-2px text-11px text-gray-400">
                      归档日期：{{ mat.date ? mat.date : '无' }}
                    </div>
                  </div>

                  <button
                    type="button"
                    class="inline-flex flex-shrink-0 items-center gap-5px rounded-full border border-[var(--sct-border)] px-10px py-3px text-11px font-bold transition hover:border-[#A81C24]"
                    :style="{
                      background: statusStyle(mat.status).bg,
                      color: statusStyle(mat.status).color
                    }"
                    title="点击修改该材料状态"
                    @click="openMaterialConfirm(n.no, mat)"
                  >
                    <span
                      class="inline-block size-6px rounded-full"
                      :style="{ background: statusStyle(mat.status).dot }"
                    />
                    <span>{{ mat.status }}</span>
                    <SvgIcon icon="lucide:chevron-down" class="text-11px opacity-75" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 流转记录时间线 -->
        <div>
          <div class="mb-6px text-13px font-bold">阶段流转记录</div>
          <NSteps v-if="timeline.length" vertical size="small">
            <NStep
              v-for="(t, i) in timeline"
              :key="i"
              :title="t.node"
              :description="`${t.date}${t.note ? ` · ${t.note}` : ''}`"
            />
          </NSteps>
          <div v-else class="text-12px text-gray-400">暂无记录</div>
        </div>
      </NSpace>
    </NDrawerContent>
  </NDrawer>

  <!-- 材料状态变更确认弹窗（支持归档日期选「无」） -->
  <NModal v-model:show="matModalShow" preset="card" title="确认变更材料状态" class="w-460px" :mask-closable="false">
    <div class="mb-12px rounded-8px bg-[var(--sct-soft)] px-12px py-10px text-13px">
      <div class="font-bold text-[var(--sct-ink)]">{{ matForm.no }} {{ matForm.name }}</div>
      <div class="mt-4px text-12px text-gray-500">当前状态：{{ matForm.currentStatus }}</div>
    </div>

    <NForm label-placement="left" label-width="112" size="small">
      <NFormItem required>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:check-circle-2" class="sct-field-icon" />
            <span>变更为状态</span>
          </span>
        </template>
        <NSelect v-model:value="matForm.targetStatus" :options="MATERIAL_STATUS_OPTIONS" />
      </NFormItem>
      <NFormItem v-if="matForm.targetStatus === '已归档'">
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:calendar-check" class="sct-field-icon" />
            <span>归档日期</span>
          </span>
        </template>
        <div class="flex w-full flex-col gap-8px">
          <NRadioGroup v-model:value="matForm.dateMode" size="small">
            <NRadio value="date">填写日期</NRadio>
            <NRadio value="none">无（不填日期）</NRadio>
          </NRadioGroup>
          <NDatePicker
            v-if="matForm.dateMode === 'date'"
            v-model:formatted-value="matForm.date"
            type="date"
            value-format="yyyy-MM-dd"
            clearable
            class="w-full"
          />
        </div>
      </NFormItem>
    </NForm>

    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton size="small" @click="matModalShow = false">取消</NButton>
        <NButton size="small" type="primary" @click="confirmMaterialChange">
          <template #icon><SvgIcon icon="lucide:check" /></template>
          确认变更
        </NButton>
      </div>
    </template>
  </NModal>

  <!-- 按阶段一键归档弹窗 -->
  <DevBatchArchiveModal v-model:show="batchArchiveShow" :member-id="props.memberId" :initial-stage="viewingStage" />
</template>

<style scoped>
.dev-stepper {
  position: relative;
  padding: 12px 14px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(168, 28, 36, 0.06) 0%, rgba(37, 99, 235, 0.04) 100%);
  border: 1.5px solid rgba(168, 28, 36, 0.22);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.dev-stepper__top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dev-stepper__badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}
.dev-stepper__badge--current {
  background: rgba(168, 28, 36, 0.14);
  color: #a81c24;
}
.dev-stepper__badge--past {
  background: rgba(22, 163, 74, 0.14);
  color: #15803d;
}
.dev-stepper__badge--future {
  background: rgba(37, 99, 235, 0.14);
  color: #1d4ed8;
}
.dev-stepper__nav {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--sct-ink);
  background: var(--sct-container) !important;
  border: 1px solid var(--sct-border);
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s,
    transform 0.12s;
}
.dev-stepper__nav:hover:not(:disabled) {
  border-color: #a81c24;
  color: #a81c24;
}
.dev-stepper__nav:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.dev-stepper__track {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  padding: 4px;
  border-radius: 10px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
}
.dev-step-pill {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 4px 7px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent !important;
  color: var(--sct-ink) !important;
  cursor: pointer;
  transition:
    background-color 0.15s,
    color 0.15s,
    border-color 0.15s,
    box-shadow 0.15s;
}
.dev-step-pill:hover:not(.dev-step-pill--active) {
  background: var(--sct-soft) !important;
  border-color: var(--sct-border);
}
.dev-step-pill__num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  font-family: var(--sct-font-mono);
  background: var(--sct-soft);
  color: var(--sct-muted);
}
.dev-step-pill__label {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
}
.dev-step-pill--passed .dev-step-pill__num {
  background: rgba(22, 163, 74, 0.16);
  color: #15803d;
}
.dev-step-pill--actual {
  border-color: rgba(168, 28, 36, 0.45);
  background: rgba(168, 28, 36, 0.06) !important;
  color: #a81c24 !important;
}
.dev-step-pill--actual .dev-step-pill__num {
  background: rgba(168, 28, 36, 0.16);
  color: #a81c24;
}
.dev-step-pill--active {
  background: #a81c24 !important;
  border-color: #8f161d !important;
  color: #ffffff !important;
  box-shadow: 0 3px 10px rgba(168, 28, 36, 0.28);
}
.dev-step-pill--active .dev-step-pill__num {
  background: rgba(255, 255, 255, 0.24);
  color: #ffffff;
}
.dev-step-pill--active .dev-step-pill__label {
  color: #ffffff !important;
  font-weight: 700;
}
.dev-step-pill__dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #a81c24;
}
.dev-stepper__foot {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  color: var(--sct-muted);
}
</style>
