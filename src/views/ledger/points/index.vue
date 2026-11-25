<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue';
import { NButton, NTag } from 'naive-ui';
import dayjs from 'dayjs';
import { POINT_PASS_LINE } from '@/constants/party-points';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';
import {
  buildBranchPointsPrintHtml,
  computeMemberYearPoints,
  exportBranchPointsExcel,
  formatScore,
  roundScore
} from '@/utils/party-points';
import type { MemberYearPointSummary } from '@/utils/party-points';
import { printHtml } from '@/utils/print';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSvgIcon } from '@/hooks/common/icon';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import { useTableColumnLayout } from '@/hooks/common/table-layout';
import MemberPointsDrawer from './modules/member-points-drawer.vue';
import PointsRulesConfigModal from './modules/rules-config-modal.vue';

defineOptions({ name: 'PartyPointsPage' });

const workStore = useWorkDataStore();
const { SvgIconVNode } = useSvgIcon();
const { bi } = useSctI18n();

// ---------------- 年度选择 ----------------
const currentYear = dayjs().year();
const selectedYear = ref<number>(currentYear);

const yearOptions = computed(() => {
  const years = new Set<number>([currentYear - 1, currentYear, currentYear + 1]);
  workStore.pointRecords.forEach(r => {
    if (Number.isInteger(r.year)) years.add(r.year);
  });
  workStore.pointVetoes.forEach(v => {
    if (Number.isInteger(v.year)) years.add(v.year);
  });
  return Array.from(years)
    .sort((a, b) => b - a)
    .map(y => ({ label: `${y} 年度`, value: y }));
});

// ---------------- 考核范围：正式党员 + 预备党员 ----------------
const partyMembers = computed(() => workStore.members.filter(m => m.type === '正式党员' || m.type === '预备党员'));

const vetoMap = computed(() => {
  const m = new Map<string, Sct.PointVeto>();
  workStore.pointVetoes.filter(v => v.year === selectedYear.value).forEach(v => m.set(v.member_id, v));
  return m;
});

/** 先按年度做单次 O(R) 分组，避免对每位党员重复扫描全量积分流水（500 人场景提速 1~2 个数量级） */
const yearRecordsByMember = computed(() => {
  const map = new Map<string, Sct.PointRecord[]>();
  const targetYear = selectedYear.value;
  for (const r of workStore.pointRecords) {
    if (r.year !== targetYear) continue;
    const bucket = map.get(r.member_id);
    if (bucket) {
      bucket.push(r);
    } else {
      map.set(r.member_id, [r]);
    }
  }
  return map;
});

const allSummaries = computed<MemberYearPointSummary[]>(() => {
  const recMap = yearRecordsByMember.value;
  return partyMembers.value
    .map(member =>
      computeMemberYearPoints(member, selectedYear.value, recMap.get(member.id) ?? [], vetoMap.value.get(member.id))
    )
    .sort((a, b) => b.totalScore - a.totalScore || a.member.name.localeCompare(b.member.name, 'zh-CN'));
});

// ---------------- 顶部统计 ----------------
const kpiStats = computed(() => {
  const list = allSummaries.value;
  const formalCount = list.filter(s => s.member.type === '正式党员').length;
  const probationCount = list.length - formalCount;
  const avg = list.length ? roundScore(list.reduce((acc, s) => acc + s.totalScore, 0) / list.length) : 0;
  const max = list.length ? Math.max(...list.map(s => s.totalScore)) : 0;
  const warningCount = list.filter(s => s.isWarning).length;
  const pendingItems = list.reduce((acc, s) => acc + s.pendingCount, 0);
  const pendingMembers = list.filter(s => s.pendingCount > 0).length;
  return {
    total: list.length,
    formalCount,
    probationCount,
    avg,
    max,
    warningCount,
    pendingItems,
    pendingMembers
  };
});

// ---------------- 筛选、搜索与分页 ----------------
const filterMode = ref<'all' | 'warning' | 'pending' | 'pass'>('all');
const searchKeyword = ref('');

const pagination = reactive({
  page: 1,
  pageSize: 15,
  showSizePicker: true,
  pageSizes: [15, 20, 50],
  onChange: (page: number) => {
    pagination.page = page;
  },
  onUpdatePageSize: (pageSize: number) => {
    pagination.pageSize = pageSize;
    pagination.page = 1;
  }
});

watch([filterMode, searchKeyword, selectedYear], () => {
  pagination.page = 1;
});

