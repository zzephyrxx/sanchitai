<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NTag } from 'naive-ui';
import type { DataTableColumns, SelectGroupOption, SelectOption } from 'naive-ui';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';
import {
  IMPORT_FIELD_LIST,
  buildImportPreviewRows,
  buildImportTemplateBlob,
  buildInitialColumnMappings,
  detectHeaderRowIndex,
  parseSpreadsheetFile
} from '@/utils/member-import';
import type {
  ColumnMapping,
  DuplicateStrategy,
  ImportPreviewRow,
  ImportTargetField,
  MemberStandardField,
  ParsedWorkbook
} from '@/utils/member-import';
import { saveFileWithPicker } from '@/utils/save-file';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'MemberImportModal' });

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>();

const workStore = useWorkDataStore();
const { bi, tMemberType } = useSctI18n();

const show = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
});

// ---------------- 向导状态 ----------------
const step = ref<1 | 2 | 3>(1);
const parsing = ref(false);
const importing = ref(false);
const draggingOver = ref(false);
const fileInputRef = ref<HTMLInputElement>();

const workbook = ref<ParsedWorkbook | null>(null);
const selectedSheetName = ref('');
const headerRowIndex = ref(0);
const mappings = ref<ColumnMapping[]>([]);
const duplicateStrategy = ref<DuplicateStrategy>('merge');

function resetWizard() {
  step.value = 1;
  parsing.value = false;
  importing.value = false;
  draggingOver.value = false;
  workbook.value = null;
  selectedSheetName.value = '';
  headerRowIndex.value = 0;
  mappings.value = [];
  duplicateStrategy.value = 'merge';
}

watch(
  () => props.show,
  val => {
    if (!val) {
      resetWizard();
    }
  }
);

const activeSheet = computed(
  () => workbook.value?.sheets.find(s => s.name === selectedSheetName.value) ?? workbook.value?.sheets[0] ?? null
);

const sheetOptions = computed<SelectOption[]>(() =>
  (workbook.value?.sheets ?? []).map(s => ({
    label: `${s.name}（${s.rows.length} 行）`,
    value: s.name
  }))
);

const maxHeaderRowNum = computed(() => Math.min(activeSheet.value?.rows.length ?? 1, 10));

function rebuildMappingsForHeader(rowIdx: number) {
  const sheet = activeSheet.value;
  if (!sheet) return;
  const clamped = Math.max(0, Math.min(rowIdx, Math.max(0, sheet.rows.length - 1)));
  headerRowIndex.value = clamped;
  mappings.value = buildInitialColumnMappings(sheet.rows, clamped);
}

function handleSheetChange(name: string) {
  selectedSheetName.value = name;
  const sheet = workbook.value?.sheets.find(s => s.name === name);
  if (!sheet) return;
  const detected = detectHeaderRowIndex(sheet.rows);
  rebuildMappingsForHeader(detected);
}

function handleHeaderRowNumberChange(val: number | null) {
  if (val === null) return;
  rebuildMappingsForHeader(val - 1);
}

// ---------------- 文件上传与模板下载 ----------------
async function loadFile(file: File) {
  const lower = file.name.toLowerCase();
  if (!/\.(xlsx|xls|csv|txt)$/.test(lower)) {
    window.$message?.warning('请选择 .xlsx、.xls 或 .csv 格式的表格文件');
    return;
  }
  parsing.value = true;
  try {
    const parsed = await parseSpreadsheetFile(file);
    if (!parsed.sheets.length) {
      window.$message?.warning('未在文件中读取到有效数据行，请检查表格内容');
      return;
    }
    workbook.value = parsed;
    selectedSheetName.value = parsed.sheets[0].name;
    const detected = detectHeaderRowIndex(parsed.sheets[0].rows);
    rebuildMappingsForHeader(detected);
    step.value = 2;
  } catch (err) {
    window.$message?.error(`解析表格失败：${(err as Error).message}`);
  } finally {
    parsing.value = false;
  }
}

