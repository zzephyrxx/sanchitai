<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue';
import { NButton, NDatePicker, NTag } from 'naive-ui';
import dayjs from 'dayjs';
import { saveFileWithPicker } from '@/utils/save-file';
import { generateSemesterDrafts, draftToEvent } from '@/utils/schedule-gen';
import type { GenDraftEvent, GenParams } from '@/utils/schedule-gen';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSvgIcon } from '@/hooks/common/icon';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import { useTableColumnLayout } from '@/hooks/common/table-layout';
import MeetingDetail from './modules/meeting-detail.vue';

defineOptions({ name: 'MeetingsPage' });

const workStore = useWorkDataStore();
const { SvgIconVNode } = useSvgIcon();
const { bi, tMeetingKind, tEventStatus } = useSctI18n();

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOptions = WEEKDAY_CN.map((v, i) => ({ label: v, value: i }));

const MEETING_KINDS = ['支委会', '党员大会', '党小组会', '党课', '主题党日', '组织生活会', '民主评议'];

const MEETING_KIND_STYLES: Record<string, { color: string; bg: string }> = {
  支委会: { color: '#2B2926', bg: 'rgba(43, 41, 38, 0.10)' },
  党员大会: { color: '#A81C24', bg: 'var(--sct-err-soft)' },
  党小组会: { color: '#0284c7', bg: 'var(--sct-info-soft)' },
  党课: { color: '#7c5cd6', bg: 'var(--sct-purple-soft)' },
  主题党日: { color: '#d97706', bg: 'var(--sct-warn-soft)' },
  组织生活会: { color: '#0d9488', bg: 'var(--sct-teal-soft)' },
  民主评议: { color: '#3f9d63', bg: 'var(--sct-ok-soft)' }
};

// ---------------- 学年 / 年度筛选范围 ----------------
const today = dayjs();
const currentAcademicStartYear = today.month() >= 8 ? today.year() : today.year() - 1;
const defaultSemester = computed(() => {
  const y = today.year();
  const m = today.month();
  if (m >= 7) return { label: `${y}-${y + 1}学年 秋季学期`, start: `${y}-09-01`, end: `${y + 1}-01-31` };
  if (m <= 0) return { label: `${y - 1}-${y}学年 秋季学期`, start: `${y - 1}-09-01`, end: `${y}-01-31` };
  return { label: `${y}-${y + 1}学年 春季学期`, start: `${y}-03-01`, end: `${y}-07-31` };
});

const periodMode = ref<'academic' | 'calendar'>('academic');
const selectedAcademicYear = ref<number>(currentAcademicStartYear);
const selectedTerm = ref<'all' | 'fall' | 'spring'>('all');
const selectedCalendarYear = ref<number>(today.year());

const academicYearOptions = computed(() => {
  const years = new Set<number>([currentAcademicStartYear - 1, currentAcademicStartYear, currentAcademicStartYear + 1]);
  workStore.calEvents.forEach(ev => {
    if (!MEETING_KINDS.includes(ev.kind ?? '') || !ev.date) return;
    const d = dayjs(ev.date);
    if (!d.isValid()) return;
    years.add(d.month() >= 8 ? d.year() : d.year() - 1);
  });
  return [...years].sort((a, b) => b - a).map(y => ({ label: `${y}-${y + 1}学年`, value: y }));
});

const termOptions = computed(() => [
  { label: bi('全学年', 'Full Academic Year'), value: 'all' },
  { label: bi('秋季学期（9–1月）', 'Fall (Sep–Jan)'), value: 'fall' },
  { label: bi('春季学期（2–8月）', 'Spring (Feb–Aug)'), value: 'spring' }
]);

const calendarYearOptions = computed(() => {
  const years = new Set<number>([today.year() - 1, today.year(), today.year() + 1]);
  workStore.calEvents.forEach(ev => {
    if (!MEETING_KINDS.includes(ev.kind ?? '') || !ev.date) return;
    const y = Number(ev.date.slice(0, 4));
    if (Number.isFinite(y) && y > 2000) years.add(y);
  });
  return [...years].sort((a, b) => b - a).map(y => ({ label: `${y}年度`, value: y }));
});