const filteredSummaries = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  return allSummaries.value.filter(s => {
    if (filterMode.value === 'warning' && !s.isWarning) return false;
    if (filterMode.value === 'pending' && s.pendingCount === 0) return false;
    if (filterMode.value === 'pass' && s.isWarning) return false;
    if (!kw) return true;
    return [s.member.name, s.member.student_id, s.member.code, s.member.group, s.member.type]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(kw));
  });
});

// ---------------- 抽屉与规则弹窗 ----------------
const drawerShow = ref(false);
const activeMemberId = ref<string | null>(null);
const rulesModalShow = ref(false);
const exporting = ref(false);

function openMemberDrawer(memberId: string) {
  activeMemberId.value = memberId;
  drawerShow.value = true;
}

async function handleExportExcel() {
  exporting.value = true;
  try {
    const status = await exportBranchPointsExcel({
      branchName: workStore.branchName,
      year: selectedYear.value,
      summaries: allSummaries.value,
      records: workStore.pointRecords,
      memberMap: workStore.memberById
    });
    if (status === 'saved') {
      window.$message?.success('已导出《支部积分汇总表》+《全员积分明细流水》Excel');
    }
  } catch (err) {
    window.$message?.error(`导出失败：${(err as Error).message}`);
  } finally {
    exporting.value = false;
  }
}

function handlePrintBranchRecord() {
  const html = buildBranchPointsPrintHtml({
    branchName: workStore.branchName,
    year: selectedYear.value,
    summaries: allSummaries.value
  });
  printHtml(`${workStore.branchName}_${selectedYear.value}年度党员积分支部记录表`, html);
}

// ---------------- 表格列配置（支持拖拽换列与平滑调列宽） ----------------
function thLabel(icon: string, text: string) {
  return h('span', { class: 'inline-flex items-center gap-4px' }, [
    SvgIconVNode({ icon, fontSize: 13 })?.(),
    h('span', text)
  ]);
}

const DEFAULT_POINT_COLS = [
  'idx',
  'name',
  'type',
  'baseScore',
  'dutyScore',
  'bonusScore',
  'penaltyDeduction',
  'totalScore',
  'status',
  'op'
] as const;

