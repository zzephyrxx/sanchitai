<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import {
  POINT_BUCKETS,
  POINT_BUCKET_MAP,
  POINT_CATEGORY_META,
  POINT_PASS_LINE,
  POINT_VERIFY_STATUS_OPTIONS
} from '@/constants/party-points';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';
import { computeMemberYearPoints, computeRuleSuggestedScore, formatScore, roundScore } from '@/utils/party-points';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'MemberPointsDrawer' });

interface Props {
  memberId: string | null;
  year: number;
}

const props = defineProps<Props>();
const show = defineModel<boolean>('show', { required: true });

const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const member = computed(() => (props.memberId ? workStore.memberOf(props.memberId) : undefined));

const veto = computed(() =>
  props.memberId ? workStore.pointVetoes.find(v => v.member_id === props.memberId && v.year === props.year) : undefined
);

const summary = computed(() => {
  if (!member.value) return null;
  return computeMemberYearPoints(member.value, props.year, workStore.pointRecords, veto.value);
});

const memberRecords = computed(() => {
  if (!props.memberId) return [];
  return workStore.pointRecords
    .filter(r => r.member_id === props.memberId && r.year === props.year)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
});

const statusFilter = ref<'all' | Sct.PointVerifyStatus>('all');
const filteredRecords = computed(() => {
  if (statusFilter.value === 'all') return memberRecords.value;
  return memberRecords.value.filter(r => r.status === statusFilter.value);
});

// ---------------- 一票否决控制 ----------------
const vetoActiveDraft = ref(false);
const vetoReasonDraft = ref('');
watch(
  [veto, () => props.memberId, () => props.year],
  () => {
    vetoActiveDraft.value = Boolean(veto.value?.active);
    vetoReasonDraft.value = veto.value?.reason ?? '';
  },
  { immediate: true }
);

async function handleToggleVeto(val: boolean) {
  if (!props.memberId) return;
  vetoActiveDraft.value = val;
  if (!val) {
    vetoReasonDraft.value = '';
    await workStore.setPointVeto(props.memberId, props.year, false, '');
    window.$message?.success('已解除本年度一票否决标记');
  } else {
    await workStore.setPointVeto(props.memberId, props.year, true, vetoReasonDraft.value);
    window.$message?.warning('已标记一票否决：本年度基础分已归零');
  }
}

async function saveVetoReason() {
  if (!props.memberId || !vetoActiveDraft.value) return;
  await workStore.setPointVeto(props.memberId, props.year, true, vetoReasonDraft.value);
  window.$message?.success('一票否决事由已保存');
}

// ---------------- 快速切换认定状态 ----------------
async function handleQuickStatusChange(record: Sct.PointRecord, nextStatus: Sct.PointVerifyStatus) {
  if (record.status === nextStatus) return;
  await workStore.updatePointRecord(record.id, { status: nextStatus });
  window.$message?.success(`已将「${record.content || record.rule_label}」更新为「${nextStatus}」`);
}

async function handleDeleteRecord(record: Sct.PointRecord) {
  await workStore.deletePointRecord(record.id);
  window.$message?.success('已删除该条积分记录');
}

// ---------------- 新增 / 编辑单条积分弹窗 ----------------
const recordModalShow = ref(false);
const editingRecordId = ref<string | null>(null);

const recordForm = reactive<{
  category: Sct.PointCategory;
  rule_id: string;
  sub_category: Sct.PointSubCategory;
  rule_label: string;
  date: string;
  content: string;
  score: number;
  status: Sct.PointVerifyStatus;
  note: string;
  calcCount: number;
  calcRole: 'core' | 'member';
  calcHours: number;
}>({
  category: 'duty',
  rule_id: '',
  sub_category: 'duty_study',
  rule_label: '',
  date: dayjs().format('YYYY-MM-DD'),
  content: '',
  score: 1,
  status: '已认定',
  note: '',
  calcCount: 1,
  calcRole: 'core',
  calcHours: 20
});

const categoryOptions: Array<{ label: string; value: Sct.PointCategory }> = [
  { label: '履职分（加分项，上限 40）', value: 'duty' },
  { label: '基础分（扣分项，初始 60）', value: 'base' },
  { label: '附加分（先进典型 / 支委履职）', value: 'bonus' },
  { label: '减扣分（通报批评等）', value: 'penalty' }
];