const activePeriod = computed(() => {
  if (periodMode.value === 'calendar') {
    const y = selectedCalendarYear.value;
    return {
      label: `${y}年度`,
      shortScope: bi('本年度', 'this year'),
      start: `${y}-01-01`,
      end: `${y}-12-31`
    };
  }
  const y = selectedAcademicYear.value;
  if (selectedTerm.value === 'fall') {
    return {
      label: `${y}-${y + 1}学年 秋季学期`,
      shortScope: bi('本学期', 'this term'),
      start: `${y}-09-01`,
      end: `${y + 1}-01-31`
    };
  }
  if (selectedTerm.value === 'spring') {
    return {
      label: `${y}-${y + 1}学年 春季学期`,
      shortScope: bi('本学期', 'this term'),
      start: `${y + 1}-02-01`,
      end: `${y + 1}-08-31`
    };
  }
  return {
    label: `${y}-${y + 1}学年`,
    shortScope: bi('本学年', 'this academic year'),
    start: `${y}-09-01`,
    end: `${y + 1}-08-31`
  };
});

/** 所选学年/年度内的会议事件（含重复投影，按发生日期） */
const meetingEvents = computed(() => {
  const list = workStore.eventsInRange(activePeriod.value.start, activePeriod.value.end);
  return list
    .filter(ev => MEETING_KINDS.includes(ev.kind ?? '') && ev.status !== '已取消')
    .sort((a, b) => a.date.localeCompare(b.date));
});

function baseIdOf(id: string) {
  return id.includes('-occ-') ? id.split('-occ-')[0] : id;
}

// ---------------- 频次统计 ----------------
const freqStats = computed(() => {
  const count = (kind: string) => meetingEvents.value.filter(ev => ev.kind === kind).length;
  return [
    { label: tMeetingKind('支委会'), target: bi('每月1次', '1/month'), done: count('支委会'), color: '#2B2926' },
    {
      label: tMeetingKind('党员大会'),
      target: bi('每季度1次', '1/quarter'),
      done: count('党员大会'),
      color: '#A81C24'
    },
    { label: tMeetingKind('党课'), target: bi('每季度1次', '1/quarter'), done: count('党课'), color: '#7c5cd6' },
    { label: tMeetingKind('主题党日'), target: bi('每月1天', '1/month'), done: count('主题党日'), color: '#d97706' },
    {
      label: tMeetingKind('组织生活会'),
      target: bi('学期末1次', '1/semester'),
      done: count('组织生活会') + count('民主评议'),
      color: '#0d9488'
    }
  ];
});

/** 本月线下会议计数（并入的不计，A4） */
const monthMeetingCount = computed(() => {
  const ym = today.format('YYYY-MM');
  return meetingEvents.value.filter(
    ev =>
      ev.date.startsWith(ym) &&
      !ev.merged_into &&
      ['支委会', '党员大会', '党小组会', '党课', '主题党日', '组织生活会'].includes(ev.kind ?? '')
  ).length;
});

// ---------------- 学期排期生成（A3/A10） ----------------
const genShow = ref(false);
const genParams = reactive<GenParams>({
  semesterLabel: defaultSemester.value.label,
  start: defaultSemester.value.start,
  end: defaultSemester.value.end,
  committeeNth: 2,
  committeeWeekday: 3,
  partyDayNth: 3,
  partyDayWeekday: 5,
  assemblyNth: 3,
  assemblyWeekday: 3,
  lessonMergedIntoAssembly: true
});
const genDrafts = ref<GenDraftEvent[]>([]);
const genExisting = ref(false);
const dupKeys = ref<Set<string>>(new Set());

function openGen() {
  genDrafts.value = generateSemesterDrafts(genParams);
  genExisting.value = workStore.calEvents.some(
    ev => ev.id.startsWith('gen-') && ev.date >= genParams.start && ev.date <= genParams.end
  );
  const existing = workStore.calEvents.filter(
    ev => !ev.id.startsWith('gen-') && !ev.merged_into && (ev.status === '计划' || ev.status === '进行中')
  );
  dupKeys.value = new Set(
    genDrafts.value
      .filter(d => existing.some(ev => ev.kind === d.kind && ev.date.slice(0, 7) === d.date.slice(0, 7)))
      .map(d => d.id)
  );
  genShow.value = true;
}

