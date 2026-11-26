<script setup lang="ts">
/**
 * 党员积分「规则方案工坊」抽屉（v0.3.0）
 * - 支持 4 套内置方案一键切换 + 克隆改写 + 空白自定义
 * - 分桶台账卡片网格管理维度（名称 / 方向 / 初始分 / 封顶值 / 星级阈值）与细则增删
 * - 支持「按年度绑定快照」（改方案不破坏往年历史成绩）
 * - 内置 .sctpreset 单位配置包导入/导出
 */
import { computed, reactive, ref, watch } from 'vue';
import { nanoid } from '@sa/utils';
import { clonePointScheme, createBlankCustomScheme } from '@/constants/party-points';
import { buildUnitPresetPack, exportUnitPresetFile, parseUnitPresetText } from '@/utils/unit-preset';
import type { UnitPresetIncludeKey } from '@/utils/unit-preset';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'SchemeWorkshopDrawer' });

const props = defineProps<{ show: boolean; year: number }>();
const emit = defineEmits<{ 'update:show': [val: boolean]; applied: [] }>();

const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const draft = ref<Sct.PointScheme>(clonePointScheme(workStore.getPointSchemeForYear(props.year)));
const selectedDimId = ref<string>('');
const presetModalShow = ref(false);
const presetExportIncludes = ref<UnitPresetIncludeKey[]>(['point_scheme', 'scene', 'custom_fields', 'doc_templates']);
const presetExportName = ref('');
const presetFileInput = ref<HTMLInputElement>();

const addDimModalShow = ref(false);
const newDimForm = reactive({
  label: '',
  shortLabel: '',
  mode: 'add_capped' as Sct.PointDimensionDef['mode'],
  initial_score: 0,
  cap: 20 as number | null,
  star_threshold: 10,
  color: '#16a34a'
});

const addRuleModalShow = ref(false);
const newRuleForm = reactive({
  label: '',
  description: '',
  default_score: 2,
  calc_mode: 'count' as Sct.PointCalcMode,
  unit_label: '次'
});

watch(
  () => [props.show, props.year],
  ([visible]) => {
    if (!visible) return;
    draft.value = clonePointScheme(workStore.getPointSchemeForYear(props.year));
    selectedDimId.value = draft.value.dimensions[0]?.id ?? '';
    presetExportName.value = `${workStore.branchName}_标准配置包`;
  },
  { immediate: true }
);

const activeDim = computed(
  () => draft.value.dimensions.find(d => d.id === selectedDimId.value) ?? draft.value.dimensions[0]
);

const activeDimRules = computed(() => {
  if (!activeDim.value) return [];
  return draft.value.rules.filter(r => r.sub_category === activeDim.value!.id);
});

function selectPresetScheme(scheme: Sct.PointScheme) {
  draft.value = clonePointScheme(scheme);
  selectedDimId.value = draft.value.dimensions[0]?.id ?? '';
}

function handleCreateBlankScheme() {
  const custom = createBlankCustomScheme(`scheme-custom-${nanoid(5)}`, '自定义积分方案');
  draft.value = custom;
  selectedDimId.value = custom.dimensions[0]?.id ?? '';
  window.$message?.info('已创建空白自定义方案，可自由增删维度与细则');
}

function handleCloneAsCustom() {
  const cloned = clonePointScheme(draft.value);
  cloned.id = `scheme-custom-${nanoid(5)}`;
  cloned.name = `${draft.value.name}（副本）`;
  cloned.builtin = false;
  draft.value = cloned;
  window.$message?.info('已克隆为独立自定义方案');
}

function openAddDimModal() {
  Object.assign(newDimForm, {
    label: '',
    shortLabel: '',
    mode: draft.value.scheme_mode === 'star' ? 'add_capped' : 'add_capped',
    initial_score: 0,
    cap: 20,
    star_threshold: 10,
    color: '#0f766e'
  });
  addDimModalShow.value = true;
}

