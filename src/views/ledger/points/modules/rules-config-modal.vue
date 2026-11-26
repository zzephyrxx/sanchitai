<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { nanoid } from '@sa/utils';
import { DEFAULT_POINT_RULES, POINT_BUCKETS, POINT_BUCKET_MAP, POINT_CATEGORY_META } from '@/constants/party-points';
import { formatScore } from '@/utils/party-points';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'PointsRulesConfigModal' });

const show = defineModel<boolean>('show', { required: true });

const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const activeCat = ref<Sct.PointCategory>('base');
const localRules = ref<Sct.PointRuleItem[]>([]);

watch(
  show,
  visible => {
    if (visible) {
      localRules.value = JSON.parse(JSON.stringify(workStore.pointRules)) as Sct.PointRuleItem[];
    }
  },
  { immediate: true }
);

const categoryTabs: Array<{ key: Sct.PointCategory; label: string }> = [
  { key: 'base', label: '基础分（60分，扣分项）' },
  { key: 'duty', label: '履职分（40分，加分项）' },
  { key: 'bonus', label: '附加分' },
  { key: 'penalty', label: '减扣分' }
];

const filteredRules = computed(() => localRules.value.filter(r => r.category === activeCat.value));

const calcModeOptions: Array<{ label: string; value: Sct.PointCalcMode }> = [
  { label: '固定分值', value: 'fixed' },
  { label: '按次/按项乘算', value: 'count' },
  { label: '集体折算（核心100% / 参与50%）', value: 'role_half' },
  { label: '志愿时长（每 20 小时记 1 分）', value: 'hours_20' }
];

function calcModeLabel(mode: Sct.PointCalcMode): string {
  return calcModeOptions.find(o => o.value === mode)?.label ?? '固定分值';
}

// ---------------- 新增/编辑单条细则弹窗 ----------------
const editModalShow = ref(false);
const editingId = ref<string | null>(null);
const editForm = reactive<{
  category: Sct.PointCategory;
  sub_category: Sct.PointSubCategory;
  label: string;
  description: string;
  default_score: number;
  calc_mode: Sct.PointCalcMode;
  unit_label: string;
}>({
  category: 'duty',
  sub_category: 'duty_study',
  label: '',
  description: '',
  default_score: 1,
  calc_mode: 'fixed',
  unit_label: '次'
});

const subCategoryOptions = computed(() =>
  POINT_BUCKETS.filter(b => b.category === editForm.category).map(b => ({
    label: b.label,
    value: b.key
  }))
);

function onEditCategoryChange(cat: Sct.PointCategory) {
  editForm.category = cat;
  const firstBucket = POINT_BUCKETS.find(b => b.category === cat);
  if (firstBucket) editForm.sub_category = firstBucket.key;
  if (cat === 'base' || cat === 'penalty') {
    editForm.default_score = -Math.abs(editForm.default_score || 1);
  } else {
    editForm.default_score = Math.abs(editForm.default_score || 1);
  }
}

function openAddRule() {
  editingId.value = null;
  onEditCategoryChange(activeCat.value);
  editForm.label = '';
  editForm.description = '';
  editForm.default_score = activeCat.value === 'base' || activeCat.value === 'penalty' ? -1 : 1;
  editForm.calc_mode = 'fixed';
  editForm.unit_label = '次';
  editModalShow.value = true;
}

function openEditRule(rule: Sct.PointRuleItem) {
  editingId.value = rule.id;
  editForm.category = rule.category;
  editForm.sub_category = rule.sub_category;
  editForm.label = rule.label;
  editForm.description = rule.description;
  editForm.default_score = rule.default_score;
  editForm.calc_mode = rule.calc_mode;
  editForm.unit_label = rule.unit_label ?? '次';
  editModalShow.value = true;
}

function confirmRuleEdit() {
  const cleanLabel = editForm.label.trim();
  if (!cleanLabel) {
    window.$message?.warning('请填写细则名称');
    return;
  }
  const rawScore = Number(editForm.default_score) || 0;
  const normalizedScore =
    editForm.category === 'base' || editForm.category === 'penalty' ? -Math.abs(rawScore) : Math.abs(rawScore);

  if (editingId.value) {
    localRules.value = localRules.value.map(r =>
      r.id === editingId.value
        ? {
            ...r,
            category: editForm.category,
            sub_category: editForm.sub_category,
            label: cleanLabel,
            description: editForm.description.trim(),
            default_score: normalizedScore,
            calc_mode: editForm.calc_mode,
            unit_label: editForm.calc_mode === 'count' ? editForm.unit_label.trim() || '次' : undefined
          }
        : r
    );
  } else {
    localRules.value = [
      ...localRules.value,
      {
        id: `custom-${nanoid(6)}`,
        category: editForm.category,
        sub_category: editForm.sub_category,
        label: cleanLabel,
        description: editForm.description.trim() || `${formatScore(normalizedScore, true)} 分`,
        default_score: normalizedScore,
        calc_mode: editForm.calc_mode,
        unit_label: editForm.calc_mode === 'count' ? editForm.unit_label.trim() || '次' : undefined,
        builtin: false,
        enabled: true
      }
    ];
  }
  editModalShow.value = false;
}

function toggleRuleEnabled(id: string, enabled: boolean) {
  localRules.value = localRules.value.map(r => (r.id === id ? { ...r, enabled } : r));
}

function removeRule(id: string) {
  localRules.value = localRules.value.filter(r => r.id !== id);
}

async function handleSaveAll() {
  await workStore.savePointRules(localRules.value);
  show.value = false;
  window.$message?.success('党员积分考核标准已保存');
}