function regenerate() {
  genDrafts.value = generateSemesterDrafts(genParams);
}

async function writeDrafts() {
  if (genExisting.value) {
    window.$message?.warning('本学期已存在生成排期，不重复写入（可先删除 gen- 前缀事项后再生成）');
    return;
  }
  const skipped = genDrafts.value.filter(d => dupKeys.value.has(d.id)).length;
  const rows = genDrafts.value
    .filter(d => !dupKeys.value.has(d.id))
    .map(d => {
      const ev = draftToEvent(d, 'secretary');
      const secretary = workStore.members.find(m => m.role === '书记');
      if (secretary) ev.owner = secretary.id;
      return ev;
    });
  await Promise.all(rows.map(r => dbPutEvent(r)));
  genExisting.value = true;
  const skipMsg = skipped ? `，跳过 ${skipped} 条与既有排期重复的事项` : '';
  window.$message?.success(`已写入 ${rows.length} 条排期事项，可在台历查看${skipMsg}`);
  genShow.value = false;
}

async function exportSchedule() {
  const header = ['序号', '日期', '周次', '事项', '类型', '地点', '主责人', '协助人', '备注'];
  const lines: string[] = [header.join(',')];
  meetingEvents.value.forEach((ev, i) => {
    const weekOfPeriod = Math.floor(dayjs(ev.date).diff(dayjs(activePeriod.value.start), 'day') / 7) + 1;
    lines.push(
      [
        String(i + 1),
        ev.date,
        `第${weekOfPeriod}周`,
        ev.title,
        ev.kind ?? '',
        ev.location ?? '',
        workStore.memberName(ev.owner),
        ev.helper
          ? ev.helper
              .split(/[、,，]/)
              .map(id => workStore.memberName(id.trim()))
              .join('、')
          : '',
        ev.status === '已完成' ? '已开展' : ''
      ]
        .map(v => `"${String(v).replaceAll('"', '""')}"`)
        .join(',')
    );
  });
  const res = await saveFileWithPicker(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }), {
    suggestedName: `三会一课安排表_${activePeriod.value.label}.csv`,
    types: [{ description: 'CSV 表格文件', mime: 'text/csv', extensions: ['.csv'] }]
  });
  if (res.status === 'saved') {
    window.$message?.success('学期安排表已导出（CSV，Excel/Word 可打开）');
  }
}

function dbPutEvent(row: Sct.CalEvent) {
  const { addEvent } = workStore;
  return addEvent(row as Partial<Sct.CalEvent> & Pick<Sct.CalEvent, 'title' | 'date' | 'category'>);
}

// ---------------- 会议列表（支持搜索、类型筛选、分页与图标表头） ----------------
const detailId = ref<string | null>(null);
const detailShow = ref(false);
const kindFilter = ref<string>('');
const searchKeyword = ref<string>('');
const pagination = reactive({
  page: 1,
  pageSize: 10,
  showSizePicker: true,
  pageSizes: [10, 15, 25, 50],
  onChange: (page: number) => {
    pagination.page = page;
  },
  onUpdatePageSize: (pageSize: number) => {
    pagination.pageSize = pageSize;
    pagination.page = 1;
  }
});

const kindFilterOptions = computed(() => [
  { label: bi('全部会议类型', 'All Meeting Types'), value: '' },
  ...MEETING_KINDS.map(k => ({ label: tMeetingKind(k) || k, value: k }))
]);

function openDetail(id: string) {
  detailId.value = baseIdOf(id);
  detailShow.value = true;
}

type MeetingRow = Sct.CalEvent & {
  rate: { present: number; due: number; rate: number } | null;
};

const listRows = computed<MeetingRow[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  return meetingEvents.value
    .filter(ev => !kindFilter.value || ev.kind === kindFilter.value)
    .filter(ev => {
      if (!kw) return true;
      const ownerName = workStore.memberName(ev.owner);
      return [ev.title, ev.kind, ev.location, ev.date, ownerName]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(kw));
    })
    .map(ev => ({
      ...ev,
      rate: workStore.attendanceRate(baseIdOf(ev.id))
    }));
});

