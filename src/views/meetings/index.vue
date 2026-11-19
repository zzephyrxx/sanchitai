<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { NDatePicker, NTag } from 'naive-ui';
import { saveAs } from 'file-saver';
import { useWorkDataStore } from '@/store/modules/work-data';
import { generateSemesterDrafts, draftToEvent, type GenDraftEvent, type GenParams } from '@/utils/schedule-gen';
import MeetingDetail from './modules/meeting-detail.vue';

defineOptions({ name: 'MeetingsPage' });

const workStore = useWorkDataStore();

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const weekdayOptions = WEEKDAY_CN.map((v, i) => ({ label: v, value: i }));

const MEETING_KINDS = ['支委会', '党员大会', '党小组会', '党课', '主题党日', '组织生活会', '民主评议'];
const MEETING_KIND_COLORS: Record<string, string> = {
  支委会: '#2B2926',
  党员大会: '#A81C24',
  党小组会: '#8a8f99',
  党课: '#7c5cd6',
  主题党日: '#d97706',
  组织生活会: '#3f9d63',
  民主评议: '#3f9d63'
};

// ---------------- 学期范围 ----------------
const today = dayjs();
const semester = computed(() => {
  const y = today.year();
  const m = today.month(); // 0-based
  if (m >= 7) return { label: `${y}-${y + 1}学年 秋季学期`, start: `${y}-09-01`, end: `${y + 1}-01-31` };
  if (m <= 0) return { label: `${y - 1}-${y}学年 秋季学期`, start: `${y - 1}-09-01`, end: `${y}-01-31` };
  return { label: `${y}-${y + 1}学年 春季学期`, start: `${y}-03-01`, end: `${y}-07-31` };
});

/** 学期内会议事件（含重复投影，按发生日期） */
const meetingEvents = computed(() => {
  const list = workStore.eventsInRange(semester.value.start, semester.value.end);
  return list
    .filter(ev => MEETING_KINDS.includes(ev.kind ?? '') && ev.status !== '已取消')
    .sort((a, b) => a.date.localeCompare(b.date));
});

function baseIdOf(id: string) {
  return id.includes('~occ~') ? id.split('~occ~')[0] : id;
}

// ---------------- 频次统计 ----------------
const freqStats = computed(() => {
  const count = (kind: string) => meetingEvents.value.filter(ev => ev.kind === kind).length;
  return [
    { label: '支委会', target: '每月1次', done: count('支委会'), color: '#A81C24' },
    { label: '党员大会', target: '每季度1次', done: count('党员大会'), color: '#A81C24' },
    { label: '党课', target: '每季度1次', done: count('党课'), color: '#7c5cd6' },
    { label: '主题党日', target: '每月1天', done: count('主题党日'), color: '#d97706' },
    { label: '组织生活会', target: '学期末1次', done: count('组织生活会') + count('民主评议'), color: '#3f9d63' }
  ];
});

/** 本月线下会议计数（并入的不计，A4） */
const monthMeetingCount = computed(() => {
  const ym = today.format('YYYY-MM');
  return meetingEvents.value.filter(
    ev => ev.date.startsWith(ym) && !ev.merged_into && ['支委会', '党员大会', '党小组会', '党课', '主题党日', '组织生活会'].includes(ev.kind ?? '')
  ).length;
});

