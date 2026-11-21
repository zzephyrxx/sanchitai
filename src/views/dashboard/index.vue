<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { useTransition } from '@vueuse/core';
import VChart from 'vue-echarts';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useThemeStore } from '@/store/modules/theme';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import { setupEcharts } from '@/plugins/echarts';
import { EVENT_CATEGORY_COLORS } from '@/constants/sanchitai';
import { DEV_STAGE_ORDER } from '@/constants/dev-nodes';
import EmptyFancy from '@/components/custom/empty-fancy.vue';

defineOptions({ name: 'DashboardPage' });

setupEcharts();

const workStore = useWorkDataStore();
const { bi, tMemberType, tCategory } = useSctI18n();

const themeStore = useThemeStore();
/** 图表墨色随深浅切换（CSS var 无法进 echarts，取实时值） */
const inkColor = computed(() => (themeStore.darkMode ? '#d9d6d0' : '#2B2926'));
const heatBase = computed(() => (themeStore.darkMode ? '217, 214, 208' : '43, 41, 38'));

// ---------------- count-up 动数 ----------------
function useCountUp(source: () => number, duration = 800) {
  const target = ref(source());
  const shown = useTransition(target, { duration, transition: [0.22, 1, 0.36, 1] });
  watch(
    source,
    v => {
      target.value = v;
    },
    { immediate: false }
  );
  return computed(() => Math.round(shown.value));
}

const memberCount = computed(() => workStore.members.length);
const eventCount = computed(() => workStore.calEvents.length);
const talkCount = computed(() => workStore.talks.length);
const owedCount = computed(() => new Set(workStore.feeRecords.filter(f => f.status === '欠缴').map(f => f.member_id)).size);

const memberNum = useCountUp(() => memberCount.value);
const eventNum = useCountUp(() => eventCount.value);
const talkNum = useCountUp(() => talkCount.value);
const owedNum = useCountUp(() => owedCount.value, 500);

// ---------------- 可定制组件系统（编辑模式/拖拽排序/增删/持久化） ----------------
interface WidgetDef {
  id: string;
  title: string;
  fullRow?: boolean;
}
const WIDGET_DEFS = computed<WidgetDef[]>(() => [
  { id: 'stats', title: bi('关键数字', 'Key Metrics'), fullRow: true },
  { id: 'reminders', title: bi('待办提醒中心', 'Action & Reminder Center'), fullRow: true },
  { id: 'feeRing', title: bi('本月党费', 'Monthly Dues') },
  { id: 'heatmap', title: bi('日程热力', 'Schedule Heatmap') },
  { id: 'feeTrend', title: bi('缴费率趋势', 'Dues Trend') },
  { id: 'stageBars', title: bi('发展阶段', 'Development Stages') },
  { id: 'categoryBars', title: bi('类别分布', 'Category Breakdown') },
  { id: 'weekOverview', title: bi('本周速览', 'Weekly Snapshot') }
]);
const DEFAULT_ORDER = ['stats', 'reminders', 'feeRing', 'heatmap', 'feeTrend', 'stageBars', 'categoryBars', 'weekOverview'];
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

const activeWidgets = computed(
  () => widgetOrder.value.map(id => WIDGET_DEFS.value.find(d => d.id === id)).filter(Boolean) as WidgetDef[]
);
const hiddenWidgets = computed(() => DEFAULT_ORDER.filter(id => !widgetOrder.value.includes(id)));

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
  const idx = widgetOrder.value.indexOf(id);
  const next = idx + dir;
  if (idx < 0 || next < 0 || next >= widgetOrder.value.length) return;
  const arr = [...widgetOrder.value];
  arr.splice(next, 0, arr.splice(idx, 1)[0]);
  widgetOrder.value = arr;
  persistWidgets();
}

function onWidgetDrop(targetId: string) {
  if (!dragWidgetId.value || dragWidgetId.value === targetId) return;
  const arr = [...widgetOrder.value];
  const from = arr.indexOf(dragWidgetId.value);
  const to = arr.indexOf(targetId);
  arr.splice(to, 0, arr.splice(from, 1)[0]);
  widgetOrder.value = arr;
  dragWidgetId.value = null;
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
    .filter(d => d.next_due && d.next_due < todayStr)
    .map(d => ({
      text: `${workStore.memberName(d.member_id)}：${d.next_node ?? bi('下一步节点', 'Next Milestone')}（${bi('应办', 'Due')} ${d.next_due}）`
    }))
);

const owedItems = computed(() => {
  const map = new Map<string, string[]>();
  workStore.feeRecords
    .filter(f => f.status === '欠缴')
    .forEach(f => {
      map.set(f.member_id, [...(map.get(f.member_id) ?? []), f.year_month]);
    });
  return [...map.entries()].map(([id, months]) => ({
    text: `${workStore.memberName(id)}：${months.join('、')} ${bi('党费未缴', 'dues unpaid')}`
  }));
});

