<script setup lang="ts">
/**
 * 个人年度积分账单抽屉（v0.3.0 动态多方案引擎适配）
 * - 顶部得分仪表卡（分数制显示总分与各维度进度条；五星模型显示 ★★★★★ 星标点亮明细）
 * - 动态选择当前方案的维度与细则快速登记
 * - 流水清单按时间倒序，支持一键「认定 / 待核实 / 未通过」与编辑删除
 */
import { computed, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { POINT_VERIFY_STATUS_OPTIONS } from '@/constants/party-points';
import { computeMemberYearPoints, computeRuleSuggestedScore, formatScore } from '@/utils/party-points';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'MemberPointsDrawer' });

const props = defineProps<{
  show: boolean;
  memberId: string | null;
  year: number;
  scheme: Sct.PointScheme;
}>();

const emit = defineEmits<{ 'update:show': [val: boolean] }>();

const workStore = useWorkDataStore();

const member = computed(() => (props.memberId ? workStore.memberOf(props.memberId) : undefined));
const veto = computed(() =>
  props.memberId ? workStore.pointVetoes.find(v => v.member_id === props.memberId && v.year === props.year) : undefined
);

const yearRecords = computed(() =>
  props.memberId
    ? workStore.pointRecords
        .filter(r => r.member_id === props.memberId && r.year === props.year)
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
    : []
);

const summary = computed(() =>
  member.value ? computeMemberYearPoints(member.value, props.year, yearRecords.value, veto.value, props.scheme) : null
);

const formShow = ref(false);
const editingId = ref<string | null>(null);
const vetoActive = ref(false);
const vetoReason = ref('');

const form = reactive({
  date: dayjs().format('YYYY-MM-DD'),
  dimension_id: '',
  rule_id: '' as string,
  rule_label: '',
  content: '',
  score: 1,
  status: '已认定' as Sct.PointVerifyStatus,
  count: 1,
  role: 'core' as 'core' | 'member',
  hours: 20,
  note: ''
});

watch(
  () => [props.show, props.memberId, props.year],
  ([visible]) => {
    if (!visible) return;
    formShow.value = false;
    editingId.value = null;
    vetoActive.value = Boolean(veto.value?.active);
    vetoReason.value = veto.value?.reason ?? '';
  }
);

const selectedDim = computed(
  () => props.scheme.dimensions.find(d => d.id === form.dimension_id) ?? props.scheme.dimensions[0]
);

const dimRules = computed(() => {
  if (!selectedDim.value) return [];
  return props.scheme.rules.filter(r => r.sub_category === selectedDim.value!.id && r.enabled !== false);
});

const selectedRule = computed(() => dimRules.value.find(r => r.id === form.rule_id));

function openAddForm(dimId?: string) {
  editingId.value = null;
  const targetDim = props.scheme.dimensions.find(d => d.id === dimId) ?? props.scheme.dimensions[0];
  const isDeduct = targetDim?.mode === 'deduct_from_base' || targetDim?.mode === 'deduct_direct';
  Object.assign(form, {
    date: dayjs().format('YYYY-MM-DD'),
    dimension_id: targetDim?.id ?? '',
    rule_id: '',
    rule_label: '',
    content: '',
    score: isDeduct ? -1 : 1,
    status: '已认定',
    count: 1,
    role: 'core',
    hours: 20,
    note: ''
  });
  formShow.value = true;
}

function openEditForm(rec: Sct.PointRecord) {
  editingId.value = rec.id;
  Object.assign(form, {
    date: rec.date,
    dimension_id: rec.sub_category,
    rule_id: rec.rule_id ?? '',
    rule_label: rec.rule_label,
    content: rec.content,
    score: rec.score,
    status: rec.status,
    count: rec.calc_meta?.count ?? 1,
    role: rec.calc_meta?.role ?? 'core',
    hours: rec.calc_meta?.hours ?? 20,
    note: rec.note ?? ''
  });
  formShow.value = true;
}

function handleRuleSelect(ruleId: string | null) {
  form.rule_id = ruleId ?? '';
  const rule = dimRules.value.find(r => r.id === form.rule_id);
  if (!rule) return;
  form.rule_label = rule.label;
  form.score = computeRuleSuggestedScore(rule, { count: form.count, role: form.role, hours: form.hours });
}