// ---------------- 学期排期生成（A3/A10） ----------------
const genShow = ref(false);
const genParams = reactive<GenParams>({
  semesterLabel: semester.value.label,
  start: semester.value.start,
  end: semester.value.end,
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
/** 与既有计划事项重复的草稿 key（评审遗留 L1：同月同类型已有计划/进行中事项则跳过） */
const dupKeys = ref<Set<string>>(new Set());

function openGen() {
  genDrafts.value = generateSemesterDrafts(genParams);
  // 幂等检查（A10）：本学期是否已有生成的排期
  genExisting.value = workStore.calEvents.some(ev => ev.id.startsWith('gen-') && ev.date >= genParams.start && ev.date <= genParams.end);
  // L1：与既有计划/进行中事项（非生成、非并入）同月同类型 → 标记重复
  const existing = workStore.calEvents.filter(ev => !ev.id.startsWith('gen-') && !ev.merged_into && (ev.status === '计划' || ev.status === '进行中'));
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
  const rows = genDrafts.value.filter(d => !dupKeys.value.has(d.id)).map(d => {
    const ev = draftToEvent(d, 'secretary');
    // L3：默认主责人 = 书记
    const secretary = workStore.members.find(m => m.role === '书记');
    if (secretary) ev.owner = secretary.id;
    return ev;
  });
  await Promise.all(rows.map(r => dbPutEvent(r)));
  const skipMsg = skipped ? `，跳过 ${skipped} 条与既有排期重复的事项` : '';
  window.$message?.success(`已写入 ${rows.length} 条排期事项，可在台历查看${skipMsg}`);
  genShow.value = false;
}

/** 学期安排表导出（A5 后半，对齐学院"月份/周次/事项/类型/主责人/协助人/备注"格式） */
function exportSchedule() {
  const header = ['序号', '日期', '周次', '事项', '类型', '地点', '主责人', '协助人', '备注'];
  const lines: string[] = [header.join(',')];
  meetingEvents.value.forEach((ev, i) => {
    const weekOfMonth = Math.ceil(dayjs(ev.date).date() / 7);
    lines.push(
      [
        String(i + 1),
        ev.date,
        `第${weekOfMonth}周`,
        ev.title,
        ev.kind ?? '',
        ev.location ?? '',
        workStore.memberName(ev.owner),
        ev.helper ? ev.helper.split(/[、,，]/).map(id => workStore.memberName(id.trim())).join('、') : '',
        ev.status === '已完成' ? '已开展' : ''
      ]
        .map(v => `"${String(v).replaceAll('"', '""')}"`)
        .join(',')
    );
  });
  saveAs(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }), `三会一课学期安排表_${semester.value.label}.csv`);
  window.$message?.success('学期安排表已导出（CSV，Excel/Word 可打开）');
}

function dbPutEvent(row: Sct.CalEvent) {
  // 生成事项直接落库（复用 store 的 addEvent 但保留稳定 id 以支持幂等与合并引用）
  const { addEvent } = workStore;
  return addEvent(row as Partial<Sct.CalEvent> & Pick<Sct.CalEvent, 'title' | 'date' | 'category'>);
}

// ---------------- 会议列表 ----------------
const detailId = ref<string | null>(null);
const detailShow = ref(false);

function openDetail(id: string) {
  detailId.value = baseIdOf(id);
  detailShow.value = true;
}

const listRows = computed(() =>
  meetingEvents.value.map(ev => ({
    ...ev,
    rate: workStore.attendanceRate(baseIdOf(ev.id))
  }))
);