function triggerFilePick() {
  fileInputRef.value?.click();
}

async function handleFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    await loadFile(file);
  }
  input.value = '';
}

async function handleDropFile(e: DragEvent) {
  draggingOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    await loadFile(file);
  }
}

async function downloadTemplate() {
  const res = await saveFileWithPicker(() => buildImportTemplateBlob(), {
    suggestedName: '三尺台_成员批量导入模板.xlsx',
    types: [
      {
        description: 'Excel 工作簿',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extensions: ['.xlsx']
      }
    ]
  });
  if (res.status === 'saved') {
    window.$message?.success('标准导入模板已保存');
  }
}

// ---------------- Step 2：列映射配置 ----------------
const targetSelectOptions = computed<Array<SelectGroupOption | SelectOption>>(() => [
  {
    type: 'group',
    label: bi('系统标准字段', 'Standard Fields'),
    key: 'std',
    children: IMPORT_FIELD_LIST.map(f => ({
      label: f.required ? `${f.label}（必填）` : f.label,
      value: f.key
    }))
  },
  {
    type: 'group',
    label: bi('其他处理', 'Other Actions'),
    key: 'extra',
    children: [
      { label: bi('合并到备注（保留原列名）', 'Append to Note (keep header)'), value: '__note_append__' },
      { label: bi('忽略此列（不导入）', 'Ignore column'), value: '__ignore__' }
    ]
  }
]);

const hasNameMapped = computed(() => mappings.value.some(m => m.target === 'name'));
const hasTypeMapping = computed(() => mappings.value.some(m => m.target === 'type'));

const duplicateFieldLabels = computed(() => {
  const counts = new Map<MemberStandardField, number>();
  mappings.value.forEach(m => {
    if (m.target !== '__ignore__' && m.target !== '__note_append__') {
      counts.set(m.target, (counts.get(m.target) ?? 0) + 1);
    }
  });
  const dupes: string[] = [];
  counts.forEach((cnt, key) => {
    if (cnt > 1) {
      const meta = IMPORT_FIELD_LIST.find(f => f.key === key);
      dupes.push(meta?.label ?? key);
    }
  });
  return dupes;
});

const sensitiveColumnCount = computed(() => mappings.value.filter(m => m.sensitive).length);
const mappedColumnCount = computed(() => mappings.value.filter(m => m.target !== '__ignore__').length);
const noteAppendCount = computed(() => mappings.value.filter(m => m.target === '__note_append__').length);

const canGoToStep3 = computed(() => hasNameMapped.value && duplicateFieldLabels.value.length === 0);

function updateMappingTarget(colIndex: number, target: ImportTargetField) {
  mappings.value = mappings.value.map(m => (m.colIndex === colIndex ? { ...m, target } : m));
}

// ---------------- Step 3：预览校验与执行 ----------------
const previewRows = computed<ImportPreviewRow[]>(() => {
  if (step.value !== 3 || !activeSheet.value) return [];
  return buildImportPreviewRows(activeSheet.value.rows, headerRowIndex.value, mappings.value, workStore.members);
});

const previewStats = computed(() => {
  let valid = 0;
  let invalid = 0;
  let toInsert = 0;
  let toUpdate = 0;
  let toSkip = 0;
  let warningCount = 0;

  for (const r of previewRows.value) {
    if (r.errors.length > 0) {
      invalid += 1;
      continue;
    }
    valid += 1;
    if (r.warnings.length > 0) warningCount += 1;
    if (r.matchedExisting) {
      if (duplicateStrategy.value === 'merge') toUpdate += 1;
      else if (duplicateStrategy.value === 'skip') toSkip += 1;
      else toInsert += 1;
    } else {
      toInsert += 1;
    }
  }

  return {
    total: previewRows.value.length,
    valid,
    invalid,
    toInsert,
    toUpdate,
    toSkip,
    warningCount
  };
});

