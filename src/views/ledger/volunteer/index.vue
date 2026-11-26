<script setup lang="ts">
/**
 * 志愿时长台账主视图（v0.3.0 新增）
 * - 顶部 KPI 统计胶囊 + 「按活动记录 ⇄ 按成员汇总」双视图切换
 * - 支持按身份类型、时间范围（本年度/本学期/全部/自定义）、来源分类与待核实状态组合筛选
 * - 成员汇总含可视化进度条 + 可选「考核折算预览」+ 点击弹出个人志愿明细抽屉
 * - 双 Sheet Excel 导出（支持脱敏公示版/全量报送版）+ 电子纸风格一键打印公示单
 */
import { computed, h, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { NButton, NTag } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import dayjs from 'dayjs';
import { MEMBER_TYPE_COLORS, MEMBER_TYPE_ORDER } from '@/constants/sanchitai';
import { isMemberActive } from '@/constants/workspace-presets';
import { onTourCommand } from '@/utils/onboarding-bus';
import { printHtml } from '@/utils/print';
import {
  buildVolunteerPrintHtml,
  computeVolunteerSummaries,
  exportVolunteerExcel,
  roundHours
} from '@/utils/volunteer';
import type { MemberVolunteerSummary } from '@/utils/volunteer';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import PrivacyExportModal from '@/components/custom/privacy-export-modal.vue';
import VolunteerActivityDrawer from './modules/volunteer-activity-drawer.vue';

defineOptions({ name: 'VolunteerPage' });

const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const viewMode = ref<'activities' | 'members'>('activities');
const timeScope = ref<'year' | 'semester' | 'all' | 'custom'>('year');
const customDateRange = ref<[string, string] | null>(null);
const sourceFilter = ref<string | null>(null);
const typeFilter = ref<string | null>(null);
const onlyPending = ref(false);
const searchKeyword = ref('');

// 可选考核折算预览（如高校发展对象考核按封顶小时与学期数折算百分制）
const conversionEnabled = ref(false);
const conversionMaxHours = ref(60);
const conversionSemesters = ref(2);

const drawerShow = ref(false);
const editingActivity = ref<Sct.VolunteerActivity | null>(null);
const detailMemberId = ref<string | null>(null);
const detailDrawerShow = ref(false);
const exportModalShow = ref(false);
const exporting = ref(false);

const currentRange = computed<{ start: string; end: string; label: string }>(() => {
  const now = dayjs();
  if (timeScope.value === 'year') {
    return { start: `${now.year()}-01-01`, end: `${now.year()}-12-31`, label: `${now.year()}年度` };
  }
  if (timeScope.value === 'semester') {
    const m = now.month() + 1;
    if (m >= 9) {
      return { start: `${now.year()}-09-01`, end: `${now.year() + 1}-02-28`, label: `${now.year()}秋季学期` };
    }
    if (m <= 2) {
      return { start: `${now.year() - 1}-09-01`, end: `${now.year()}-02-28`, label: `${now.year() - 1}秋季学期` };
    }
    return { start: `${now.year()}-03-01`, end: `${now.year()}-08-31`, label: `${now.year()}春季学期` };
  }
  if (timeScope.value === 'custom' && customDateRange.value) {
    return {
      start: customDateRange.value[0],
      end: customDateRange.value[1],
      label: `${customDateRange.value[0]}至${customDateRange.value[1]}`
    };
  }
  return { start: '', end: '', label: '全部历史' };
});

const rangeScopedActivities = computed(() => {
  const { start, end } = currentRange.value;
  return workStore.volunteerActivities
    .filter(act => {
      if (start && act.date < start) return false;
      if (end && act.date > end) return false;
      if (sourceFilter.value && act.source !== sourceFilter.value) return false;
      return true;
    })
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
});

const filteredActivities = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  return rangeScopedActivities.value.filter(act => {
    if (onlyPending.value && act.status !== '待核实') return false;
    if (!kw) return true;
    return (
      act.title.toLowerCase().includes(kw) ||
      (act.note ?? '').toLowerCase().includes(kw) ||
      act.participants.some(p => p.name_snapshot.toLowerCase().includes(kw))
    );
  });
});

