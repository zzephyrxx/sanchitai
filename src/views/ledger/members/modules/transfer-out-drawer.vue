<script setup lang="ts">
/**
 * 单人组织关系转出 4 步办理抽屉（v0.3.0）
 * Step 1: 发起申请（转接方式、接收党委与具体支部）
 * Step 2: 党费与档案交接（党费交至年月、档案去向 + 一键生成自提申请书）
 * Step 3: 介绍信 / 线上审核（介绍信编号、挂起为「转出办理中」待办）
 * Step 4: 回执核销并归档（录入回执日期/编号 → 正式移入历史归档，保留全部历史账目）
 */
import { computed, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { buildSelfPickupApplicationText, downloadTextAsDoc } from '@/utils/transfer';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'TransferOutDrawer' });

interface Props {
  show: boolean;
  memberId: string | null;
  transferId?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  transferId: null
});

const emit = defineEmits<{
  'update:show': [val: boolean];
  done: [];
}>();

const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const member = computed(() => (props.memberId ? workStore.memberOf(props.memberId) : undefined));
const existingTransfer = computed(() => {
  if (props.transferId) {
    return workStore.transferRecords.find(r => r.id === props.transferId);
  }
  if (!props.memberId) return undefined;
  return workStore.transferRecords.find(
    r => r.member_id === props.memberId && r.direction === 'out' && r.status === '办理中'
  );
});

const currentStep = ref(1);
const busy = ref(false);

const form = reactive({
  transfer_mode: '线上系统转接' as Sct.TransferMode,
  initiated_date: dayjs().format('YYYY-MM-DD'),
  target_committee: '',
  target_branch: '',
  is_internal: false,
  fee_paid_until: dayjs().format('YYYY-MM'),
  archive_dest: '随人事档案' as Sct.ArchiveDest,
  letter_no: '',
  receipt_received: false,
  receipt_date: dayjs().format('YYYY-MM-DD'),
  receipt_no: '',
  note: ''
});

watch(
  () => [props.show, props.memberId, props.transferId],
  ([visible]) => {
    if (!visible) return;
    const rec = existingTransfer.value;
    if (rec) {
      currentStep.value = Math.min(4, Math.max(1, rec.step ?? 2));
      form.transfer_mode = rec.transfer_mode ?? '线上系统转接';
      form.initiated_date = rec.initiated_date || dayjs().format('YYYY-MM-DD');
      form.target_committee = rec.target_committee ?? '';
      form.target_branch = rec.target_branch ?? '';
      form.is_internal = Boolean(rec.is_internal);
      form.fee_paid_until = rec.fee_paid_until || dayjs().format('YYYY-MM');
      form.archive_dest = rec.archive_dest ?? '随人事档案';
      form.letter_no = rec.letter_no ?? '';
      form.receipt_received = Boolean(rec.receipt_received);
      form.receipt_date = rec.receipt_date || dayjs().format('YYYY-MM-DD');
      form.receipt_no = rec.receipt_no ?? '';
      form.note = rec.note ?? '';
    } else {
      currentStep.value = 1;
      // 自动推导该成员最后已缴党费月份
      const paidMonths = workStore.feeRecords
        .filter(f => f.member_id === props.memberId && f.status === '已缴')
        .map(f => f.year_month)
        .sort();
      form.transfer_mode = '线上系统转接';
      form.initiated_date = dayjs().format('YYYY-MM-DD');
      form.target_committee = '';
      form.target_branch = '';
      form.is_internal = false;
      form.fee_paid_until = paidMonths[paidMonths.length - 1] || dayjs().format('YYYY-MM');
      form.archive_dest = '随人事档案';
      form.letter_no = '';
      form.receipt_received = false;
      form.receipt_date = dayjs().format('YYYY-MM-DD');
      form.receipt_no = '';
      form.note = '';
    }
  },
  { immediate: true }
);

const transferModeOptions = [
  { label: '线上系统转接（省级/全国党建平台）', value: '线上系统转接' },
  { label: '纸质介绍信转接（跨省/无线上系统）', value: '纸质介绍信' },
  { label: '内部调转（本校升学 / 同党委下属支部）', value: '内部调转' }
];

