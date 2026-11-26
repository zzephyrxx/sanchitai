<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useTransition } from '@vueuse/core';
import VChart from 'vue-echarts';
import dayjs from 'dayjs';
import { DEV_STAGE_ORDER, computeNextDevNode } from '@/constants/dev-nodes';
import { EVENT_CATEGORY_COLORS } from '@/constants/sanchitai';
import { isMemberArchived } from '@/constants/workspace-presets';
import { setupEcharts } from '@/plugins/echarts';
import { useThemeStore } from '@/store/modules/theme';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import EmptyFancy from '@/components/custom/empty-fancy.vue';
import DashboardVduiWidgets from './modules/dashboard-vdui-widgets.vue';
import type { VduiWidgetId } from './modules/dashboard-vdui-widgets.vue';

defineOptions({ name: 'DashboardPage' });

setupEcharts();

const workStore = useWorkDataStore();
const { bi, tMemberType, tCategory } = useSctI18n();

const themeStore = useThemeStore();
/** 图表墨色随深浅切换（CSS var 无法进 echarts，取实时值） */
const inkColor = computed(() => (themeStore.darkMode ? '#d9d6d0' : '#2B2926'));
const heatBase = computed(() => (themeStore.darkMode ? '217, 214, 208' : '43, 41, 38'));

// ---------------- 进入动画与 count-up 动数 ----------------
const entered = ref(false);
onMounted(() => {
  requestAnimationFrame(() => {
    entered.value = true;
  });
});

function useCountUp(source: () => number, duration = 850) {
  const target = ref(0);
  const shown = useTransition(target, { duration, transition: [0.22, 1, 0.36, 1] });
  watch(
    [entered, source],
    ([isReady, val]) => {
      if (isReady) {
        target.value = val;
      }
    },
    { immediate: true }
  );
  return computed(() => Math.round(shown.value));
}

const memberCount = computed(() => workStore.activeMembers.length);
const activeFormalCount = computed(() => workStore.activeMembers.filter(m => m.type === '正式党员').length);
const activeProbationCount = computed(() => workStore.activeMembers.filter(m => m.type === '预备党员').length);
const activePartyCount = computed(() => activeFormalCount.value + activeProbationCount.value);
const eventCount = computed(() => workStore.calEvents.length);
const talkCount = computed(() => workStore.talks.length);
const rosterMemberIdSet = computed(() => new Set(workStore.inBranchRosterMembers.map(m => m.id)));
const owedCount = computed(
  () =>
    new Set(
      workStore.feeRecords
        .filter(f => f.status === '欠缴' && rosterMemberIdSet.value.has(f.member_id))
        .map(f => f.member_id)
    ).size
);

const memberNum = useCountUp(() => memberCount.value, 850);
const eventNum = useCountUp(() => eventCount.value, 900);
const talkNum = useCountUp(() => talkCount.value, 850);
const owedNum = useCountUp(() => owedCount.value, 650);

// ---------------- 可定制组件系统（编辑模式/拖拽排序/增删/持久化） ----------------
interface WidgetDef {
  id: string;
  title: string;
  fullRow?: boolean;
  vdui?: boolean;
  moduleKey?: Sct.OptionalModuleKey;
}
const WIDGET_DEFS = computed<WidgetDef[]>(() => [
  { id: 'stats', title: bi('关键数字', 'Key Metrics'), fullRow: true },
  { id: 'reminders', title: bi('待办提醒中心', 'Action & Reminder Center'), fullRow: true },
  { id: 'healthRadar', title: bi('支部党建健康雷达', 'Branch Health Radar'), vdui: true },
  { id: 'pointsGauge', title: bi('党员积分 60+40 仪表', 'Party Points Gauge'), vdui: true, moduleKey: 'points' },
  { id: 'volunteerDonut', title: bi('志愿服务时长统计', 'Volunteer Hours'), vdui: true, moduleKey: 'volunteer' },
  { id: 'lifecycleWaffle', title: bi('成员生命周期矩阵', 'Lifecycle Matrix'), vdui: true },
  { id: 'talksThermometer', title: bi('年度谈话覆盖温度计', 'Talks Coverage Meter'), vdui: true, moduleKey: 'talks' },
  { id: 'groupOnion', title: bi('党小组活力同心环', 'Party Group Vitality'), vdui: true },
  { id: 'feeRing', title: bi('本月党费', 'Monthly Dues'), moduleKey: 'fees' },
  { id: 'heatmap', title: bi('近半年日程热力', '6-Month Schedule Heatmap') },
  { id: 'feeTrend', title: bi('缴费率趋势', 'Dues Trend'), moduleKey: 'fees' },
  { id: 'stageBars', title: bi('发展阶段', 'Development Stages'), moduleKey: 'development' },
  { id: 'categoryBars', title: bi('类别分布', 'Category Breakdown') },
  { id: 'weekOverview', title: bi('本周速览', 'Weekly Snapshot') }
]);
const DEFAULT_ORDER = [
  'stats',
  'reminders',
  'healthRadar',
  'pointsGauge',
  'volunteerDonut',
  'lifecycleWaffle',
  'talksThermometer',
  'groupOnion',
  'feeRing',
  'heatmap',
  'feeTrend',
  'stageBars',
  'categoryBars',
  'weekOverview'
];
const WIDGET_STORE_KEY = 'sct-dash-widgets';