const listColumns = [
  { title: '日期', key: 'date', width: 110, render: (r: any) => `${dayjs(r.date).format('MM-DD')} ${WEEKDAY_CN[dayjs(r.date).day()]}` },
  {
    title: '类型',
    key: 'kind',
    width: 100,
    render: (r: any) => h('span', { style: { color: MEETING_KIND_COLORS[r.kind] ?? '#666', fontWeight: 600 } }, r.kind + (r.merged_into ? '（并入）' : ''))
  },
  { title: '标题', key: 'title' },
  { title: '地点', key: 'location', width: 100, render: (r: any) => r.location || '—' },
  { title: '主责人', key: 'owner', width: 80, render: (r: any) => workStore.memberName(r.owner) || '—' },
  { title: '协助人', key: 'helper', width: 90, render: (r: any) => (r.helper ? r.helper.split(/[、,，]/).map((id: string) => workStore.memberName(id.trim())).join('、') : '—') },
  { title: '状态', key: 'status', width: 76 },
  {
    title: '到会率',
    key: 'rate',
    width: 100,
    render: (r: any) => (r.rate ? `${Math.round(r.rate.rate * 100)}%（${r.rate.present}/${r.rate.due}）` : '—')
  },
  {
    title: '',
    key: 'op',
    width: 80,
    render: (r: any) => h('a', { style: { color: '#A81C24', cursor: 'pointer' }, onClick: () => openDetail(r.id) }, '详情')
  }
];
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">三会一课</span>
          <span class="text-12px text-gray-400">{{ semester.label }}</span>
          <NTag v-if="monthMeetingCount > 3" type="warning" size="small">本月线下会议 {{ monthMeetingCount }} 次（超过 3 次，注意合并）</NTag>
          <NTag v-else size="small" :bordered="false">本月线下会议 {{ monthMeetingCount }} 次</NTag>
        </div>
      </template>
      <template #header-extra>
        <div class="flex items-center gap-8px">
          <NButton size="small" @click="exportSchedule">导出学期安排表</NButton>
          <NButton type="primary" size="small" @click="openGen">按规范生成学期排期</NButton>
        </div>
      </template>

      <!-- 频次达标概览 -->
      <div class="mb-14px flex flex-wrap gap-10px">
        <div
          v-for="s in freqStats"
          :key="s.label"
          class="flex items-center gap-8px rounded-8px bg-[var(--sct-soft)] px-12px py-8px"
        >
          <span class="inline-block size-10px rounded-full" :style="{ background: s.color }" />
          <span class="text-13px font-bold">{{ s.label }}</span>
          <span class="text-12px text-gray-500">本学期 {{ s.done }} 次 · {{ s.target }}</span>
        </div>
      </div>

      <NDataTable :columns="listColumns" :data="listRows" size="small" :bordered="false" :row-key="(r: any) => r.id" />
    </NCard>

    <!-- 生成排期弹层 -->
    <NModal v-model:show="genShow" preset="card" title="按规范生成学期排期" class="w-680px">
      <NAlert v-if="genExisting" type="warning" class="mb-10px">
        本学期已存在生成排期（gen- 前缀事项）。依据验收要求不重复生成；如需重排请先删除旧事项。
      </NAlert>
      <NForm inline size="small" label-placement="left" label-width="96">
        <NFormItem label="学期起止">
          <NInput v-model:value="genParams.start" placeholder="YYYY-MM-DD" style="width: 130px" />
          <NInput v-model:value="genParams.end" placeholder="YYYY-MM-DD" style="width: 130px; margin-left: 8px" />
        </NFormItem>
        <NFormItem label="支委会">
          每月第 <NInputNumber v-model:value="genParams.committeeNth" size="tiny" style="width: 64px; margin: 0 4px" :min="1" :max="5" /> 个
          <NSelect v-model:value="genParams.committeeWeekday" :options="weekdayOptions" size="tiny" style="width: 88px; margin-left: 4px" />
        </NFormItem>
        <NFormItem label="主题党日">
          每月第 <NInputNumber v-model:value="genParams.partyDayNth" size="tiny" style="width: 64px; margin: 0 4px" :min="1" :max="5" /> 个
          <NSelect v-model:value="genParams.partyDayWeekday" :options="weekdayOptions" size="tiny" style="width: 88px; margin-left: 4px" />
        </NFormItem>
        <NFormItem label="党员大会">
          季度末月第 <NInputNumber v-model:value="genParams.assemblyNth" size="tiny" style="width: 64px; margin: 0 4px" :min="1" :max="5" /> 个
          <NSelect v-model:value="genParams.assemblyWeekday" :options="weekdayOptions" size="tiny" style="width: 88px; margin-left: 4px" />
        </NFormItem>
        <NFormItem label="党课合并">
          <NSwitch v-model:value="genParams.lessonMergedIntoAssembly" size="small" />
          <span class="ml-6px text-12px text-gray-400">并入党员大会（不计入每月线下会议次数）</span>
        </NFormItem>
      </NForm>

      <div class="mb-6px flex items-center justify-between">
        <span class="text-13px font-bold">预览（{{ genDrafts.length }} 条）</span>
        <NButton size="tiny" @click="regenerate">重新生成</NButton>
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
            width: 130,
            render: (r: any) =>
              h(NDatePicker, {
                value: dayjs(r.date).valueOf(),
                type: 'date',
                size: 'tiny',
                // naive 的 volar 泛型在此处的 h() 推导不兼容，放宽处理
                onUpdateValue: ((v: number) => {
                  // 只改日期，保持 id 稳定（党课的 merged_into 引用党员大会 id）
                  r.date = dayjs(v).format('YYYY-MM-DD');
                }) as unknown as undefined
              } as any)
          },
          { title: '类型', key: 'kind', width: 90 },
          {
            title: '标题',
            key: 'title',
            render: (r: any) =>
              h('span', { class: 'inline-flex items-center gap-6px' }, [
                r.title,
                dupKeys.has(r.id) ? h(NTag, { size: 'tiny', type: 'warning', bordered: false }, () => '与既有排期重复，将跳过') : null
              ])
          },
          { title: '时间', key: 'start_time', width: 110, render: (r: any) => `${r.start_time}-${r.end_time}` }
        ]"
        :row-key="(r: any) => r.id"
      />

      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="genShow = false">取消</NButton>
          <NButton type="primary" :disabled="genExisting" @click="writeDrafts">写入台历（{{ genDrafts.length }} 条）</NButton>
        </div>
      </template>
    </NModal>

    <MeetingDetail v-model:show="detailShow" :event-id="detailId" />
  </div>
</template>

<style scoped></style>
