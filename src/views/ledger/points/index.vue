<script setup lang="ts">
/**
 * 党员积分管理主视图（v0.2.7 高校 60+40 分桶制）
 * - 基础分 60（5 项扣至 0）+ 履职分 ≤40（专业 15 / 实践 10 / 志愿 15）+ 附加分 - 减扣分
 * - 支持一键同步考勤 / 党费 / 志愿时长待核实草稿
 * - 支持考核细则微调弹窗、脱敏公示版 / 全量报送版 Excel 导出与《支部记录表》打印
 */
import { computed, h, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { NButton, NTag } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import dayjs from 'dayjs';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';
import { isMemberActive } from '@/constants/workspace-presets';
import { onTourCommand } from '@/utils/onboarding-bus';
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
import PrivacyExportModal from '@/components/custom/privacy-export-modal.vue';
import MemberPointsDrawer from './modules/member-points-drawer.vue';
import PointsRulesConfigModal from './modules/rules-config-modal.vue';
import SyncDraftsModal from './modules/sync-drafts-modal.vue';

defineOptions({ name: 'PartyPointsPage' });

const workStore = useWorkDataStore();
const { SvgIconVNode } = useSvgIcon();
const { bi } = useSctI18n();

const currentYear = dayjs().year();
const selectedYear = ref<number>(currentYear);

const yearOptions = computed(() => {
  const years = new Set<number>([currentYear - 1, currentYear, currentYear + 1]);
  workStore.pointRecords.forEach(r => {
    if (Number.isInteger(r.year)) years.add(r.year);
  });
  return Array.from(years)
    .sort((a, b) => b - a)
    .map(y => ({ label: `${y} 年度`, value: y }));
});

const activeScheme = computed<Sct.PointScheme>(() => workStore.activePointScheme);

const yearRecordsByMember = computed(() => {
  const map = new Map<string, Sct.PointRecord[]>();
  const targetYear = selectedYear.value;
  for (const r of workStore.pointRecords) {
    if (r.year !== targetYear) continue;
    const arr = map.get(r.member_id);
    if (arr) arr.push(r);
    else map.set(r.member_id, [r]);
  }
  return map;
});

/** 考核范围：在册正式/预备党员 + 该年度已有积分记录的历史归档党员（保证往年账实相符） */
const partyMembers = computed(() => {
  const hasRecIds = new Set(yearRecordsByMember.value.keys());
  return workStore.members.filter(
    m => (m.type === '正式党员' || m.type === '预备党员') && (isMemberActive(m) || hasRecIds.has(m.id))
  );
});

const vetoMap = computed(() => {
  const m = new Map<string, Sct.PointVeto>();
  workStore.pointVetoes.filter(v => v.year === selectedYear.value).forEach(v => m.set(v.member_id, v));
  return m;
});

const allSummaries = computed<MemberYearPointSummary[]>(() => {
  const recMap = yearRecordsByMember.value;
  const scheme = activeScheme.value;
  return partyMembers.value
    .map(member =>
      computeMemberYearPoints(
        member,
        selectedYear.value,
        recMap.get(member.id) ?? [],
        vetoMap.value.get(member.id),
        scheme
      )
    )
    .sort((a, b) => b.totalScore - a.totalScore || a.member.name.localeCompare(b.member.name, 'zh-CN'));
});

const kpiStats = computed(() => {
  const list = allSummaries.value;
  const formalCount = list.filter(s => s.member.type === '正式党员').length;
  const probationCount = list.length - formalCount;
  const avg = list.length ? roundScore(list.reduce((acc, s) => acc + s.totalScore, 0) / list.length) : 0;
  const max = list.length ? Math.max(...list.map(s => s.totalScore)) : 0;
  const warningCount = list.filter(s => s.isWarning).length;
  const pendingItems = list.reduce((acc, s) => acc + s.pendingCount, 0);
  const pendingMembers = list.filter(s => s.pendingCount > 0).length;
  return { total: list.length, formalCount, probationCount, avg, max, warningCount, pendingItems, pendingMembers };
});

const filterMode = ref<'all' | 'warning' | 'pending' | 'pass'>('all');
const searchKeyword = ref('');
const pagination = reactive({
  page: 1,
  pageSize: 15,
  showSizePicker: true,
  pageSizes: [15, 25, 50],
  onChange: (p: number) => {
    pagination.page = p;
  },
  onUpdatePageSize: (ps: number) => {
    pagination.pageSize = ps;
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

// 抽屉与弹窗
const drawerShow = ref(false);
const activeMemberId = ref<string | null>(null);
const rulesModalShow = ref(false);
const syncModalShow = ref(false);
const exportModalShow = ref(false);
const exporting = ref(false);

function openMemberDrawer(memberId: string) {
  activeMemberId.value = memberId;
  drawerShow.value = true;
}

const offPointsTour = onTourCommand(cmd => {
  if (cmd === 'tour:cleanup') {
    rulesModalShow.value = false;
    syncModalShow.value = false;
    drawerShow.value = false;
  }
});
onBeforeUnmount(offPointsTour);

async function handleExportExcelWithPrivacy(privacyMode: Sct.ExportPrivacyMode) {
  exporting.value = true;
  try {
    const status = await exportBranchPointsExcel({
      branchName: workStore.branchName,
      year: selectedYear.value,
      scheme: activeScheme.value,
      summaries: allSummaries.value,
      records: workStore.pointRecords,
      memberMap: workStore.memberById,
      privacyMode
    });
    if (status === 'saved') {
      exportModalShow.value = false;
      window.$message?.success('已导出双 Sheet 党员积分 Excel');
    }
  } finally {
    exporting.value = false;
  }
}

function handlePrintBranchRecord() {
  const html = buildBranchPointsPrintHtml({
    branchName: workStore.branchName,
    year: selectedYear.value,
    scheme: activeScheme.value,
    summaries: allSummaries.value
  });
  printHtml(`${workStore.branchName}_${selectedYear.value}年度党员积分记录表`, html);
}

/** 固定高校 60+40 分桶表格列 */
const columns = computed<DataTableColumns<MemberYearPointSummary>>(() => [
  {
    title: '#',
    key: 'idx',
    width: 46,
    align: 'center',
    render: (_row, index) => h('span', { class: 'font-mono text-gray-400' }, index + 1)
  },
  {
    title: bi('党员姓名', 'Member'),
    key: 'name',
    width: 118,
    render: row =>
      h('div', { class: 'flex items-center gap-6px' }, [
        h('span', {
          class: 'inline-block size-8px shrink-0 rounded-full',
          style: { background: MEMBER_TYPE_COLORS[row.member.type] }
        }),
        h('span', { class: 'font-semibold text-[var(--sct-ink)]' }, row.member.name),
        !isMemberActive(row.member) ? h(NTag, { size: 'tiny', bordered: false }, { default: () => '归档' }) : null
      ])
  },
  {
    title: bi('身份', 'Status'),
    key: 'type',
    width: 82,
    align: 'center',
    render: row =>
      h(
        NTag,
        { size: 'tiny', bordered: false, type: row.member.type === '正式党员' ? 'error' : 'warning' },
        { default: () => row.member.type }
      )
  },
  {
    title: bi('基础分 (/60)', 'Base'),
    key: 'baseScore',
    width: 96,
    align: 'center',
    sorter: (a, b) => a.baseScore - b.baseScore,
    render: row => h('span', { class: 'font-mono font-bold text-[#2563eb]' }, formatScore(row.baseScore))
  },
  {
    title: bi('专业 / 实践 / 志愿', 'Study/Prac/Vol'),
    key: 'dutyDetail',
    width: 138,
    align: 'center',
    render: row => {
      const study = row.dutyBuckets.find(d => d.id === 'duty_study')?.effective ?? 0;
      const practice = row.dutyBuckets.find(d => d.id === 'duty_practice')?.effective ?? 0;
      const vol = row.dutyBuckets.find(d => d.id === 'duty_volunteer')?.effective ?? 0;
      return h('span', { class: 'font-mono text-12px text-[var(--sct-muted)]' }, [
        formatScore(study),
        ' / ',
        formatScore(practice),
        ' / ',
        formatScore(vol)
      ]);
    }
  },
  {
    title: bi('履职分 (/40)', 'Duty'),
    key: 'dutyScore',
    width: 96,
    align: 'center',
    sorter: (a, b) => a.dutyScore - b.dutyScore,
    render: row => h('span', { class: 'font-mono font-bold text-[#16a34a]' }, `+${formatScore(row.dutyScore)}`)
  },
  {
    title: bi('附加 / 减扣', 'Bonus/Pen'),
    key: 'bonusPen',
    width: 96,
    align: 'center',
    render: row =>
      h('span', { class: 'font-mono text-12px' }, [
        h('span', { class: 'text-[#d97706]' }, `+${formatScore(row.bonusScore)}`),
        h('span', { class: 'mx-3px text-gray-400' }, '/'),
        h('span', { class: 'text-[#dc2626]' }, `-${formatScore(row.penaltyDeduction)}`)
      ])
  },
  {
    title: bi('年度总分', 'Total'),
    key: 'totalScore',
    width: 88,
    align: 'center',
    sorter: (a, b) => a.totalScore - b.totalScore,
    render: row =>
      h(
        'span',
        {
          class: 'font-mono text-15px font-extrabold',
          style: { color: row.isWarning ? '#dc2626' : '#A81C24' }
        },
        formatScore(row.totalScore)
      )
  },
  {
    title: bi('评定 / 待核实', 'Review'),
    key: 'status',
    width: 112,
    align: 'center',
    render: row =>
      h('div', { class: 'flex flex-wrap items-center justify-center gap-4px' }, [
        row.vetoActive
          ? h(NTag, { size: 'tiny', type: 'error' }, { default: () => '一票否决' })
          : row.isWarning
            ? h(NTag, { size: 'tiny', type: 'error' }, { default: () => '预警' })
            : h(NTag, { size: 'tiny', type: 'success', bordered: false }, { default: () => '合格' }),
        row.pendingCount > 0
          ? h(NTag, { size: 'tiny', type: 'warning' }, { default: () => `${row.pendingCount} 待核` })
          : null
      ])
  },
  {
    title: bi('操作', 'Action'),
    key: 'op',
    width: 132,
    fixed: 'right',
    align: 'center',
    render: row =>
      h(
        NButton,
        {
          size: 'tiny',
          class: 'sct-op-btn sct-op-btn--primary',
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            openMemberDrawer(row.member.id);
          }
        },
        {
          icon: SvgIconVNode({ icon: 'lucide:clipboard-check', fontSize: 13 }),
          default: () => (row.totalRecordCount > 0 ? `账单(${row.totalRecordCount})` : '登记积分')
        }
      )
  }
]);

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
          <span class="text-16px font-bold">{{ bi('党员积分管理', 'Party Member Points') }}</span>
          <NSelect v-model:value="selectedYear" :options="yearOptions" size="small" class="w-114px" />
          <NTag size="small" type="info" :bordered="false">基础 60 + 履职 40</NTag>
        </div>
      </template>

      <template #header-extra>
        <div data-tour="points-actions" class="flex flex-wrap items-center gap-8px">
          <NButton size="small" secondary @click="syncModalShow = true">
            <template #icon><SvgIcon icon="lucide:sparkles" /></template>
            {{ bi('一键同步草稿', 'Sync Drafts') }}
          </NButton>
          <NButton size="small" secondary @click="rulesModalShow = true">
            <template #icon><SvgIcon icon="lucide:sliders-horizontal" /></template>
            {{ bi('考核标准设置', 'Scoring Rules') }}
          </NButton>
          <NButton size="small" secondary :loading="exporting" @click="exportModalShow = true">
            <template #icon><SvgIcon icon="lucide:file-spreadsheet" /></template>
            {{ bi('导出 Excel', 'Export Excel') }}
          </NButton>
          <NButton size="small" type="primary" @click="handlePrintBranchRecord">
            <template #icon><SvgIcon icon="lucide:printer" /></template>
            {{ bi('打印记录表', 'Print Sheet') }}
          </NButton>
        </div>
      </template>

      <!-- 顶部 KPI 统计与可点击筛选胶囊 -->
      <div data-tour="points-kpi" class="mb-14px flex flex-wrap items-center gap-10px">
        <div class="flex items-center gap-4px rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          <SvgIcon icon="lucide:users" class="text-14px text-gray-400" />
          <span>考核党员</span>
          <b class="font-mono text-[#A81C24]">{{ kpiStats.total }}</b>
          <span class="text-12px text-gray-500">
            （正式 {{ kpiStats.formalCount }} · 预备 {{ kpiStats.probationCount }}）
          </span>
        </div>
        <div class="flex items-center gap-4px rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          <SvgIcon icon="lucide:trending-up" class="text-14px text-gray-400" />
          <span>平均分</span>
          <b class="font-mono text-[#2563eb]">{{ formatScore(kpiStats.avg) }}</b>
          <span class="text-12px text-gray-500">最高 {{ formatScore(kpiStats.max) }}</span>
        </div>

        <button
          type="button"
          class="points-kpi-btn points-kpi-btn--warn"
          :class="{ 'is-active': filterMode === 'warning' }"
          @click="filterMode = filterMode === 'warning' ? 'all' : 'warning'"
        >
          <SvgIcon icon="lucide:alert-circle" class="text-14px text-[#dc2626]" />
          <span>&lt;{{ activeScheme.pass_line }}分预警</span>
          <b class="font-mono" :style="{ color: kpiStats.warningCount > 0 ? '#dc2626' : '#16a34a' }">
            {{ kpiStats.warningCount }}
          </b>
        </button>

        <button
          type="button"
          class="points-kpi-btn points-kpi-btn--pending"
          :class="{ 'is-active': filterMode === 'pending' }"
          @click="filterMode = filterMode === 'pending' ? 'all' : 'pending'"
        >
          <SvgIcon icon="lucide:clock" class="text-14px text-[#d97706]" />
          <span>待核实申报</span>
          <b class="font-mono text-[#d97706]">{{ kpiStats.pendingItems }}</b>
          <span class="text-12px text-gray-500">条（{{ kpiStats.pendingMembers }} 人）</span>
        </button>
      </div>

      <!-- 筛选与搜索栏 -->
      <div class="mb-10px flex flex-wrap items-center justify-between gap-10px">
        <div class="flex flex-wrap items-center gap-8px">
          <NRadioGroup v-model:value="filterMode" size="small">
            <NRadioButton value="all">全部 ({{ allSummaries.length }})</NRadioButton>
            <NRadioButton value="warning">预警 ({{ kpiStats.warningCount }})</NRadioButton>
            <NRadioButton value="pending">待核实 ({{ kpiStats.pendingMembers }})</NRadioButton>
            <NRadioButton value="pass">合格 ({{ allSummaries.length - kpiStats.warningCount }})</NRadioButton>
          </NRadioGroup>
          <div class="w-210px shrink-0">
            <NInput v-model:value="searchKeyword" size="small" clearable placeholder="搜索姓名、学号、党小组…">
              <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
            </NInput>
          </div>
        </div>
        <span class="text-12px text-[var(--sct-muted)]">{{ activeScheme.description }}</span>
      </div>

      <NDataTable
        :columns="columns"
        :data="filteredSummaries"
        :pagination="pagination"
        :bordered="false"
        size="small"
        :scroll-x="960"
        :row-key="(r: MemberYearPointSummary) => r.member.id"
        :row-props="rowProps"
      />
    </NCard>

    <MemberPointsDrawer
      v-model:show="drawerShow"
      :member-id="activeMemberId"
      :year="selectedYear"
      :scheme="activeScheme"
    />

    <PointsRulesConfigModal v-model:show="rulesModalShow" />

    <SyncDraftsModal v-model:show="syncModalShow" :year="selectedYear" :scheme="activeScheme" />

    <PrivacyExportModal
      v-model:show="exportModalShow"
      title="导出《党员积分记录表》Excel"
      :loading="exporting"
      @confirm="handleExportExcelWithPrivacy"
    />
  </div>
</template>

<style scoped>
.points-kpi-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: var(--sct-radius, 8px);
  border: 1px solid var(--sct-border);
  background: var(--sct-page);
  color: var(--sct-ink);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.points-kpi-btn:hover {
  border-color: var(--sct-ink);
}
.points-kpi-btn--warn.is-active {
  border-color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
}
.points-kpi-btn--pending.is-active {
  border-color: #d97706;
  background: rgba(217, 119, 6, 0.08);
}
</style>