const columnMap = computed(() => ({
  idx: {
    defaultWidth: 46,
    minWidth: 42,
    align: 'center' as const,
    titleContent: () => thLabel('lucide:hash', bi('序号', '#')),
    render: (_row: MemberYearPointSummary, index: number) => h('span', { class: 'text-gray-400 font-mono' }, index + 1)
  },
  name: {
    defaultWidth: 102,
    minWidth: 88,
    titleContent: () => thLabel('lucide:user', bi('党员姓名', 'Member')),
    render: (row: MemberYearPointSummary) =>
      h('div', { class: 'flex items-center gap-6px' }, [
        h('span', {
          class: 'inline-block size-8px shrink-0 rounded-full',
          style: { background: MEMBER_TYPE_COLORS[row.member.type] }
        }),
        h('span', { class: 'font-semibold text-[var(--sct-ink)]' }, row.member.name)
      ])
  },
  type: {
    defaultWidth: 80,
    minWidth: 72,
    align: 'center' as const,
    titleContent: () => thLabel('lucide:badge-check', bi('身份', 'Status')),
    render: (row: MemberYearPointSummary) =>
      h(
        NTag,
        {
          size: 'small',
          bordered: false,
          type: row.member.type === '正式党员' ? 'error' : 'warning'
        },
        { default: () => row.member.type }
      )
  },
  baseScore: {
    defaultWidth: 88,
    minWidth: 78,
    align: 'center' as const,
    sorter: (a: MemberYearPointSummary, b: MemberYearPointSummary) => a.baseScore - b.baseScore,
    titleContent: () => thLabel('lucide:shield', bi('基础分(60)', 'Base')),
    render: (row: MemberYearPointSummary) =>
      h('div', { class: 'font-mono' }, [
        h(
          'span',
          {
            class: 'font-bold',
            style: { color: row.vetoActive || row.baseDeducted > 0 ? '#dc2626' : '#2563eb' }
          },
          formatScore(row.baseScore)
        ),
        row.baseDeducted > 0 && !row.vetoActive
          ? h('span', { class: 'ml-3px text-11px text-[#dc2626]' }, `(-${formatScore(row.baseDeducted)})`)
          : null
      ])
  },
  dutyScore: {
    defaultWidth: 124,
    minWidth: 108,
    align: 'center' as const,
    sorter: (a: MemberYearPointSummary, b: MemberYearPointSummary) => a.dutyScore - b.dutyScore,
    titleContent: () => thLabel('lucide:sparkles', bi('履职分(≤40)', 'Duty')),
    render: (row: MemberYearPointSummary) =>
      h('div', { class: 'flex flex-col items-center leading-tight' }, [
        h('span', { class: 'font-bold font-mono text-[#16a34a]' }, `+${formatScore(row.dutyScore)}`),
        h(
          'span',
          { class: 'text-10px text-gray-400 font-mono' },
          `学${formatScore(row.dutyStudyScore)} · 践${formatScore(row.dutyPracticeScore)} · 志${formatScore(row.dutyVolunteerScore)}`
        )
      ])
  },
  bonusScore: {
    defaultWidth: 72,
    minWidth: 64,
    align: 'center' as const,
    sorter: (a: MemberYearPointSummary, b: MemberYearPointSummary) => a.bonusScore - b.bonusScore,
    titleContent: () => thLabel('lucide:star', bi('附加分', 'Bonus')),
    render: (row: MemberYearPointSummary) =>
      h(
        'span',
        { class: 'font-mono font-semibold', style: { color: row.bonusScore > 0 ? '#d97706' : 'var(--sct-muted)' } },
        row.bonusScore > 0 ? `+${formatScore(row.bonusScore)}` : '0'
      )
  },
  penaltyDeduction: {
    defaultWidth: 72,
    minWidth: 64,
    align: 'center' as const,
    sorter: (a: MemberYearPointSummary, b: MemberYearPointSummary) => a.penaltyDeduction - b.penaltyDeduction,
    titleContent: () => thLabel('lucide:alert-triangle', bi('减扣分', 'Penalty')),
    render: (row: MemberYearPointSummary) =>
      h(
        'span',
        {
          class: 'font-mono font-semibold',
          style: { color: row.penaltyDeduction > 0 ? '#dc2626' : 'var(--sct-muted)' }
        },
        row.penaltyDeduction > 0 ? `-${formatScore(row.penaltyDeduction)}` : '0'
      )
  },
  totalScore: {
    defaultWidth: 86,
    minWidth: 76,
    align: 'center' as const,
    sorter: (a: MemberYearPointSummary, b: MemberYearPointSummary) => a.totalScore - b.totalScore,
    titleContent: () => thLabel('lucide:award', bi('年度总分', 'Total')),
    render: (row: MemberYearPointSummary) =>
      h(
        'span',
        {
          class: 'text-15px font-extrabold font-mono',
          style: { color: row.isWarning ? '#dc2626' : '#A81C24' }
        },
        formatScore(row.totalScore)
      )
  },
  status: {
    defaultWidth: 102,
    minWidth: 90,
    align: 'center' as const,
    titleContent: () => thLabel('lucide:clipboard-check', bi('评定 / 待核实', 'Review')),
    render: (row: MemberYearPointSummary) =>
      h('div', { class: 'flex flex-wrap items-center justify-center gap-4px' }, [
        row.vetoActive
          ? h(NTag, { size: 'tiny', type: 'error' }, { default: () => '一票否决' })
          : row.totalScore < POINT_PASS_LINE
            ? h(NTag, { size: 'tiny', type: 'error' }, { default: () => '<60 预警' })
            : h(NTag, { size: 'tiny', type: 'success', bordered: false }, { default: () => '合格' }),
        row.pendingCount > 0
          ? h(NTag, { size: 'tiny', type: 'warning' }, { default: () => `${row.pendingCount} 待核实` })
          : null
      ])
  },
  op: {
    defaultWidth: 148,
    minWidth: 136,
    fixed: 'right' as const,
    align: 'center' as const,
    resizable: false,
    reorderable: false,
    titleContent: () => thLabel('lucide:sliders-horizontal', bi('操作', 'Action')),
    render: (row: MemberYearPointSummary) =>
      h(
        NButton,
        {
          size: 'small',
          type: 'primary',
          class: 'sct-op-btn sct-op-btn--primary',
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            openMemberDrawer(row.member.id);
          }
        },
        {
          icon: SvgIconVNode({
            icon: row.totalRecordCount > 0 ? 'lucide:clipboard-check' : 'lucide:plus-circle',
            fontSize: 14
          }),
          default: () => (row.totalRecordCount > 0 ? `登记/审核(${row.totalRecordCount})` : '登记积分')
        }
      )
  }
}));