async function handleResetDefault() {
  await workStore.resetPointRules();
  localRules.value = JSON.parse(JSON.stringify(DEFAULT_POINT_RULES)) as Sct.PointRuleItem[];
  window.$message?.success('已恢复为高校 60+40 默认考核标准');
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    :title="bi('党员积分考核标准设置', 'Points Scoring Rules')"
    class="w-780px max-w-[94vw]"
    :mask-closable="false"
  >
    <div
      class="mb-12px flex flex-wrap items-center justify-between gap-8px rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-12px text-gray-500"
    >
      <span>预置高校学生党员 60+40 积分管理考核标准，可微调分值、停用或新增自定义条目；历史已录入记录不受影响。</span>
      <NPopconfirm @positive-click="handleResetDefault">
        <template #trigger>
          <NButton size="tiny" secondary>
            <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
            恢复默认标准
          </NButton>
        </template>
        确定恢复为高校 60+40 默认积分细则？自定义修改将被覆盖。
      </NPopconfirm>
    </div>

    <div class="mb-10px flex flex-wrap items-center justify-between gap-8px">
      <NRadioGroup v-model:value="activeCat" size="small">
        <NRadioButton v-for="t in categoryTabs" :key="t.key" :value="t.key">{{ t.label }}</NRadioButton>
      </NRadioGroup>
      <NButton type="primary" size="small" @click="openAddRule">
        <template #icon><SvgIcon icon="lucide:plus" /></template>
        新增细则条目
      </NButton>
    </div>

    <div class="max-h-420px flex flex-col gap-6px overflow-y-auto pr-4px">
      <div
        v-for="rule in filteredRules"
        :key="rule.id"
        class="flex items-center justify-between gap-10px rounded-8px border border-[var(--sct-border)] px-12px py-8px transition"
        :class="rule.enabled === false ? 'opacity-55 bg-gray-50 dark:bg-white/2' : ''"
      >
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-6px">
            <NTag size="tiny" :bordered="false" :type="POINT_CATEGORY_META[rule.category].tagType">
              {{ POINT_BUCKET_MAP[rule.sub_category]?.shortLabel }}
            </NTag>
            <span class="text-13px font-semibold text-[var(--sct-ink)]">{{ rule.label }}</span>
            <NTag v-if="!rule.builtin" size="tiny" :bordered="false">自定义</NTag>
          </div>
          <div class="mt-2px flex flex-wrap items-center gap-10px text-11px text-gray-500">
            <span>{{ rule.description }}</span>
            <span>· 计分方式：{{ calcModeLabel(rule.calc_mode) }}</span>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-8px">
          <span
            class="min-w-52px text-right text-13px font-bold font-mono"
            :style="{ color: rule.default_score < 0 ? '#dc2626' : '#16a34a' }"
          >
            {{ formatScore(rule.default_score, true) }} 分
          </span>
          <NSwitch size="small" :value="rule.enabled !== false" @update:value="v => toggleRuleEnabled(rule.id, v)" />
          <NButton size="tiny" quaternary @click="openEditRule(rule)">
            <template #icon><SvgIcon icon="lucide:pencil" /></template>
          </NButton>
          <NPopconfirm v-if="!rule.builtin" @positive-click="removeRule(rule.id)">
            <template #trigger>
              <NButton size="tiny" quaternary type="error">
                <template #icon><SvgIcon icon="lucide:trash-2" /></template>
              </NButton>
            </template>
            删除此自定义细则？
          </NPopconfirm>
        </div>
      </div>

      <div v-if="!filteredRules.length" class="py-24px text-center text-12px text-gray-400">
        当前分类暂无细则，点击右上角「新增细则条目」添加。
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton @click="show = false">取消</NButton>
        <NButton type="primary" @click="handleSaveAll">
          <template #icon><SvgIcon icon="lucide:check" /></template>
          保存考核标准
        </NButton>
      </div>
    </template>
  </NModal>

  <!-- 新增 / 编辑单条细则 -->
  <NModal
    v-model:show="editModalShow"
    preset="card"
    :title="editingId ? '编辑积分细则' : '新增积分细则'"
    class="w-480px max-w-[92vw]"
  >
    <NForm label-placement="left" label-width="96" size="small">
      <NFormItem label="所属大类" required>
        <NSelect
          :value="editForm.category"
          :options="categoryTabs.map(t => ({ label: t.label, value: t.key }))"
          @update:value="v => onEditCategoryChange(v as Sct.PointCategory)"
        />
      </NFormItem>
      <NFormItem label="封顶子项" required>
        <NSelect v-model:value="editForm.sub_category" :options="subCategoryOptions" />
      </NFormItem>
      <NFormItem label="细则名称" required>
        <NInput v-model:value="editForm.label" placeholder="如：参加学院学术前沿报告会" maxlength="60" />
      </NFormItem>
      <NFormItem label="标准说明">
        <NInput v-model:value="editForm.description" placeholder="简述认定条件或分值依据" maxlength="100" />
      </NFormItem>
      <NFormItem label="辅助计分方式">
        <NSelect v-model:value="editForm.calc_mode" :options="calcModeOptions" />
      </NFormItem>
      <NFormItem v-if="editForm.calc_mode === 'count'" label="计量单位">
        <NInput v-model:value="editForm.unit_label" placeholder="次 / 项" maxlength="10" />
      </NFormItem>
      <NFormItem label="默认分值" required>
        <NInputNumber v-model:value="editForm.default_score" :step="0.5" :precision="2" class="w-full">
          <template #suffix>分</template>
        </NInputNumber>
      </NFormItem>
    </NForm>
    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton size="small" @click="editModalShow = false">取消</NButton>
        <NButton size="small" type="primary" @click="confirmRuleEdit">确定</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