const uncoveredTalks = computed(() => {
  const covered = new Set(workStore.talks.filter(t => t.date.startsWith(yearStr)).flatMap(t => t.member_ids));
  const names = workStore.members.filter(m => !covered.has(m.id)).map(m => m.name);
  return { count: names.length, names };
});

const weekItems = computed(() => {
  const nodes = workStore.devStages
    .filter(d => d.next_due && d.next_due >= todayStr && d.next_due <= weekEndStr)
    .map(d => ({
      tag: bi('节点', 'Milestone'),
      text: `${workStore.memberName(d.member_id)}：${d.next_node ?? ''}（${d.next_due}）`
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
  () => new Set(workStore.members.filter(m => m.type === '正式党员' || m.type === '预备党员').map(m => m.id))
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

// ---------------- 近 12 周日程热力 ----------------
const heat = computed(() => {
  const weeks: Array<Array<{ date: string; count: number }>> = [];
  const start = dayjs().subtract(11, 'week').startOf('week').add(1, 'day'); // 周一
  for (let w = 0; w < 12; w += 1) {
    const col: Array<{ date: string; count: number }> = [];
    for (let d = 0; d < 7; d += 1) {
      const date = start.add(w * 7 + d, 'day');
      const iso = date.format('YYYY-MM-DD');
      col.push({
        date: iso,
        count: date.isAfter(dayjs()) ? -1 : workStore.eventsInRange(iso, iso).filter(ev => ev.status !== '已取消').length
      });
    }
    weeks.push(col);
  }
  const max = Math.max(1, ...weeks.flat().map(c => c.count));
  return { weeks, max };
});

function heatColor(count: number) {
  if (count < 0) return 'transparent';
  if (count === 0) return 'var(--sct-soft)';
  const alpha = Math.min(0.25 + (count / heat.value.max) * 0.6, 0.88);
  return `rgba(${heatBase.value}, ${alpha})`;
}

// ---------------- 发展阶段横条 ----------------
const stageBars = computed(() => {
  const counts = DEV_STAGE_ORDER.map(stage => ({
    stage,
    count: workStore.devStages.filter(d => d.stage === stage).length
  }));
  const max = Math.max(1, ...counts.map(c => c.count));
  return counts.map(c => ({ ...c, width: `${(c.count / max) * 100}%` }));
});

// ---------------- 近 6 月党费缴纳率折线 ----------------
const feeOption = computed(() => {
  const months: string[] = [];
  for (let i = 5; i >= 0; i -= 1) months.push(dayjs().subtract(i, 'month').format('YYYY-MM'));
  const rates = months.map(ym => {
    const rows = workStore.feeRecords.filter(f => f.year_month === ym && f.status !== '未在校');
    if (!rows.length) return 0;
    const paid = rows.filter(f => f.status === '已缴').length;
    return Math.round((paid / rows.length) * 100);
  });
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 36, right: 14, top: 18, bottom: 22 },
    textStyle: { color: '#71717a', fontSize: 11 },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { lineStyle: { color: 'var(--sct-border)' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      max: 100,
      splitLine: { lineStyle: { color: '#f0ede8' } },
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
        itemStyle: { color: inkColor.value, borderColor: '#1f2430', borderWidth: 2 },
        areaStyle: { color: 'rgba(140, 140, 140, 0.10)' }
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
        <NButton
          v-for="d in WIDGET_DEFS.filter(x => !widgetOrder.includes(x.id))"
          :key="d.id"
          size="tiny"
          secondary
          @click="addWidget(d.id)"
        >
          <template #icon><SvgIcon icon="lucide:plus" /></template>
          {{ d.title }}
        </NButton>
        <span v-if="hiddenWidgets.length === 0" class="text-gray-400">{{ bi('全部组件已添加', 'All widgets added') }}</span>
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
      <NButton size="small" secondary @click="widgetsEditable = true">
        <template #icon><SvgIcon icon="lucide:layout-grid" /></template>
        {{ bi('自定义布局', 'Customize Layout') }}
      </NButton>
    </div>

    <!-- 组件自适应栅格：stats 与 reminders 占满整行；本月党费及以下卡片按屏幕宽度自适应每行 1~3 个 -->
    <div class="grid grid-cols-1 gap-14px md:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="w in activeWidgets"
        :key="w.id"
        :class="[
          w.fullRow ? 'col-span-full' : 'flex flex-col',
          {
            'opacity-50': dragWidgetId === w.id,
            'outline outline-1 outline-dashed outline-gray-300 rounded-14px p-8px': widgetsEditable
          }
        ]"
        :draggable="widgetsEditable"
        @dragstart="dragWidgetId = w.id"
        @dragover.prevent
        @drop="onWidgetDrop(w.id)"
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
                  {{ bi('正式', 'Full') }} {{ memberCount && workStore.members.filter(m => m.type === '正式党员').length }} ·
                  {{ bi('预备', 'Probationary') }}
                  {{ workStore.members.filter(m => m.type === '预备党员').length }}
                </div>
              </div>
              <div class="size-54px flex items-center justify-center rounded-14px bg-[var(--sct-soft)] text-34px opacity-95">
                <IconFluentEmojiCardIndexDividers />
              </div>
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
              <div class="size-54px flex items-center justify-center rounded-14px bg-[var(--sct-soft)] text-34px opacity-95">
                <IconFluentEmojiCalendar />
              </div>
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
                      `今年已覆盖 ${workStore.members.length - uncoveredTalks.count}/${memberCount} 人`,
                      `Covered ${workStore.members.length - uncoveredTalks.count}/${memberCount} this year`
                    )
                  }}
                </div>
              </div>
              <div class="size-54px flex items-center justify-center rounded-14px bg-[var(--sct-soft)] text-34px opacity-95">
                <IconFluentEmojiSpiralNotepad />
              </div>
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
              <div class="size-54px flex items-center justify-center rounded-14px bg-[var(--sct-soft)] text-34px opacity-95">
                <IconFluentEmojiAlarmClock />
              </div>
            </div>
          </NCard>
        </div>

        <!-- 待办提醒中心 -->
        <NCard
          v-else-if="w.id === 'reminders'"
          :bordered="false"
          class="rounded-16px"
          :title="bi('待办提醒中心', 'Action & Reminder Center')"
        >
          <template #header-extra>
            <span class="text-12px text-gray-400">
              {{ bi('自动汇总自党员发展 / 党费收缴 / 谈话 / 台历', 'Aggregated from Development / Dues / Talks / Calendar') }}
            </span>
          </template>
          <div class="grid grid-cols-1 gap-12px lg:grid-cols-3">
            <div class="rounded-14px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-14px">
              <div class="mb-8px flex items-center gap-6px text-13px font-bold" style="color: #d43030">
                <span class="inline-block h-12px w-3.5px rounded-full bg-[#d43030]" />
                <span>{{ bi('逾期', 'Overdue') }}（{{ overdueItems.length }}）</span>
              </div>
              <div v-if="!overdueItems.length" class="text-12px text-gray-400">{{ bi('无逾期节点', 'No overdue milestones') }}</div>
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
                <span>{{ bi('欠缴与未覆盖', 'Unpaid Dues & Uncovered Talks') }}（{{ owedItems.length + uncoveredTalks.count }}）</span>
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
                {{ bi(`今年未谈心谈话 ${uncoveredTalks.count} 人`, `Uncovered talks this year: ${uncoveredTalks.count}`) }}{{
                  uncoveredTalks.count
                    ? `：${uncoveredTalks.names.slice(0, 6).join('、')}${uncoveredTalks.count > 6 ? bi(' 等', ' etc.') : ''}`
                    : ''
                }}
              </div>
            </div>
            <div class="rounded-14px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-14px">
              <div class="mb-8px flex items-center gap-6px text-13px font-bold" style="color: #2080f0">
                <span class="inline-block h-12px w-3.5px rounded-full bg-[#2080f0]" />
                <span>{{ bi(`今日与近 7 天（${weekItems.length}，含发展节点）`, `Today & Next 7 Days (${weekItems.length})`) }}</span>
              </div>
              <div v-if="!weekItems.length" class="text-12px text-gray-400">
                {{ bi('未来一周无节点与会议', 'No milestones or meetings in the next 7 days') }}
              </div>
              <div v-for="(it, i) in weekItems" :key="'w' + i" class="mb-4px text-12px leading-relaxed text-gray-600">
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

        <!-- 本月党费及以下卡片：自适应每行 3 个 -->
        <NCard
          v-else-if="w.id === 'feeRing'"
          :bordered="false"
          class="h-full rounded-16px"
          :title="bi('本月党费', 'Monthly Dues')"
        >
          <div class="flex items-center justify-around py-12px">
            <div
              class="relative size-136px rounded-full"
              :style="{ background: `conic-gradient(var(--sct-ink) ${monthRate.pct}%, var(--sct-soft) 0)` }"
            >
              <div
                class="absolute inset-14px flex flex-col items-center justify-center rounded-full"
                style="background: var(--sct-container)"
              >
                <div class="text-26px font-black" style="color: var(--sct-ink)">
                  {{ monthRate.pct }}<span class="text-13px">%</span>
                </div>
                <div class="text-11px text-gray-400">{{ bi('缴纳率', 'Collection') }}</div>
              </div>
            </div>
            <div class="text-13px leading-7 text-gray-500">
              <div>
                {{ bi('应缴', 'Due') }} <b class="text-[var(--sct-ink)]">{{ monthRate.due }}</b> {{ bi('人', '') }}
              </div>
              <div>
                {{ bi('已缴', 'Paid') }} <b style="color: #3f9d63">{{ monthRate.paid }}</b> {{ bi('人', '') }}
              </div>
              <div>
                {{ bi('欠缴', 'Unpaid') }} <b style="color: #d43030">{{ monthRate.due - monthRate.paid }}</b> {{ bi('人', '') }}
              </div>
              <div v-if="!monthRate.hasData" class="text-11px text-gray-300">{{ bi('本月名单未生成', 'List not generated') }}</div>
            </div>
          </div>
        </NCard>

        <NCard
          v-else-if="w.id === 'heatmap'"
          :bordered="false"
          class="h-full rounded-16px"
          :title="bi('近 12 周日程热力', '12-Week Schedule Heatmap')"
        >
          <div class="flex justify-center gap-4px overflow-x-auto py-8px">
            <div v-for="(week, wi) in heat.weeks" :key="wi" class="flex flex-col gap-4px">
              <div
                v-for="cell in week"
                :key="cell.date"
                class="size-16px rounded-4px"
                :style="{ background: heatColor(cell.count) }"
                :title="`${cell.date}：${cell.count < 0 ? bi('未到来', 'Upcoming') : `${cell.count} ${bi('项安排', 'events')}`}`"
              />
            </div>
          </div>
          <div class="mt-8px flex items-center justify-center gap-6px text-11px text-gray-400">
            {{ bi('疏', 'Less') }}
            <span class="inline-block size-12px rounded-3px" style="background: var(--sct-soft)" />
            <span
              v-for="a in [0.3, 0.5, 0.7]"
              :key="a"
              class="inline-block size-12px rounded-3px"
              :style="{ background: `rgba(${heatBase}, ${a})` }"
            />
            {{ bi('密', 'More') }}
            <span class="ml-6px">{{ bi('每日格 = 当日事项数', 'Cell = daily events') }}</span>
          </div>
        </NCard>

        <NCard
          v-else-if="w.id === 'feeTrend'"
          :bordered="false"
          class="h-full rounded-16px"
          :title="bi('近 6 个月党费缴纳率', '6-Month Dues Collection Rate')"
        >
          <VChart class="h-190px" :option="feeOption" autoresize />
        </NCard>

        <NCard
          v-else-if="w.id === 'stageBars'"
          :bordered="false"
          class="h-full rounded-16px"
          :title="bi('发展阶段分布', 'Development Stage Distribution')"
        >
          <div class="flex flex-col gap-12px py-6px">
            <div v-for="row in stageBars" :key="row.stage" class="flex items-center gap-10px">
              <span class="w-84px truncate text-right text-12px text-gray-500">{{ tMemberType(row.stage) }}</span>
              <div class="h-16px flex-1 overflow-hidden rounded-6px" style="background: var(--sct-soft)">
                <div
                  class="h-full rounded-6px transition-all-500"
                  :style="{ width: row.width, background: 'var(--sct-ink)' }"
                />
              </div>
              <span class="w-24px text-13px font-bold" style="color: var(--sct-ink)">{{ row.count }}</span>
            </div>
          </div>
        </NCard>

        <NCard
          v-else-if="w.id === 'categoryBars'"
          :bordered="false"
          class="h-full rounded-16px"
          :title="bi('台历事项类别', 'Calendar Event Categories')"
        >
          <div class="flex flex-col gap-10px py-6px">
            <div v-for="row in categoryBars" :key="row.cat" class="flex items-center gap-10px">
              <span class="w-76px truncate text-right text-12px text-gray-500">{{ tCategory(row.cat) }}</span>
              <div class="h-14px flex-1 overflow-hidden rounded-6px" style="background: var(--sct-soft)">
                <div
                  class="h-full rounded-6px transition-all-500"
                  :style="{ width: row.width, background: row.color }"
                />
              </div>
              <span class="w-22px text-13px font-bold text-gray-600">{{ row.count }}</span>
            </div>
          </div>
        </NCard>

        <NCard
          v-else-if="w.id === 'weekOverview'"
          :bordered="false"
          class="h-full rounded-16px"
          :title="bi('本周类别速览', 'Weekly Category Overview')"
        >
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
  </div>
</template>