function colHeader(icon: string, text: string) {
  return h('span', { class: 'inline-flex items-center gap-4px whitespace-nowrap' }, [
    SvgIconVNode({ icon, fontSize: 13 })?.(),
    h('span', text)
  ]);
}

function statusTagType(status: Sct.EventStatus): 'success' | 'info' | 'warning' {
  if (status === '已完成') return 'success';
  if (status === '进行中') return 'info';
  return 'warning';
}

function renderKindCapsule(kind?: string, merged?: string) {
  const k = kind ?? '其他';
  const st = MEETING_KIND_STYLES[k] ?? { color: '#64748b', bg: 'var(--sct-soft)' };
  const label = tMeetingKind(k) || k;
  return h(
    'span',
    {
      class: 'inline-flex items-center gap-5px rounded-full px-10px py-2px text-12px font-semibold whitespace-nowrap',
      style: {
        backgroundColor: st.bg,
        color: st.color
      }
    },
    [
      h('span', { class: 'inline-block size-6px rounded-full', style: { backgroundColor: st.color } }),
      `${label}${merged ? bi('（并入）', ' (Merged)') : ''}`
    ]
  );
}

const MEETING_COL_ORDER = ['date', 'kind', 'title', 'location', 'owner', 'helper', 'status', 'rate', 'op'] as const;

const meetingColumnMap = computed(() => ({
  date: {
    key: 'date',
    defaultWidth: 142,
    minWidth: 112,
    titleContent: () => colHeader('lucide:calendar', bi('日期', 'Date')),
    sorter: (a: MeetingRow, b: MeetingRow) => a.date.localeCompare(b.date),
    render: (r: MeetingRow) =>
      `${dayjs(r.date).format('YYYY-MM-DD')} ${bi(WEEKDAY_CN[dayjs(r.date).day()], WEEKDAY_EN[dayjs(r.date).day()])}`
  },
  kind: {
    key: 'kind',
    defaultWidth: 145,
    minWidth: 100,
    titleContent: () => colHeader('lucide:tag', bi('类型', 'Type')),
    sorter: (a: MeetingRow, b: MeetingRow) => (a.kind ?? '').localeCompare(b.kind ?? ''),
    render: (r: MeetingRow) => renderKindCapsule(r.kind, r.merged_into)
  },
  title: {
    key: 'title',
    defaultWidth: 220,
    minWidth: 120,
    ellipsis: { tooltip: true },
    titleContent: () => colHeader('lucide:file-text', bi('标题', 'Title')),
    sorter: (a: MeetingRow, b: MeetingRow) => a.title.localeCompare(b.title)
  },
  location: {
    key: 'location',
    defaultWidth: 118,
    minWidth: 80,
    ellipsis: { tooltip: true },
    titleContent: () => colHeader('lucide:map-pin', bi('地点', 'Location')),
    sorter: (a: MeetingRow, b: MeetingRow) => (a.location ?? '').localeCompare(b.location ?? ''),
    render: (r: MeetingRow) => r.location || '—'
  },
  owner: {
    key: 'owner',
    defaultWidth: 96,
    minWidth: 74,
    titleContent: () => colHeader('lucide:user', bi('主责人', 'Owner')),
    sorter: (a: MeetingRow, b: MeetingRow) =>
      workStore.memberName(a.owner).localeCompare(workStore.memberName(b.owner)),
    render: (r: MeetingRow) => workStore.memberName(r.owner) || '—'
  },
  helper: {
    key: 'helper',
    defaultWidth: 115,
    minWidth: 80,
    titleContent: () => colHeader('lucide:users', bi('协助人', 'Helper')),
    render: (r: MeetingRow) =>
      r.helper
        ? r.helper
            .split(/[、,，]/)
            .map((id: string) => workStore.memberName(id.trim()))
            .join('、')
        : '—'
  },
  status: {
    key: 'status',
    defaultWidth: 96,
    minWidth: 74,
    titleContent: () => colHeader('lucide:circle-dot', bi('状态', 'Status')),
    sorter: (a: MeetingRow, b: MeetingRow) => a.status.localeCompare(b.status),
    render: (r: MeetingRow) =>
      h(
        NTag,
        {
          size: 'tiny',
          bordered: false,
          type: statusTagType(r.status)
        },
        () => tEventStatus(r.status)
      )
  },
  rate: {
    key: 'rate',
    defaultWidth: 118,
    minWidth: 86,
    titleContent: () => colHeader('lucide:percent', bi('到会率', 'Attendance')),
    sorter: (a: MeetingRow, b: MeetingRow) => (a.rate?.rate ?? -1) - (b.rate?.rate ?? -1),
    render: (r: MeetingRow) =>
      r.status === '计划' || !r.rate ? '—' : `${Math.round(r.rate.rate * 100)}%（${r.rate.present}/${r.rate.due}）`
  },
  op: {
    key: 'op',
    defaultWidth: 96,
    fixed: 'right' as const,
    resizable: false,
    reorderable: false,
    titleContent: () => colHeader('lucide:sliders-horizontal', bi('操作', 'Actions')),
    render: (r: MeetingRow) =>
      h(
        NButton,
        {
          size: 'tiny',
          secondary: true,
          type: 'primary',
          onClick: () => openDetail(r.id)
        },
        {
          icon: SvgIconVNode({ icon: 'lucide:eye', fontSize: 13 }),
          default: () => bi('详情', 'Details')
        }
      )
  }
}));