function handleAddDimension() {
  if (!newDimForm.shortLabel.trim()) {
    window.$message?.warning('请填写维度简称（用于表头展示）');
    return;
  }
  const id = `dim_${nanoid(5)}`;
  const cat: Sct.PointCategory =
    newDimForm.mode === 'deduct_from_base'
      ? 'base'
      : newDimForm.mode === 'deduct_direct'
        ? 'penalty'
        : newDimForm.mode === 'add_uncapped'
          ? 'bonus'
          : 'duty';
  draft.value.dimensions.push({
    id,
    label: newDimForm.label.trim() || newDimForm.shortLabel.trim(),
    shortLabel: newDimForm.shortLabel.trim(),
    category: cat,
    mode: newDimForm.mode,
    initial_score: newDimForm.mode === 'deduct_from_base' ? Number(newDimForm.initial_score) || 20 : 0,
    cap:
      newDimForm.mode === 'deduct_from_base'
        ? Number(newDimForm.initial_score) || 20
        : newDimForm.mode === 'add_capped'
          ? Number(newDimForm.cap) || 20
          : null,
    star_threshold: Number(newDimForm.star_threshold) || 10,
    color: newDimForm.color
  });
  selectedDimId.value = id;
  addDimModalShow.value = false;
}

function removeDimension(dimId: string) {
  if (draft.value.dimensions.length <= 1) {
    window.$message?.warning('方案至少保留 1 个计分维度');
    return;
  }
  draft.value.dimensions = draft.value.dimensions.filter(d => d.id !== dimId);
  draft.value.rules = draft.value.rules.filter(r => r.sub_category !== dimId);
  if (selectedDimId.value === dimId) {
    selectedDimId.value = draft.value.dimensions[0]?.id ?? '';
  }
}

function openAddRuleModal() {
  if (!activeDim.value) return;
  const isDeduct = activeDim.value.mode === 'deduct_from_base' || activeDim.value.mode === 'deduct_direct';
  Object.assign(newRuleForm, {
    label: '',
    description: '',
    default_score: isDeduct ? -2 : 2,
    calc_mode: 'count',
    unit_label: '次'
  });
  addRuleModalShow.value = true;
}

function handleAddRule() {
  if (!activeDim.value || !newRuleForm.label.trim()) {
    window.$message?.warning('请填写细则名称');
    return;
  }
  const isDeduct = activeDim.value.mode === 'deduct_from_base' || activeDim.value.mode === 'deduct_direct';
  const rawScore = Number(newRuleForm.default_score) || 1;
  const score = isDeduct ? -Math.abs(rawScore) : Math.abs(rawScore);
  draft.value.rules.push({
    id: `rule-${nanoid(6)}`,
    category: activeDim.value.category,
    sub_category: activeDim.value.id,
    label: newRuleForm.label.trim(),
    description: newRuleForm.description.trim() || `${score > 0 ? '+' : ''}${score} 分`,
    default_score: score,
    calc_mode: newRuleForm.calc_mode,
    unit_label: newRuleForm.unit_label.trim() || undefined,
    builtin: false,
    enabled: true
  });
  addRuleModalShow.value = false;
}

function removeRule(ruleId: string) {
  draft.value.rules = draft.value.rules.filter(r => r.id !== ruleId);
}

async function handleApplyToYear() {
  if (!draft.value.name.trim()) {
    window.$message?.warning('请填写方案名称');
    return;
  }
  await workStore.saveCustomPointScheme(draft.value);
  await workStore.bindYearPointScheme(props.year, draft.value);
  window.$message?.success(`已将「${draft.value.name}」应用并锁定为 ${props.year} 年度方案快照`);
  emit('applied');
  emit('update:show', false);
}

async function handleExportUnitPreset() {
  if (!presetExportIncludes.value.length) {
    window.$message?.warning('请至少勾选一项要打包的配置');
    return;
  }
  const pack = buildUnitPresetPack({
    name: presetExportName.value || `${workStore.branchName}_配置包`,
    description: `包含积分方案「${draft.value.name}」与支部标准化配置`,
    sourceBranch: workStore.branchName,
    includes: presetExportIncludes.value,
    workspaceConfig: workStore.workspaceConfig,
    pointScheme: draft.value,
    docTemplates: workStore.docTemplates
  });
  const res = await exportUnitPresetFile(pack);
  if (res === 'saved') {
    presetModalShow.value = false;
    window.$message?.success('单位配置包 (.sctpreset) 已导出，可直接分享给同单位其他支部导入');
  }
}

async function handleImportUnitPresetFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseUnitPresetText(text);
    if (!parsed.ok) {
      window.$message?.error(parsed.message);
      return;
    }
    const applied = await workStore.applyUnitPresetPack(parsed.pack, props.year);
    draft.value = clonePointScheme(workStore.getPointSchemeForYear(props.year));
    selectedDimId.value = draft.value.dimensions[0]?.id ?? '';
    window.$message?.success(`已导入单位配置包「${parsed.pack.name}」：${applied.join('、')}`);
    emit('applied');
  } finally {
    input.value = '';
  }
}