const memberPoolForSummary = computed(() => {
  const involvedIds = new Set<string>();
  for (const act of rangeScopedActivities.value) {
    for (const p of act.participants) involvedIds.add(p.member_id);
  }
  return workStore.members.filter(m => isMemberActive(m) || involvedIds.has(m.id));
});

const baseMemberSummaries = computed<MemberVolunteerSummary[]>(() =>
  computeVolunteerSummaries({
    members: memberPoolForSummary.value,
    activities: rangeScopedActivities.value,
    conversion: {
      enabled: conversionEnabled.value,
      maxHours: conversionMaxHours.value,
      semesters: conversionSemesters.value
    }
  })
);

const memberSummaries = computed<MemberVolunteerSummary[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  const base = computeVolunteerSummaries({
    members: memberPoolForSummary.value,
    activities: filteredActivities.value,
    conversion: {
      enabled: conversionEnabled.value,
      maxHours: conversionMaxHours.value,
      semesters: conversionSemesters.value
    }
  });
  return base.filter(s => {
    if (typeFilter.value && s.member.type !== typeFilter.value) return false;
    if (!kw) return true;
    return [s.member.name, s.member.code, s.member.group, s.member.type]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(kw));
  });
});

const kpiStats = computed(() => {
  const acts = filteredActivities.value;
  const certifiedActs = acts.filter(a => a.status === '已认定');
  const pendingActsCount = acts.filter(a => a.status === '待核实').length;
  let totalHours = 0;
  let totalParticipations = 0;
  const uniqueMemberIds = new Set<string>();

  for (const a of certifiedActs) {
    for (const p of a.participants) {
      totalHours = roundHours(totalHours + (Number(p.hours) || 0));
      totalParticipations += 1;
      uniqueMemberIds.add(p.member_id);
    }
  }
  const avgHours = uniqueMemberIds.size ? roundHours(totalHours / uniqueMemberIds.size) : 0;
  return {
    totalHours,
    activityCount: acts.length,
    totalParticipations,
    uniqueMembers: uniqueMemberIds.size,
    avgHours,
    pendingActsCount
  };
});

const activeDetailSummary = computed(() =>
  detailMemberId.value ? (baseMemberSummaries.value.find(s => s.member.id === detailMemberId.value) ?? null) : null
);

function openCreateActivity() {
  editingActivity.value = null;
  drawerShow.value = true;
}

function openEditActivity(act: Sct.VolunteerActivity) {
  editingActivity.value = act;
  drawerShow.value = true;
}

function openMemberDetail(memberId: string) {
  detailMemberId.value = memberId;
  detailDrawerShow.value = true;
}

const offVolTour = onTourCommand(cmd => {
  if (cmd === 'volunteer:show-members-tab') {
    drawerShow.value = false;
    detailDrawerShow.value = false;
    viewMode.value = 'members';
  } else if (cmd === 'volunteer:open-drawer') {
    editingActivity.value = null;
    drawerShow.value = true;
  } else if (cmd === 'volunteer:reset' || cmd === 'tour:cleanup') {
    drawerShow.value = false;
    detailDrawerShow.value = false;
    viewMode.value = 'activities';
  }
});
onBeforeUnmount(offVolTour);

async function toggleActivityVerify(act: Sct.VolunteerActivity) {
  const nextStatus: Sct.VolunteerStatus = act.status === '已认定' ? '待核实' : '已认定';
  await workStore.setVolunteerActivityStatus(act.id, nextStatus);
  window.$message?.success(`活动状态已切为「${nextStatus}」`);
}

async function handleExportExcel(privacyMode: Sct.ExportPrivacyMode) {
  exporting.value = true;
  try {
    const res = await exportVolunteerExcel({
      branchName: workStore.branchName,
      rangeLabel: currentRange.value.label,
      summaries: memberSummaries.value,
      activities: filteredActivities.value,
      privacyMode,
      includeConversion: conversionEnabled.value
    });
    if (res === 'saved') {
      exportModalShow.value = false;
      window.$message?.success('《志愿时长公示表》双 Sheet Excel 已导出');
    }
  } finally {
    exporting.value = false;
  }
}

