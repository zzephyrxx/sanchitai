<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { useTransition } from '@vueuse/core';
import VChart from 'vue-echarts';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useThemeStore } from '@/store/modules/theme';
import { setupEcharts } from '@/plugins/echarts';
import { EVENT_CATEGORY_COLORS } from '@/constants/sanchitai';
import { DEV_STAGE_ORDER } from '@/constants/dev-nodes';
import EmptyFancy from '@/components/custom/empty-fancy.vue';

defineOptions({ name: 'DashboardPage' });

setupEcharts();

const workStore = useWorkDataStore();

const themeStore = useThemeStore();
/** 图表墨色随深浅切换（CSS var 无法进 echarts，取实时值） */
const inkColor = computed(() => (themeStore.darkMode ? '#d9d6d0' : '#2B2926'));
const heatBase = computed(() => (themeStore.darkMode ? '217, 214, 208' : '43, 41, 38'));
const RED = '#A81C24';

// ---------------- count-up 动数 ----------------
function useCountUp(source: () => number, duration = 800) {
  const target = ref(0);
  const shown = useTransition(target, { duration, transition: [0.22, 1, 0.36, 1] });
  watch(source, v => {
    target.value = v;
  }, { immediate: true });
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

// ---------------- 待办提醒中心（广度池 A1） ----------------
const todayStr = dayjs().format('YYYY-MM-DD');
const weekEndStr = dayjs().add(7, 'day').format('YYYY-MM-DD');
const yearStr = dayjs().format('YYYY');

const overdueItems = computed(() =>
  workStore.devStages
    .filter(d => d.next_due && d.next_due < todayStr && d.stage !== '正式党员')
    .map(d => ({
      text: `${workStore.memberName(d.member_id)}：${d.next_node ?? '下一步节点'}（应办 ${d.next_due}）`
    }))
);

const owedItems = computed(() => {
  const map = new Map<string, string[]>();
  workStore.feeRecords.filter(f => f.status === '欠缴').forEach(f => {
    map.set(f.member_id, [...(map.get(f.member_id) ?? []), f.year_month]);
  });
  return [...map.entries()].map(([id, months]) => ({
    text: `${workStore.memberName(id)}：${months.join('、')} 党费未缴`
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
    .map(d => ({ tag: '节点', text: `${workStore.memberName(d.member_id)}：${d.next_node ?? ''}（${d.next_due}）` }));
  const events = workStore
    .eventsInRange(todayStr, weekEndStr)
    .filter(ev => ev.status !== '已取消' && !ev.merged_into)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6)
    .map(ev => ({ tag: ev.date === todayStr ? '今日' : '近7天', text: `${ev.date.slice(5)} ${ev.title}` }));
  return [...nodes, ...events];
});

// ---------------- 当月缴纳率：CSS 进度环 ----------------
const monthRate = computed(() => {
  const ym = dayjs().format('YYYY-MM');
  const rows = workStore.feeRecords.filter(f => f.year_month === ym && f.status !== '未在校');
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
  if (count < 0) return 'transparent'; // 未来日期
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
    grid: { left: 34, right: 14, top: 18, bottom: 22 },
    textStyle: { color: '#71717a', fontSize: 11 },
    xAxis: { type: 'category', data: months, axisLine: { lineStyle: { color: 'var(--sct-border)' } }, axisTick: { show: false } },
    yAxis: { type: 'value', max: 100, splitLine: { lineStyle: { color: '#f0ede8' } }, axisLabel: { formatter: '{value}%' } },
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

// ---------------- 台历类别分布（横条） ----------------
const weekCategoryCount = computed(() => {
  const weekStart = dayjs().subtract((dayjs().day() + 6) % 7, 'day').format('YYYY-MM-DD');
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
    <!-- Bento：关键数字 -->
    <div class="mb-14px grid grid-cols-2 gap-14px lg:grid-cols-4">
      <NCard :bordered="false" class="rounded-16px" size="small">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-12px text-gray-400">在册人员</div>
            <div class="mt-6px text-30px font-black leading-none text-[var(--sct-ink)]">{{ memberNum }}</div>
            <div class="mt-6px text-11px text-gray-400">正式 {{ memberCount && workStore.members.filter(m => m.type === '正式党员').length }} · 预备 {{ workStore.members.filter(m => m.type === '预备党员').length }}</div>
          </div>
          <div class="text-30px opacity-90"><IconFluentEmojiCardIndexDividers /></div>
        </div>
      </NCard>
      <NCard :bordered="false" class="rounded-16px" size="small">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-12px text-gray-400">台历事项</div>
            <div class="mt-6px text-30px font-black leading-none text-[var(--sct-ink)]">{{ eventNum }}</div>
            <div class="mt-6px text-11px text-gray-400">本周 {{ workStore.eventsInRange(todayStr, weekEndStr).length }} 项</div>
          </div>
          <div class="text-30px opacity-90"><IconFluentEmojiCalendar /></div>
        </div>
      </NCard>
      <NCard :bordered="false" class="rounded-16px" size="small">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-12px text-gray-400">谈心谈话</div>
            <div class="mt-6px text-30px font-black leading-none text-[var(--sct-ink)]">{{ talkNum }}</div>
            <div class="mt-6px text-11px text-gray-400">今年已覆盖 {{ workStore.members.length - uncoveredTalks.count }}/{{ memberCount }}</div>
          </div>
          <div class="text-30px opacity-90"><IconFluentEmojiSpiralNotepad /></div>
        </div>
      </NCard>
      <NCard :bordered="false" class="rounded-16px" size="small">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-12px text-gray-400">欠缴人数</div>
            <div class="mt-6px text-30px font-black leading-none" :style="{ color: owedCount ? '#d43030' : '#2B2926' }">{{ owedNum }}</div>
            <div class="mt-6px text-11px text-gray-400">{{ owedCount ? '座位图已标红角标' : '缴费情况良好' }}</div>
          </div>
          <div class="text-30px opacity-90"><IconFluentEmojiAlarmClock /></div>
        </div>
      </NCard>
    </div>

    <!-- Bento：待办提醒中心 -->
    <NCard :bordered="false" class="mb-14px rounded-16px" title="待办提醒中心">
      <template #header-extra>
        <span class="text-12px text-gray-400">自动汇总自发展台账 / 党费 / 谈话 / 台历</span>
      </template>
      <div class="grid grid-cols-1 gap-12px lg:grid-cols-3">
        <div class="rounded-12px bg-[var(--sct-soft)] p-12px" style="border-left: 3px solid #d43030">
          <div class="mb-6px text-13px font-bold" style="color: #d43030">逾期（{{ overdueItems.length }}）</div>
          <div v-if="!overdueItems.length" class="text-12px text-gray-400">无逾期节点</div>
          <div v-for="(it, i) in overdueItems" :key="i" class="mb-4px text-12px leading-relaxed text-gray-600">{{ it.text }}</div>
        </div>
        <div class="rounded-12px bg-[var(--sct-soft)] p-12px" style="border-left: 3px solid #d97706">
          <div class="mb-6px text-13px font-bold" style="color: #d97706">欠缴与未覆盖（{{ owedItems.length + uncoveredTalks.count }}）</div>
          <div v-for="(it, i) in owedItems" :key="'f' + i" class="mb-4px text-12px leading-relaxed text-gray-600">{{ it.text }}</div>
          <div class="text-12px leading-relaxed text-gray-600">
            今年未谈心谈话 {{ uncoveredTalks.count }} 人{{ uncoveredTalks.count ? `：${uncoveredTalks.names.slice(0, 6).join('、')}${uncoveredTalks.count > 6 ? ' 等' : ''}` : '' }}
          </div>
        </div>
        <div class="rounded-12px bg-[var(--sct-soft)] p-12px" style="border-left: 3px solid #2080f0">
          <div class="mb-6px text-13px font-bold" style="color: #2080f0">今日与近 7 天（{{ weekItems.length }}）</div>
          <div v-if="!weekItems.length" class="text-12px text-gray-400">未来一周无节点与会议</div>
          <div v-for="(it, i) in weekItems" :key="'w' + i" class="mb-4px text-12px leading-relaxed text-gray-600">
            <span class="mr-4px inline-block rounded-2px px-3px py-1px text-10px font-bold" :style="{ background: '#2b292614', color: '#2b2926' }">{{ it.tag }}</span>
            {{ it.text }}
          </div>
        </div>
      </div>
    </NCard>

    <!-- Bento：可视化区 -->
    <div class="grid grid-cols-1 gap-14px lg:grid-cols-12">
      <!-- 缴纳率进度环 -->
      <NCard :bordered="false" class="rounded-16px lg:col-span-4" title="本月党费">
        <div class="flex items-center justify-around py-8px">
          <div
            class="relative size-130px rounded-full"
            :style="{ background: `conic-gradient(var(--sct-ink) ${monthRate.pct}%, #efece7 0)` }"
          >
            <div class="absolute inset-14px flex flex-col items-center justify-center rounded-full" style="background: var(--sct-container)">
              <div class="text-24px font-black" style="color: var(--sct-ink)">{{ monthRate.pct }}<span class="text-13px">%</span></div>
              <div class="text-11px text-gray-400">缴纳率</div>
            </div>
          </div>
          <div class="text-13px leading-7 text-gray-500">
            <div>应缴 <b class="text-[var(--sct-ink)]">{{ monthRate.due }}</b> 人</div>
            <div>已缴 <b class="text-[#3f9d63]">{{ monthRate.paid }}</b> 人</div>
            <div>欠缴 <b style="color: #d43030">{{ monthRate.due - monthRate.paid }}</b> 人</div>
            <div v-if="!monthRate.hasData" class="text-11px text-gray-300">本月名单未生成</div>
          </div>
        </div>
      </NCard>

      <!-- 12 周热力 -->
      <NCard :bordered="false" class="rounded-16px lg:col-span-8" title="近 12 周日程热力">
        <div class="flex gap-3px overflow-x-auto py-6px">
          <div v-for="(week, wi) in heat.weeks" :key="wi" class="flex flex-col gap-3px">
            <div
              v-for="cell in week"
              :key="cell.date"
              class="size-16px rounded-4px"
              :style="{ background: heatColor(cell.count) }"
              :title="`${cell.date}：${cell.count < 0 ? '未到来' : `${cell.count} 项安排`}`"
            />
          </div>
        </div>
        <div class="mt-8px flex items-center gap-6px text-11px text-gray-400">
          疏
          <span class="inline-block size-12px rounded-3px" style="background: #efece7" />
          <span v-for="a in [0.3, 0.5, 0.7]" :key="a" class="inline-block size-12px rounded-3px" :style="{ background: `rgba(43,41,38,${a})` }" />
          密
          <span class="ml-10px">每日格 = 当日未取消事项数</span>
        </div>
      </NCard>

      <!-- 缴费率趋势 -->
      <NCard :bordered="false" class="rounded-16px lg:col-span-6" title="近 6 个月党费缴纳率">
        <VChart class="h-220px" :option="feeOption" autoresize />
      </NCard>

      <!-- 发展阶段横条 -->
      <NCard :bordered="false" class="rounded-16px lg:col-span-6" title="发展阶段分布">
        <div class="flex-col gap-12px py-8px">
          <div v-for="row in stageBars" :key="row.stage" class="flex items-center gap-10px">
            <span class="w-70px text-right text-12px text-gray-500">{{ row.stage }}</span>
            <div class="h-16px flex-1 overflow-hidden rounded-6px bg-[var(--sct-soft)]">
              <div class="h-full rounded-6px transition-all-500" :style="{ width: row.width, background: 'var(--sct-ink)' }" />
            </div>
            <span class="w-24px text-13px font-bold" style="color: #2B2926">{{ row.count }}</span>
          </div>
        </div>
      </NCard>

      <!-- 类别分布横条 -->
      <NCard :bordered="false" class="rounded-16px lg:col-span-6" title="台历事项类别">
        <div class="flex-col gap-10px py-6px">
          <div v-for="row in categoryBars" :key="row.cat" class="flex items-center gap-10px">
            <span class="w-64px text-right text-12px text-gray-500">{{ row.cat }}</span>
            <div class="h-14px flex-1 overflow-hidden rounded-6px bg-[var(--sct-soft)]">
              <div class="h-full rounded-6px transition-all-500" :style="{ width: row.width, background: row.color }" />
            </div>
            <span class="w-22px text-13px font-bold text-gray-600">{{ row.count }}</span>
          </div>
        </div>
      </NCard>

      <!-- 本周速览 -->
      <NCard :bordered="false" class="rounded-16px lg:col-span-6" title="本周类别速览">
        <EmptyFancy v-if="!weekCategoryCount.length" emoji="tea" text="本周还没有安排" sub="去台历点一格就能新建" />
        <div v-else class="flex-col gap-10px py-6px">
          <div v-for="[cat, count] in weekCategoryCount" :key="cat" class="flex items-center justify-between">
            <span class="flex items-center gap-8px text-13px">
              <span class="inline-block size-10px rounded-3px" :style="{ background: EVENT_CATEGORY_COLORS[cat as Sct.EventCategory]?.color }" />
              {{ cat }}
            </span>
            <span class="text-13px font-bold text-gray-600">{{ count }} 项</span>
          </div>
        </div>
      </NCard>
    </div>
  </div>
</template>

<style scoped></style>