const enabledRulesOfCat = computed(() =>
  workStore.pointRules.filter(r => r.category === recordForm.category && r.enabled !== false)
);

const ruleSelectOptions = computed(() => [
  ...enabledRulesOfCat.value.map(r => ({
    label: `${r.label}（${formatScore(r.default_score, true)}分）`,
    value: r.id
  })),
  { label: '自定义事项（手动填写子项与分值）', value: '__custom__' }
]);

const subBucketOptions = computed(() =>
  POINT_BUCKETS.filter(b => b.category === recordForm.category).map(b => ({
    label: b.label,
    value: b.key
  }))
);

const selectedRule = computed(() =>
  recordForm.rule_id && recordForm.rule_id !== '__custom__'
    ? workStore.pointRules.find(r => r.id === recordForm.rule_id)
    : undefined
);

function defaultDateForYear(year: number): string {
  const now = dayjs();
  return now.year() === year ? now.format('YYYY-MM-DD') : `${year}-${now.format('MM-DD')}`;
}

function recalcSuggestedScore() {
  const rule = selectedRule.value;
  if (!rule) return;
  recordForm.score = computeRuleSuggestedScore(rule, {
    count: recordForm.calcCount,
    role: recordForm.calcRole,
    hours: recordForm.calcHours
  });
}

function onRecordCategoryChange(cat: Sct.PointCategory) {
  recordForm.category = cat;
  const firstRule = workStore.pointRules.find(r => r.category === cat && r.enabled !== false);
  if (firstRule) {
    onRuleSelect(firstRule.id);
  } else {
    recordForm.rule_id = '__custom__';
    const firstBucket = POINT_BUCKETS.find(b => b.category === cat);
    if (firstBucket) recordForm.sub_category = firstBucket.key;
    recordForm.rule_label = '自定义事项';
    recordForm.score = cat === 'base' || cat === 'penalty' ? -1 : 1;
  }
}

function onRuleSelect(ruleId: string) {
  recordForm.rule_id = ruleId;
  if (ruleId === '__custom__') {
    const firstBucket = POINT_BUCKETS.find(b => b.category === recordForm.category);
    if (firstBucket) recordForm.sub_category = firstBucket.key;
    recordForm.rule_label = '自定义事项';
    recordForm.score = recordForm.category === 'base' || recordForm.category === 'penalty' ? -1 : 1;
    return;
  }
  const rule = workStore.pointRules.find(r => r.id === ruleId);
  if (!rule) return;
  recordForm.sub_category = rule.sub_category;
  recordForm.rule_label = rule.label;
  recordForm.calcCount = 1;
  recordForm.calcRole = 'core';
  recordForm.calcHours = 20;
  recalcSuggestedScore();
}

function openAddRecord(presetCategory: Sct.PointCategory = 'duty') {
  editingRecordId.value = null;
  recordForm.date = defaultDateForYear(props.year);
  recordForm.content = '';
  recordForm.status = '已认定';
  recordForm.note = '';
  onRecordCategoryChange(presetCategory);
  recordModalShow.value = true;
}

function openEditRecord(rec: Sct.PointRecord) {
  editingRecordId.value = rec.id;
  recordForm.category = rec.category;
  recordForm.rule_id = rec.rule_id && workStore.pointRules.some(r => r.id === rec.rule_id) ? rec.rule_id : '__custom__';
  recordForm.sub_category = rec.sub_category;
  recordForm.rule_label = rec.rule_label;
  recordForm.date = rec.date;
  recordForm.content = rec.content;
  recordForm.score = rec.score;
  recordForm.status = rec.status;
  recordForm.note = rec.note ?? '';
  recordForm.calcCount = rec.calc_meta?.count ?? 1;
  recordForm.calcRole = rec.calc_meta?.role ?? 'core';
  recordForm.calcHours = rec.calc_meta?.hours ?? 20;
  recordModalShow.value = true;
}