function handlePrintPublicSheet() {
  const html = buildVolunteerPrintHtml({
    branchName: workStore.branchName,
    rangeLabel: currentRange.value.label,
    summaries: memberSummaries.value,
    includeConversion: conversionEnabled.value
  });
  printHtml(`${workStore.branchName}_志愿时长公示表_${currentRange.value.label}`, html);
}

const maxMemberHours = computed(() => Math.max(10, ...memberSummaries.value.map(s => s.totalHours)));

const memberPagination = reactive({
  page: 1,
  pageSize: 15,
  showSizePicker: true,
  pageSizes: [15, 30, 50],
  onChange: (p: number) => {
    memberPagination.page = p;
  },
  onUpdatePageSize: (ps: number) => {
    memberPagination.pageSize = ps;
    memberPagination.page = 1;
  }
});

watch([searchKeyword, typeFilter, timeScope, customDateRange, sourceFilter, onlyPending], () => {
  memberPagination.page = 1;
});

const memberColumns = computed<DataTableColumns<MemberVolunteerSummary>>(() => {
  const cols: DataTableColumns<MemberVolunteerSummary> = [
    {
      title: '#',
      key: 'idx',
      width: 48,
      align: 'center',
      render: (_r, idx) => h('span', { class: 'font-mono text-gray-400' }, idx + 1)
    },
    {
      title: bi('姓名', 'Name'),
      key: 'name',
      width: 120,
      render: row =>
        h('div', { class: 'flex items-center gap-6px' }, [
          h('span', {
            class: 'inline-block size-8px shrink-0 rounded-full',
            style: { background: MEMBER_TYPE_COLORS[row.member.type] ?? '#666' }
          }),
          h('span', { class: 'font-semibold' }, row.member.name),
          !isMemberActive(row.member) ? h(NTag, { size: 'tiny', bordered: false }, () => '归档') : null
        ])
    },
    {
      title: bi('政治面貌', 'Status'),
      key: 'type',
      width: 100,
      render: row => h(NTag, { size: 'tiny', bordered: false }, () => row.member.type)
    },
    {
      title: bi('党小组', 'Group'),
      key: 'group',
      width: 100,
      render: row => row.member.group || '—'
    },
    {
      title: bi('已认定总时长', 'Certified Hours'),
      key: 'totalHours',
      width: 190,
      sorter: (a, b) => a.totalHours - b.totalHours,
      render: row =>
        h('div', { class: 'flex items-center gap-8px' }, [
          h('span', { class: 'w-54px font-mono text-13px font-bold text-[#16a34a]' }, `${row.totalHours} h`),
          h('div', { class: 'h-6px flex-1 overflow-hidden rounded-full bg-[var(--sct-soft)]' }, [
            h('div', {
              class: 'h-full bg-[#16a34a]',
              style: { width: `${Math.min(100, (row.totalHours / maxMemberHours.value) * 100)}%` }
            })
          ])
        ])
    },
    {
      title: bi('待核实', 'Pending'),
      key: 'pendingHours',
      width: 82,
      align: 'center',
      render: row =>
        row.pendingHours > 0
          ? h('span', { class: 'font-mono text-12px text-[#d97706]' }, `${row.pendingHours}h`)
          : h('span', { class: 'text-gray-400' }, '—')
    },
    {
      title: bi('场次', 'Acts'),
      key: 'activityCount',
      width: 66,
      align: 'center',
      sorter: (a, b) => a.activityCount - b.activityCount,
      render: row => h('span', { class: 'font-mono' }, row.activityCount)
    }
  ];

  if (conversionEnabled.value) {
    cols.push({
      title: bi('折算分(100)', 'Score'),
      key: 'convertedScore',
      width: 96,
      align: 'center',
      sorter: (a, b) => (a.convertedScore ?? 0) - (b.convertedScore ?? 0),
      render: row => h('span', { class: 'font-mono font-bold text-[#A81C24]' }, `${row.convertedScore ?? 0}`)
    });
  }

  cols.push({
    title: bi('操作', 'Action'),
    key: 'op',
    width: 100,
    align: 'center',
    render: row =>
      h(
        NButton,
        {
          size: 'tiny',
          class: 'sct-op-btn sct-op-btn--info',
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            openMemberDetail(row.member.id);
          }
        },
        () => bi('明细', 'Detail')
      )
  });

  return cols;
});

