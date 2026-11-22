<script setup lang="ts">
import { computed, h, ref } from 'vue';
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

const allSummaries = computed<MemberYearPointSummary[]>(() =>
  partyMembers.value
    .map(member =>
      computeMemberYearPoints(member, selectedYear.value, workStore.pointRecords, vetoMap.value.get(member.id))
    )
    .sort((a, b) => b.totalScore - a.totalScore || a.member.name.localeCompare(b.member.name, 'zh-CN'))
);

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

// ---------------- 筛选与搜索 ----------------
const filterMode = ref<'all' | 'warning' | 'pending' | 'pass'>('all');
const searchKeyword = ref('');

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
    defaultWidth: 50,
    minWidth: 44,
    align: 'center' as const,
    titleContent: () => thLabel('lucide:hash', bi('序号', '#')),
    render: (_row: MemberYearPointSummary, index: number) => h('span', { class: 'text-gray-400 font-mono' }, index + 1)
  },
  name: {
    defaultWidth: 112,
    minWidth: 96,
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
    defaultWidth: 84,
    minWidth: 76,
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
    defaultWidth: 92,
    minWidth: 82,
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
    defaultWidth: 136,
    minWidth: 112,
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
    defaultWidth: 76,
    minWidth: 68,
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
    defaultWidth: 76,
    minWidth: 68,
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
    defaultWidth: 92,
    minWidth: 82,
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
    defaultWidth: 112,
    minWidth: 96,
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
    defaultWidth: 102,
    minWidth: 94,
    align: 'center' as const,
    resizable: false,
    reorderable: false,
    titleContent: () => thLabel('lucide:sliders-horizontal', bi('操作', 'Action')),
    render: (row: MemberYearPointSummary) =>
      h(
        NButton,
        {
          size: 'tiny',
          type: 'primary',
          secondary: true,
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            openMemberDrawer(row.member.id);
          }
        },
        { default: () => (row.totalRecordCount > 0 ? `登记/审核(${row.totalRecordCount})` : '登记积分') }
      )
  }
}));

const { columns, scrollX, hasCustomLayout, resetLayout } = useTableColumnLayout<MemberYearPointSummary>({
  storageKey: 'party-points',
  defaultOrder: DEFAULT_POINT_COLS,
  pinnedEndKeys: ['op'],
  columnMap,
  minTableWidth: 860
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

      <!-- 顶部统计指标 -->
      <div class="mb-14px flex flex-wrap gap-10px">
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          {{ bi('考核党员', 'Members') }}
          <b class="text-[#A81C24]">{{ kpiStats.total }}</b>
          <span class="ml-4px text-12px text-gray-500">
            （正式 {{ kpiStats.formalCount }} · 预备 {{ kpiStats.probationCount }}）
          </span>
        </div>
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          {{ bi('支部平均分', 'Average') }}
          <b class="font-mono text-[#2563eb]">{{ formatScore(kpiStats.avg) }}</b>
          <span class="ml-6px text-12px text-gray-500">最高 {{ formatScore(kpiStats.max) }} 分</span>
        </div>
        <div
          role="button"
          tabindex="0"
          class="cursor-pointer rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px transition hover:opacity-85"
          :class="filterMode === 'warning' ? 'ring-1 ring-[#dc2626]' : ''"
          @click="filterMode = filterMode === 'warning' ? 'all' : 'warning'"
        >
          {{ bi('<60分 / 否决预警', 'Warnings') }}
          <b class="ml-4px font-mono" :style="{ color: kpiStats.warningCount > 0 ? '#dc2626' : '#16a34a' }">
            {{ kpiStats.warningCount }}
          </b>
          {{ bi('人', '') }}
        </div>
        <div
          role="button"
          tabindex="0"
          class="cursor-pointer rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px transition hover:opacity-85"
          :class="filterMode === 'pending' ? 'ring-1 ring-[#d97706]' : ''"
          @click="filterMode = filterMode === 'pending' ? 'all' : 'pending'"
        >
          {{ bi('待核实申报', 'Pending Review') }}
          <b class="ml-4px font-mono" :style="{ color: kpiStats.pendingItems > 0 ? '#d97706' : 'var(--sct-muted)' }">
            {{ kpiStats.pendingItems }}
          </b>
          <span class="ml-2px text-12px text-gray-500">条（{{ kpiStats.pendingMembers }} 人）</span>
        </div>
      </div>

      <!-- 单行筛选与搜索栏 -->
      <div class="mb-10px flex flex-wrap items-center justify-between gap-10px">
        <div class="flex flex-wrap items-center gap-8px">
          <NRadioGroup v-model:value="filterMode" size="small">
            <NRadioButton value="all">全部 ({{ allSummaries.length }})</NRadioButton>
            <NRadioButton value="warning">预警 ({{ kpiStats.warningCount }})</NRadioButton>
            <NRadioButton value="pending">有待核实 ({{ kpiStats.pendingMembers }})</NRadioButton>
            <NRadioButton value="pass">合格 ({{ allSummaries.length - kpiStats.warningCount }})</NRadioButton>
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
        :pagination="{ pageSize: 20, showSizePicker: true, pageSizes: [15, 20, 50] }"
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

<style scoped></style>