function modeLabel(mode: Sct.PointDimensionDef['mode']): string {
  if (mode === 'deduct_from_base') return '基础扣分';
  if (mode === 'add_capped') return '封顶加分';
  if (mode === 'add_uncapped') return '不封顶加分';
  return '直接减扣';
}
</script>

<template>
  <NDrawer :show="show" :width="760" class="max-w-96vw" @update:show="val => emit('update:show', val)">
    <NDrawerContent :title="bi(`积分与评定规则方案工坊（${year} 年度）`, `Scoring Scheme Workshop (${year})`)" closable>
      <div class="flex flex-col gap-14px">
        <!-- 1. 方案预设切换栏 -->
        <div
          data-tour="points-workshop-presets"
          class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-10px"
        >
          <div class="mb-8px flex flex-wrap items-center justify-between gap-8px">
            <span class="text-12px font-bold text-[var(--sct-ink)]">选择预置方案或新建自定义方案</span>
            <div class="flex flex-wrap items-center gap-6px">
              <NButton size="tiny" secondary @click="handleCloneAsCustom">
                <template #icon><SvgIcon icon="lucide:copy" /></template>
                克隆为副本
              </NButton>
              <NButton size="tiny" secondary @click="handleCreateBlankScheme">
                <template #icon><SvgIcon icon="lucide:plus" /></template>
                空白自定义
              </NButton>
              <NButton size="tiny" type="info" secondary @click="presetFileInput?.click()">
                <template #icon><SvgIcon icon="lucide:upload" /></template>
                导入 .sctpreset
              </NButton>
              <NButton size="tiny" type="warning" secondary @click="presetModalShow = true">
                <template #icon><SvgIcon icon="lucide:share-2" /></template>
                分享 .sctpreset
              </NButton>
              <input
                ref="presetFileInput"
                type="file"
                accept=".sctpreset,.json"
                class="hidden"
                @change="handleImportUnitPresetFile"
              />
            </div>
          </div>
          <div class="grid grid-cols-1 gap-8px sm:grid-cols-2">
            <button
              v-for="s in workStore.allPointSchemes"
              :key="s.id"
              type="button"
              class="scheme-card"
              :class="{ 'is-active': draft.id === s.id }"
              @click="selectPresetScheme(s)"
            >
              <div class="flex items-center justify-between gap-6px">
                <span class="text-12.5px font-bold">{{ s.name }}</span>
                <NTag size="tiny" :type="s.scheme_mode === 'star' ? 'warning' : 'info'" :bordered="false">
                  {{ s.scheme_mode === 'star' ? '五星模型' : '分数制' }}
                </NTag>
              </div>
              <div class="mt-4px text-left text-11px text-[var(--sct-muted)] line-clamp-2">{{ s.description }}</div>
            </button>
          </div>
        </div>

        <!-- 2. 方案全局参数 -->
        <div
          class="grid grid-cols-1 gap-10px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] p-12px sm:grid-cols-12"
        >
          <div class="sm:col-span-5">
            <div class="mb-4px text-11px text-[var(--sct-muted)]">方案名称</div>
            <NInput v-model:value="draft.name" size="small" />
          </div>
          <div class="sm:col-span-3">
            <div class="mb-4px text-11px text-[var(--sct-muted)]">评定模式</div>
            <NSelect
              v-model:value="draft.scheme_mode"
              size="small"
              :options="[
                { label: '分数制', value: 'score' },
                { label: '五星评定模型', value: 'star' }
              ]"
            />
          </div>
          <div class="sm:col-span-2">
            <div class="mb-4px text-11px text-[var(--sct-muted)]">
              {{ draft.scheme_mode === 'star' ? '合格星数' : '预警线(分)' }}
            </div>
            <NInputNumber
              v-if="draft.scheme_mode === 'star'"
              v-model:value="draft.pass_stars"
              size="small"
              :min="1"
              :max="draft.dimensions.length || 5"
              class="w-full"
            />
            <NInputNumber v-else v-model:value="draft.pass_line" size="small" :min="0" class="w-full" />
          </div>
          <div class="flex flex-col justify-between sm:col-span-2">
            <div class="mb-4px text-11px text-[var(--sct-muted)]">一票否决</div>
            <NSwitch v-model:value="draft.enable_veto" size="small" />
          </div>
        </div>

        <!-- 3. 分桶台账卡片网格（点击卡片编辑对应细则） -->
        <div data-tour="points-workshop-dims">
          <div class="mb-8px flex items-center justify-between">
            <span class="text-13px font-bold text-[var(--sct-ink)]">
              考核维度分桶（{{ draft.dimensions.length }} 个维度 · 点击卡片管理细则）
            </span>
            <NButton size="tiny" type="primary" secondary @click="openAddDimModal">
              <template #icon><SvgIcon icon="lucide:plus" /></template>
              新增维度
            </NButton>
          </div>
          <div class="grid grid-cols-2 gap-8px sm:grid-cols-3">
            <div
              v-for="dim in draft.dimensions"
              :key="dim.id"
              class="dim-card"
              :class="{ 'is-active': activeDim?.id === dim.id }"
              :style="{ '--dim-color': dim.color }"
              @click="selectedDimId = dim.id"
            >
              <div class="flex items-center justify-between gap-4px">
                <span class="truncate text-12.5px font-bold text-[var(--sct-ink)]">{{ dim.shortLabel }}</span>
                <NButton size="tiny" quaternary type="error" @click.stop="removeDimension(dim.id)">
                  <template #icon><SvgIcon icon="lucide:x" class="text-12px" /></template>
                </NButton>
              </div>
              <div class="mt-4px flex flex-wrap items-center gap-4px text-11px text-[var(--sct-muted)] font-mono">
                <NTag size="tiny" :bordered="false">{{ modeLabel(dim.mode) }}</NTag>
                <span v-if="dim.mode === 'deduct_from_base'">初 {{ dim.initial_score }}</span>
                <span v-else-if="dim.cap">限 {{ dim.cap }}</span>
                <span v-if="draft.scheme_mode === 'star'" class="text-[#d97706]">
                  ≥{{ dim.star_threshold ?? 10 }}亮星
                </span>
              </div>
              <div class="mt-4px text-11px text-[var(--sct-muted)]">
                细则 {{ draft.rules.filter(r => r.sub_category === dim.id).length }} 条
              </div>
            </div>
          </div>
        </div>

        <!-- 4. 当前选中维度的配置与细则清单 -->
        <div v-if="activeDim" class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] p-12px">
          <div
            class="mb-10px flex flex-wrap items-center justify-between gap-8px border-b border-dashed border-[var(--sct-border)] pb-8px"
          >
            <div class="flex flex-wrap items-center gap-8px">
              <span class="size-10px inline-block rounded-full" :style="{ background: activeDim.color }" />
              <span class="text-13px font-bold">{{ activeDim.label }}</span>
              <NInput v-model:value="activeDim.shortLabel" size="tiny" class="w-100px" placeholder="简称" />
              <NInputNumber
                v-if="activeDim.mode === 'deduct_from_base'"
                v-model:value="activeDim.initial_score"
                size="tiny"
                :min="0"
                class="w-90px"
              >
                <template #prefix>初</template>
              </NInputNumber>
              <NInputNumber
                v-if="activeDim.mode === 'add_capped'"
                v-model:value="activeDim.cap"
                size="tiny"
                :min="1"
                class="w-90px"
              >
                <template #prefix>限</template>
              </NInputNumber>
              <NInputNumber
                v-if="draft.scheme_mode === 'star'"
                v-model:value="activeDim.star_threshold"
                size="tiny"
                :min="1"
                class="w-96px"
              >
                <template #prefix>星≥</template>
              </NInputNumber>
            </div>
            <NButton size="tiny" type="primary" secondary @click="openAddRuleModal">
              <template #icon><SvgIcon icon="lucide:plus" /></template>
              新增细则
            </NButton>
          </div>

          <div v-if="!activeDimRules.length" class="py-16px text-center text-12px text-[var(--sct-muted)]">
            该维度暂无预设细则，可点击右上角「新增细则」或在登记积分时自由填报。
          </div>
          <div v-else class="flex flex-col gap-6px">
            <div
              v-for="rule in activeDimRules"
              :key="rule.id"
              class="flex items-center justify-between gap-10px rounded-6px border border-[var(--sct-border)] bg-[var(--sct-container)] px-10px py-7px text-12px"
            >
              <div class="min-w-0 flex-1">
                <div class="font-semibold text-[var(--sct-ink)]">{{ rule.label }}</div>
                <div class="text-11px text-[var(--sct-muted)]">{{ rule.description }}</div>
              </div>
              <div class="flex shrink-0 items-center gap-8px">
                <NTag size="tiny" :type="rule.default_score < 0 ? 'error' : 'success'" :bordered="false">
                  {{ rule.default_score > 0 ? `+${rule.default_score}` : rule.default_score }} 分
                </NTag>
                <NSwitch :value="rule.enabled !== false" size="small" @update:value="val => (rule.enabled = val)" />
                <NButton size="tiny" quaternary type="error" @click="removeRule(rule.id)">
                  <template #icon><SvgIcon icon="lucide:trash-2" class="text-12px" /></template>
                </NButton>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="w-full flex items-center justify-between">
          <span class="text-11.5px text-[var(--sct-muted)]">
            应用后自动为 {{ year }} 年度创建独立快照，不影响往年数据
          </span>
          <div class="flex items-center gap-8px">
            <NButton size="small" @click="emit('update:show', false)">取消</NButton>
            <NButton size="small" type="primary" @click="handleApplyToYear">
              <template #icon><SvgIcon icon="lucide:check" /></template>
              保存并应用到 {{ year }} 年度
            </NButton>
          </div>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>

  <!-- 新增维度弹窗 -->
  <NModal v-model:show="addDimModalShow" preset="card" title="新增考核维度" class="w-440px max-w-94vw">
    <NForm label-placement="left" label-width="92" size="small">
      <NFormItem required>
        <template #label><span class="sct-field-label">维度简称</span></template>
        <NInput v-model:value="newDimForm.shortLabel" placeholder="如：科研创新 / 志愿星（表头用）" />
      </NFormItem>
      <NFormItem>
        <template #label><span class="sct-field-label">完整说明</span></template>
        <NInput v-model:value="newDimForm.label" placeholder="选填，默认同简称" />
      </NFormItem>
      <NFormItem required>
        <template #label><span class="sct-field-label">计分方向</span></template>
        <NSelect
          v-model:value="newDimForm.mode"
          :options="[
            { label: '基础扣分（从初始分扣至 0）', value: 'deduct_from_base' },
            { label: '封顶加分（0 起累加至上限）', value: 'add_capped' },
            { label: '不封顶加分（激励附加）', value: 'add_uncapped' },
            { label: '直接减扣（纪律扣分）', value: 'deduct_direct' }
          ]"
        />
      </NFormItem>
      <NFormItem v-if="newDimForm.mode === 'deduct_from_base'">
        <template #label><span class="sct-field-label">初始分值</span></template>
        <NInputNumber v-model:value="newDimForm.initial_score" :min="1" class="w-full" />
      </NFormItem>
      <NFormItem v-if="newDimForm.mode === 'add_capped'">
        <template #label><span class="sct-field-label">封顶上限</span></template>
        <NInputNumber v-model:value="newDimForm.cap" :min="1" class="w-full" />
      </NFormItem>
      <NFormItem v-if="draft.scheme_mode === 'star'">
        <template #label><span class="sct-field-label">亮星阈值</span></template>
        <NInputNumber v-model:value="newDimForm.star_threshold" :min="1" class="w-full" />
      </NFormItem>
      <NFormItem>
        <template #label><span class="sct-field-label">标识色</span></template>
        <div class="flex items-center gap-8px">
          <button
            v-for="c in ['#A81C24', '#2563eb', '#16a34a', '#0f766e', '#d97706', '#7c5cd6', '#dc2626']"
            :key="c"
            type="button"
            class="size-22px rounded-full border-2"
            :style="{ background: c, borderColor: newDimForm.color === c ? '#111' : 'transparent' }"
            @click="newDimForm.color = c"
          />
        </div>
      </NFormItem>
    </NForm>
    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton size="small" @click="addDimModalShow = false">取消</NButton>
        <NButton size="small" type="primary" @click="handleAddDimension">添加维度</NButton>
      </div>
    </template>
  </NModal>

  <!-- 新增细则弹窗 -->
  <NModal v-model:show="addRuleModalShow" preset="card" title="新增计分细则" class="w-460px max-w-94vw">
    <NForm label-placement="left" label-width="92" size="small">
      <NFormItem required>
        <template #label><span class="sct-field-label">细则名称</span></template>
        <NInput v-model:value="newRuleForm.label" placeholder="如：参加社区志愿服务" />
      </NFormItem>
      <NFormItem>
        <template #label><span class="sct-field-label">细则说明</span></template>
        <NInput v-model:value="newRuleForm.description" placeholder="如：每次加 2 分，需留存照片或签到" />
      </NFormItem>
      <div class="grid grid-cols-2 gap-10px">
        <NFormItem>
          <template #label><span class="sct-field-label">默认分值</span></template>
          <NInputNumber v-model:value="newRuleForm.default_score" :step="0.5" class="w-full" />
        </NFormItem>
        <NFormItem>
          <template #label><span class="sct-field-label">计分方式</span></template>
          <NSelect
            v-model:value="newRuleForm.calc_mode"
            :options="[
              { label: '固定分值', value: 'fixed' },
              { label: '按次数乘算', value: 'count' },
              { label: '集体折半(核心/参与)', value: 'role_half' },
              { label: '按志愿时长(/20h)', value: 'hours_20' }
            ]"
          />
        </NFormItem>
      </div>
    </NForm>
    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton size="small" @click="addRuleModalShow = false">取消</NButton>
        <NButton size="small" type="primary" @click="handleAddRule">添加细则</NButton>
      </div>
    </template>
  </NModal>

  <!-- 导出 .sctpreset 单位配置包弹窗 -->
  <NModal v-model:show="presetModalShow" preset="card" title="导出单位配置包（.sctpreset）" class="w-480px max-w-94vw">
    <div class="flex flex-col gap-12px">
      <div class="text-12px text-[var(--sct-muted)] leading-relaxed">
        单位配置包仅包含制度规则与模板，
        <strong>不含任何个人姓名、党费或隐私台账</strong>
        ，可直接分享给同单位其他党支部一键导入统一口径。
      </div>
      <NInput v-model:value="presetExportName" size="small" placeholder="配置包名称" />
      <NCheckboxGroup v-model:value="presetExportIncludes">
        <div class="flex flex-col gap-8px">
          <NCheckbox value="point_scheme">当前积分/评定方案（{{ draft.name }}）</NCheckbox>
          <NCheckbox value="scene">支部场景与扩展模块配置</NCheckbox>
          <NCheckbox value="custom_fields">
            花名册自定义扩展字段（{{ workStore.workspaceConfig.customFields.length }} 项）
          </NCheckbox>
          <NCheckbox value="doc_templates">材料库公文模板（{{ workStore.docTemplates.length }} 套）</NCheckbox>
        </div>
      </NCheckboxGroup>
    </div>
    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton size="small" @click="presetModalShow = false">取消</NButton>
        <NButton size="small" type="primary" @click="handleExportUnitPreset">
          <template #icon><SvgIcon icon="lucide:download" /></template>
          导出 .sctpreset
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.scheme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 10px 12px 10px 16px;
  border-radius: var(--sct-radius, 7px);
  border: 1px solid var(--sct-border);
  background: var(--sct-container);
  color: var(--sct-ink);
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease;
}
.scheme-card::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 6px;
  bottom: 6px;
  width: 3.5px;
  border-radius: 999px;
  background: transparent;
  transition: background-color 0.14s ease;
}
.scheme-card:hover {
  border-color: var(--sct-ink);
}
.scheme-card.is-active {
  border-color: color-mix(in srgb, var(--sct-accent) 45%, transparent);
  background: color-mix(in srgb, var(--sct-accent) 7%, var(--sct-container));
}
.scheme-card.is-active::before {
  background: var(--sct-accent);
}

.dim-card {
  position: relative;
  padding: 10px 12px 10px 17px;
  border-radius: var(--sct-radius, 7px);
  border: 1px solid color-mix(in srgb, var(--dim-color, var(--sct-accent)) 28%, var(--sct-border));
  background: var(--sct-container);
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease;
}
.dim-card::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 7px;
  bottom: 7px;
  width: 3.5px;
  border-radius: 999px;
  background: var(--dim-color, var(--sct-accent));
}
.dim-card:hover {
  border-color: color-mix(in srgb, var(--dim-color, var(--sct-accent)) 55%, var(--sct-border));
}
.dim-card.is-active {
  border-color: color-mix(in srgb, var(--dim-color, var(--sct-accent)) 60%, transparent);
  background: color-mix(in srgb, var(--dim-color, var(--sct-accent)) 8%, var(--sct-container));
}
</style>