const archiveDestOptions = [
  { label: '随个人人事档案寄出', value: '随人事档案' },
  { label: '个人密封自提（需签自提申请书）', value: '个人自提' },
  { label: '暂存原单位党组织', value: '暂存原单位' },
  { label: '其他去向（备注说明）', value: '其他' }
];

async function saveAsInProgress() {
  if (!member.value) return;
  if (!form.target_branch.trim() && !form.target_committee.trim()) {
    window.$message?.warning('请至少填写接收单位上级党委或具体党支部名称');
    currentStep.value = 1;
    return;
  }
  busy.value = true;
  try {
    await workStore.initiateTransferOut(member.value.id, {
      transferId: existingTransfer.value?.id,
      step: currentStep.value,
      initiated_date: form.initiated_date,
      transfer_mode: form.transfer_mode,
      target_committee: form.target_committee.trim(),
      target_branch: form.target_branch.trim(),
      is_internal: form.is_internal,
      fee_paid_until: form.fee_paid_until.trim(),
      archive_dest: form.archive_dest,
      letter_no: form.letter_no.trim(),
      receipt_received: form.receipt_received,
      receipt_date: form.receipt_date,
      receipt_no: form.receipt_no.trim(),
      note: form.note.trim()
    });
    window.$message?.success(`已保存「${member.value.name}」为转出办理中（已挂入待办提醒）`);
    emit('update:show', false);
    emit('done');
  } finally {
    busy.value = false;
  }
}

async function confirmCompleteAndArchive() {
  if (!member.value) return;
  if (!form.target_branch.trim() && !form.target_committee.trim()) {
    window.$message?.warning('请先填写接收单位上级党委或具体党支部名称后再办结归档');
    currentStep.value = 1;
    return;
  }
  busy.value = true;
  try {
    const id = await workStore.initiateTransferOut(member.value.id, {
      transferId: existingTransfer.value?.id,
      step: 4,
      initiated_date: form.initiated_date,
      transfer_mode: form.transfer_mode,
      target_committee: form.target_committee.trim(),
      target_branch: form.target_branch.trim(),
      is_internal: form.is_internal,
      fee_paid_until: form.fee_paid_until.trim(),
      archive_dest: form.archive_dest,
      letter_no: form.letter_no.trim(),
      receipt_received: true,
      receipt_date: form.receipt_date,
      receipt_no: form.receipt_no.trim(),
      note: form.note.trim()
    });
    await workStore.completeTransferOut(id, {
      receipt_date: form.receipt_date,
      receipt_no: form.receipt_no.trim(),
      note: form.note.trim()
    });
    window.$message?.success(`「${member.value.name}」组织关系转出已办结并移入历史归档（历史台账完整保留）`);
    emit('update:show', false);
    emit('done');
  } finally {
    busy.value = false;
  }
}

async function handleCancelTransfer() {
  if (!existingTransfer.value) return;
  busy.value = true;
  try {
    await workStore.cancelTransferOut(existingTransfer.value.id);
    window.$message?.success('已撤回转出办理，成员恢复为在册正常');
    emit('update:show', false);
    emit('done');
  } finally {
    busy.value = false;
  }
}

async function exportSelfPickupDoc() {
  if (!member.value) return;
  const draftTransfer: Sct.TransferRecord = {
    id: existingTransfer.value?.id ?? 'draft',
    member_id: member.value.id,
    direction: 'out',
    status: '办理中',
    initiated_date: form.initiated_date,
    target_committee: form.target_committee,
    target_branch: form.target_branch,
    fee_paid_until: form.fee_paid_until,
    archive_dest: form.archive_dest
  };
  const content = buildSelfPickupApplicationText({
    branchName: workStore.branchName,
    member: member.value,
    transfer: draftTransfer
  });
  const res = await downloadTextAsDoc(`${member.value.name}_党员档案自提申请书.doc`, '党员档案自提申请书', content);
  if (res === 'saved') {
    window.$message?.success('《党员档案自提申请书》已导出');
  }
}
</script>