function recalcFromMeta() {
  if (!selectedRule.value) return;
  form.score = computeRuleSuggestedScore(selectedRule.value, {
    count: form.count,
    role: form.role,
    hours: form.hours
  });
}

async function handleSaveRecord() {
  if (!member.value || !selectedDim.value) return;
  if (!form.content.trim() && !form.rule_label.trim()) {
    window.$message?.warning('请填写活动内容或选择计分细则');
    return;
  }
  const isDeduct = selectedDim.value.mode === 'deduct_from_base' || selectedDim.value.mode === 'deduct_direct';
  const normalizedScore = isDeduct ? -Math.abs(Number(form.score) || 0) : Math.abs(Number(form.score) || 0);
  const payload = {
    member_id: member.value.id,
    year: props.year,
    date: form.date || dayjs().format('YYYY-MM-DD'),
    category: selectedDim.value.category,
    sub_category: selectedDim.value.id,
    rule_id: form.rule_id || undefined,
    rule_label: form.rule_label.trim() || selectedDim.value.shortLabel,
    content: form.content.trim() || form.rule_label.trim(),
    score: normalizedScore,
    status: form.status,
    calc_meta: { count: form.count, role: form.role, hours: form.hours },
    note: form.note.trim() || undefined
  };

  if (editingId.value) {
    await workStore.updatePointRecord(editingId.value, payload);
    window.$message?.success('积分明细已更新');
  } else {
    await workStore.addPointRecord(payload);
    window.$message?.success('积分记录已登记');
  }
  formShow.value = false;
  editingId.value = null;
}

async function quickVerify(rec: Sct.PointRecord, nextStatus: Sct.PointVerifyStatus) {
  await workStore.updatePointRecord(rec.id, { status: nextStatus });
}

async function handleSaveVeto() {
  if (!member.value) return;
  await workStore.setPointVeto(member.value.id, props.year, vetoActive.value, vetoReason.value);
  window.$message?.success(vetoActive.value ? '已启用本年度一票否决' : '已解除本年度一票否决');
}
</script>