function loadWidgetOrder(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(WIDGET_STORE_KEY) ?? 'null') as string[] | null;
    if (saved?.length) {
      return [...saved.filter(id => DEFAULT_ORDER.includes(id)), ...DEFAULT_ORDER.filter(id => !saved.includes(id))];
    }
  } catch {
    /* 忽略损坏配置 */
  }
  return DEFAULT_ORDER;
}

const widgetOrder = ref<string[]>(loadWidgetOrder());
const widgetsEditable = ref(false);
const dragWidgetId = ref<string | null>(null);
const dragOverWidgetId = ref<string | null>(null);
const dragWidgetTitle = ref('');
const dragPointer = reactive({ x: 0, y: 0 });
let dashDragOrigin: { x: number; y: number; id: string; title: string } | null = null;

function hitTestDashWidget(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  const wrap = el?.closest?.('[data-dash-widget]') as HTMLElement | null;
  return wrap?.dataset?.dashWidget ?? null;
}

function cleanupDashDrag() {
  dashDragOrigin = null;
  dragWidgetId.value = null;
  dragOverWidgetId.value = null;
  dragWidgetTitle.value = '';
  window.removeEventListener('pointermove', onDashPointerMove);
  window.removeEventListener('pointerup', onDashPointerUp);
  window.removeEventListener('pointercancel', cleanupDashDrag);
  window.removeEventListener('keydown', onDashDragKeydown);
}

function onDashPointerMove(e: PointerEvent) {
  if (!dashDragOrigin) return;
  if (!dragWidgetId.value && Math.hypot(e.clientX - dashDragOrigin.x, e.clientY - dashDragOrigin.y) < 6) {
    return;
  }
  if (!dragWidgetId.value) {
    dragWidgetId.value = dashDragOrigin.id;
    dragWidgetTitle.value = dashDragOrigin.title;
  }
  dragPointer.x = e.clientX;
  dragPointer.y = e.clientY;
  dragOverWidgetId.value = hitTestDashWidget(e.clientX, e.clientY);
}

function onDashPointerUp(e: PointerEvent) {
  const fromId = dragWidgetId.value;
  const targetId = fromId ? hitTestDashWidget(e.clientX, e.clientY) : null;
  cleanupDashDrag();
  if (fromId && targetId && fromId !== targetId) {
    const arr = [...widgetOrder.value];
    const fi = arr.indexOf(fromId);
    const ti = arr.indexOf(targetId);
    if (fi >= 0 && ti >= 0) {
      const [moved] = arr.splice(fi, 1);
      arr.splice(ti, 0, moved);
      widgetOrder.value = arr;
      persistWidgets();
    }
  }
}

function onDashDragKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') cleanupDashDrag();
}

function onWidgetPointerDown(w: WidgetDef, e: PointerEvent) {
  if (!widgetsEditable.value || e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('button, a, input, select, textarea')) return;
  e.preventDefault();
  dashDragOrigin = { x: e.clientX, y: e.clientY, id: w.id, title: w.title };
  window.addEventListener('pointermove', onDashPointerMove);
  window.addEventListener('pointerup', onDashPointerUp);
  window.addEventListener('pointercancel', cleanupDashDrag);
  window.addEventListener('keydown', onDashDragKeydown);
}

onBeforeUnmount(cleanupDashDrag);

const enabledWidgetDefs = computed(() =>
  WIDGET_DEFS.value.filter(d => !d.moduleKey || workStore.workspaceConfig.enabledModules[d.moduleKey])
);
const activeWidgets = computed(() =>
  widgetOrder.value.map(id => enabledWidgetDefs.value.find(d => d.id === id)).filter((d): d is WidgetDef => Boolean(d))
);
const hiddenWidgets = computed(() => enabledWidgetDefs.value.filter(d => !widgetOrder.value.includes(d.id)));

function persistWidgets() {
  localStorage.setItem(WIDGET_STORE_KEY, JSON.stringify(widgetOrder.value));
}

function removeWidget(id: string) {
  widgetOrder.value = widgetOrder.value.filter(i => i !== id);
  persistWidgets();
}

function addWidget(id: string) {
  if (!widgetOrder.value.includes(id)) {
    widgetOrder.value.push(id);
    persistWidgets();
  }
}

function moveWidget(id: string, dir: -1 | 1) {
  const activeIdx = activeWidgets.value.findIndex(w => w.id === id);
  const targetWidget = activeWidgets.value[activeIdx + dir];
  if (activeIdx < 0 || !targetWidget) return;
  const fromIdx = widgetOrder.value.indexOf(id);
  const toIdx = widgetOrder.value.indexOf(targetWidget.id);
  if (fromIdx < 0 || toIdx < 0) return;
  const arr = [...widgetOrder.value];
  arr.splice(toIdx, 0, arr.splice(fromIdx, 1)[0]);
  widgetOrder.value = arr;
  persistWidgets();
}

function resetWidgets() {
  widgetOrder.value = [...DEFAULT_ORDER];
  persistWidgets();
  window.$message?.success('已恢复默认布局');
}

// ---------------- 待办提醒中心（广度池 A1） ----------------
const todayStr = dayjs().format('YYYY-MM-DD');
const weekEndStr = dayjs().add(7, 'day').format('YYYY-MM-DD');
const weekStartStr = dayjs()
  .subtract((dayjs().day() + 6) % 7, 'day')
  .format('YYYY-MM-DD');
