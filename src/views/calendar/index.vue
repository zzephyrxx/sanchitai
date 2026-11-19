<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { Temporal } from 'temporal-polyfill';
import { ScheduleXCalendar } from '@schedule-x/vue';
import { createCalendar, createViewWeek, createViewMonthGrid, createViewMonthAgenda } from '@schedule-x/calendar';
import type { CalendarEvent, CalendarEventExternal } from '@schedule-x/calendar';
import { createDragAndDropPlugin } from '@schedule-x/drag-and-drop';
import { createCurrentTimePlugin } from '@schedule-x/current-time';
import { createEventsServicePlugin } from '@schedule-x/events-service';
import '@schedule-x/theme-default/dist/index.css';
import 'temporal-polyfill/global';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useThemeStore } from '@/store/modules/theme';
import { EVENT_CATEGORY_COLORS } from '@/constants/sanchitai';
import EmptyFancy from '@/components/custom/empty-fancy.vue';
import EventEditModal from './modules/event-edit-modal.vue';
import EventDetailDrawer from './modules/event-detail-drawer.vue';

defineOptions({ name: 'CalendarPage' });

const workStore = useWorkDataStore();
const themeStore = useThemeStore();

// ---------------- 类别 → Schedule-X 色板 ----------------
function sxColors(name: string, main: string, container: string) {
  return {
    colorName: name,
    lightColors: { main, container, onContainer: '#2b2926' },
    darkColors: { main, container, onContainer: '#e8eaf0' }
  };
}

const CATEGORY_CALENDARS: Record<string, ReturnType<typeof sxColors>> = {
  组织生活: sxColors('org', '#A81C24', '#fdf5f5'),
  党务常规: sxColors('routine', '#64748b', '#eef1f5'),
  发展党员: sxColors('dev', '#d97706', '#fcefdc'),
  品牌活动: sxColors('brand', '#0f766e', '#e0f0ef'),
  服务实践: sxColors('service', '#3f9d63', '#e3f2e9'),
  工作例会: sxColors('meeting', '#2080f0', '#e3eefb'),
  理论学习: sxColors('theory', '#7c5cd6', '#efeaf9')
};

// ---------------- 日历实例 ----------------
const eventsService = createEventsServicePlugin();
const dragAndDrop = createDragAndDropPlugin();
const currentTime = createCurrentTimePlugin();

const calendarApp = createCalendar({
  locale: 'zh-CN',
  views: [createViewWeek(), createViewMonthGrid(), createViewMonthAgenda()],
  calendars: CATEGORY_CALENDARS,
  plugins: [eventsService, dragAndDrop, currentTime],
  isDark: themeStore.darkMode,
  dayBoundaries: { start: '07:00', end: '23:00' },
  callbacks: {
    onEventClick(event: CalendarEventExternal) {
      const sct = (event as CalendarEventExternal & { _sct?: Sct.CalEvent })._sct;
      openDetail(String(event.id), sct ?? null);
    },
    onClickDateTime(dateTime: Temporal.ZonedDateTime) {
      // 周网格：点击具体时段
      const d = dateTime.toString().slice(0, 10);
      const t = dateTime.toString().slice(11, 16);
      const [h, m] = t.split(':').map(Number);
      openCreate(d, h || 14, m || 0);
    },
    onClickDate(date: Temporal.PlainDate) {
      // 月网格：点击日期
      openCreate(date.toString(), 14, 0);
    },
    onEventUpdate(event: CalendarEventExternal) {
      void persistDrag(event);
    }
  }
});

// ---------------- 事件投喂（DB → Schedule-X） ----------------
function baseIdOf(id: string) {
  return id.includes('-occ-') ? id.split('-occ-')[0] : id;
}

function displayTitle(ev: Sct.CalEvent): string {
  const time = ev.start_time && ev.start_time !== ev.end_time ? `${ev.start_time} ` : '';
  const mergedTag = ev.merged_into ? '〔并入〕' : '';
  return `${time}${mergedTag}${ev.title}`;
}

