<script setup lang="ts">
/**
 * 按阶段一键归档弹窗：
 * - 支持切换任意发展阶段，并可勾选「同时包含前序未归档阶段」
 * - 支持三种日期模式：不设置日期（全无）/ 同页逐条依次设置 / 统一设为同一日期
 * - 已归档材料默认不勾选以保留原日期，用户可手动勾选或直接修改日期覆盖
 */
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { DEV_STAGE_ORDER, nodesOfStage, resolveNodeMaterials } from '@/constants/dev-nodes';
import type { DevStageName } from '@/constants/dev-nodes';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'DevBatchArchiveModal' });

const props = defineProps<{
  show: boolean;
  memberId: string | null;
  initialStage?: DevStageName;
}>();

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void;
  (e: 'archived', count: number): void;
}>();

const workStore = useWorkDataStore();

const show = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
});

type DateMode = 'none' | 'per-item' | 'uniform';

const targetStage = ref<DevStageName>('申请人');
const includePrior = ref(false);
const dateMode = ref<DateMode>('none');
const uniformDate = ref<string | null>(dayjs().format('YYYY-MM-DD'));
const rowChecked = ref<Record<string, boolean>>({});
const rowDates = ref<Record<string, string | null>>({});
const submitting = ref(false);

const member = computed(() => (props.memberId ? workStore.memberOf(props.memberId) : undefined));
const devStage = computed(() =>
  props.memberId ? workStore.devStages.find(d => d.member_id === props.memberId) : undefined
);

const targetStageIdx = computed(() => Math.max(0, DEV_STAGE_ORDER.indexOf(targetStage.value)));

/** 前序阶段尚未归档的材料数量 */
const priorUnarchivedCount = computed(() => {
  if (targetStageIdx.value <= 0) return 0;
  const rawMats = devStage.value?.materials;
  let count = 0;
  for (let i = 0; i < targetStageIdx.value; i += 1) {
    for (const node of nodesOfStage(DEV_STAGE_ORDER[i])) {
      for (const m of resolveNodeMaterials(node, rawMats)) {
        if (m.status !== '已归档') count += 1;
      }
    }
  }
  return count;
});

const activeStages = computed<DevStageName[]>(() => {
  if (includePrior.value && targetStageIdx.value > 0) {
    return DEV_STAGE_ORDER.slice(0, targetStageIdx.value + 1);
  }
  return [targetStage.value];
});

interface BatchMaterialRow {
  key: string;
  stage: DevStageName;
  nodeNo: string;
  nodeTitle: string;
  no: string;
  name: string;
  currentStatus: string;
  currentDate: string;
  alreadyArchived: boolean;
}

interface StageMaterialGroup {
  stage: DevStageName;
  rows: BatchMaterialRow[];
  unarchivedCount: number;
}

const stageGroups = computed<StageMaterialGroup[]>(() => {
  const rawMats = devStage.value?.materials;
  return activeStages.value.map(stageName => {
    const rows: BatchMaterialRow[] = [];
    for (const node of nodesOfStage(stageName)) {
      for (const mat of resolveNodeMaterials(node, rawMats)) {
        rows.push({
          key: `${node.no}::${mat.no}::${mat.name}`,
          stage: stageName,
          nodeNo: node.no,
          nodeTitle: node.node,
          no: mat.no,
          name: mat.name,
          currentStatus: mat.status,
          currentDate: mat.date || '',
          alreadyArchived: mat.status === '已归档'
        });
      }
    }
    return {
      stage: stageName,
      rows,
      unarchivedCount: rows.filter(r => !r.alreadyArchived).length
    };
  });
});

const allRows = computed<BatchMaterialRow[]>(() => stageGroups.value.flatMap(g => g.rows));

function syncRowMaps(resetAll = false) {
  const nextChecked: Record<string, boolean> = resetAll ? {} : { ...rowChecked.value };
  const nextDates: Record<string, string | null> = resetAll ? {} : { ...rowDates.value };

  for (const row of allRows.value) {
    if (resetAll || nextChecked[row.key] === undefined) {
      // 未归档材料默认勾选；已归档材料默认不勾选以保留原日期
      nextChecked[row.key] = !row.alreadyArchived;
    }
    if (resetAll || nextDates[row.key] === undefined) {
      nextDates[row.key] = row.currentDate || null;
    }
  }

  rowChecked.value = nextChecked;
  rowDates.value = nextDates;
}

watch(
  () => props.show,
  visible => {
    if (!visible) return;
    const fallbackStage = (devStage.value?.stage as DevStageName | undefined) ?? '申请人';
    const nextStage =
      props.initialStage && DEV_STAGE_ORDER.includes(props.initialStage)
        ? props.initialStage
        : DEV_STAGE_ORDER.includes(fallbackStage)
          ? fallbackStage
          : '申请人';
    targetStage.value = nextStage;
    includePrior.value = false;
    dateMode.value = 'none';
    uniformDate.value = dayjs().format('YYYY-MM-DD');
    syncRowMaps(true);
  }
);