const weekEndStr2 = dayjs(weekStartStr).add(6, 'day').format('YYYY-MM-DD');
const yearStr = dayjs().format('YYYY');

const overdueItems = computed(() =>
  workStore.devStages
    .filter(d => {
      const m = workStore.memberOf(d.member_id);
      return Boolean(m && !isMemberArchived(m));
    })
    .map(d => ({ d, nextNode: computeNextDevNode(d.stage, d.materials) }))
    .filter(({ d, nextNode }) => Boolean(nextNode && d.next_due && d.next_due < todayStr))
    .map(({ d, nextNode }) => ({
      text: `${workStore.memberName(d.member_id)}：${nextNode}（${bi('应办', 'Due')} ${d.next_due}）`
    }))
);

const owedItems = computed(() => {
  const map = new Map<string, string[]>();
  workStore.feeRecords
    .filter(f => f.status === '欠缴' && rosterMemberIdSet.value.has(f.member_id))
    .forEach(f => {
      map.set(f.member_id, [...(map.get(f.member_id) ?? []), f.year_month]);
    });
  return [...map.entries()].map(([id, months]) => ({
    text: `${workStore.memberName(id)}：${months.join('、')} ${bi('党费未缴', 'dues unpaid')}`
  }));
});

const uncoveredTalks = computed(() => {
  const covered = new Set(workStore.talks.filter(t => t.date.startsWith(yearStr)).flatMap(t => t.member_ids));
  const names = workStore.activeMembers
    .filter(m => (m.type === '正式党员' || m.type === '预备党员') && !covered.has(m.id))
    .map(m => m.name);
  return { count: names.length, names };
});

const weekItems = computed(() => {
  const nodes = workStore.devStages
    .filter(d => {
      const m = workStore.memberOf(d.member_id);
      return Boolean(m && !isMemberArchived(m));
    })
    .map(d => ({ d, nextNode: computeNextDevNode(d.stage, d.materials) }))
    .filter(({ d, nextNode }) => Boolean(nextNode && d.next_due && d.next_due >= todayStr && d.next_due <= weekEndStr))
    .map(({ d, nextNode }) => ({
      tag: bi('节点', 'Milestone'),
      text: `${workStore.memberName(d.member_id)}：${nextNode}（${d.next_due}）`
    }));
  const events = workStore
    .eventsInRange(todayStr, weekEndStr)
    .filter(ev => ev.status !== '已取消' && !ev.merged_into)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6)
    .map(ev => ({
      tag: ev.date === todayStr ? bi('今日', 'Today') : bi('近7天', 'Next 7d'),
      text: `${ev.date.slice(5)} ${ev.title}`
    }));
  return [...nodes, ...events];
});

// ---------------- 当月缴纳率：CSS 进度环 ----------------
const feeMemberIds = computed(
  () =>
    new Set(workStore.inBranchRosterMembers.filter(m => m.type === '正式党员' || m.type === '预备党员').map(m => m.id))
);

const monthRate = computed(() => {
  const ym = dayjs().format('YYYY-MM');
  const rows = workStore.feeRecords.filter(
    f => f.year_month === ym && f.status !== '未在校' && feeMemberIds.value.has(f.member_id)
  );
  if (!rows.length) return { pct: 0, paid: 0, due: 0, hasData: false };
  const paid = rows.filter(r => r.status === '已缴').length;
  return { pct: Math.round((paid / rows.length) * 100), paid, due: rows.length, hasData: true };
});

const animatedFeePct = useCountUp(() => monthRate.value.pct, 980);
const animatedFeeDue = useCountUp(() => monthRate.value.due, 800);
const animatedFeePaid = useCountUp(() => monthRate.value.paid, 850);
const animatedFeeUnpaid = useCountUp(() => Math.max(0, monthRate.value.due - monthRate.value.paid), 700);

const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------- 近半年（26 周）日程热力 ----------------
const heat = computed(() => {
  const totalWeeks = 26;
  const now = dayjs();
  const currentMonday = now.subtract((now.day() + 6) % 7, 'day').startOf('day');
  const start = currentMonday.subtract(totalWeeks - 1, 'week');
  const startIso = start.format('YYYY-MM-DD');
  const todayIso = now.format('YYYY-MM-DD');

  const countByDate = new Map<string, number>();
  workStore
    .eventsInRange(startIso, todayIso)
    .filter(ev => ev.status !== '已取消')
    .forEach(ev => {
      countByDate.set(ev.date, (countByDate.get(ev.date) ?? 0) + 1);
    });

  const weeks: Array<{ monthLabel: string; days: Array<{ date: string; count: number }> }> = [];
  let prevMonth = -1;
  let lastLabelWeek = -99;
  let totalEvents = 0;

  for (let w = 0; w < totalWeeks; w += 1) {
    const weekStart = start.add(w * 7, 'day');
    const month = weekStart.month();
    const isMonthChange = month !== prevMonth;
    const isNearEnd = w >= totalWeeks - 2;
    const isInitialStub = w === 0 && start.add(14, 'day').month() !== month;
    const monthLabel =
      isMonthChange && !isInitialStub && !isNearEnd && w - lastLabelWeek >= 3
        ? bi(`${month + 1}月`, MONTH_SHORT_EN[month])
        : '';
    if (monthLabel) lastLabelWeek = w;
    prevMonth = month;

    const days: Array<{ date: string; count: number }> = [];
    for (let d = 0; d < 7; d += 1) {
      const date = weekStart.add(d, 'day');
      const iso = date.format('YYYY-MM-DD');
      const count = iso > todayIso ? -1 : (countByDate.get(iso) ?? 0);
      if (count > 0) totalEvents += count;
      days.push({ date: iso, count });
    }
    weeks.push({ monthLabel, days });
  }

  const max = Math.max(1, ...weeks.flatMap(w => w.days.map(c => c.count)));
  return { weeks, max, totalEvents };
});