function toSxEvent(ev: Sct.CalEvent, baseId: string): CalendarEventExternal {
  const allDay = !ev.start_time || ev.start_time === ev.end_time;
  const start = allDay
    ? Temporal.PlainDate.from(ev.date)
    : Temporal.ZonedDateTime.from(`${ev.date}T${ev.start_time}:00[Asia/Shanghai]`);
  const endTime = ev.end_time || ev.start_time || '01:00';
  const end = allDay
    ? Temporal.PlainDate.from(ev.date)
    : Temporal.ZonedDateTime.from(`${ev.date}T${endTime}:00[Asia/Shanghai]`);

  return {
    id: ev.id,
    title: displayTitle(ev),
    start,
    end,
    calendarId: ev.category,
    _sct: { ...ev, id: baseId },
    _recurring: baseId !== ev.id
  } as CalendarEventExternal;
}

/** 全量投喂：种子 + 投影（数量级 ≤ 百，一次性 set 足够） */
function feedEvents() {
  const list = workStore.eventsInRange('2025-01-01', '2028-12-31').map(ev => {
    const baseId = baseIdOf(ev.id);
    return toSxEvent(ev, baseId);
  });
  eventsService.set(list);
}

watch(
  () => workStore.calEvents,
  () => feedEvents(),
  { immediate: true }
);

/** 拖拽/缩放后回写（重复实例拦截） */
async function persistDrag(calendarEvent: CalendarEventExternal) {
  const id = String(calendarEvent.id);
  const baseId = baseIdOf(id);
  if (id !== baseId) {
    feedEvents(); // 还原
    window.$message?.warning('重复事项暂不支持拖拽改期，请直接编辑该事项');
    return;
  }
  const startStr = String(calendarEvent.start);
  const endStr = String(calendarEvent.end);
  const startDate = startStr.slice(0, 10);
  const startTime = startStr.includes('T') ? startStr.split('T')[1].slice(0, 5) : '';
  const endTime = endStr.includes('T') ? endStr.split('T')[1].slice(0, 5) : startTime;

  const base = workStore.calEvents.find(ev => ev.id === baseId);
  const patch: Partial<Sct.CalEvent> = { date: startDate };
  if (base?.start_time && base.start_time !== base.end_time) {
    patch.start_time = startTime || '00:00';
    patch.end_time = endTime || '01:00';
  }
  await workStore.updateEvent(baseId, patch);
  window.$message?.success('已更新日程时间');
}

// ---------------- 深色联动 ----------------
watch(
  () => themeStore.darkMode,
  v => {
    // v4：运行时切换写内部配置信号（类型未公开，放宽断言）
    (calendarApp as unknown as { $app: { calendarConfig: { isDark: { value: boolean } } } }).$app.calendarConfig.isDark.value = v;
  },
  { immediate: false }
);

// ---------------- 新建 / 编辑 / 详情 ----------------
const editModalShow = ref(false);
const editModalEvent = ref<Sct.CalEvent | null>(null);
const editModalPreset = ref<{ date: string; start_time: string; end_time: string } | null>(null);

function openCreate(dateStr: string, hour: number, minute: number) {
  const snapped = Math.round(minute / 15) * 15;
  const start = `${String(hour).padStart(2, '0')}:${String(snapped).padStart(2, '0')}`;
  const endHour = Math.min(hour + 1, 23);
  editModalEvent.value = null;
  editModalPreset.value = {
    date: dateStr,
    start_time: start,
    end_time: `${String(endHour).padStart(2, '0')}:${String(snapped).padStart(2, '0')}`
  };
  editModalShow.value = true;
}

function openEditById(baseId: string) {
  const ev = workStore.calEvents.find(e => e.id === baseId);
  if (!ev) return;
  editModalEvent.value = ev;
  editModalPreset.value = null;
  editModalShow.value = true;
}

const detailShow = ref(false);
const detailEvent = ref<Sct.CalEvent | null>(null);

function openDetail(_id: string, ev: Sct.CalEvent | null) {
  if (!ev) return;
  detailEvent.value = ev;
  detailShow.value = true;
}