function rowActionTag(row: ImportPreviewRow): { label: string; type: 'success' | 'info' | 'default' | 'error' } {
  if (row.errors.length > 0) return { label: '异常跳过', type: 'error' };
  if (row.matchedExisting) {
    if (duplicateStrategy.value === 'merge') {
      if (row.matchReason === 'student_id') return { label: '按学号更新', type: 'info' };
      if (row.matchReason === 'code') return { label: '按编号更新', type: 'info' };
      return { label: '按姓名更新', type: 'info' };
    }
    if (duplicateStrategy.value === 'skip') {
      return { label: '已有跳过', type: 'default' };
    }
    return { label: '追加新增', type: 'success' };
  }
  return { label: '新增', type: 'success' };
}

const previewColumns = computed<DataTableColumns<ImportPreviewRow>>(() => [
  {
    title: '行号',
    key: 'rowNumber',
    width: 60
  },
  {
    title: '导入动作',
    key: 'action',
    width: 102,
    render: row => {
      const info = rowActionTag(row);
      return h(NTag, { size: 'tiny', bordered: false, type: info.type }, () => info.label);
    }
  },
  {
    title: '姓名',
    key: 'name',
    width: 96,
    render: row => row.data.name || h('span', { class: 'text-red-500' }, '（空）')
  },
  {
    title: '身份',
    key: 'type',
    width: 118,
    render: row => {
      const effectiveType =
        row.matchedExisting && duplicateStrategy.value === 'merge' && !row.autoComputedType && !hasTypeMapping.value
          ? row.matchedExisting.type
          : row.data.type;
      return h('span', { class: 'inline-flex items-center gap-4px whitespace-nowrap' }, [
        h('span', {
          class: 'inline-block size-7px rounded-full',
          style: { background: MEMBER_TYPE_COLORS[effectiveType] ?? '#666' }
        }),
        h('span', tMemberType(effectiveType))
      ]);
    }
  },
  {
    title: '学号',
    key: 'student_id',
    width: 112,
    render: row => row.data.student_id || '—'
  },
  {
    title: '入党时间',
    key: 'join_date',
    width: 106,
    render: row => row.data.join_date || '—'
  },
  {
    title: '转正时间',
    key: 'full_date',
    width: 106,
    render: row => row.data.full_date || '—'
  },
  {
    title: '层次 / 年级 / 专业 / 导师',
    key: 'meta',
    width: 190,
    ellipsis: { tooltip: true },
    render: row => [row.data.level, row.data.grade, row.data.major, row.data.advisor].filter(Boolean).join(' · ') || '—'
  },
  {
    title: '校验提示 / 备注',
    key: 'tips',
    minWidth: 160,
    render: row => {
      const notes: string[] = [];
      if (row.errors.length) notes.push(`❌ ${row.errors.join('；')}`);
      if (row.warnings.length) notes.push(`⚠️ ${row.warnings.join('；')}`);
      if (row.data.note) notes.push(row.data.note);
      return notes.length ? h('span', { class: 'text-12px leading-snug' }, notes.join(' ｜ ')) : '—';
    }
  }
]);

const previewPagination = { pageSize: 8 };

