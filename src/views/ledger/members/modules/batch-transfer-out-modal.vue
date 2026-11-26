<script setup lang="ts">
/**
 * 毕业季批量关系转出工作台（v0.3.0）
 * 支持按年级/身份筛选多选成员、统设默认参数、行内填写接收单位与档案去向、批量办理及一键导出《组织关系转接登记表》
 */
import { computed, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { exportTransferRegistryExcel } from '@/utils/transfer';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import PrivacyExportModal from '@/components/custom/privacy-export-modal.vue';

defineOptions({ name: 'BatchTransferOutModal' });

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ 'update:show': [val: boolean]; done: [] }>();

const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const gradeFilter = ref('');
const selectedIds = ref<string[]>([]);
const completeImmediately = ref(false);
const defaultDate = ref(dayjs().format('YYYY-MM-DD'));
const defaultFeeUntil = ref(dayjs().format('YYYY-MM'));
const defaultMode = ref<Sct.TransferMode>('线上系统转接');
const defaultArchiveDest = ref<Sct.ArchiveDest>('随人事档案');
const busy = ref(false);

interface RowDraft {
  target_committee: string;
  target_branch: string;
  archive_dest: Sct.ArchiveDest;
  is_internal: boolean;
}
const rowDrafts = reactive<Record<string, RowDraft>>({});

const exportModalShow = ref(false);
const lastCreatedRecords = ref<Sct.TransferRecord[]>([]);

const candidateMembers = computed(() =>
  workStore.activeMembers.filter(m => !gradeFilter.value || (m.grade ?? '') === gradeFilter.value)
);

const gradeOptions = computed(() => {
  const grades = Array.from(new Set(workStore.activeMembers.map(m => (m.grade ?? '').trim()).filter(Boolean))).sort();
  return [{ label: '全部年级', value: '' }, ...grades.map(g => ({ label: g, value: g }))];
});

watch(
  () => props.show,
  visible => {
    if (!visible) return;
    selectedIds.value = [];
    lastCreatedRecords.value = [];
    for (const m of workStore.activeMembers) {
      if (!rowDrafts[m.id]) {
        rowDrafts[m.id] = {
          target_committee: '',
          target_branch: '',
          archive_dest: defaultArchiveDest.value,
          is_internal: false
        };
      }
    }
  }
);

function toggleMember(id: string) {
  const idx = selectedIds.value.indexOf(id);
  if (idx >= 0) {
    selectedIds.value.splice(idx, 1);
  } else {
    selectedIds.value.push(id);
    if (!rowDrafts[id]) {
      rowDrafts[id] = {
        target_committee: '',
        target_branch: '',
        archive_dest: defaultArchiveDest.value,
        is_internal: false
      };
    }
  }
}

function selectAllFiltered() {
  selectedIds.value = candidateMembers.value.map(m => m.id);
  for (const m of candidateMembers.value) {
    if (!rowDrafts[m.id]) {
      rowDrafts[m.id] = {
        target_committee: '',
        target_branch: '',
        archive_dest: defaultArchiveDest.value,
        is_internal: false
      };
    }
  }
}

function applyDefaultArchiveToSelected() {
  for (const id of selectedIds.value) {
    if (rowDrafts[id]) {
      rowDrafts[id].archive_dest = defaultArchiveDest.value;
    }
  }
  window.$message?.success('已将默认档案去向套用到所有已选成员');
}

async function handleSubmitBatch() {
  if (!selectedIds.value.length) {
    window.$message?.warning('请至少勾选一位要办理关系转出的成员');
    return;
  }
  busy.value = true;
  try {
    const items = selectedIds.value.map(id => {
      const d = rowDrafts[id] ?? {
        target_committee: '',
        target_branch: '',
        archive_dest: defaultArchiveDest.value,
        is_internal: false
      };
      return {
        member_id: id,
        transfer_mode: defaultMode.value,
        target_committee: d.target_committee.trim(),
        target_branch: d.target_branch.trim(),
        fee_paid_until: defaultFeeUntil.value.trim(),
        initiated_date: defaultDate.value,
        archive_dest: d.archive_dest,
        is_internal: d.is_internal,
        completeImmediately: completeImmediately.value
      };
    });
    const created = await workStore.batchInitiateTransferOut(items);
    lastCreatedRecords.value = created;
    window.$message?.success(
      completeImmediately.value
        ? `已批量办结 ${created.length} 名成员关系转出并归档（历史台账已保留）`
        : `已批量发起 ${created.length} 名成员关系转出（进入「转出办理中」追踪）`
    );
    emit('done');
  } finally {
    busy.value = false;
  }
}