watch([targetStage, includePrior], () => {
  if (!props.show) return;
  syncRowMaps(false);
});

const selectedRows = computed(() => allRows.value.filter(r => Boolean(rowChecked.value[r.key])));
const skippedArchivedCount = computed(
  () => allRows.value.filter(r => r.alreadyArchived && !rowChecked.value[r.key]).length
);

function selectOnlyUnarchived() {
  const next: Record<string, boolean> = { ...rowChecked.value };
  for (const row of allRows.value) {
    next[row.key] = !row.alreadyArchived;
  }
  rowChecked.value = next;
}

function selectAllRows() {
  const next: Record<string, boolean> = { ...rowChecked.value };
  for (const row of allRows.value) {
    next[row.key] = true;
  }
  rowChecked.value = next;
}

function fillAllDatesToday() {
  const today = dayjs().format('YYYY-MM-DD');
  const next: Record<string, string | null> = { ...rowDates.value };
  for (const row of allRows.value) {
    if (rowChecked.value[row.key]) {
      next[row.key] = today;
    }
  }
  rowDates.value = next;
}

function clearAllDates() {
  const next: Record<string, string | null> = { ...rowDates.value };
  for (const row of allRows.value) {
    if (rowChecked.value[row.key]) {
      next[row.key] = null;
    }
  }
  rowDates.value = next;
}

function handleRowDateChange(key: string, val: string | null) {
  rowDates.value = { ...rowDates.value, [key]: val };
  // 若用户直接编辑了某行日期，自动勾选该行以免改动丢失
  if (!rowChecked.value[key]) {
    rowChecked.value = { ...rowChecked.value, [key]: true };
  }
}