async function executeImport() {
  if (previewStats.value.toInsert === 0 && previewStats.value.toUpdate === 0) {
    window.$message?.warning('当前没有可新增或更新的数据行');
    return;
  }
  importing.value = true;
  try {
    const result = await workStore.bulkImportMembers(previewRows.value, duplicateStrategy.value, {
      hasTypeMapping: hasTypeMapping.value
    });
    const parts: string[] = [];
    if (result.inserted) parts.push(`新增 ${result.inserted} 人`);
    if (result.updated) parts.push(`更新 ${result.updated} 人`);
    if (result.skipped) parts.push(`跳过 ${result.skipped} 人`);
    window.$message?.success(`批量导入完成：${parts.join('，')}（已自动保存导入前快照）`);
    show.value = false;
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    :title="bi('批量导入成员（Excel / CSV）', 'Batch Import Members (Excel / CSV)')"
    class="max-w-95vw w-900px"
    :mask-closable="false"
  >
    <div class="flex flex-col gap-14px">
      <NSteps :current="step" size="small">
        <NStep
          :title="bi('上传表格', 'Upload File')"
          :description="bi('支持 .xlsx / .xls / .csv', '.xlsx / .xls / .csv')"
        />
        <NStep
          :title="bi('智能列映射', 'Map Columns')"
          :description="bi('确认列名与字段对应关系', 'Confirm column mapping')"
        />
        <NStep
          :title="bi('预览并导入', 'Preview & Import')"
          :description="bi('校验日期、查重并入库', 'Validate & commit')"
        />
      </NSteps>

      <!-- Step 1: 上传表格 -->
      <div v-if="step === 1" class="flex flex-col gap-12px">
        <div
          class="flex flex-col cursor-pointer items-center justify-center gap-10px border-2 rounded-10px border-dashed px-20px py-36px transition-colors"
          :class="
            draggingOver
              ? 'border-[var(--sct-accent)] bg-[var(--sct-soft)]'
              : 'border-gray-300 hover:border-[var(--sct-accent)] dark:border-gray-700'
          "
          @click="triggerFilePick"
          @dragover.prevent="draggingOver = true"
          @dragleave="draggingOver = false"
          @drop.prevent="handleDropFile"
        >
          <SvgIcon icon="lucide:file-spreadsheet" class="text-36px text-[var(--sct-accent)]" />
          <div class="text-14px font-semibold">
            {{
              bi(
                '点击选择文件，或将 Excel / CSV 成员表拖拽到此处',
                'Click to select or drag an Excel / CSV roster file here'
              )
            }}
          </div>
          <div class="text-12px text-gray-500">
            {{
              bi(
                '支持 .xlsx / .xls / .csv（自动兼容 Windows GBK 编码与顶部大标题行，全本地解析不上传网络）',
                'Supports .xlsx / .xls / .csv (UTF-8 & GBK auto-detected, 100% local parsing)'
              )
            }}
          </div>
          <NButton size="small" type="primary" :loading="parsing" @click.stop="triggerFilePick">
            <template #icon><SvgIcon icon="lucide:upload" /></template>
            {{ bi('选择表格文件', 'Choose File') }}
          </NButton>
          <input
            ref="fileInputRef"
            type="file"
            accept=".xlsx,.xls,.csv,.txt"
            class="hidden"
            @change="handleFileInputChange"
          />
        </div>

        <div
          class="flex flex-wrap items-center justify-between gap-10px rounded-8px bg-[var(--sct-soft)] px-14px py-10px"
        >
          <div class="text-12px leading-relaxed text-gray-600 dark:text-gray-300">
            <strong>{{ bi('不确定表头怎么写？', 'Need a starter template?') }}</strong>
            {{
              bi(
                '直接上传你现有的支部名册即可，下一步支持自由映射列名；也可下载标准模板参考。',
                'Upload your existing roster directly and map columns in Step 2, or download our starter template.'
              )
            }}
          </div>
          <NButton size="small" secondary @click="downloadTemplate">
            <template #icon><SvgIcon icon="lucide:download" /></template>
            {{ bi('下载标准模板（.xlsx）', 'Download Template (.xlsx)') }}
          </NButton>
        </div>
      </div>

      <!-- Step 2: 智能列映射 -->
      <div v-else-if="step === 2" class="flex flex-col gap-12px">
        <div
          class="flex flex-wrap items-center justify-between gap-10px rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-12px"
        >
          <div class="flex flex-wrap items-center gap-10px">
            <span class="inline-flex items-center gap-4px font-semibold">
              <SvgIcon icon="lucide:file-spreadsheet" class="text-14px" />
              {{ workbook?.fileName }}
            </span>
            <NSelect
              v-if="sheetOptions.length > 1"
              :value="selectedSheetName"
              :options="sheetOptions"
              size="tiny"
              class="w-180px"
              @update:value="handleSheetChange"
            />
            <span class="inline-flex items-center gap-6px">
              <span class="text-gray-500">{{ bi('表头所在行：第', 'Header Row:') }}</span>
              <NInputNumber
                :value="headerRowIndex + 1"
                :min="1"
                :max="maxHeaderRowNum"
                size="tiny"
                class="w-84px"
                @update:value="handleHeaderRowNumberChange"
              />
              <span class="text-gray-500">{{ bi('行', '') }}</span>
            </span>
          </div>
          <div class="flex items-center gap-8px text-gray-500">
            <span>{{ bi(`已映射 ${mappedColumnCount} 列`, `${mappedColumnCount} mapped`) }}</span>
            <span v-if="noteAppendCount">
              · {{ bi(`拼接备注 ${noteAppendCount} 列`, `${noteAppendCount} → note`) }}
            </span>
          </div>
        </div>

        <NAlert v-if="!hasNameMapped" type="error" :show-icon="true">
          请至少将一列映射为「姓名（必填）」，方可进入下一步预览。
        </NAlert>
        <NAlert v-else-if="duplicateFieldLabels.length" type="warning" :show-icon="true">
          以下系统字段被重复映射了多次，请只保留一列：
          <strong>{{ duplicateFieldLabels.join('、') }}</strong>
        </NAlert>
        <NAlert v-if="sensitiveColumnCount" type="info" :show-icon="true">
          检测到
          <strong>{{ sensitiveColumnCount }}</strong>
          个身份证号/高敏列：仅存于本机数据库，且在人员列表中
          <strong>默认自动隐藏并脱敏显示</strong>
          （如无需入库可手动切换为「忽略此列」）。
        </NAlert>

        <div class="max-h-360px overflow-y-auto border border-gray-200 rounded-8px dark:border-gray-700">
          <table class="w-full border-collapse text-12px">
            <thead>
              <tr class="sticky top-0 z-1 border-b border-gray-200 bg-[var(--sct-soft)] text-left dark:border-gray-700">
                <th class="w-28% px-12px py-8px font-semibold">{{ bi('原表列名', 'Source Column') }}</th>
                <th class="w-38% px-12px py-8px font-semibold">{{ bi('前几行样例数据', 'Sample Values') }}</th>
                <th class="w-34% px-12px py-8px font-semibold">{{ bi('映射到系统字段', 'Target Field') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="col in mappings"
                :key="col.colIndex"
                class="border-b border-gray-100 last:border-b-0 dark:border-gray-800"
                :class="col.target === '__ignore__' ? 'opacity-65' : ''"
              >
                <td class="px-12px py-8px align-middle">
                  <div class="flex flex-wrap items-center gap-6px">
                    <span class="font-medium">{{ col.header }}</span>
                    <NTag v-if="col.sensitive" size="tiny" type="error" :bordered="false">隐私敏感</NTag>
                    <NTag
                      v-else-if="col.autoMatched && col.target !== '__ignore__'"
                      size="tiny"
                      type="success"
                      :bordered="false"
                    >
                      自动匹配
                    </NTag>
                  </div>
                </td>
                <td class="px-12px py-8px align-middle text-gray-500">
                  <div v-if="col.samples.length" class="flex flex-wrap gap-4px">
                    <span
                      v-for="(s, sIdx) in col.samples"
                      :key="sIdx"
                      class="max-w-160px truncate rounded-4px bg-[var(--sct-soft)] px-6px py-2px text-11px"
                      :title="s"
                    >
                      {{ s }}
                    </span>
                  </div>
                  <span v-else class="text-11px text-gray-400">（空列）</span>
                </td>
                <td class="px-12px py-8px align-middle">
                  <NSelect
                    :value="col.target"
                    :options="targetSelectOptions"
                    size="small"
                    filterable
                    @update:value="v => updateMappingTarget(col.colIndex, v)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Step 3: 预览与导入 -->
      <div v-else class="flex flex-col gap-12px">
        <div
          class="flex flex-wrap items-center justify-between gap-10px rounded-8px bg-[var(--sct-soft)] px-12px py-10px"
        >
          <div class="flex flex-wrap items-center gap-12px text-13px">
            <span>
              {{ bi('解析总行数', 'Parsed') }}：
              <strong>{{ previewStats.total }}</strong>
            </span>
            <span class="text-emerald-600 font-semibold">
              {{ bi('预计新增', 'Insert') }}：{{ previewStats.toInsert }}
            </span>
            <span class="text-blue-600 font-semibold">{{ bi('预计更新', 'Update') }}：{{ previewStats.toUpdate }}</span>
            <span v-if="previewStats.toSkip" class="text-gray-500">
              {{ bi('跳过已有', 'Skip') }}：{{ previewStats.toSkip }}
            </span>
            <span v-if="previewStats.invalid" class="text-red-500 font-semibold">
              {{ bi('异常跳过', 'Invalid') }}：{{ previewStats.invalid }}
            </span>
          </div>
          <span class="inline-flex items-center gap-4px text-11px text-gray-500">
            <SvgIcon icon="lucide:shield-check" class="text-14px text-emerald-600" />
            {{ bi('导入前将自动创建本地快照，可随时回退', 'Auto-snapshot created before import') }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-10px text-12px">
          <span class="text-gray-600 font-semibold dark:text-gray-300">
            {{ bi('遇到已有成员（同学号、同编号或同名）：', 'When existing member matched:') }}
          </span>
          <NRadioGroup v-model:value="duplicateStrategy" size="small">
            <NSpace>
              <NRadio value="merge">
                {{ bi('合并更新（仅覆盖非空字段，保留座位/台账）', 'Merge non-empty fields (keep seats/records)') }}
              </NRadio>
              <NRadio value="skip">{{ bi('跳过已有成员', 'Skip existing') }}</NRadio>
              <NRadio value="append">{{ bi('仍作为新成员追加', 'Append as new') }}</NRadio>
            </NSpace>
          </NRadioGroup>
        </div>

        <NDataTable
          :columns="previewColumns"
          :data="previewRows"
          :pagination="previewPagination"
          :bordered="false"
          size="small"
          :scroll-x="820"
          :max-height="320"
          :row-key="(r: ImportPreviewRow) => r.rowNumber"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-8px">
        <div>
          <NButton v-if="step === 2" size="small" secondary @click="step = 1">
            <template #icon><SvgIcon icon="lucide:arrow-left" /></template>
            {{ bi('重新选文件', 'Change File') }}
          </NButton>
          <NButton v-if="step === 3" size="small" secondary @click="step = 2">
            <template #icon><SvgIcon icon="lucide:arrow-left" /></template>
            {{ bi('返回调整映射', 'Back to Mapping') }}
          </NButton>
        </div>
        <div class="flex items-center gap-8px">
          <NButton size="small" @click="show = false">{{ bi('取消', 'Cancel') }}</NButton>
          <NButton v-if="step === 2" size="small" type="primary" :disabled="!canGoToStep3" @click="step = 3">
            {{ bi('下一步：预览校验', 'Next: Preview') }}
            <template #icon><SvgIcon icon="lucide:arrow-right" /></template>
          </NButton>
          <NButton
            v-if="step === 3"
            size="small"
            type="primary"
            :loading="importing"
            :disabled="previewStats.toInsert === 0 && previewStats.toUpdate === 0"
            @click="executeImport"
          >
            <template #icon><SvgIcon icon="lucide:check" /></template>
            {{
              bi(
                `确认导入（新增 ${previewStats.toInsert} / 更新 ${previewStats.toUpdate}）`,
                `Import (${previewStats.toInsert} new / ${previewStats.toUpdate} updated)`
              )
            }}
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