async function handleExportBatchRegistry(mode: Sct.ExportPrivacyMode) {
  const sourceRecs = lastCreatedRecords.value.length
    ? lastCreatedRecords.value
    : selectedIds.value.map(id => {
        const d = rowDrafts[id];
        return {
          id: `preview-${id}`,
          member_id: id,
          direction: 'out' as const,
          status: (completeImmediately.value ? '已完成' : '办理中') as Sct.TransferStatus,
          initiated_date: defaultDate.value,
          transfer_mode: defaultMode.value,
          target_committee: d?.target_committee ?? '',
          target_branch: d?.target_branch ?? '',
          fee_paid_until: defaultFeeUntil.value,
          archive_dest: d?.archive_dest ?? defaultArchiveDest.value,
          is_internal: Boolean(d?.is_internal),
          receipt_received: completeImmediately.value
        };
      });

  const res = await exportTransferRegistryExcel({
    branchName: workStore.branchName,
    records: sourceRecs.map(r => ({ transfer: r, member: workStore.memberOf(r.member_id) })),
    privacyMode: mode
  });
  if (res === 'saved') {
    exportModalShow.value = false;
    window.$message?.success('《组织关系转接登记表》已导出');
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="bi('毕业季 / 批量组织关系转出工作台', 'Batch Organization Transfer Out')"
    class="w-920px max-w-96vw"
    @update:show="val => emit('update:show', val)"
  >
    <div class="flex flex-col gap-12px">
      <!-- 顶部批量默认值栏 -->
      <div
        class="flex flex-wrap items-center gap-10px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-10px"
      >
        <div class="w-130px">
          <NSelect v-model:value="gradeFilter" :options="gradeOptions" size="small" placeholder="筛选年级" />
        </div>
        <NDatePicker
          v-model:formatted-value="defaultDate"
          type="date"
          value-format="yyyy-MM-dd"
          size="small"
          class="w-135px"
        />
        <NInput v-model:value="defaultFeeUntil" size="small" class="w-120px" placeholder="党费交至 YYYY-MM" />
        <NSelect
          v-model:value="defaultMode"
          size="small"
          class="w-140px"
          :options="[
            { label: '线上系统转接', value: '线上系统转接' },
            { label: '纸质介绍信', value: '纸质介绍信' },
            { label: '内部调转', value: '内部调转' }
          ]"
        />
        <NSelect
          v-model:value="defaultArchiveDest"
          size="small"
          class="w-130px"
          :options="[
            { label: '随人事档案', value: '随人事档案' },
            { label: '个人自提', value: '个人自提' },
            { label: '暂存原单位', value: '暂存原单位' },
            { label: '其他', value: '其他' }
          ]"
        />
        <NButton size="tiny" secondary @click="applyDefaultArchiveToSelected">套用到已选</NButton>
        <div class="ml-auto flex items-center gap-6px">
          <NButton size="tiny" secondary @click="selectAllFiltered">全选当前({{ candidateMembers.length }})</NButton>
          <NButton size="tiny" quaternary @click="selectedIds = []">清空</NButton>
        </div>
      </div>

      <!-- 候选成员选择芯片 -->
      <div
        class="max-h-140px flex flex-wrap gap-6px overflow-y-auto rounded-8px border border-[var(--sct-border)] p-8px"
      >
        <button
          v-for="m in candidateMembers"
          :key="m.id"
          type="button"
          class="batch-chip"
          :class="{ 'is-selected': selectedIds.includes(m.id) }"
          @click="toggleMember(m.id)"
        >
          <span>{{ m.name }}</span>
          <span class="text-10px opacity-75">{{ m.grade || m.type }}</span>
        </button>
        <span v-if="!candidateMembers.length" class="text-12px text-[var(--sct-muted)]">当前筛选下无在册成员</span>
      </div>

      <!-- 已选成员逐行填报明细 -->
      <div v-if="selectedIds.length" class="max-h-290px overflow-y-auto rounded-8px border border-[var(--sct-border)]">
        <table class="w-full border-collapse text-12px">
          <thead>
            <tr
              class="border-b border-[var(--sct-border)] bg-[var(--sct-soft)] text-left text-11px text-[var(--sct-muted)]"
            >
              <th class="px-10px py-7px w-90px">姓名</th>
              <th class="px-8px py-7px">接收上级党委</th>
              <th class="px-8px py-7px">接收具体党支部</th>
              <th class="px-8px py-7px w-130px">档案去向</th>
              <th class="px-8px py-7px w-70px text-center">内部调转</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="id in selectedIds" :key="id" class="border-b border-[var(--sct-border)] last:border-b-0">
              <td class="px-10px py-6px font-semibold">
                {{ workStore.memberOf(id)?.name }}
              </td>
              <td class="px-8px py-6px">
                <NInput v-model:value="rowDrafts[id].target_committee" size="tiny" placeholder="上级党委（选填）" />
              </td>
              <td class="px-8px py-6px">
                <NInput v-model:value="rowDrafts[id].target_branch" size="tiny" placeholder="接收具体支部" />
              </td>
              <td class="px-8px py-6px">
                <NSelect
                  v-model:value="rowDrafts[id].archive_dest"
                  size="tiny"
                  :options="[
                    { label: '随人事档案', value: '随人事档案' },
                    { label: '个人自提', value: '个人自提' },
                    { label: '暂存原单位', value: '暂存原单位' },
                    { label: '其他', value: '其他' }
                  ]"
                />
              </td>
              <td class="px-8px py-6px text-center">
                <NCheckbox v-model:checked="rowDrafts[id].is_internal" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-10px">
        <NCheckbox v-model:checked="completeImmediately">
          <span class="text-12px">回执均已收回，直接一步办结并移入历史归档（默认挂入「转出办理中」）</span>
        </NCheckbox>
        <NButton
          size="small"
          secondary
          :disabled="!selectedIds.length && !lastCreatedRecords.length"
          @click="exportModalShow = true"
        >
          <template #icon><SvgIcon icon="lucide:file-spreadsheet" /></template>
          导出《组织关系转接登记表》
        </NButton>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <span class="text-12px text-[var(--sct-muted)]">已选 {{ selectedIds.length }} 人</span>
        <div class="flex items-center gap-8px">
          <NButton size="small" @click="emit('update:show', false)">关闭</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="busy"
            :disabled="!selectedIds.length"
            @click="handleSubmitBatch"
          >
            <template #icon><SvgIcon icon="lucide:send" /></template>
            {{ completeImmediately ? '批量办结并归档' : '批量发起转出' }}
          </NButton>
        </div>
      </div>
    </template>
  </NModal>

  <PrivacyExportModal
    v-model:show="exportModalShow"
    title="导出《组织关系转接登记表》"
    summary="关系转接登记表包含身份证号与联系电话字段。公开汇总请选择「脱敏公示版」，上报上级党委组织部审核时请切换「全量报送版」。"
    @confirm="handleExportBatchRegistry"
  />
</template>

<style scoped>
.batch-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--sct-radius, 6px);
  border: 1px solid var(--sct-border);
  background: var(--sct-page);
  color: var(--sct-ink);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.batch-chip:hover {
  border-color: var(--sct-ink);
}
.batch-chip.is-selected {
  border-color: #a81c24;
  background: var(--sct-err-soft);
  color: #a81c24;
  font-weight: 600;
}
</style>