function activityTotalHours(act: Sct.VolunteerActivity): number {
  return roundHours(act.participants.reduce((acc, p) => acc + (Number(p.hours) || 0), 0));
}
</script>

<template>
  <div class="min-h-520px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex flex-wrap items-center gap-10px">
          <span class="text-16px font-bold">{{ bi('志愿时长台账', 'Volunteer Hours Ledger') }}</span>
          <NTag size="small" type="success" :bordered="false">{{ currentRange.label }}</NTag>
        </div>
      </template>

      <template #header-extra>
        <div data-tour="volunteer-actions" class="flex flex-wrap items-center gap-8px">
          <NButton size="small" secondary :loading="exporting" @click="exportModalShow = true">
            <template #icon><SvgIcon icon="lucide:file-spreadsheet" /></template>
            {{ bi('导出公示 Excel', 'Export Excel') }}
          </NButton>
          <NButton size="small" secondary @click="handlePrintPublicSheet">
            <template #icon><SvgIcon icon="lucide:printer" /></template>
            {{ bi('打印公示单', 'Print Notice') }}
          </NButton>
          <NButton size="small" type="primary" @click="openCreateActivity">
            <template #icon><SvgIcon icon="lucide:plus" /></template>
            {{ bi('登记志愿活动', 'Add Activity') }}
          </NButton>
        </div>
      </template>

      <!-- 顶部 KPI 统计胶囊 -->
      <div data-tour="volunteer-kpi" class="mb-14px flex flex-wrap items-center gap-10px">
        <div class="flex items-center gap-5px rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          <SvgIcon icon="lucide:clock" class="text-14px text-[#16a34a]" />
          <span>累计认定总时长</span>
          <b class="font-mono text-[#16a34a]">{{ kpiStats.totalHours }} h</b>
        </div>
        <div class="flex items-center gap-5px rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          <SvgIcon icon="lucide:calendar-heart" class="text-14px text-[#2563eb]" />
          <span>志愿活动</span>
          <b class="font-mono">{{ kpiStats.activityCount }}</b>
          <span class="text-12px text-[var(--sct-muted)]">场</span>
        </div>
        <div class="flex items-center gap-5px rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          <SvgIcon icon="lucide:users" class="text-14px text-[#0f766e]" />
          <span>参与人次</span>
          <b class="font-mono">{{ kpiStats.totalParticipations }}</b>
          <span class="text-12px text-[var(--sct-muted)]">
            （覆盖 {{ kpiStats.uniqueMembers }} 人 · 人均 {{ kpiStats.avgHours }}h）
          </span>
        </div>
        <button
          type="button"
          class="vol-kpi-btn"
          :class="{ 'is-active': onlyPending }"
          @click="onlyPending = !onlyPending"
        >
          <SvgIcon icon="lucide:hourglass" class="text-14px text-[#d97706]" />
          <span>待核实活动</span>
          <b class="font-mono text-[#d97706]">{{ kpiStats.pendingActsCount }}</b>
        </button>
      </div>

      <!-- 双视图切换 + 组合筛选栏 -->
      <div class="mb-12px flex flex-wrap items-center justify-between gap-10px">
        <div class="flex flex-wrap items-center gap-8px">
          <NTabs v-model:value="viewMode" type="segment" size="small" class="w-230px">
            <NTab name="activities" :tab="bi('按活动记录', 'By Activity')" />
            <NTab name="members" :tab="bi('按成员汇总', 'By Member')" />
          </NTabs>

          <NSelect
            v-model:value="timeScope"
            size="small"
            class="w-116px"
            :options="[
              { label: '本年度', value: 'year' },
              { label: '本学期', value: 'semester' },
              { label: '全部历史', value: 'all' },
              { label: '自定义区间', value: 'custom' }
            ]"
          />

          <NDatePicker
            v-if="timeScope === 'custom'"
            v-model:formatted-value="customDateRange"
            type="daterange"
            value-format="yyyy-MM-dd"
            size="small"
            class="w-230px"
          />

          <NSelect
            v-model:value="sourceFilter"
            size="small"
            class="w-116px"
            clearable
            placeholder="全部来源"
            :options="[
              { label: '支部内部', value: '支部内部' },
              { label: '校院活动', value: '校院活动' },
              { label: '社会公益', value: '社会公益' },
              { label: '其他', value: '其他' }
            ]"
          />

          <NSelect
            v-if="viewMode === 'members'"
            v-model:value="typeFilter"
            size="small"
            class="w-128px"
            clearable
            placeholder="全部身份"
            :options="MEMBER_TYPE_ORDER.map(t => ({ label: t, value: t }))"
          />

          <NInput
            v-model:value="searchKeyword"
            size="small"
            clearable
            class="w-190px"
            placeholder="搜索活动名或参与人…"
          >
            <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
          </NInput>
        </div>

        <!-- 成员汇总模式下的可选「考核折算预览」开关 -->
        <div v-if="viewMode === 'members'" class="flex flex-wrap items-center gap-8px text-12px">
          <NSwitch v-model:value="conversionEnabled" size="small" />
          <span class="font-medium text-[var(--sct-ink)]">考核折算预览</span>
          <template v-if="conversionEnabled">
            <NInputNumber v-model:value="conversionMaxHours" size="tiny" :min="1" class="w-94px">
              <template #prefix>封顶</template>
              <template #suffix>h</template>
            </NInputNumber>
            <NInputNumber v-model:value="conversionSemesters" size="tiny" :min="1" :max="12" class="w-90px">
              <template #suffix>学期</template>
            </NInputNumber>
          </template>
        </div>
      </div>

      <!-- 视图 1：按活动记录台账流 -->
      <div v-if="viewMode === 'activities'" class="flex flex-col gap-10px">
        <div
          v-if="!filteredActivities.length"
          class="rounded-8px border border-dashed border-[var(--sct-border)] py-40px text-center text-13px text-[var(--sct-muted)]"
        >
          当前条件下暂无志愿服务活动记录，点击右上角「登记志愿活动」开始记录（支持微信接龙名单粘贴识人）。
        </div>
        <div v-for="act in filteredActivities" :key="act.id" class="vol-act-card">
          <div class="flex flex-wrap items-start justify-between gap-10px">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-8px">
                <span class="font-mono text-12px font-semibold text-[var(--sct-muted)]">{{ act.date }}</span>
                <span class="text-14px font-bold text-[var(--sct-ink)]">{{ act.title }}</span>
                <NTag size="tiny" :bordered="false" type="info">{{ act.source }}</NTag>
                <NTag
                  size="tiny"
                  :type="act.status === '已认定' ? 'success' : 'warning'"
                  :bordered="false"
                  class="cursor-pointer"
                  @click="toggleActivityVerify(act)"
                >
                  {{ act.status }}
                </NTag>
              </div>
              <div v-if="act.note" class="mt-4px text-12px text-[var(--sct-muted)]">{{ act.note }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-8px">
              <span class="font-mono text-13px font-bold text-[#16a34a]">
                {{ act.participants.length }} 人 · 共 {{ activityTotalHours(act) }} h
              </span>
              <NButton size="tiny" class="sct-op-btn sct-op-btn--neutral" @click="openEditActivity(act)">
                <template #icon><SvgIcon icon="lucide:pencil" class="text-12px" /></template>
                编辑
              </NButton>
              <NPopconfirm @positive-click="workStore.deleteVolunteerActivity(act.id)">
                <template #trigger>
                  <NButton size="tiny" class="sct-op-btn sct-op-btn--danger">
                    <template #icon><SvgIcon icon="lucide:trash-2" class="text-12px" /></template>
                    删除
                  </NButton>
                </template>
                确认删除志愿活动「{{ act.title }}」？
              </NPopconfirm>
            </div>
          </div>

          <div class="mt-10px flex flex-wrap gap-6px border-t border-dashed border-[var(--sct-border)] pt-8px">
            <button
              v-for="p in act.participants"
              :key="p.member_id"
              type="button"
              class="inline-flex items-center gap-5px rounded-6px border border-[var(--sct-border)] bg-[var(--sct-container)] px-8px py-3px text-11.5px text-[var(--sct-ink)] transition-colors hover:border-[var(--sct-accent)]"
              @click="openMemberDetail(p.member_id)"
            >
              <span class="font-semibold">{{ p.name_snapshot }}</span>
              <span class="font-mono text-[#16a34a]">{{ p.hours }}h</span>
              <span v-if="p.role_note" class="text-10.5px text-[var(--sct-muted)]">· {{ p.role_note }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 视图 2：按成员汇总排行表 -->
      <NDataTable
        v-else
        :columns="memberColumns"
        :data="memberSummaries"
        :pagination="memberPagination"
        :bordered="false"
        size="small"
        :scroll-x="820"
        :row-key="(r: MemberVolunteerSummary) => r.member.id"
        :row-props="
          (r: MemberVolunteerSummary) => ({ style: 'cursor: pointer', onClick: () => openMemberDetail(r.member.id) })
        "
      />
    </NCard>

    <!-- 新建 / 编辑志愿活动三合一抽屉 -->
    <VolunteerActivityDrawer v-model:show="drawerShow" :editing-activity="editingActivity" />

    <!-- 个人志愿明细抽屉 -->
    <NDrawer v-model:show="detailDrawerShow" :width="460" class="max-w-95vw">
      <NDrawerContent v-if="activeDetailSummary" :title="`${activeDetailSummary.member.name} · 志愿时长明细`" closable>
        <div class="flex flex-col gap-12px">
          <div
            class="flex items-center justify-between rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-12px"
          >
            <div>
              <div class="text-12px text-[var(--sct-muted)]">{{ currentRange.label }} · 已认定总时长</div>
              <div class="mt-2px font-mono text-24px font-extrabold text-[#16a34a]">
                {{ activeDetailSummary.totalHours }} h
              </div>
            </div>
            <div class="text-right text-12px text-[var(--sct-muted)]">
              <div>参与活动 {{ activeDetailSummary.activityCount }} 场</div>
              <div v-if="activeDetailSummary.pendingHours" class="text-[#d97706]">
                待核实 {{ activeDetailSummary.pendingHours }} h
              </div>
            </div>
          </div>

          <div v-if="!activeDetailSummary.records.length" class="py-24px text-center text-12px text-[var(--sct-muted)]">
            该时间范围内暂无志愿服务记录
          </div>
          <div v-else class="flex flex-col gap-8px">
            <div
              v-for="r in activeDetailSummary.records"
              :key="`${r.activityId}-${r.date}`"
              class="flex items-start justify-between gap-8px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] p-10px text-12px"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-6px">
                  <span class="font-mono text-11px text-[var(--sct-muted)]">{{ r.date }}</span>
                  <NTag size="tiny" :bordered="false">{{ r.source }}</NTag>
                  <NTag size="tiny" :type="r.status === '已认定' ? 'success' : 'warning'" :bordered="false">
                    {{ r.status }}
                  </NTag>
                </div>
                <div class="mt-4px font-semibold">{{ r.title }}</div>
                <div v-if="r.roleNote" class="mt-2px text-11px text-[var(--sct-muted)]">分工：{{ r.roleNote }}</div>
              </div>
              <span class="shrink-0 font-mono text-14px font-bold text-[#16a34a]">{{ r.hours }}h</span>
            </div>
          </div>
        </div>
      </NDrawerContent>
    </NDrawer>

    <!-- 脱敏双版本导出弹窗 -->
    <PrivacyExportModal
      v-model:show="exportModalShow"
      title="导出《志愿时长公示表》Excel（双 Sheet）"
      summary="将导出「按人汇总公示表」与「按活动明细表」。对外公示请保持默认「脱敏公示版」，上报核验时可切换「全量报送版」。"
      :loading="exporting"
      @confirm="handleExportExcel"
    />
  </div>
</template>

<style scoped>
.vol-kpi-btn {
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
.vol-kpi-btn:hover {
  border-color: var(--sct-ink);
}
.vol-kpi-btn.is-active {
  border-color: #d97706;
  background: var(--sct-warn-soft);
}

.vol-act-card {
  padding: 12px 14px;
  border-radius: var(--sct-radius, 8px);
  border: 1px solid var(--sct-border);
  background: var(--sct-page);
  transition: border-color 0.14s ease;
}
.vol-act-card:hover {
  border-color: var(--sct-ink);
}
</style>