// ---------------- 今日/本周速览 ----------------
const today = dayjs().format('YYYY-MM-DD');
const todayEvents = computed(() => workStore.eventsInRange(today, today).filter(ev => ev.status !== '已取消' && !ev.merged_into));
const weekStart = dayjs().subtract((dayjs().day() + 6) % 7, 'day').format('YYYY-MM-DD');
const weekEnd = dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD');
const weekEvents = computed(() =>
  workStore.eventsInRange(weekStart, weekEnd).filter(ev => ev.status !== '已取消' && !ev.merged_into)
);

const weekCategoryCount = computed(() => {
  const map = new Map<string, number>();
  weekEvents.value.forEach(ev => {
    map.set(ev.category, (map.get(ev.category) ?? 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
});
</script>

<template>
  <div class="h-full min-h-500px flex gap-16px">
    <!-- 主台历 -->
    <NCard :bordered="false" class="h-full flex-1 overflow-hidden" :content-style="{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 16px' }">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">台历</span>
          <span class="text-12px text-gray-400">点空白时段快速新建 · 拖拽可改期</span>
        </div>
      </template>
      <template #header-extra>
        <NButton type="primary" size="small" @click="openCreate(today, 14, 0)">＋ 新建事项</NButton>
      </template>
      <div class="min-h-0 flex-1 sx-wrapper">
        <ScheduleXCalendar :calendar-app="calendarApp" />
      </div>
    </NCard>

    <!-- 侧栏：今日/本周 -->
    <div class="w-260px flex-col gap-16px overflow-y-auto">
      <NCard :bordered="false" size="small" title="今日">
        <EmptyFancy v-if="!todayEvents.length" emoji="tea" text="今天没有安排" sub="点一格就能新建" compact />
        <div v-else class="flex-col gap-8px">
          <div
            v-for="ev in todayEvents"
            :key="ev.id"
            class="cursor-pointer rounded-6px px-8px py-6px"
            :style="{ background: EVENT_CATEGORY_COLORS[ev.category]?.soft }"
            @click="openDetail(ev.id, ev)"
          >
            <div class="text-13px font-bold" :style="{ color: EVENT_CATEGORY_COLORS[ev.category]?.color }">{{ ev.title }}</div>
            <div class="text-11px text-gray-500">{{ ev.start_time && ev.start_time !== ev.end_time ? `${ev.start_time}-${ev.end_time}` : '全天' }}{{ ev.location ? ` · ${ev.location}` : '' }}</div>
          </div>
        </div>
      </NCard>

      <NCard :bordered="false" size="small" :title="`本周（${weekEvents.length} 项）`">
        <div v-if="!weekCategoryCount.length" class="text-12px text-gray-400">暂无</div>
        <div v-for="[cat, count] in weekCategoryCount" :key="cat" class="mb-6px flex items-center justify-between">
          <span class="flex items-center gap-6px text-12px">
            <span class="inline-block size-8px rounded-full" :style="{ background: EVENT_CATEGORY_COLORS[cat as Sct.EventCategory]?.color }" />
            {{ cat }}
          </span>
          <span class="text-12px text-gray-500">{{ count }}</span>
        </div>
      </NCard>

      <NCard :bordered="false" size="small" title="类别图例">
        <div class="flex-col gap-6px">
          <span v-for="(c, cat) in EVENT_CATEGORY_COLORS" :key="cat" class="flex items-center gap-8px text-12px">
            <span class="inline-block size-10px w-18px rounded-4px" :style="{ background: c.color }" />
            {{ cat }}
          </span>
        </div>
      </NCard>
    </div>

    <EventEditModal
      v-model:show="editModalShow"
      :event="editModalEvent"
      :preset="editModalPreset"
      @saved="detailShow = false"
    />
    <EventDetailDrawer
      v-model:show="detailShow"
      :event="detailEvent"
      @edit="openEditById(baseIdOf($event.id))"
    />
  </div>
</template>

<style scoped>
.sx-wrapper :deep(.sx__calendar-wrapper) {
  height: 100%;
  font-size: 13px;
  border-radius: 10px;
}
</style>