function heatColor(count: number) {
  if (count < 0) return 'transparent';
  if (count === 0) return 'var(--sct-soft)';
  const alpha = Math.min(0.25 + (count / heat.value.max) * 0.6, 0.88);
  return `rgba(${heatBase.value}, ${alpha})`;
}

// ---------------- 发展阶段横条（仅统计未归档在册成员） ----------------
const stageBars = computed(() => {
  const activeStageRows = workStore.devStages.filter(d => {
    const m = workStore.memberOf(d.member_id);
    return Boolean(m && !isMemberArchived(m));
  });
  const counts = DEV_STAGE_ORDER.map(stage => ({
    stage,
    count: activeStageRows.filter(d => d.stage === stage).length
  }));
  const max = Math.max(1, ...counts.map(c => c.count));
  return counts.map(c => ({ ...c, width: `${(c.count / max) * 100}%` }));
});

// ---------------- 近 6 月党费缴纳率折线 ----------------
const feeOption = computed(() => {
  const currentYm = dayjs().format('YYYY-MM');
  const months: string[] = [];
  for (let i = 5; i >= 0; i -= 1) months.push(dayjs().subtract(i, 'month').format('YYYY-MM'));
  const rates = months.map(ym => {
    const rows = workStore.feeRecords.filter(
      f => f.year_month === ym && f.status !== '未在校' && (ym !== currentYm || feeMemberIds.value.has(f.member_id))
    );
    if (!rows.length) return 0;
    const paid = rows.filter(f => f.status === '已缴').length;
    return Math.round((paid / rows.length) * 100);
  });
  const dark = themeStore.darkMode;
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 36, right: 14, top: 18, bottom: 22 },
    textStyle: { color: dark ? '#9ca3af' : '#71717a', fontSize: 11 },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { lineStyle: { color: dark ? '#374151' : '#dcd9d0' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      max: 100,
      splitLine: { lineStyle: { color: dark ? '#2a303c' : '#f0ede8' } },
      axisLabel: { formatter: '{value}%' }
    },
    series: [
      {
        type: 'line',
        data: rates,
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { color: inkColor.value, width: 2.5 },
        itemStyle: { color: inkColor.value, borderColor: dark ? '#12161f' : '#ffffff', borderWidth: 2 },
        areaStyle: { color: dark ? 'rgba(229, 227, 222, 0.12)' : 'rgba(140, 140, 140, 0.10)' }
      }
    ]
  };
});

// ---------------- 台历类别分布（横条） ----------------
const categoryBars = computed(() => {
  const entries = Object.entries(EVENT_CATEGORY_COLORS)
    .map(([cat, c]) => ({ cat, color: c.color, count: workStore.calEvents.filter(ev => ev.category === cat).length }))
    .filter(e => e.count > 0)
    .sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...entries.map(e => e.count));
  return entries.map(e => ({ ...e, width: `${(e.count / max) * 100}%` }));
});