const { columns, scrollX, hasCustomLayout, resetLayout } = useTableColumnLayout<MemberYearPointSummary>({
  storageKey: 'party-points',
  defaultOrder: DEFAULT_POINT_COLS,
  pinnedEndKeys: ['op'],
  columnMap,
  minTableWidth: 820
});

function rowProps(row: MemberYearPointSummary) {
  return {
    style: 'cursor: pointer;',
    onClick: () => openMemberDrawer(row.member.id)
  };
}
</script>

<template>
  <div class="min-h-520px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex flex-wrap items-center gap-10px">
          <span class="text-16px font-bold">{{ bi('党员积分', 'Party Member Points') }}</span>
          <NTag size="tiny" type="warning" :bordered="false" round>Preview</NTag>
          <NSelect v-model:value="selectedYear" :options="yearOptions" size="small" class="w-116px" />
          <span class="hidden text-12px text-gray-400 xl:inline">
            {{
              bi(
                '年度总积分 = 基础分(60) + 履职分(≤40) + 附加分 - 减扣分',
                'Total = Base(60) + Duty(≤40) + Bonus - Penalty'
              )
            }}
          </span>
        </div>
      </template>

      <template #header-extra>
        <div class="flex flex-wrap items-center gap-8px">
          <NButton size="small" secondary @click="rulesModalShow = true">
            <template #icon><SvgIcon icon="lucide:settings-2" /></template>
            {{ bi('考核标准设置', 'Scoring Rules') }}
          </NButton>
          <NButton size="small" secondary :loading="exporting" @click="handleExportExcel">
            <template #icon><SvgIcon icon="lucide:file-spreadsheet" /></template>
            {{ bi('导出 Excel（双表）', 'Export Excel') }}
          </NButton>
          <NButton size="small" type="primary" @click="handlePrintBranchRecord">
            <template #icon><SvgIcon icon="lucide:printer" /></template>
            {{ bi('打印《支部记录表》', 'Print Record Sheet') }}
          </NButton>
        </div>
      </template>

      <!-- 顶部统计指标（前两项为静态汇总，后两项为可点击快捷筛选按钮，视觉清晰区分） -->
      <div class="mb-14px flex flex-wrap items-center gap-10px">
        <div class="flex items-center gap-4px rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          <SvgIcon icon="lucide:users" class="text-14px text-gray-400" />
          <span>{{ bi('考核党员', 'Members') }}</span>
          <b class="text-[#A81C24] font-mono">{{ kpiStats.total }}</b>
          <span class="ml-2px text-12px text-gray-500">
            {{
              bi(
                `（正式 ${kpiStats.formalCount} · 预备 ${kpiStats.probationCount}）`,
                `(${kpiStats.formalCount} Full · ${kpiStats.probationCount} Prob.)`
              )
            }}
          </span>
        </div>
        <div class="flex items-center gap-4px rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          <SvgIcon icon="lucide:trending-up" class="text-14px text-gray-400" />
          <span>{{ bi('支部平均分', 'Average') }}</span>
          <b class="font-mono text-[#2563eb]">{{ formatScore(kpiStats.avg) }}</b>
          <span class="ml-4px text-12px text-gray-500">
            {{ bi(`最高 ${formatScore(kpiStats.max)} 分`, `Max ${formatScore(kpiStats.max)}`) }}
          </span>
        </div>

        <button
          type="button"
          class="points-kpi-btn points-kpi-btn--warn"
          :class="{ 'is-active': filterMode === 'warning' }"
          :title="bi('点击筛选 <60 分或一票否决预警党员', 'Click to filter warning members')"
          @click="filterMode = filterMode === 'warning' ? 'all' : 'warning'"
        >
          <SvgIcon icon="lucide:alert-circle" class="text-14px" style="color: #dc2626" />
          <span>{{ bi('<60分 / 否决预警', 'Warnings') }}</span>
          <b class="font-mono" :style="{ color: kpiStats.warningCount > 0 ? '#dc2626' : '#16a34a' }">
            {{ kpiStats.warningCount }}
          </b>
          <span>{{ bi('人', '') }}</span>
          <span class="points-kpi-btn__cue">
            <SvgIcon :icon="filterMode === 'warning' ? 'lucide:check' : 'lucide:list-filter'" class="text-11px" />
            <span>{{ filterMode === 'warning' ? bi('已筛选', 'Active') : bi('筛选', 'Filter') }}</span>
          </span>
        </button>

        <button
          type="button"
          class="points-kpi-btn points-kpi-btn--pending"
          :class="{ 'is-active': filterMode === 'pending' }"
          :title="bi('点击筛选存在待核实申报条目的党员', 'Click to filter pending review members')"
          @click="filterMode = filterMode === 'pending' ? 'all' : 'pending'"
        >
          <SvgIcon icon="lucide:clock" class="text-14px" style="color: #d97706" />
          <span>{{ bi('待核实申报', 'Pending Review') }}</span>
          <b class="font-mono" :style="{ color: kpiStats.pendingItems > 0 ? '#d97706' : 'var(--sct-ink)' }">
            {{ kpiStats.pendingItems }}
          </b>
          <span class="text-12px text-gray-500">
            {{ bi(`条（${kpiStats.pendingMembers} 人）`, `(${kpiStats.pendingMembers})`) }}
          </span>
          <span class="points-kpi-btn__cue">
            <SvgIcon :icon="filterMode === 'pending' ? 'lucide:check' : 'lucide:list-filter'" class="text-11px" />
            <span>{{ filterMode === 'pending' ? bi('已筛选', 'Active') : bi('筛选', 'Filter') }}</span>
          </span>
        </button>
      </div>

      <!-- 单行筛选与搜索栏 -->
      <div class="mb-10px flex flex-wrap items-center justify-between gap-10px">
        <div class="flex flex-wrap items-center gap-8px">
          <NRadioGroup v-model:value="filterMode" size="small">
            <NRadioButton value="all">{{ bi('全部', 'All') }} ({{ allSummaries.length }})</NRadioButton>
            <NRadioButton value="warning">{{ bi('预警', 'Warning') }} ({{ kpiStats.warningCount }})</NRadioButton>
            <NRadioButton value="pending">{{ bi('有待核实', 'Pending') }} ({{ kpiStats.pendingMembers }})</NRadioButton>
            <NRadioButton value="pass">
              {{ bi('合格', 'Pass') }} ({{ allSummaries.length - kpiStats.warningCount }})
            </NRadioButton>
          </NRadioGroup>
          <div class="w-210px shrink-0">
            <NInput
              v-model:value="searchKeyword"
              size="small"
              clearable
              :placeholder="bi('搜索党员姓名、学号、编号…', 'Search name, student ID…')"
            >
              <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
            </NInput>
          </div>
          <NButton size="small" secondary :disabled="!hasCustomLayout" @click="resetLayout">
            <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
            {{ bi('重置列宽', 'Reset Columns') }}
          </NButton>
        </div>
        <span class="text-12px text-gray-400">
          {{
            bi(
              '点击任意党员行打开侧滑抽屉，逐条登记与审核本年度积分',
              'Click any member row to record & review annual points'
            )
          }}
        </span>
      </div>

      <!-- 主表 -->
      <NDataTable
        :columns="columns"
        :data="filteredSummaries"
        :row-key="(r: MemberYearPointSummary) => r.member.id"
        :row-props="rowProps"
        :scroll-x="scrollX"
        :pagination="pagination"
        size="small"
        striped
      />
    </NCard>

    <!-- 党员个人积分档案与录入审核抽屉 -->
    <MemberPointsDrawer v-model:show="drawerShow" :member-id="activeMemberId" :year="selectedYear" />

    <!-- 考核标准设置弹窗 -->
    <PointsRulesConfigModal v-model:show="rulesModalShow" />
  </div>
</template>

<style scoped>
.points-kpi-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 11px;
  font-size: 13px;
  color: var(--sct-ink);
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    transform 0.16s ease,
    box-shadow 0.16s ease;
}

.points-kpi-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.07);
}

.points-kpi-btn--warn:hover {
  border-color: rgba(220, 38, 38, 0.55);
}

.points-kpi-btn--pending:hover {
  border-color: rgba(217, 119, 6, 0.55);
}

.points-kpi-btn--warn.is-active {
  background: var(--sct-err-soft);
  border-color: #dc2626;
}

.points-kpi-btn--pending.is-active {
  background: var(--sct-warn-soft);
  border-color: #d97706;
}

.points-kpi-btn__cue {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
  padding: 1px 6px;
  font-size: 11px;
  color: var(--sct-muted);
  background: var(--sct-soft);
  border-radius: 999px;
}

.points-kpi-btn--warn.is-active .points-kpi-btn__cue {
  color: #dc2626;
  background: var(--sct-container);
}

.points-kpi-btn--pending.is-active .points-kpi-btn__cue {
  color: #d97706;
  background: var(--sct-container);
}
</style>