const {
  columns: listColumns,
  scrollX: meetingScrollX,
  hasCustomLayout: hasCustomMeetingLayout,
  resetLayout: resetMeetingLayout
} = useTableColumnLayout<MeetingRow>({
  storageKey: 'meetings',
  defaultOrder: MEETING_COL_ORDER,
  pinnedEndKeys: ['op'],
  columnMap: meetingColumnMap,
  minTableWidth: 860
});

function handleResetMeetingLayout() {
  resetMeetingLayout();
  window.$message?.success('三会一课表列宽与列顺序已重置');
}
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex flex-wrap items-center gap-12px">
          <span class="text-16px font-bold">{{ bi('三会一课', 'Meetings & Lectures') }}</span>
          <span class="text-12px text-gray-400">
            {{ activePeriod.label }}（{{ activePeriod.start }} ~ {{ activePeriod.end }}）
          </span>
          <NTag v-if="monthMeetingCount > 3" type="warning" size="small">
            {{
              bi(
                `本月线下会议 ${monthMeetingCount} 次（超过 3 次，注意合并）`,
                `Offline meetings this month: ${monthMeetingCount} (>3, consider merging)`
              )
            }}
          </NTag>
          <NTag v-else size="small" :bordered="false">
            {{ bi(`本月线下会议 ${monthMeetingCount} 次`, `Offline meetings this month: ${monthMeetingCount}`) }}
          </NTag>
        </div>
      </template>
      <template #header-extra>
        <div class="flex items-center gap-8px">
          <NButton size="small" secondary @click="exportSchedule">
            <template #icon><SvgIcon icon="lucide:download" /></template>
            {{ bi('导出安排表', 'Export Schedule') }}
          </NButton>
          <NButton type="primary" size="small" @click="openGen">
            <template #icon><SvgIcon icon="lucide:calendar-plus" /></template>
            {{ bi('按规范生成学期排期', 'Generate Semester Schedule') }}
          </NButton>
        </div>
      </template>

      <!-- 学年 / 年度筛选条 -->
      <div
        class="mb-14px flex flex-wrap items-center justify-between gap-10px rounded-10px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-8px"
      >
        <div class="flex flex-wrap items-center gap-8px">
          <span class="inline-flex items-center gap-5px text-12px font-semibold text-gray-500">
            <SvgIcon icon="lucide:calendar-range" class="text-14px text-[#A81C24]" />
            <span>{{ bi('统计周期', 'Period') }}</span>
          </span>
          <NRadioGroup v-model:value="periodMode" size="small" @update:value="pagination.page = 1">
            <NRadioButton value="academic">{{ bi('按学年', 'Academic Year') }}</NRadioButton>
            <NRadioButton value="calendar">{{ bi('按年度', 'Calendar Year') }}</NRadioButton>
          </NRadioGroup>

          <template v-if="periodMode === 'academic'">
            <NSelect
              v-model:value="selectedAcademicYear"
              size="small"
              class="w-136px"
              :options="academicYearOptions"
              @update:value="pagination.page = 1"
            />
            <NSelect
              v-model:value="selectedTerm"
              size="small"
              class="w-156px"
              :options="termOptions"
              @update:value="pagination.page = 1"
            />
          </template>
          <NSelect
            v-else
            v-model:value="selectedCalendarYear"
            size="small"
            class="w-124px"
            :options="calendarYearOptions"
            @update:value="pagination.page = 1"
          />
        </div>
        <span class="text-12px text-gray-500">
          {{ bi(`当前范围共 ${meetingEvents.length} 场会议`, `${meetingEvents.length} meetings in selected period`) }}
        </span>
      </div>

      <!-- 频次达标概览 -->
      <div class="mb-14px flex flex-wrap gap-10px">
        <div
          v-for="s in freqStats"
          :key="s.label"
          class="flex items-center gap-8px rounded-8px bg-[var(--sct-soft)] px-12px py-8px"
        >
          <span class="inline-block size-10px rounded-full" :style="{ background: s.color }" />
          <span class="text-13px font-bold">{{ s.label }}</span>
          <span class="text-12px text-gray-500">{{ `${activePeriod.shortScope} ${s.done} 次` }} · {{ s.target }}</span>
        </div>
      </div>

      <div class="mb-12px flex flex-wrap items-center justify-between gap-10px">
        <div class="flex flex-nowrap items-center gap-8px overflow-x-auto">
          <div class="w-165px shrink-0">
            <NSelect
              v-model:value="kindFilter"
              :options="kindFilterOptions"
              size="small"
              @update:value="pagination.page = 1"
            />
          </div>
          <div class="w-230px shrink-0">
            <NInput
              v-model:value="searchKeyword"
              size="small"
              clearable
              :placeholder="bi('搜索会议标题、地点、主责人…', 'Search title, location, owner…')"
              @update:value="pagination.page = 1"
            >
              <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
            </NInput>
          </div>
          <NButton
            size="small"
            secondary
            class="shrink-0"
            :disabled="!hasCustomMeetingLayout"
            @click="handleResetMeetingLayout"
          >
            <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
            {{ bi('重置列宽', 'Reset Columns') }}
          </NButton>
        </div>
        <span class="text-12px text-gray-400">
          {{
            bi(
              '拖拽表头可换列顺序 · 拖右侧边线调列宽（自动记忆） · 点击「详情」管理考勤',
              'Drag headers to reorder · Drag edge to resize · Click Details for attendance'
            )
          }}
        </span>
      </div>

      <NDataTable
        :columns="listColumns"
        :data="listRows"
        :pagination="pagination"
        size="small"
        :bordered="false"
        :scroll-x="meetingScrollX"
        :row-key="(r: MeetingRow) => r.id"
      />
    </NCard>

    <!-- 生成排期弹层（双列规整排版，带字段图标且防止 Label 与输入框换行） -->
    <NModal v-model:show="genShow" preset="card" title="按规范生成学期排期" class="w-760px">
      <NAlert v-if="genExisting" type="warning" class="mb-12px">
        本学期已存在生成排期（gen- 前缀事项）。依据验收要求不重复生成；如需重排请先删除旧事项。
      </NAlert>
      <NForm size="small" label-placement="left" label-width="108">
        <div class="grid grid-cols-1 gap-x-16px md:grid-cols-2">
          <NFormItem class="md:col-span-2">
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:calendar-range" class="sct-field-icon" />
                <span>学期起止</span>
              </span>
            </template>
            <div class="flex items-center gap-8px">
              <NInput v-model:value="genParams.start" placeholder="YYYY-MM-DD" class="w-150px" />
              <span class="text-gray-400">至</span>
              <NInput v-model:value="genParams.end" placeholder="YYYY-MM-DD" class="w-150px" />
            </div>
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:users" class="sct-field-icon" />
                <span>支委会</span>
              </span>
            </template>
            <div class="flex items-center gap-6px whitespace-nowrap">
              <span>每月第</span>
              <NInputNumber v-model:value="genParams.committeeNth" size="small" class="w-76px" :min="1" :max="5" />
              <span>个</span>
              <NSelect
                v-model:value="genParams.committeeWeekday"
                :options="weekdayOptions"
                size="small"
                class="w-92px"
              />
            </div>
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:flag" class="sct-field-icon" />
                <span>主题党日</span>
              </span>
            </template>
            <div class="flex items-center gap-6px whitespace-nowrap">
              <span>每月第</span>
              <NInputNumber v-model:value="genParams.partyDayNth" size="small" class="w-76px" :min="1" :max="5" />
              <span>个</span>
              <NSelect
                v-model:value="genParams.partyDayWeekday"
                :options="weekdayOptions"
                size="small"
                class="w-92px"
              />
            </div>
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:landmark" class="sct-field-icon" />
                <span>党员大会</span>
              </span>
            </template>
            <div class="flex items-center gap-6px whitespace-nowrap">
              <span>季末第</span>
              <NInputNumber v-model:value="genParams.assemblyNth" size="small" class="w-76px" :min="1" :max="5" />
              <span>个</span>
              <NSelect
                v-model:value="genParams.assemblyWeekday"
                :options="weekdayOptions"
                size="small"
                class="w-92px"
              />
            </div>
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:git-merge" class="sct-field-icon" />
                <span>党课合并</span>
              </span>
            </template>
            <div class="flex items-center gap-8px whitespace-nowrap">
              <NSwitch v-model:value="genParams.lessonMergedIntoAssembly" size="small" />
              <span class="text-12px text-gray-400">并入党员大会（不占月次数）</span>
            </div>
          </NFormItem>
        </div>
      </NForm>

      <div class="mb-8px flex items-center justify-between">
        <span class="text-13px font-bold">排期预览（{{ genDrafts.length }} 条）</span>
        <NButton size="tiny" secondary @click="regenerate">
          <template #icon><SvgIcon icon="lucide:refresh-cw" /></template>
          重新计算
        </NButton>
      </div>
      <NDataTable
        :data="genDrafts"
        :bordered="false"
        size="small"
        max-height="240px"
        :columns="[
          {
            title: '日期（可改）',
            key: 'date',
            width: 140,
            render: (r: GenDraftEvent) =>
              // naive 的 volar 泛型在此处的 h() 推导不兼容，放宽处理
              h(NDatePicker, {
                value: dayjs(r.date).valueOf(),
                type: 'date',
                size: 'tiny',
                onUpdateValue: ((v: number) => {
                  r.date = dayjs(v).format('YYYY-MM-DD');
                }) as unknown as undefined
              } as any)
          },
          {
            title: '类型',
            key: 'kind',
            width: 110,
            render: (r: GenDraftEvent) => renderKindCapsule(r.kind)
          },
          {
            title: '标题',
            key: 'title',
            render: (r: GenDraftEvent) =>
              h('span', { class: 'inline-flex items-center gap-6px' }, [
                r.title,
                dupKeys.has(r.id)
                  ? h(NTag, { size: 'tiny', type: 'warning', bordered: false }, () => '与既有排期重复，将跳过')
                  : null
              ])
          },
          {
            title: '时间',
            key: 'start_time',
            width: 110,
            render: (r: GenDraftEvent) => `${r.start_time}-${r.end_time}`
          }
        ]"
        :row-key="(r: GenDraftEvent) => r.id"
      />

      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="genShow = false">取消</NButton>
          <NButton type="primary" :disabled="genExisting" @click="writeDrafts">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            写入台历（{{ genDrafts.length }} 条）
          </NButton>
        </div>
      </template>
    </NModal>

    <MeetingDetail v-model:show="detailShow" :event-id="detailId" />
  </div>
</template>

<style scoped></style>