<template>
  <NDrawer :show="show" :width="540" class="max-w-96vw" @update:show="val => emit('update:show', val)">
    <NDrawerContent
      v-if="member"
      :title="bi(`组织关系转出办理 · ${member.name}`, `Org Transfer Out · ${member.name}`)"
      closable
    >
      <div class="flex flex-col gap-16px">
        <!-- 顶部 4 步进度条 -->
        <div class="grid grid-cols-4 gap-6px">
          <button
            v-for="s in [
              { n: 1, title: '1. 发起申请' },
              { n: 2, title: '2. 党费档案' },
              { n: 3, title: '3. 介绍信审核' },
              { n: 4, title: '4. 回执归档' }
            ]"
            :key="s.n"
            type="button"
            class="transfer-step-btn"
            :class="{ 'is-active': currentStep === s.n, 'is-done': currentStep > s.n }"
            @click="currentStep = s.n"
          >
            {{ s.title }}
          </button>
        </div>

        <!-- 成员信息摘要条 -->
        <div
          class="flex flex-wrap items-center justify-between gap-8px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-8px text-12px"
        >
          <div class="flex items-center gap-8px">
            <span class="font-bold text-[var(--sct-ink)]">{{ member.name }}</span>
            <NTag size="tiny" :bordered="false">{{ member.type }}</NTag>
            <span class="font-mono text-[var(--sct-muted)]">{{ member.code }}</span>
          </div>
          <span class="text-[var(--sct-muted)]">
            {{ bi('办结后自动归档，历史党费/考勤/发展记录永久留存', 'History stays intact after archive') }}
          </span>
        </div>

        <!-- Step 1 -->
        <NForm v-if="currentStep === 1" label-placement="left" label-width="116" size="small">
          <NFormItem required>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:send" class="sct-field-icon" />
                转接方式
              </span>
            </template>
            <NSelect v-model:value="form.transfer_mode" :options="transferModeOptions" />
          </NFormItem>
          <NFormItem required>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:calendar" class="sct-field-icon" />
                发起日期
              </span>
            </template>
            <NDatePicker
              v-model:formatted-value="form.initiated_date"
              type="date"
              value-format="yyyy-MM-dd"
              class="w-full"
            />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:landmark" class="sct-field-icon" />
                接收上级党委
              </span>
            </template>
            <NInput v-model:value="form.target_committee" placeholder="如：中共某某单位委员会 / 县区委组织部" />
          </NFormItem>
          <NFormItem required>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:building-2" class="sct-field-icon" />
                接收具体支部
              </span>
            </template>
            <NInput v-model:value="form.target_branch" placeholder="如：中共某某公司第一党支部" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:repeat" class="sct-field-icon" />
                内部升学/调转
              </span>
            </template>
            <NSwitch v-model:value="form.is_internal" />
          </NFormItem>
        </NForm>

        <!-- Step 2 -->
        <div v-else-if="currentStep === 2" class="flex flex-col gap-12px">
          <NForm label-placement="left" label-width="116" size="small">
            <NFormItem>
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:coins" class="sct-field-icon" />
                  党费交至年月
                </span>
              </template>
              <NInput v-model:value="form.fee_paid_until" placeholder="YYYY-MM，如 2026-06" />
            </NFormItem>
            <NFormItem>
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:folder-archive" class="sct-field-icon" />
                  党员档案去向
                </span>
              </template>
              <NSelect v-model:value="form.archive_dest" :options="archiveDestOptions" />
            </NFormItem>
          </NForm>
          <div
            v-if="form.archive_dest === '个人自提'"
            class="flex items-center justify-between gap-10px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-warn-soft)] px-12px py-10px"
          >
            <div class="text-12px text-[var(--sct-ink)]">
              已选择「个人密封自提」，建议打印并留存本人签字的《党员档案自提申请书》。
            </div>
            <NButton size="tiny" type="warning" secondary @click="exportSelfPickupDoc">
              <template #icon><SvgIcon icon="lucide:file-down" /></template>
              导出申请书 (.doc)
            </NButton>
          </div>
        </div>

        <!-- Step 3 -->
        <NForm v-else-if="currentStep === 3" label-placement="left" label-width="116" size="small">
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:hash" class="sct-field-icon" />
                介绍信编号
              </span>
            </template>
            <NInput v-model:value="form.letter_no" placeholder="线上转接可填系统流水号，纸质填介绍信编号" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:file-text" class="sct-field-icon" />
                办理备注
              </span>
            </template>
            <NInput
              v-model:value="form.note"
              type="textarea"
              :rows="3"
              placeholder="如：已于系统提交待对方党委审批 / 纸质介绍信已邮寄"
            />
          </NFormItem>
          <NAlert type="info" :show-icon="true">
            若对方支部尚未接收或纸质回执联尚未寄回，可点击下方「暂存为转出办理中」，成员将出现在「转出中」红点列表与总览待办提醒中。
          </NAlert>
        </NForm>

        <!-- Step 4 -->
        <div v-else class="flex flex-col gap-12px">
          <NForm label-placement="left" label-width="116" size="small">
            <NFormItem>
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:calendar-check" class="sct-field-icon" />
                  回执/办结日期
                </span>
              </template>
              <NDatePicker
                v-model:formatted-value="form.receipt_date"
                type="date"
                value-format="yyyy-MM-dd"
                class="w-full"
              />
            </NFormItem>
            <NFormItem>
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:receipt" class="sct-field-icon" />
                  回执联编号
                </span>
              </template>
              <NInput v-model:value="form.receipt_no" placeholder="纸质介绍信回执编号或线上办结单号（选填）" />
            </NFormItem>
            <NFormItem>
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:sticky-note" class="sct-field-icon" />
                  归档备注
                </span>
              </template>
              <NInput v-model:value="form.note" type="textarea" :rows="2" />
            </NFormItem>
          </NForm>
          <NAlert type="success" :show-icon="true">
            点击「确认办结并归档」后：该成员将退出当前在册花名册、座位图与未来党费/考勤名单，但其历史年份的党费、考勤、发展材料、谈话、积分与志愿记录将完整留存在「历史归档库」中。
          </NAlert>
        </div>
      </div>

      <template #footer>
        <div class="w-full flex flex-wrap items-center justify-between gap-8px">
          <div class="flex items-center gap-6px">
            <NPopconfirm v-if="existingTransfer" @positive-click="handleCancelTransfer">
              <template #trigger>
                <NButton size="small" quaternary type="error" :disabled="busy">撤回转出</NButton>
              </template>
              确认撤回本次转出申请并将成员恢复为「在册正常」？
            </NPopconfirm>
            <NButton v-if="currentStep > 1" size="small" secondary @click="currentStep -= 1">上一步</NButton>
          </div>
          <div class="flex items-center gap-8px">
            <NButton size="small" secondary :loading="busy" @click="saveAsInProgress">暂存为转出办理中</NButton>
            <NButton v-if="currentStep < 4" size="small" type="primary" @click="currentStep += 1">下一步</NButton>
            <NButton v-else size="small" type="primary" :loading="busy" @click="confirmCompleteAndArchive">
              <template #icon><SvgIcon icon="lucide:archive" /></template>
              确认办结并归档
            </NButton>
          </div>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.transfer-step-btn {
  padding: 7px 6px;
  font-size: 12px;
  font-weight: 600;
  border-radius: var(--sct-radius, 6px);
  border: 1px solid var(--sct-border);
  background: var(--sct-page);
  color: var(--sct-muted);
  cursor: pointer;
  transition: all 0.14s ease;
}
.transfer-step-btn.is-active {
  border-color: var(--sct-accent);
  background: var(--sct-container);
  color: var(--sct-ink);
  box-shadow: inset 0 -2px 0 var(--sct-accent);
}
.transfer-step-btn.is-done {
  border-color: #16a34a;
  color: #16a34a;
  background: var(--sct-ok-soft);
}
</style>