async function handleConfirm() {
  if (!props.memberId || !selectedRows.value.length) {
    window.$message?.warning('请至少勾选一项要归档的材料');
    return;
  }

  submitting.value = true;
  try {
    const payload = selectedRows.value.map(row => {
      let finalDate = '';
      if (dateMode.value === 'uniform') {
        finalDate = uniformDate.value ?? '';
      } else if (dateMode.value === 'per-item') {
        finalDate = rowDates.value[row.key] ?? '';
      }
      return {
        nodeNo: row.nodeNo,
        no: row.no,
        name: row.name,
        date: finalDate
      };
    });

    const count = await workStore.batchArchiveStageMaterials(props.memberId, payload);
    emit('archived', count);
    show.value = false;
    window.$message?.success(`已一键归档 ${count} 项材料`);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    :title="member ? `${member.name} · 按阶段一键归档` : '按阶段一键归档'"
    class="w-[92vw] max-w-720px"
    :mask-closable="false"
  >
    <div class="flex flex-col gap-12px">
      <!-- 1. 阶段选择 + 包含前序未归档选项 -->
      <div class="flex flex-col gap-8px rounded-10px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-10px">
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <span class="text-12px font-bold text-[var(--sct-ink)]">选择归档阶段</span>
          <NCheckbox v-if="targetStageIdx > 0" v-model:checked="includePrior" size="small">
            <span class="text-12px">
              同时包含前序未归档阶段
              <span v-if="priorUnarchivedCount > 0" class="font-semibold text-[#d97706]">
                （前序缺 {{ priorUnarchivedCount }} 项）
              </span>
              <span v-else class="text-[var(--sct-muted)]">（前序已全归档）</span>
            </span>
          </NCheckbox>
        </div>
        <NRadioGroup v-model:value="targetStage" size="small">
          <NRadioButton v-for="sName in DEV_STAGE_ORDER" :key="sName" :value="sName">
            {{ sName }}
          </NRadioButton>
        </NRadioGroup>
      </div>

      <!-- 2. 归档日期设置模式 -->
      <div class="flex flex-wrap items-center justify-between gap-8px">
        <div class="flex flex-wrap items-center gap-8px">
          <span class="text-12px font-bold text-[var(--sct-ink)]">归档日期：</span>
          <NRadioGroup v-model:value="dateMode" size="small">
            <NRadioButton value="none">不设置日期（全无）</NRadioButton>
            <NRadioButton value="per-item">同页逐条依次设置</NRadioButton>
            <NRadioButton value="uniform">统一设为同一日期</NRadioButton>
          </NRadioGroup>
        </div>
        <div v-if="dateMode === 'uniform'" class="flex items-center gap-6px">
          <NDatePicker
            v-model:formatted-value="uniformDate"
            type="date"
            value-format="yyyy-MM-dd"
            size="small"
            clearable
            placeholder="选择统一日期（留空为无）"
            class="w-180px"
          />
        </div>
      </div>

      <!-- 3. 批量选择与日期快捷栏 -->
      <div class="flex flex-wrap items-center justify-between gap-8px text-12px">
        <div class="flex flex-wrap items-center gap-6px">
          <NButton size="tiny" secondary @click="selectOnlyUnarchived">仅选未归档</NButton>
          <NButton size="tiny" secondary @click="selectAllRows">全选全部</NButton>
          <template v-if="dateMode === 'per-item'">
            <NButton size="tiny" quaternary type="primary" @click="fillAllDatesToday">已选项全填今日</NButton>
            <NButton size="tiny" quaternary @click="clearAllDates">已选项全清空（无）</NButton>
          </template>
        </div>
        <span class="text-11px text-[var(--sct-muted)]">已归档项默认不勾选（保留原日期），勾选或改日期可覆盖</span>
      </div>

      <!-- 4. 单页材料列表（按阶段分组，逐条可勾选 & 独立设日期） -->
      <div class="max-h-360px flex flex-col gap-10px overflow-y-auto pr-4px">
        <div
          v-for="group in stageGroups"
          :key="group.stage"
          class="rounded-10px border border-[var(--sct-border)] p-10px"
        >
          <div
            class="mb-8px flex items-center justify-between border-b border-dashed border-[var(--sct-border)] pb-6px"
          >
            <span class="text-12px font-bold text-[var(--sct-ink)]">
              {{ group.stage }}（共 {{ group.rows.length }} 项）
            </span>
            <NTag size="tiny" :type="group.unarchivedCount === 0 ? 'success' : 'warning'" :bordered="false" round>
              {{ group.unarchivedCount === 0 ? '本阶段已全部归档' : `待归档 ${group.unarchivedCount} 项` }}
            </NTag>
          </div>

          <div class="flex flex-col gap-6px">
            <div
              v-for="row in group.rows"
              :key="row.key"
              class="flex flex-wrap items-center justify-between gap-8px rounded-8px px-8px py-6px transition-colors"
              :class="rowChecked[row.key] ? 'bg-[var(--sct-soft)]' : 'opacity-65'"
            >
              <div class="flex min-w-0 flex-1 items-center gap-8px">
                <NCheckbox
                  :checked="Boolean(rowChecked[row.key])"
                  @update:checked="v => (rowChecked = { ...rowChecked, [row.key]: v })"
                />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-12px font-medium text-[var(--sct-ink)]">
                    <span class="mr-5px font-mono text-11px text-[var(--sct-muted)]">{{ row.no }}</span>
                    <span>{{ row.name }}</span>
                  </div>
                  <div class="mt-1px flex items-center gap-6px text-11px text-[var(--sct-muted)]">
                    <span>#{{ row.nodeNo }} {{ row.nodeTitle }}</span>
                    <span v-if="row.alreadyArchived" class="text-[#16a34a]">
                      · 已归档（{{ row.currentDate || '无日期' }}）
                    </span>
                    <span v-else-if="row.currentStatus === '进行中'" class="text-[#d97706]">· 进行中</span>
                  </div>
                </div>
              </div>

              <!-- 右侧日期控件或将应用日期预览 -->
              <div class="flex shrink-0 items-center gap-4px">
                <template v-if="dateMode === 'per-item'">
                  <NDatePicker
                    :formatted-value="rowDates[row.key] ?? null"
                    type="date"
                    value-format="yyyy-MM-dd"
                    size="small"
                    clearable
                    placeholder="留空为「无」"
                    class="w-146px"
                    @update:formatted-value="val => handleRowDateChange(row.key, val)"
                  />
                  <NButton
                    v-if="rowDates[row.key]"
                    size="tiny"
                    quaternary
                    title="设为无日期"
                    @click="handleRowDateChange(row.key, null)"
                  >
                    无
                  </NButton>
                </template>
                <span
                  v-else-if="rowChecked[row.key]"
                  class="rounded-full bg-[var(--sct-ok-soft)] px-8px py-1px text-11px font-semibold text-[#16a34a]"
                >
                  → {{ dateMode === 'uniform' ? uniformDate || '无日期' : '无日期' }}
                </span>
                <span v-else class="text-11px text-[var(--sct-muted)]">保持原状</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-8px">
        <div class="text-12px text-[var(--sct-muted)]">
          即将归档
          <strong class="text-[var(--sct-ink)]">{{ selectedRows.length }}</strong>
          项材料
          <span v-if="skippedArchivedCount > 0">（保留 {{ skippedArchivedCount }} 项已归档原日期）</span>
        </div>
        <div class="flex items-center gap-8px">
          <NButton size="small" @click="show = false">取消</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="submitting"
            :disabled="!selectedRows.length"
            @click="handleConfirm"
          >
            <template #icon><SvgIcon icon="lucide:folder-check" /></template>
            确认一键归档（{{ selectedRows.length }} 项）
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