async function handleSaveRecord() {
  if (!props.memberId) return;
  const cleanContent = recordForm.content.trim();
  if (!cleanContent) {
    window.$message?.warning('请填写活动内容或事项说明');
    return;
  }
  const rawScore = roundScore(Number(recordForm.score) || 0);
  const signedScore =
    recordForm.category === 'base' || recordForm.category === 'penalty' ? -Math.abs(rawScore) : Math.abs(rawScore);

  const rule = selectedRule.value;
  const calcMeta =
    rule?.calc_mode === 'count'
      ? { count: recordForm.calcCount, base_score: rule.default_score }
      : rule?.calc_mode === 'role_half'
        ? { role: recordForm.calcRole, base_score: rule.default_score }
        : rule?.calc_mode === 'hours_20'
          ? { hours: recordForm.calcHours, base_score: rule.default_score }
          : undefined;

  const payload = {
    member_id: props.memberId,
    year: props.year,
    date: recordForm.date || defaultDateForYear(props.year),
    category: recordForm.category,
    sub_category: recordForm.sub_category,
    rule_id: recordForm.rule_id === '__custom__' ? undefined : recordForm.rule_id,
    rule_label: rule ? rule.label : recordForm.rule_label.trim() || '自定义事项',
    content: cleanContent,
    score: signedScore,
    status: recordForm.status,
    calc_meta: calcMeta,
    note: recordForm.note.trim() || undefined
  };

  if (editingRecordId.value) {
    await workStore.updatePointRecord(editingRecordId.value, payload);
    window.$message?.success('积分记录已更新');
  } else {
    await workStore.addPointRecord(payload);
    window.$message?.success('积分记录已登记');
  }
  recordModalShow.value = false;
}

function statusTagType(status: Sct.PointVerifyStatus): 'success' | 'warning' | 'error' {
  return POINT_VERIFY_STATUS_OPTIONS.find(o => o.value === status)?.tagType ?? 'success';
}
</script>