<template>
  <NDrawer :show="show" :width="560" class="max-w-96vw" @update:show="val => emit('update:show', val)">
    <NDrawerContent v-if="member && summary" :title="`${member.name} · ${year} 年度积分账单`" closable>
      <div class="flex flex-col gap-14px">
        <!-- 顶部得分仪表卡 -->
        <div class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-12px">
          <div class="flex flex-wrap items-center justify-between gap-10px">
            <div>
              <div class="text-11.5px text-[var(--sct-muted)]">{{ scheme.name }}</div>
              <div v-if="scheme.scheme_mode === 'star'" class="mt-4px flex items-center gap-8px">
                <span class="text-20px tracking-widest text-[#d97706]">
                  {{ '★'.repeat(summary.starsEarned)
                  }}{{ '☆'.repeat(Math.max(0, summary.starsTotal - summary.starsEarned)) }}
                </span>
                <span class="font-mono text-13px font-bold text-[var(--sct-ink)]">
                  {{ summary.starsEarned }}/{{ summary.starsTotal }} 星 · {{ formatScore(summary.totalScore) }} 分
                </span>
              </div>
              <div v-else class="mt-2px flex items-baseline gap-8px">
                <span
                  class="font-mono text-26px font-extrabold leading-none"
                  :style="{ color: summary.isWarning ? '#dc2626' : '#A81C24' }"
                >
                  {{ formatScore(summary.totalScore) }}
                </span>
                <span class="text-12px text-[var(--sct-muted)]">分（合格线 {{ scheme.pass_line }}）</span>
              </div>
            </div>
            <NButton size="small" type="primary" @click="openAddForm()">
              <template #icon><SvgIcon icon="lucide:plus" /></template>
              登记加减分
            </NButton>
          </div>

          <!-- 各维度明细网格 -->
          <div class="mt-10px grid grid-cols-2 gap-6px sm:grid-cols-3">
            <button
              v-for="d in summary.dimensions"
              :key="d.id"
              type="button"
              class="flex flex-col items-start rounded-6px border border-[var(--sct-border)] bg-[var(--sct-container)] px-8px py-6px text-left transition-colors hover:border-[var(--sct-ink)]"
              @click="openAddForm(d.id)"
            >
              <div class="w-full flex items-center justify-between gap-4px text-11px text-[var(--sct-muted)]">
                <span class="truncate">{{ d.shortLabel }}</span>
                <span v-if="scheme.scheme_mode === 'star' && d.starLit" class="text-[#d97706]">★</span>
              </div>
              <div class="mt-2px font-mono text-13px font-bold" :style="{ color: d.color }">
                {{
                  d.mode === 'deduct_direct' && d.effective > 0
                    ? `-${formatScore(d.effective)}`
                    : formatScore(d.effective)
                }}
                <span v-if="d.cap" class="text-10px font-normal text-[var(--sct-muted)]">/{{ d.cap }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- 快捷登记表单 -->
        <div v-if="formShow" class="rounded-8px border border-[var(--sct-accent)] bg-[var(--sct-page)] p-12px">
          <div class="mb-8px flex items-center justify-between">
            <span class="text-13px font-bold">{{ editingId ? '编辑积分条目' : '新增积分条目' }}</span>
            <NButton size="tiny" quaternary @click="formShow = false">收起</NButton>
          </div>
          <NForm label-placement="left" label-width="82" size="small">
            <div class="grid grid-cols-2 gap-8px">
              <NFormItem required>
                <template #label><span class="sct-field-label">所属维度</span></template>
                <NSelect
                  v-model:value="form.dimension_id"
                  :options="scheme.dimensions.map(d => ({ label: d.shortLabel, value: d.id }))"
                />
              </NFormItem>
              <NFormItem required>
                <template #label><span class="sct-field-label">发生日期</span></template>
                <NDatePicker v-model:formatted-value="form.date" type="date" value-format="yyyy-MM-dd" class="w-full" />
              </NFormItem>
            </div>
            <NFormItem v-if="dimRules.length">
              <template #label><span class="sct-field-label">参考细则</span></template>
              <NSelect
                :value="form.rule_id || null"
                clearable
                filterable
                placeholder="选填：选择预设细则自动计算分值"
                :options="
                  dimRules.map(r => ({ label: `${r.label} (${formatScore(r.default_score, true)})`, value: r.id }))
                "
                @update:value="handleRuleSelect"
              />
            </NFormItem>
            <div
              v-if="selectedRule && selectedRule.calc_mode !== 'fixed'"
              class="mb-8px flex items-center gap-10px pl-82px text-12px"
            >
              <template v-if="selectedRule.calc_mode === 'count'">
                <span>数量：</span>
                <NInputNumber
                  v-model:value="form.count"
                  size="tiny"
                  :min="0.5"
                  :step="0.5"
                  class="w-90px"
                  @update:value="recalcFromMeta"
                />
                <span>{{ selectedRule.unit_label || '次' }}</span>
              </template>
              <template v-else-if="selectedRule.calc_mode === 'hours_20'">
                <span>志愿时长：</span>
                <NInputNumber
                  v-model:value="form.hours"
                  size="tiny"
                  :min="0"
                  :step="1"
                  class="w-96px"
                  @update:value="recalcFromMeta"
                />
                <span>小时</span>
              </template>
              <template v-else-if="selectedRule.calc_mode === 'role_half'">
                <NRadioGroup v-model:value="form.role" size="small" @update:value="recalcFromMeta">
                  <NRadioButton value="core">核心成员 (100%)</NRadioButton>
                  <NRadioButton value="member">参与成员 (50%)</NRadioButton>
                </NRadioGroup>
              </template>
            </div>
            <NFormItem required>
              <template #label><span class="sct-field-label">事项说明</span></template>
              <NInput v-model:value="form.content" placeholder="如：参加志愿服务 / 获校级奖项 / 缺席大会" />
            </NFormItem>
            <div class="grid grid-cols-2 gap-8px">
              <NFormItem required>
                <template #label><span class="sct-field-label">认定分值</span></template>
                <NInputNumber v-model:value="form.score" :step="0.5" class="w-full" />
              </NFormItem>
              <NFormItem>
                <template #label><span class="sct-field-label">审核状态</span></template>
                <NSelect
                  v-model:value="form.status"
                  :options="POINT_VERIFY_STATUS_OPTIONS.map(o => ({ label: o.label, value: o.value }))"
                />
              </NFormItem>
            </div>
            <div class="flex justify-end gap-8px">
              <NButton size="small" @click="formShow = false">取消</NButton>
              <NButton size="small" type="primary" @click="handleSaveRecord">保存条目</NButton>
            </div>
          </NForm>
        </div>

        <!-- 一票否决开关（方案开启时展示） -->
        <div
          v-if="scheme.enable_veto"
          class="flex flex-wrap items-center justify-between gap-8px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] px-12px py-8px"
        >
          <div class="flex items-center gap-8px text-12px">
            <NSwitch v-model:value="vetoActive" size="small" />
            <span class="font-semibold">年度一票否决（基础分/星级清零）</span>
          </div>
          <div class="flex items-center gap-6px">
            <NInput
              v-if="vetoActive"
              v-model:value="vetoReason"
              size="tiny"
              class="w-180px"
              placeholder="填写否决事由"
            />
            <NButton size="tiny" secondary @click="handleSaveVeto">保存</NButton>
          </div>
        </div>

        <!-- 明细流水 -->
        <div>
          <div class="mb-8px text-13px font-bold">本年度积分明细流水（{{ yearRecords.length }} 条）</div>
          <div
            v-if="!yearRecords.length"
            class="rounded-8px border border-dashed border-[var(--sct-border)] py-28px text-center text-12px text-[var(--sct-muted)]"
          >
            暂无积分记录，点击上方「登记加减分」或任意维度卡快捷录入。
          </div>
          <div v-else class="flex flex-col gap-8px">
            <div
              v-for="rec in yearRecords"
              :key="rec.id"
              class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] p-10px text-12px"
            >
              <div class="flex items-start justify-between gap-8px">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-6px">
                    <span class="font-mono text-11px text-[var(--sct-muted)]">{{ rec.date }}</span>
                    <NTag size="tiny" :bordered="false">
                      {{ scheme.dimensions.find(d => d.id === rec.sub_category)?.shortLabel ?? rec.sub_category }}
                    </NTag>
                    <NTag
                      size="tiny"
                      :type="rec.status === '已认定' ? 'success' : rec.status === '待核实' ? 'warning' : 'error'"
                      :bordered="false"
                    >
                      {{ rec.status }}
                    </NTag>
                  </div>
                  <div class="mt-4px font-semibold text-[var(--sct-ink)]">{{ rec.content }}</div>
                  <div
                    v-if="rec.rule_label && rec.rule_label !== rec.content"
                    class="mt-2px text-11px text-[var(--sct-muted)]"
                  >
                    细则：{{ rec.rule_label }}
                  </div>
                </div>
                <span
                  class="shrink-0 font-mono text-14px font-extrabold"
                  :style="{ color: rec.score >= 0 ? '#16a34a' : '#dc2626' }"
                >
                  {{ formatScore(rec.score, true) }}
                </span>
              </div>
              <div
                class="mt-8px flex flex-wrap items-center justify-end gap-6px border-t border-dashed border-[var(--sct-border)] pt-6px"
              >
                <NButton
                  v-if="rec.status !== '已认定'"
                  size="tiny"
                  type="success"
                  secondary
                  @click="quickVerify(rec, '已认定')"
                >
                  通过认定
                </NButton>
                <NButton
                  v-if="rec.status === '待核实'"
                  size="tiny"
                  type="error"
                  secondary
                  @click="quickVerify(rec, '未通过')"
                >
                  不通过
                </NButton>
                <NButton size="tiny" quaternary @click="openEditForm(rec)">编辑</NButton>
                <NPopconfirm @positive-click="workStore.deletePointRecord(rec.id)">
                  <template #trigger>
                    <NButton size="tiny" quaternary type="error">删除</NButton>
                  </template>
                  确认删除该条积分记录？
                </NPopconfirm>
              </div>
            </div>
          </div>
        </div>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>