// ---------------- 本周类别分布 ----------------
const weekCategoryCount = computed(() => {
  const weekStart = dayjs()
    .subtract((dayjs().day() + 6) % 7, 'day')
    .format('YYYY-MM-DD');
  const weekEnd = dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD');
  const map = new Map<string, number>();
  workStore.eventsInRange(weekStart, weekEnd).forEach(ev => {
    map.set(ev.category, (map.get(ev.category) ?? 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
});
</script>

<template>
  <div class="min-h-500px">
    <!-- 编辑模式工具条 -->
    <div
      v-if="widgetsEditable"
      class="mb-14px flex flex-wrap items-center justify-between gap-10px rounded-12px p-12px"
      style="background: var(--sct-soft)"
    >
      <div class="flex flex-wrap items-center gap-8px text-12px">
        <span class="font-bold text-gray-500">{{ bi('添加组件：', 'Add Widgets:') }}</span>
        <NButton v-for="d in hiddenWidgets" :key="d.id" size="tiny" secondary @click="addWidget(d.id)">
          <template #icon><SvgIcon icon="lucide:plus" /></template>
          {{ d.title }}
        </NButton>
        <span v-if="hiddenWidgets.length === 0" class="text-gray-400">
          {{ bi('全部组件已添加', 'All widgets added') }}
        </span>
      </div>
      <div class="flex gap-8px">
        <NButton size="tiny" secondary @click="resetWidgets">
          <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
          {{ bi('恢复默认布局', 'Reset Layout') }}
        </NButton>
        <NButton size="tiny" type="primary" @click="widgetsEditable = false">
          <template #icon><SvgIcon icon="lucide:check" /></template>
          {{ bi('完成', 'Done') }}
        </NButton>
      </div>
    </div>
    <div v-else class="mb-12px flex justify-end">
      <div data-tour="dashboard-customize">
        <NButton size="small" secondary @click="widgetsEditable = true">
          <template #icon><SvgIcon icon="lucide:layout-grid" /></template>
          {{ bi('自定义布局', 'Customize Layout') }}
        </NButton>
      </div>
    </div>

    <!-- 组件自适应栅格：stats 与 reminders 占满整行；本月党费及以下卡片按屏幕宽度自适应每行 1~3 个 -->
    <div data-tour="dashboard-grid" class="grid grid-cols-1 gap-14px md:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="(w, wIdx) in activeWidgets"
        :key="w.id"
        :data-dash-widget="w.id"
        class="dash-widget-item"
        :class="[
          w.fullRow ? 'col-span-full' : 'flex flex-col',
          {
            'opacity-45': dragWidgetId === w.id,
            'ring-2 ring-[#A81C24]':
              widgetsEditable && dragOverWidgetId === w.id && dragWidgetId && dragWidgetId !== w.id,
            'dash-widget-item--editing outline outline-1 outline-dashed outline-gray-300 rounded-14px p-8px select-none':
              widgetsEditable,
            'dash-widget-item--wide': widgetsEditable && w.fullRow,
            'dash-widget-item--alt': widgetsEditable && wIdx % 2 === 1
          }
        ]"
        :style="widgetsEditable && !dragWidgetId ? { animationDelay: `${(wIdx % 4) * -0.11}s` } : undefined"
        @pointerdown="onWidgetPointerDown(w, $event)"
      >
        <div v-if="widgetsEditable" class="mb-8px flex items-center justify-between gap-8px text-11px text-gray-400">
          <span class="cursor-move font-semibold">⠿ {{ w.title }}（{{ bi('拖拽排序', 'Drag to reorder') }}）</span>
          <div class="flex items-center gap-4px">
            <NButton size="tiny" quaternary @click.stop="moveWidget(w.id, -1)">
              <template #icon><SvgIcon icon="lucide:arrow-up" /></template>
              {{ bi('上移', 'Up') }}
            </NButton>
            <NButton size="tiny" quaternary @click.stop="moveWidget(w.id, 1)">
              <template #icon><SvgIcon icon="lucide:arrow-down" /></template>
              {{ bi('下移', 'Down') }}
            </NButton>
            <NButton size="tiny" quaternary type="error" @click.stop="removeWidget(w.id)">
              <template #icon><SvgIcon icon="lucide:trash-2" /></template>
              {{ bi('移除', 'Remove') }}
            </NButton>
          </div>
        </div>

        <!-- 顶部关键数字：卡片与数字放大 -->
        <div v-if="w.id === 'stats'" class="grid grid-cols-1 gap-14px sm:grid-cols-2 lg:grid-cols-4">
          <NCard :bordered="false" class="rounded-16px" :content-style="{ padding: '22px 24px' }">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-13px font-semibold text-gray-500">{{ bi('在册人员', 'Registered Members') }}</div>
                <div class="mt-10px text-40px font-black leading-none tracking-tight text-[var(--sct-ink)]">
                  {{ memberNum }}
                </div>
                <div class="mt-10px text-12px text-gray-400">
                  {{ bi('正式', 'Full') }}
                  {{ activeFormalCount }} ·
                  {{ bi('预备', 'Probationary') }}
                  {{ activeProbationCount }}
                </div>
              </div>
              <IconSolarUsersGroupTwoRoundedBoldDuotone class="shrink-0 text-50px text-[#3b82f6] opacity-90" />
            </div>
          </NCard>

          <NCard :bordered="false" class="rounded-16px" :content-style="{ padding: '22px 24px' }">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-13px font-semibold text-gray-500">{{ bi('台历事项', 'Calendar Events') }}</div>
                <div class="mt-10px text-40px font-black leading-none tracking-tight text-[var(--sct-ink)]">
                  {{ eventNum }}
                </div>
                <div class="mt-10px text-12px text-gray-400">
                  {{
                    bi(
                      `本周 ${workStore.eventsInRange(weekStartStr, weekEndStr2).length} 项安排`,
                      `${workStore.eventsInRange(weekStartStr, weekEndStr2).length} scheduled this week`
                    )
                  }}
                </div>
              </div>
              <IconSolarCalendarMarkBoldDuotone class="shrink-0 text-50px text-[#8b5cf6] opacity-90" />
            </div>
          </NCard>

          <NCard :bordered="false" class="rounded-16px" :content-style="{ padding: '22px 24px' }">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-13px font-semibold text-gray-500">{{ bi('谈心谈话', 'Heart-to-Heart Talks') }}</div>
                <div class="mt-10px text-40px font-black leading-none tracking-tight text-[var(--sct-ink)]">
                  {{ talkNum }}
                </div>
                <div class="mt-10px text-12px text-gray-400">
                  {{
                    bi(
                      `今年党员覆盖 ${Math.max(0, activePartyCount - uncoveredTalks.count)}/${activePartyCount} 人`,
                      `Covered ${Math.max(0, activePartyCount - uncoveredTalks.count)}/${activePartyCount} party members`
                    )
                  }}
                </div>
              </div>
              <IconSolarChatRoundDotsBoldDuotone class="shrink-0 text-50px text-[#10b981] opacity-90" />
            </div>
          </NCard>

          <NCard :bordered="false" class="rounded-16px" :content-style="{ padding: '22px 24px' }">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-13px font-semibold text-gray-500">{{ bi('欠缴人数', 'Overdue Dues') }}</div>
                <div
                  class="mt-10px text-40px font-black leading-none tracking-tight"
                  :style="{ color: owedCount ? '#d43030' : '#3f9d63' }"
                >
                  {{ owedNum }}
                </div>
                <div class="mt-10px text-12px text-gray-400">
                  {{
                    owedCount
                      ? bi('座位图已标红角标提醒', 'Red badge highlighted on seat map')
                      : bi('党费缴纳情况良好', 'All dues collected on time')
                  }}
                </div>
              </div>
              <IconSolarBellBingBoldDuotone v-if="owedCount" class="shrink-0 text-50px text-[#d43030] opacity-90" />
              <IconSolarCheckCircleBoldDuotone v-else class="shrink-0 text-50px text-[#3f9d63] opacity-90" />
            </div>
          </NCard>
        </div>

        <!-- 待办提醒中心 -->
        <NCard v-else-if="w.id === 'reminders'" :bordered="false" class="rounded-16px">
          <template #header>
            <div class="flex items-center gap-7px">
              <SvgIcon icon="lucide:bell-ring" class="text-15px text-[var(--sct-ink)] opacity-75" />
              <span>{{ bi('待办提醒中心', 'Action & Reminder Center') }}</span>
            </div>
          </template>
          <template #header-extra>
            <span class="text-12px text-gray-400">
              {{
                bi(
                  '自动汇总自党员发展 / 党费收缴 / 谈话 / 台历',
                  'Aggregated from Development / Dues / Talks / Calendar'
                )
              }}
            </span>
          </template>
          <div class="grid grid-cols-1 gap-12px lg:grid-cols-3">
            <div class="rounded-14px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-14px">
              <div class="mb-8px flex items-center gap-6px text-13px font-bold" style="color: #d43030">
                <span class="inline-block h-12px w-3.5px rounded-full bg-[#d43030]" />
                <span>{{ bi('逾期', 'Overdue') }}（{{ overdueItems.length }}）</span>
              </div>
              <div v-if="!overdueItems.length" class="text-12px text-gray-400">
                {{ bi('无逾期节点', 'No overdue milestones') }}
              </div>
              <div
                v-for="(it, i) in overdueItems"
                :key="i"
                class="mb-4px text-12px leading-relaxed"
                style="color: var(--sct-muted)"
              >
                {{ it.text }}
              </div>
            </div>
            <div class="rounded-14px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-14px">
              <div class="mb-8px flex items-center gap-6px text-13px font-bold" style="color: #d97706">
                <span class="inline-block h-12px w-3.5px rounded-full bg-[#d97706]" />
                <span>
                  {{ bi('欠缴与未覆盖', 'Unpaid Dues & Uncovered Talks') }}（{{
                    owedItems.length + uncoveredTalks.count
                  }}）
                </span>
              </div>
              <div
                v-for="(it, i) in owedItems"
                :key="'f' + i"
                class="mb-4px text-12px leading-relaxed"
                style="color: var(--sct-muted)"
              >
                {{ it.text }}
              </div>
              <div class="text-12px leading-relaxed" style="color: var(--sct-muted)">
                {{
                  bi(`今年未谈心谈话 ${uncoveredTalks.count} 人`, `Uncovered talks this year: ${uncoveredTalks.count}`)
                }}{{
                  uncoveredTalks.count
                    ? `：${uncoveredTalks.names.slice(0, 6).join('、')}${uncoveredTalks.count > 6 ? bi(' 等', ' etc.') : ''}`
                    : ''
                }}
              </div>
            </div>
            <div class="rounded-14px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-14px">
              <div class="mb-8px flex items-center gap-6px text-13px font-bold" style="color: #2080f0">
                <span class="inline-block h-12px w-3.5px rounded-full bg-[#2080f0]" />
                <span>
                  {{
                    bi(`今日与近 7 天（${weekItems.length}，含发展节点）`, `Today & Next 7 Days (${weekItems.length})`)
                  }}
                </span>
              </div>
              <div v-if="!weekItems.length" class="text-12px text-gray-400">
                {{ bi('未来一周无节点与会议', 'No milestones or meetings in the next 7 days') }}
              </div>
              <div
                v-for="(it, i) in weekItems"
                :key="'w' + i"
                class="mb-4px text-12px leading-relaxed text-[var(--sct-muted)]"
              >
                <span
                  class="mr-4px inline-block rounded-4px px-5px py-1px text-10px font-bold"
                  :style="{ background: 'var(--sct-container)', color: 'var(--sct-ink)' }"
                >
                  {{ it.tag }}
                </span>
                {{ it.text }}
              </div>
            </div>
          </div>
        </NCard>

        <!-- vue-data-ui 创意可视化组件 -->
        <DashboardVduiWidgets v-else-if="w.vdui" :widget-id="w.id as VduiWidgetId" />

        <!-- 本月党费及以下卡片：自适应每行 3 个 -->
        <NCard v-else-if="w.id === 'feeRing'" :bordered="false" class="h-full rounded-16px">
          <template #header>
            <div class="flex items-center gap-7px">
              <SvgIcon icon="lucide:wallet" class="text-15px text-[var(--sct-ink)] opacity-75" />
              <span>{{ bi('本月党费', 'Monthly Dues') }}</span>
            </div>
          </template>
          <div class="flex items-center justify-around py-12px">
            <div
              class="relative size-136px rounded-full"
              :style="{ background: `conic-gradient(var(--sct-ink) ${animatedFeePct}%, var(--sct-soft) 0)` }"
            >
              <div
                class="absolute inset-14px flex flex-col items-center justify-center rounded-full"
                style="background: var(--sct-container)"
              >
                <div class="text-26px font-black font-mono" style="color: var(--sct-ink)">
                  {{ animatedFeePct }}
                  <span class="text-13px">%</span>
                </div>
                <div class="text-11px text-gray-400">{{ bi('缴纳率', 'Collection') }}</div>
              </div>
            </div>
            <div class="text-13px leading-7 text-gray-500">
              <div>
                {{ bi('应缴', 'Due') }}
                <b class="font-mono text-[var(--sct-ink)]">{{ animatedFeeDue }}</b>
                {{ bi('人', '') }}
              </div>
              <div>
                {{ bi('已缴', 'Paid') }}
                <b class="font-mono" style="color: #3f9d63">{{ animatedFeePaid }}</b>
                {{ bi('人', '') }}
              </div>
              <div>
                {{ bi('欠缴', 'Unpaid') }}
                <b class="font-mono" style="color: #d43030">{{ animatedFeeUnpaid }}</b>
                {{ bi('人', '') }}
              </div>
              <div v-if="!monthRate.hasData" class="text-11px text-gray-300">
                {{ bi('本月名单未生成', 'List not generated') }}
              </div>
            </div>
          </div>
        </NCard>

        <NCard v-else-if="w.id === 'heatmap'" :bordered="false" class="h-full rounded-16px">
          <template #header>
            <div class="flex items-center gap-7px">
              <SvgIcon icon="lucide:calendar-range" class="text-15px text-[var(--sct-ink)] opacity-75" />
              <span>{{ bi('近半年日程热力', '6-Month Schedule Heatmap') }}</span>
            </div>
          </template>
          <template #header-extra>
            <span class="text-11px text-gray-400">
              {{ bi(`近 26 周 · ${heat.totalEvents} 项`, `26w · ${heat.totalEvents}`) }}
            </span>
          </template>
          <div class="flex flex-col justify-between py-6px">
            <div class="overflow-x-auto pb-4px pt-2px">
              <div class="dash-heat-wrap mx-auto flex w-full max-w-410px items-end gap-5px">
                <!-- 星期轴 -->
                <div class="dash-heat-axis flex shrink-0 flex-col justify-between text-10px text-gray-400 leading-none">
                  <span>{{ bi('一', 'M') }}</span>
                  <span>{{ bi('三', 'W') }}</span>
                  <span>{{ bi('五', 'F') }}</span>
                  <span>{{ bi('日', 'S') }}</span>
                </div>
                <!-- 26 周列（自适应网格，无横向溢出，月份浮层不撑宽列宽） -->
                <div class="dash-heat-grid min-w-0 flex-1">
                  <div v-for="(week, wi) in heat.weeks" :key="wi" class="flex min-w-0 flex-col gap-2px">
                    <div class="relative h-14px w-full overflow-visible">
                      <span
                        v-if="week.monthLabel"
                        class="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-10px text-gray-400 leading-14px"
                      >
                        {{ week.monthLabel }}
                      </span>
                    </div>
                    <div
                      v-for="(cell, di) in week.days"
                      :key="cell.date"
                      class="dash-heat-cell aspect-square w-full rounded-2px"
                      :class="{ 'dash-heat-cell--in': entered }"
                      :style="{
                        background: heatColor(cell.count),
                        transitionDelay: `${wi * 16 + di * 10}ms`
                      }"
                      :title="`${cell.date}：${cell.count < 0 ? bi('未到来', 'Upcoming') : `${cell.count} ${bi('项安排', 'events')}`}`"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div class="mt-10px flex items-center justify-end gap-5px text-11px text-gray-400">
              {{ bi('疏', 'Less') }}
              <span class="inline-block size-10px rounded-2px" style="background: var(--sct-soft)" />
              <span
                v-for="a in [0.3, 0.5, 0.7]"
                :key="a"
                class="inline-block size-10px rounded-2px"
                :style="{ background: `rgba(${heatBase}, ${a})` }"
              />
              {{ bi('密', 'More') }}
            </div>
          </div>
        </NCard>

        <NCard v-else-if="w.id === 'feeTrend'" :bordered="false" class="h-full rounded-16px">
          <template #header>
            <div class="flex items-center gap-7px">
              <SvgIcon icon="lucide:trending-up" class="text-15px text-[var(--sct-ink)] opacity-75" />
              <span>{{ bi('近 6 个月党费缴纳率', '6-Month Dues Collection Rate') }}</span>
            </div>
          </template>
          <VChart class="h-190px" :option="feeOption" autoresize />
        </NCard>

        <NCard v-else-if="w.id === 'stageBars'" :bordered="false" class="h-full rounded-16px">
          <template #header>
            <div class="flex items-center gap-7px">
              <SvgIcon icon="lucide:git-branch" class="text-15px text-[var(--sct-ink)] opacity-75" />
              <span>{{ bi('发展阶段分布', 'Development Stage Distribution') }}</span>
            </div>
          </template>
          <div class="flex flex-col gap-12px py-6px">
            <div v-for="row in stageBars" :key="row.stage" class="flex items-center gap-10px">
              <span class="w-84px truncate text-right text-12px text-gray-500">{{ tMemberType(row.stage) }}</span>
              <div class="h-16px flex-1 overflow-hidden rounded-6px" style="background: var(--sct-soft)">
                <div
                  class="dash-bar-fill h-full rounded-6px"
                  :style="{ width: entered ? row.width : '0%', background: 'var(--sct-ink)' }"
                />
              </div>
              <span class="w-24px text-13px font-bold" style="color: var(--sct-ink)">{{ row.count }}</span>
            </div>
          </div>
        </NCard>

        <NCard v-else-if="w.id === 'categoryBars'" :bordered="false" class="h-full rounded-16px">
          <template #header>
            <div class="flex items-center gap-7px">
              <SvgIcon icon="lucide:tags" class="text-15px text-[var(--sct-ink)] opacity-75" />
              <span>{{ bi('台历事项类别', 'Calendar Event Categories') }}</span>
            </div>
          </template>
          <div class="flex flex-col gap-10px py-6px">
            <div v-for="row in categoryBars" :key="row.cat" class="flex items-center gap-10px">
              <span class="w-76px truncate text-right text-12px text-gray-500">{{ tCategory(row.cat) }}</span>
              <div class="h-14px flex-1 overflow-hidden rounded-6px" style="background: var(--sct-soft)">
                <div
                  class="dash-bar-fill h-full rounded-6px"
                  :style="{ width: entered ? row.width : '0%', background: row.color }"
                />
              </div>
              <span class="w-22px text-13px font-bold text-gray-600">{{ row.count }}</span>
            </div>
          </div>
        </NCard>

        <NCard v-else-if="w.id === 'weekOverview'" :bordered="false" class="h-full rounded-16px">
          <template #header>
            <div class="flex items-center gap-7px">
              <SvgIcon icon="lucide:bar-chart-3" class="text-15px text-[var(--sct-ink)] opacity-75" />
              <span>{{ bi('本周类别速览', 'Weekly Category Overview') }}</span>
            </div>
          </template>
          <EmptyFancy
            v-if="!weekCategoryCount.length"
            emoji="tea"
            :text="bi('本周还没有安排', 'No events scheduled this week')"
            :sub="bi('去台历点一格就能新建', 'Click any slot in Calendar to create one')"
            compact
          />
          <div v-else class="flex flex-col gap-10px py-6px">
            <div v-for="[cat, count] in weekCategoryCount" :key="cat" class="flex items-center justify-between">
              <span class="flex items-center gap-8px text-13px">
                <span
                  class="inline-block size-10px rounded-3px"
                  :style="{ background: EVENT_CATEGORY_COLORS[cat as Sct.EventCategory]?.color }"
                />
                {{ tCategory(cat) }}
              </span>
              <span class="text-13px font-bold text-gray-600">{{ count }} {{ bi('项', 'items') }}</span>
            </div>
          </div>
        </NCard>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="dragWidgetId"
        class="pointer-events-none fixed z-9999 inline-flex items-center gap-6px rounded-8px border border-[#A81C24] bg-[var(--sct-container)] px-12px py-6px text-12px font-bold text-[var(--sct-ink)] shadow-lg"
        :style="{ left: `${dragPointer.x + 12}px`, top: `${dragPointer.y + 12}px` }"
      >
        <SvgIcon icon="lucide:grip-vertical" class="text-13px text-[#A81C24]" />
        <span>{{ dragWidgetTitle }}</span>
        <span class="text-11px font-normal text-gray-400">拖到目标位置松手排序</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
@keyframes sct-widget-jiggle {
  0% {
    transform: rotate(-0.55deg);
  }
  50% {
    transform: rotate(0.55deg);
  }
  100% {
    transform: rotate(-0.55deg);
  }
}

@keyframes sct-widget-jiggle-wide {
  0% {
    transform: rotate(-0.18deg);
  }
  50% {
    transform: rotate(0.18deg);
  }
  100% {
    transform: rotate(-0.18deg);
  }
}

.dash-widget-item--editing {
  transform-origin: center center;
  animation: sct-widget-jiggle 0.34s ease-in-out infinite;
  cursor: grab;
}

.dash-widget-item--editing.dash-widget-item--alt {
  animation-direction: reverse;
  animation-duration: 0.38s;
}

.dash-widget-item--editing.dash-widget-item--wide {
  animation-name: sct-widget-jiggle-wide;
  animation-duration: 0.42s;
}

.dash-widget-item--editing:hover,
.dash-widget-item--editing:active {
  animation-play-state: paused;
}

.dash-heat-grid {
  display: grid;
  grid-template-columns: repeat(26, minmax(8px, 1fr));
  gap: 2px;
}

.dash-heat-axis {
  align-self: stretch;
  padding-top: 17px;
  padding-bottom: 1px;
}

.dash-heat-cell {
  opacity: 0;
  transform: scale(0.42);
  transition:
    opacity 0.36s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.36s cubic-bezier(0.22, 1, 0.36, 1);
}

.dash-heat-cell--in {
  opacity: 1;
  transform: scale(1);
}

.dash-bar-fill {
  transition: width 0.78s cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .dash-widget-item--editing {
    animation: none;
  }
  .dash-heat-cell {
    opacity: 1;
    transform: none;
    transition: none;
  }
  .dash-bar-fill {
    transition: none;
  }
}
</style>