<template>
  <NDrawer v-model:show="show" :width="680" placement="right">
    <NDrawerContent v-if="member && summary" closable>
      <template #header>
        <div class="flex flex-wrap items-center gap-8px">
          <span class="inline-block size-9px rounded-full" :style="{ background: MEMBER_TYPE_COLORS[member.type] }" />
          <span class="text-16px font-bold">{{ member.name }}</span>
          <NTag size="small" :bordered="false">{{ member.type }}</NTag>
          <NTag size="small" :bordered="false" type="info">{{ year }} 年度</NTag>
          <span v-if="member.student_id" class="text-12px text-gray-400 font-mono">{{ member.student_id }}</span>
        </div>
      </template>

      <div class="flex flex-col gap-14px">
        <!-- 年度总分与四大项构成 -->
        <div
          class="rounded-10px border p-12px"
          :class="
            summary.isWarning ? 'border-[#dc2626]/40 bg-[#dc2626]/5' : 'border-[var(--sct-border)] bg-[var(--sct-soft)]'
          "
        >
          <div class="flex flex-wrap items-center justify-between gap-10px">
            <div>
              <div class="text-12px text-gray-500">{{ year }} 年度总积分（仅统计「已认定」条目）</div>
              <div class="mt-2px flex items-baseline gap-8px">
                <span
                  class="text-30px font-extrabold font-mono leading-none"
                  :style="{ color: summary.isWarning ? '#dc2626' : '#A81C24' }"
                >
                  {{ formatScore(summary.totalScore) }}
                </span>
                <span class="text-12px text-gray-500">分</span>
                <NTag v-if="summary.vetoActive" size="small" type="error">一票否决 · 基础分清零</NTag>
                <NTag v-else-if="summary.totalScore < POINT_PASS_LINE" size="small" type="error">
                  低于 {{ POINT_PASS_LINE }} 分 · 民主评议不合格预警
                </NTag>
                <NTag v-else size="small" type="success">合格</NTag>
              </div>
            </div>

            <div class="grid grid-cols-4 gap-8px text-center">
              <div class="rounded-8px bg-[var(--sct-surface)] px-10px py-6px">
                <div class="text-11px text-gray-400">基础分</div>
                <div class="text-15px font-bold font-mono text-[#2563eb]">{{ formatScore(summary.baseScore) }}</div>
              </div>
              <div class="rounded-8px bg-[var(--sct-surface)] px-10px py-6px">
                <div class="text-11px text-gray-400">履职分</div>
                <div class="text-15px font-bold font-mono text-[#16a34a]">+{{ formatScore(summary.dutyScore) }}</div>
              </div>
              <div class="rounded-8px bg-[var(--sct-surface)] px-10px py-6px">
                <div class="text-11px text-gray-400">附加分</div>
                <div class="text-15px font-bold font-mono text-[#d97706]">+{{ formatScore(summary.bonusScore) }}</div>
              </div>
              <div class="rounded-8px bg-[var(--sct-surface)] px-10px py-6px">
                <div class="text-11px text-gray-400">减扣分</div>
                <div class="text-15px font-bold font-mono text-[#dc2626]">
                  {{ summary.penaltyDeduction ? `-${formatScore(summary.penaltyDeduction)}` : '0' }}
                </div>
              </div>
            </div>
          </div>

          <!-- 子项封顶明细 -->
          <div class="mt-10px grid grid-cols-1 gap-8px border-t border-[var(--sct-border)] pt-10px sm:grid-cols-2">
            <div>
              <div class="mb-4px text-11px font-semibold text-gray-500">基础分 5 子项（初始 60，各自扣至 0）</div>
              <div class="flex flex-col gap-3px text-12px">
                <div v-for="b in summary.baseBuckets" :key="b.key" class="flex items-center justify-between gap-6px">
                  <span class="truncate text-gray-600 dark:text-gray-300">{{ b.shortLabel }}</span>
                  <span class="shrink-0 font-mono">
                    <b :class="b.raw > 0 ? 'text-[#dc2626]' : ''">{{ formatScore(b.effective) }}</b>
                    <span class="text-gray-400">/ {{ b.cap }}</span>
                    <span v-if="b.raw > 0" class="ml-4px text-11px text-[#dc2626]">(扣{{ formatScore(b.raw) }})</span>
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div class="mb-4px text-11px font-semibold text-gray-500">
                履职分 3 大类（15 / 10 / 15 封顶，合计 ≤ 40）
              </div>
              <div class="flex flex-col gap-5px text-12px">
                <div v-for="b in summary.dutyBuckets" :key="b.key">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-600 dark:text-gray-300">{{ b.shortLabel }}</span>
                    <span class="font-mono">
                      <b class="text-[#16a34a]">{{ formatScore(b.effective) }}</b>
                      <span class="text-gray-400">/ {{ b.cap }}</span>
                      <span v-if="b.capped" class="ml-4px text-10px text-[#d97706]">
                        (已封顶，原{{ formatScore(b.raw) }})
                      </span>
                    </span>
                  </div>
                  <div class="mt-2px h-4px w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      class="h-full rounded-full bg-[#16a34a] transition-all"
                      :style="{ width: `${Math.min(100, (b.effective / b.cap) * 100)}%` }"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 一票否决栏 -->
        <div class="flex flex-col gap-6px rounded-8px border border-[var(--sct-border)] px-12px py-8px">
          <div class="flex items-center justify-between gap-8px">
            <div class="flex items-center gap-6px text-12px">
              <SvgIcon icon="lucide:shield-alert" class="text-14px text-[#dc2626]" />
              <span class="font-semibold">一票否决（违反国家法律法规受处分者，本年度基础分清零）</span>
            </div>
            <NSwitch :value="vetoActiveDraft" size="small" @update:value="handleToggleVeto" />
          </div>
          <div v-if="vetoActiveDraft" class="flex items-center gap-6px">
            <NInput
              v-model:value="vetoReasonDraft"
              size="small"
              placeholder="填写一票否决具体事由与处分文号…"
              maxlength="100"
              @keyup.enter="saveVetoReason"
            />
            <NButton size="small" type="error" secondary @click="saveVetoReason">保存事由</NButton>
          </div>
        </div>

        <!-- 明细工具栏 -->
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <div class="flex flex-wrap items-center gap-6px">
            <NRadioGroup v-model:value="statusFilter" size="small">
              <NRadioButton value="all">全部 ({{ memberRecords.length }})</NRadioButton>
              <NRadioButton value="已认定">已认定 ({{ summary.approvedCount }})</NRadioButton>
              <NRadioButton value="待核实">待核实 ({{ summary.pendingCount }})</NRadioButton>
              <NRadioButton value="未通过">未通过 ({{ summary.rejectedCount }})</NRadioButton>
            </NRadioGroup>
          </div>
          <div class="flex items-center gap-6px">
            <NButton size="small" secondary @click="openAddRecord('base')">
              <template #icon><SvgIcon icon="lucide:minus-circle" /></template>
              记扣分
            </NButton>
            <NButton size="small" type="primary" @click="openAddRecord('duty')">
              <template #icon><SvgIcon icon="lucide:plus" /></template>
              {{ bi('登记一条积分', 'Add Point Record') }}
            </NButton>
          </div>
        </div>

        <!-- 积分申报与认定明细列表（对照附件 2） -->
        <div
          v-if="!filteredRecords.length"
          class="rounded-8px border border-dashed border-[var(--sct-border)] py-28px text-center text-13px text-gray-400"
        >
          暂无符合条件的积分记录，点击右上角「登记一条积分」或「记扣分」录入。
        </div>

        <div v-else class="flex flex-col gap-8px">
          <div
            v-for="rec in filteredRecords"
            :key="rec.id"
            class="rounded-8px border border-[var(--sct-border)] p-10px transition"
            :class="rec.status === '未通过' ? 'opacity-60' : ''"
          >
            <div class="flex items-start justify-between gap-10px">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-6px">
                  <span class="text-12px text-gray-400 font-mono">{{ rec.date }}</span>
                  <NTag size="tiny" :bordered="false" :type="POINT_CATEGORY_META[rec.category].tagType">
                    {{ POINT_BUCKET_MAP[rec.sub_category]?.shortLabel ?? POINT_CATEGORY_META[rec.category].shortLabel }}
                  </NTag>
                  <span class="text-12px text-gray-500">{{ rec.rule_label }}</span>
                </div>
                <div class="mt-4px text-13px font-medium text-[var(--sct-ink)]">
                  {{ rec.content }}
                </div>
                <div v-if="rec.note" class="mt-2px text-11px text-gray-400">备注：{{ rec.note }}</div>
              </div>

              <div class="flex shrink-0 flex-col items-end gap-6px">
                <span
                  class="text-16px font-bold font-mono"
                  :class="rec.status !== '已认定' ? 'line-through opacity-55' : ''"
                  :style="{ color: rec.score < 0 ? '#dc2626' : '#16a34a' }"
                >
                  {{ formatScore(rec.score, true) }} 分
                </span>
                <div class="flex items-center gap-4px">
                  <NDropdown
                    trigger="click"
                    :options="POINT_VERIFY_STATUS_OPTIONS.map(o => ({ key: o.value, label: o.label }))"
                    @select="k => handleQuickStatusChange(rec, k as Sct.PointVerifyStatus)"
                  >
                    <NTag size="tiny" :type="statusTagType(rec.status)" class="cursor-pointer select-none">
                      <span class="inline-flex items-center gap-2px">
                        <span>{{ rec.status }}</span>
                        <SvgIcon icon="lucide:chevron-down" class="text-10px" />
                      </span>
                    </NTag>
                  </NDropdown>
                  <NButton size="tiny" quaternary @click="openEditRecord(rec)">
                    <template #icon><SvgIcon icon="lucide:pencil" class="text-12px" /></template>
                  </NButton>
                  <NPopconfirm @positive-click="handleDeleteRecord(rec)">
                    <template #trigger>
                      <NButton size="tiny" quaternary type="error">
                        <template #icon><SvgIcon icon="lucide:trash-2" class="text-12px" /></template>
                      </NButton>
                    </template>
                    确定删除此条积分记录？
                  </NPopconfirm>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>

  <!-- 新增 / 编辑积分记录弹窗 -->
  <NModal
    v-model:show="recordModalShow"
    preset="card"
    :title="editingRecordId ? '编辑积分记录' : `登记积分：${member?.name ?? ''}（${year}年度）`"
    class="w-540px max-w-[94vw]"
    :mask-closable="false"
  >
    <NForm label-placement="left" label-width="96" size="small">
      <NFormItem label="积分大类" required>
        <NSelect
          :value="recordForm.category"
          :options="categoryOptions"
          @update:value="v => onRecordCategoryChange(v as Sct.PointCategory)"
        />
      </NFormItem>

      <NFormItem label="考核细则" required>
        <NSelect
          :value="recordForm.rule_id"
          :options="ruleSelectOptions"
          filterable
          @update:value="v => onRuleSelect(String(v))"
        />
      </NFormItem>

      <NFormItem v-if="recordForm.rule_id === '__custom__'" label="封顶子项" required>
        <NSelect v-model:value="recordForm.sub_category" :options="subBucketOptions" />
      </NFormItem>

      <NFormItem v-if="recordForm.rule_id === '__custom__'" label="细则名称">
        <NInput v-model:value="recordForm.rule_label" placeholder="如：自定义加分/扣分项" maxlength="50" />
      </NFormItem>

      <!-- 智能辅助计分器（仍可手改下方最终分值） -->
      <NFormItem v-if="selectedRule?.calc_mode === 'count'" :label="`发生${selectedRule.unit_label || '次数'}`">
        <div class="flex w-full items-center gap-8px">
          <NInputNumber
            v-model:value="recordForm.calcCount"
            :min="1"
            :step="1"
            class="w-150px"
            @update:value="recalcSuggestedScore"
          >
            <template #suffix>{{ selectedRule.unit_label || '次' }}</template>
          </NInputNumber>
          <span class="text-12px text-gray-400">
            按 {{ formatScore(selectedRule.default_score, true) }} 分/{{ selectedRule.unit_label || '次' }} 自动算分
          </span>
        </div>
      </NFormItem>

      <NFormItem v-if="selectedRule?.calc_mode === 'role_half'" label="贡献度角色">
        <NRadioGroup v-model:value="recordForm.calcRole" size="small" @update:value="recalcSuggestedScore">
          <NRadioButton value="core">核心成员（100% · +{{ formatScore(selectedRule.default_score) }}分）</NRadioButton>
          <NRadioButton value="member">
            参与成员（50% · +{{ formatScore(selectedRule.default_score * 0.5) }}分）
          </NRadioButton>
        </NRadioGroup>
      </NFormItem>

      <NFormItem v-if="selectedRule?.calc_mode === 'hours_20'" label="志愿时长">
        <div class="flex w-full items-center gap-8px">
          <NInputNumber
            v-model:value="recordForm.calcHours"
            :min="0"
            :step="5"
            class="w-160px"
            @update:value="recalcSuggestedScore"
          >
            <template #suffix>小时</template>
          </NInputNumber>
          <span class="text-12px text-gray-400">每 20 小时记 1 分（结果可微调）</span>
        </div>
      </NFormItem>

      <NFormItem label="认定分值" required>
        <div class="flex w-full items-center gap-8px">
          <NInputNumber v-model:value="recordForm.score" :step="0.5" :precision="2" class="w-160px">
            <template #suffix>分</template>
          </NInputNumber>
          <span class="text-11px text-gray-400">
            {{
              recordForm.category === 'base' || recordForm.category === 'penalty'
                ? '自动记为扣分（负值）'
                : '自动记为加分（正值）'
            }}
          </span>
        </div>
      </NFormItem>

      <NFormItem label="活动时间" required>
        <NDatePicker v-model:formatted-value="recordForm.date" type="date" value-format="yyyy-MM-dd" class="w-full" />
      </NFormItem>

      <NFormItem label="活动内容" required>
        <NInput
          v-model:value="recordForm.content"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          placeholder="填写具体活动名称、竞赛获奖/论文名称、缺席会议名等（将同步导出到支部记录表）"
          maxlength="200"
        />
      </NFormItem>

      <NFormItem label="认定状态" required>
        <NRadioGroup v-model:value="recordForm.status" size="small">
          <NRadioButton v-for="o in POINT_VERIFY_STATUS_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </NRadioButton>
        </NRadioGroup>
      </NFormItem>

      <NFormItem label="备注说明">
        <NInput
          v-model:value="recordForm.note"
          placeholder="选填：如证明材料编号、导师签字/学工办登记情况"
          maxlength="120"
        />
      </NFormItem>
    </NForm>

    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton size="small" @click="recordModalShow = false">取消</NButton>
        <NButton size="small" type="primary" @click="handleSaveRecord">
          <template #icon><SvgIcon icon="lucide:check" /></template>
          {{ editingRecordId ? '保存修改' : '确认登记' }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
