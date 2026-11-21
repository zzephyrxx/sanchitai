<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import FullCalendar from '@fullcalendar/vue3';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type {
  CalendarOptions,
  DayHeaderContentArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventHoveringArg
} from '@fullcalendar/core';
import type { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import zhCnLocale from '@fullcalendar/core/locales/zh-cn';
import { $t } from '@/locales';
import { useAppStore } from '@/store/modules/app';
import { useWorkDataStore } from '@/store/modules/work-data';
import { EVENT_CATEGORY_COLORS } from '@/constants/sanchitai';
import EmptyFancy from '@/components/custom/empty-fancy.vue';
import EventEditModal from './modules/event-edit-modal.vue';
import EventDetailDrawer from './modules/event-detail-drawer.vue';

defineOptions({ name: 'CalendarPage' });

const appStore = useAppStore();
const workStore = useWorkDataStore();

const SHORT_WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const SHORT_WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const FULL_WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const isEn = computed(() => appStore.locale === 'en-US');

const CATEGORY_EN_MAP: Record<string, string> = {
  组织生活: 'Org Life',
  党务常规: 'Routine',
  发展党员: 'Development',
  品牌活动: 'Brand Event',
  服务实践: 'Service',
  工作例会: 'Meeting',
  理论学习: 'Study'
};

const STATUS_EN_MAP: Record<string, string> = {
  计划: 'Planned',
  进行中: 'In Progress',
  已完成: 'Completed',
  已取消: 'Cancelled'
};

function tCategory(cat: string): string {
  return isEn.value ? (CATEGORY_EN_MAP[cat] ?? cat) : cat;
}

function tStatus(status: string): string {
  return isEn.value ? (STATUS_EN_MAP[status] ?? status) : status;
}

// ---------------- 视图控制与顶栏状态 ----------------
type CalViewType = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth';
const currentView = ref<CalViewType>('timeGridWeek');
const lastRangeStart = ref(dayjs());
const lastRangeEnd = ref(dayjs());
const activeCategories = ref<Set<string>>(new Set(Object.keys(EVENT_CATEGORY_COLORS)));

const currentTitle = computed(() => {
  const start = lastRangeStart.value;
  const end = lastRangeEnd.value;
  const mid = start.add(Math.floor(end.diff(start, 'day') / 2), 'day');
  return isEn.value ? mid.format('MMM YYYY') : mid.format('YYYY年 M月');
});

const currentRangeText = computed(() => {
  const start = lastRangeStart.value;
  const end = lastRangeEnd.value;
  if (currentView.value === 'timeGridDay') {
    const wk = isEn.value ? FULL_WEEKDAYS_EN[start.day()] : FULL_WEEKDAYS_ZH[start.day()];
    return isEn.value ? `${start.format('MMM D')} · ${wk}` : `${start.format('M月D日')} ${wk}`;
  }
  return isEn.value
    ? `${start.format('MMM D')} – ${end.format('MMM D')}`
    : `${start.format('M月D日')} – ${end.format('M月D日')}`;
});

function toggleCategoryFilter(cat: string) {
  const next = new Set(activeCategories.value);
  if (next.has(cat)) {
    if (next.size === 1) {
      Object.keys(EVENT_CATEGORY_COLORS).forEach(k => next.add(k));
    } else {
      next.delete(cat);
    }
  } else {
    next.add(cat);
  }
  activeCategories.value = next;
  calendarRef.value?.getApi()?.refetchEvents();
}

function resetCategoryFilter() {
  activeCategories.value = new Set(Object.keys(EVENT_CATEGORY_COLORS));
  calendarRef.value?.getApi()?.refetchEvents();
}

const calendarRef = ref<InstanceType<typeof FullCalendar>>();

// 深度监听 calEvents 与 members 变化（包含拖拽改期、改时长、重复规则 overrides 更新）
watch(
  () => [workStore.calEvents, workStore.members],
  () => {
    calendarRef.value?.getApi()?.refetchEvents();
  },
  { deep: true }
);

watch(isEn, en => {
  const api = calendarRef.value?.getApi();
  if (!api) return;
  api.setOption('locale', en ? 'en' : zhCnLocale);
  api.setOption('allDayText', en ? 'All-day' : '全天');
});

function switchView(view: CalViewType) {
  currentView.value = view;
  calendarRef.value?.getApi()?.changeView(view);
}

function navPrev() {
  calendarRef.value?.getApi()?.prev();
}

function navNext() {
  calendarRef.value?.getApi()?.next();
}

function navToday() {
  calendarRef.value?.getApi()?.today();
}

// ---------------- 鼠标悬浮日程小弹窗（Hover Popover） ----------------
const hoverCard = reactive<{
  visible: boolean;
  event: Sct.CalEvent | null;
  x: number;
  y: number;
  placement: 'right' | 'left';
}>({
  visible: false,
  event: null,
  x: 0,
  y: 0,
  placement: 'right'
});

let hoverHideTimer: ReturnType<typeof setTimeout> | null = null;

function clearHoverTimer() {
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer);
    hoverHideTimer = null;
  }
}

function showHoverPopover(ev: Sct.CalEvent, targetEl: HTMLElement) {
  clearHoverTimer();
  const rect = targetEl.getBoundingClientRect();
  const popWidth = 310;
  const popHeight = 250;
  const gap = 10;

  let x = rect.right + gap;
  let placement: 'right' | 'left' = 'right';
  if (x + popWidth > window.innerWidth - 16) {
    x = Math.max(16, rect.left - popWidth - gap);
    placement = 'left';
  }

  let y = rect.top;
  if (y + popHeight > window.innerHeight - 16) {
    y = Math.max(16, window.innerHeight - popHeight - 16);
  }

  hoverCard.event = ev;
  hoverCard.x = Math.round(x);
  hoverCard.y = Math.round(y);
  hoverCard.placement = placement;
  hoverCard.visible = true;
}

function scheduleHideHoverPopover() {
  clearHoverTimer();
  hoverHideTimer = setTimeout(() => {
    hoverCard.visible = false;
  }, 160);
}

function onPopoverMouseEnter() {
  clearHoverTimer();
}

function onPopoverMouseLeave() {
  scheduleHideHoverPopover();
}

onBeforeUnmount(() => {
  clearHoverTimer();
});

// ---------------- FullCalendar 配置 ----------------
const calendarOptions = ref<CalendarOptions>({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
  initialView: 'timeGridWeek',
  locale: zhCnLocale,
  firstDay: 1,
  headerToolbar: false,
  slotMinTime: '07:00:00',
  slotMaxTime: '23:00:00',
  slotDuration: '00:30:00',
  slotLabelInterval: '01:00',
  slotLabelFormat: {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  },
  allDaySlot: true,
  allDayText: '全天',
  nowIndicator: true,
  editable: true,
  eventStartEditable: true,
  eventDurationEditable: true,
  selectable: true,
  height: '100%',
  expandRows: true,
  dayMaxEvents: 3,
  datesSet(arg: DatesSetArg) {
    currentView.value = arg.view.type as CalViewType;
    lastRangeStart.value = dayjs(arg.start);
    lastRangeEnd.value = dayjs(arg.end).subtract(1, 'day');
  },
  dayHeaderContent(arg: DayHeaderContentArg) {
    const d = dayjs(arg.date);
    const wk = isEn.value ? SHORT_WEEKDAYS_EN[d.day()] : SHORT_WEEKDAYS_ZH[d.day()];
    if (arg.view.type === 'dayGridMonth') {
      return {
        html: `<div class="nuxt-cal-month-head">${wk}</div>`
      };
    }
    const isToday = d.format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD');
    return {
      html: `
        <div class="nuxt-cal-col-head ${isToday ? 'is-today' : ''}">
          <span class="nuxt-cal-col-head__wk">${wk}</span>
          <span class="nuxt-cal-col-head__num">${d.date()}</span>
        </div>
      `
    };
  },
  events(fetchInfo, success) {
    workStore.fullCalendarEvents(fetchInfo, rawEvents => {
      const filtered = rawEvents.filter(item => {
        const ev = item.extendedProps?.event as Sct.CalEvent | undefined;
        return !ev || activeCategories.value.has(ev.category);
      });
      success(filtered);
    });
  },
  eventContent(arg: EventContentArg) {
    const ev = arg.event.extendedProps?.event as Sct.CalEvent | undefined;
    const cat = ev?.category ?? '组织生活';
    const palette = EVENT_CATEGORY_COLORS[cat as Sct.EventCategory] ?? {
      color: '#A81C24',
      soft: 'rgba(168, 28, 36, 0.12)'
    };
    const isDone = ev?.status === '已完成';
    const isCancelled = ev?.status === '已取消';
    const timeRange =
      ev?.start_time && ev.start_time !== ev.end_time ? `${ev.start_time} - ${ev.end_time}` : '';
    const title = ev?.title ?? arg.event.title;
    const loc = ev?.location ? ` · ${ev.location}` : '';

    return {
      html: `
        <div class="nuxt-cal-ev ${isDone ? 'is-done' : ''} ${isCancelled ? 'is-cancelled' : ''}" style="--ev-color: ${palette.color}; --ev-soft: ${palette.soft};">
          <span class="nuxt-cal-ev__pill"></span>
          <div class="nuxt-cal-ev__body">
            <div class="nuxt-cal-ev__title">${escapeHtml(title)}</div>
            ${
              timeRange || loc
                ? `<div class="nuxt-cal-ev__meta">${escapeHtml(timeRange)}${escapeHtml(loc)}</div>`
                : ''
            }
          </div>
        </div>
      `
    };
  },
  dateClick(info: DateClickArg) {
    openCreate(info.dateStr.slice(0, 10), info.date.getHours() || 14, info.date.getMinutes());
  },
  eventClick(info: EventClickArg) {
    hoverCard.visible = false;
    openDetail(info.event.id, info.event.extendedProps?.event ?? null);
  },
  eventMouseEnter(info: EventHoveringArg) {
    const ev = info.event.extendedProps?.event as Sct.CalEvent | undefined;
    if (!ev) return;
    showHoverPopover(ev, info.el);
  },
  eventMouseLeave() {
    scheduleHideHoverPopover();
  },
  eventDrop(info: EventDropArg) {
    hoverCard.visible = false;
    void handleMove(info);
  },
  eventResize(info: EventResizeDoneArg) {
    hoverCard.visible = false;
    void handleMove(info);
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function handleMove(info: EventDropArg | EventResizeDoneArg) {
  const ev = info.event;
  if (!ev.start) return;
  const start = dayjs(ev.start);
  const patch: Partial<Sct.CalEvent> = {
    date: start.format('YYYY-MM-DD')
  };

  if (ev.allDay) {
    patch.start_time = '';
    patch.end_time = '';
  } else {
    const end = ev.end ? dayjs(ev.end) : start.add(1, 'hour');
    patch.start_time = start.format('HH:mm');
    patch.end_time = end.format('HH:mm');
  }

  try {
    await workStore.updateEvent(ev.id, patch);
    calendarRef.value?.getApi()?.refetchEvents();
    window.$message?.success(
      `已更新日程时间：${patch.date} ${patch.start_time ? `${patch.start_time}-${patch.end_time}` : '全天'}`
    );
  } catch {
    info.revert();
    window.$message?.error('更新日程时间失败，已还原');
  }
}

// ---------------- 新建 / 编辑 / 详情 ----------------
const editModalShow = ref(false);
const editModalEvent = ref<Sct.CalEvent | null>(null);
const editModalPreset = ref<{ date: string; start_time: string; end_time: string } | null>(null);

function openCreate(dateStr: string, hour: number, minute: number) {
  const snapped = Math.round(minute / 15) * 15;
  const safeMin = snapped >= 60 ? 45 : snapped;
  const start = `${String(hour).padStart(2, '0')}:${String(safeMin).padStart(2, '0')}`;
  const endHour = Math.min(hour + 1, 23);
  editModalEvent.value = null;
  editModalPreset.value = {
    date: dateStr,
    start_time: start,
    end_time: `${String(endHour).padStart(2, '0')}:${String(safeMin).padStart(2, '0')}`
  };
  editModalShow.value = true;
}

function openEditEvent(ev: Sct.CalEvent) {
  hoverCard.visible = false;
  editModalEvent.value = ev;
  editModalPreset.value = null;
  editModalShow.value = true;
}

const detailShow = ref(false);
const detailEvent = ref<Sct.CalEvent | null>(null);

function openDetail(_id: string, ev: Sct.CalEvent | null) {
  if (!ev) return;
  hoverCard.visible = false;
  detailEvent.value = ev;
  detailShow.value = true;
}

async function quickMarkDone(ev: Sct.CalEvent) {
  await workStore.setEventStatus(ev.id, '已完成');
  hoverCard.visible = false;
  window.$message?.success(`「${ev.title}」已标记为已完成`);
}

// ---------------- 今日/本周速览 ----------------
const today = dayjs().format('YYYY-MM-DD');
const todayEvents = computed(() =>
  workStore.eventsInRange(today, today).filter(ev => ev.status !== '已取消' && !ev.merged_into)
);
const weekStart = dayjs()
  .subtract((dayjs().day() + 6) % 7, 'day')
  .format('YYYY-MM-DD');
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

function formatHoverDate(dateStr: string): string {
  const d = dayjs(dateStr);
  if (isEn.value) {
    return `${d.format('MMM D, YYYY')} (${SHORT_WEEKDAYS_EN[d.day()]})`;
  }
  return `${d.format('YYYY年M月D日')}（${SHORT_WEEKDAYS_ZH[d.day()]}）`;
}

function eventStatusTagType(status: Sct.EventStatus): 'success' | 'info' | 'warning' {
  if (status === '已完成') return 'success';
  if (status === '进行中') return 'info';
  return 'warning';
}
</script>

<template>
  <div class="h-full min-h-560px flex gap-14px">
    <!-- 主台历容器（Nuxt UI Calendar Template 风格） -->
    <div
      class="h-full min-w-0 flex flex-1 flex-col overflow-hidden rounded-16px border border-[var(--sct-border)] bg-[var(--sct-container)]"
    >
      <!-- Nuxt Calendar 风格定制顶栏（三列 Grid 布局，确保中间「日/周/月」固定正中、绝不随左侧日期文字宽度偏移） -->
      <div class="cal-topbar border-b border-[var(--sct-border)] px-18px py-12px">
        <!-- 左：年月大标题 + 日期区间 + 今日/本周计数胶囊 -->
        <div class="min-w-0 flex flex-wrap items-center gap-12px justify-self-start">
          <div class="flex items-baseline gap-10px whitespace-nowrap">
            <h2 class="m-0 text-18px font-extrabold tracking-tight" style="color: var(--sct-ink)">
              {{ currentTitle }}
            </h2>
            <span class="text-12px font-medium" style="color: var(--sct-muted)">
              {{ currentRangeText }}
            </span>
          </div>

          <div class="hidden items-center gap-6px whitespace-nowrap sm:flex">
            <span
              class="inline-flex items-center gap-4px rounded-full px-9px py-2px text-11px font-medium"
              style="background: var(--sct-soft); border: 1px solid var(--sct-border); color: var(--sct-muted)"
            >
              <span class="inline-block size-6px rounded-full bg-[#A81C24]" />
              {{ $t('sct.calendar.today') }} <b style="color: var(--sct-ink)">{{ todayEvents.length }}</b>
            </span>
            <span
              class="inline-flex items-center gap-4px rounded-full px-9px py-2px text-11px font-medium"
              style="background: var(--sct-soft); border: 1px solid var(--sct-border); color: var(--sct-muted)"
            >
              {{ $t('sct.calendar.thisWeek') }} <b style="color: var(--sct-ink)">{{ weekEvents.length }}</b>
            </span>
          </div>
        </div>

        <!-- 中：日 / 周 / 月 Segmented 视图切换器（Grid 中列固定水平居中，不受左侧日期宽度影响） -->
        <div class="cal-seg-track justify-self-center">
          <button
            v-for="v in [
              { key: 'timeGridDay', label: $t('sct.calendar.viewDay') },
              { key: 'timeGridWeek', label: $t('sct.calendar.viewWeek') },
              { key: 'dayGridMonth', label: $t('sct.calendar.viewMonth') }
            ]"
            :key="v.key"
            type="button"
            class="cal-seg-btn"
            :class="{ 'is-active': currentView === v.key }"
            @click="switchView(v.key as CalViewType)"
          >
            {{ v.label }}
          </button>
        </div>

        <!-- 右：前后翻页 / 今天 + 新建事项 -->
        <div class="flex items-center gap-8px justify-self-end">
          <div class="cal-nav-group">
            <button
              type="button"
              class="cal-nav-btn cal-nav-btn--icon"
              :title="$t('sct.calendar.prevPeriod')"
              @click="navPrev"
            >
              <SvgIcon icon="lucide:chevron-left" class="text-15px" />
            </button>
            <button
              type="button"
              class="cal-nav-btn cal-nav-btn--today"
              @click="navToday"
            >
              {{ $t('sct.calendar.today') }}
            </button>
            <button
              type="button"
              class="cal-nav-btn cal-nav-btn--icon"
              :title="$t('sct.calendar.nextPeriod')"
              @click="navNext"
            >
              <SvgIcon icon="lucide:chevron-right" class="text-15px" />
            </button>
          </div>

          <NButton type="primary" size="small" @click="openCreate(today, 14, 0)">
            <template #icon><SvgIcon icon="lucide:plus" /></template>
            {{ $t('sct.calendar.newEvent') }}
          </NButton>
        </div>
      </div>

      <!-- 次级日程类型快速筛选条 -->
      <div
        class="flex flex-wrap items-center justify-between gap-8px border-b border-[var(--sct-border)] px-18px py-8px"
        style="background: var(--sct-soft)"
      >
        <div class="flex flex-wrap items-center gap-6px">
          <span class="mr-2px text-11px font-semibold" style="color: var(--sct-muted)">
            {{ $t('sct.calendar.scheduleType') }}：
          </span>
          <button
            v-for="(c, cat) in EVENT_CATEGORY_COLORS"
            :key="cat"
            type="button"
            class="cal-type-pill"
            :style="{
              borderColor: activeCategories.has(cat) ? `${c.color}55` : 'var(--sct-border)',
              backgroundColor: activeCategories.has(cat) ? c.soft : 'var(--sct-container)',
              color: activeCategories.has(cat) ? c.color : 'var(--sct-muted)',
              opacity: activeCategories.has(cat) ? 1 : 0.65
            }"
            @click="toggleCategoryFilter(cat)"
          >
            <span class="inline-block size-6px rounded-full" :style="{ background: c.color }" />
            <span>{{ tCategory(cat) }}</span>
          </button>
          <NButton
            v-if="activeCategories.size < Object.keys(EVENT_CATEGORY_COLORS).length"
            size="tiny"
            secondary
            type="primary"
            class="ml-4px"
            @click="resetCategoryFilter"
          >
            <template #icon><SvgIcon icon="lucide:rotate-ccw" class="text-11px" /></template>
            {{ $t('sct.calendar.showAll') }}
          </NButton>
        </div>
        <span class="hidden text-11px text-gray-400 xl:inline">
          {{ $t('sct.calendar.filterTip') }}
        </span>
      </div>

      <!-- 日历主网格 -->
      <div class="nuxt-cal-body min-h-0 flex-1">
        <FullCalendar ref="calendarRef" :options="calendarOptions" />
      </div>
    </div>

    <!-- 右侧栏：常驻显示，采用内置胶囊色带卡片 -->
    <div class="w-288px flex flex-shrink-0 flex-col gap-12px overflow-y-auto">
      <!-- 1. 今日日程 -->
      <NCard :bordered="false" size="small" class="rounded-16px">
        <template #header>
          <div class="flex items-center gap-6px text-14px font-bold">
            <SvgIcon icon="lucide:calendar-check-2" class="text-15px text-[#A81C24]" />
            <span>{{ $t('sct.calendar.todaySchedule') }}</span>
          </div>
        </template>
        <template #header-extra>
          <NTag size="tiny" :bordered="false" round>{{ todayEvents.length }} {{ $t('sct.common.items') }}</NTag>
        </template>
        <EmptyFancy
          v-if="!todayEvents.length"
          emoji="tea"
          :text="$t('sct.calendar.todayEmpty')"
          :sub="$t('sct.calendar.todayEmptySub')"
          compact
        />
        <div v-else class="flex flex-col gap-8px">
          <div
            v-for="ev in todayEvents"
            :key="ev.id"
            class="cal-side-card group flex cursor-pointer items-stretch gap-10px rounded-10px border border-[var(--sct-border)] bg-[var(--sct-container)] p-10px transition"
            @click="openDetail(ev.id, ev)"
            @mouseenter="showHoverPopover(ev, $event.currentTarget as HTMLElement)"
            @mouseleave="scheduleHideHoverPopover"
          >
            <!-- 内置垂直胶囊色带 -->
            <span
              class="my-1px w-3.5px flex-shrink-0 rounded-full"
              :style="{ background: EVENT_CATEGORY_COLORS[ev.category]?.color ?? '#A81C24' }"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-6px">
                <div class="truncate text-13px font-bold text-[var(--sct-ink)] group-hover:text-[#A81C24]">
                  {{ ev.title }}
                </div>
                <span
                  v-if="ev.kind"
                  class="flex-shrink-0 rounded-full px-7px py-1px text-10px font-semibold"
                  :style="{
                    background: EVENT_CATEGORY_COLORS[ev.category]?.soft,
                    color: EVENT_CATEGORY_COLORS[ev.category]?.color
                  }"
                >
                  {{ ev.kind }}
                </span>
              </div>
              <div class="mt-5px flex items-center gap-10px text-11px text-[var(--sct-muted)]">
                <span class="inline-flex items-center gap-3px font-mono">
                  <SvgIcon icon="lucide:clock" class="text-11px" />
                  {{
                    ev.start_time && ev.start_time !== ev.end_time
                      ? `${ev.start_time}-${ev.end_time}`
                      : $t('sct.common.allDay')
                  }}
                </span>
                <span v-if="ev.location" class="inline-flex items-center gap-3px truncate">
                  <SvgIcon icon="lucide:map-pin" class="text-11px" />
                  {{ ev.location }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </NCard>

      <!-- 2. 本周概览 -->
      <NCard :bordered="false" size="small" class="rounded-16px">
        <template #header>
          <div class="flex items-center gap-6px text-14px font-bold">
            <SvgIcon icon="lucide:bar-chart-3" class="text-15px text-[var(--sct-ink)]" />
            <span>{{ $t('sct.calendar.weekOverview') }}</span>
          </div>
        </template>
        <template #header-extra>
          <span class="text-12px text-gray-400">{{ $t('sct.common.totalItems', { count: weekEvents.length }) }}</span>
        </template>
        <div v-if="!weekCategoryCount.length" class="py-8px text-center text-12px text-gray-400">
          {{ $t('sct.calendar.weekEmpty') }}
        </div>
        <div v-else class="flex flex-col gap-10px">
          <div v-for="[cat, count] in weekCategoryCount" :key="cat" class="flex flex-col gap-4px">
            <div class="flex items-center justify-between text-12px">
              <span class="flex items-center gap-6px font-medium">
                <span
                  class="inline-block size-8px rounded-full"
                  :style="{ background: EVENT_CATEGORY_COLORS[cat as Sct.EventCategory]?.color }"
                />
                {{ tCategory(cat) }}
              </span>
              <span class="font-bold text-[var(--sct-ink)]">{{ count }} {{ $t('sct.common.items') }}</span>
            </div>
            <div class="h-5px w-full overflow-hidden rounded-full bg-[var(--sct-soft)]">
              <div
                class="h-full rounded-full transition-all duration-300"
                :style="{
                  width: `${Math.round((count / Math.max(1, weekEvents.length)) * 100)}%`,
                  background: EVENT_CATEGORY_COLORS[cat as Sct.EventCategory]?.color
                }"
              />
            </div>
          </div>
        </div>
      </NCard>

      <!-- 3. 类别图例 -->
      <NCard :bordered="false" size="small" class="rounded-16px">
        <template #header>
          <div class="flex items-center gap-6px text-14px font-bold">
            <SvgIcon icon="lucide:tags" class="text-15px text-gray-500" />
            <span>{{ $t('sct.calendar.categoryLegend') }}</span>
          </div>
        </template>
        <div class="grid grid-cols-2 gap-8px">
          <div
            v-for="(c, cat) in EVENT_CATEGORY_COLORS"
            :key="cat"
            class="flex items-center gap-6px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)]/50 px-8px py-6px text-12px font-medium text-[var(--sct-ink)]"
          >
            <span class="inline-block h-12px w-3.5px flex-shrink-0 rounded-full" :style="{ background: c.color }" />
            <span class="truncate">{{ tCategory(cat) }}</span>
          </div>
        </div>
      </NCard>
    </div>

    <!-- 鼠标悬浮日程详情小弹窗（复刻 Nuxt Calendar Floating Event Popover） -->
    <Teleport to="body">
      <Transition name="cal-pop">
        <div
          v-if="hoverCard.visible && hoverCard.event"
          class="nuxt-cal-popover"
          :style="{ left: `${hoverCard.x}px`, top: `${hoverCard.y}px` }"
          @mouseenter="onPopoverMouseEnter"
          @mouseleave="onPopoverMouseLeave"
        >
          <div class="flex items-stretch gap-10px">
            <!-- 左侧内置胶囊色带 -->
            <span
              class="w-4px flex-shrink-0 rounded-full"
              :style="{ background: EVENT_CATEGORY_COLORS[hoverCard.event.category]?.color ?? '#A81C24' }"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-6px">
                <div class="flex items-center gap-5px">
                  <span
                    class="rounded-full px-7px py-1px text-10px font-bold"
                    :style="{
                      background: EVENT_CATEGORY_COLORS[hoverCard.event.category]?.soft,
                      color: EVENT_CATEGORY_COLORS[hoverCard.event.category]?.color
                    }"
                  >
                    {{ tCategory(hoverCard.event.category) }}
                  </span>
                  <span
                    v-if="hoverCard.event.kind"
                    class="rounded-full bg-[var(--sct-soft)] px-7px py-1px text-10px font-semibold text-[var(--sct-muted)]"
                  >
                    {{ hoverCard.event.kind }}
                  </span>
                </div>
                <NTag
                  size="tiny"
                  :bordered="false"
                  :type="eventStatusTagType(hoverCard.event.status)"
                >
                  {{ tStatus(hoverCard.event.status) }}
                </NTag>
              </div>

              <div class="mt-6px text-14px font-extrabold leading-snug text-[var(--sct-ink)]">
                {{ hoverCard.event.title }}
              </div>

              <div class="mt-8px flex flex-col gap-5px text-12px text-[var(--sct-muted)]">
                <div class="flex items-center gap-6px">
                  <SvgIcon icon="lucide:calendar-clock" class="flex-shrink-0 text-13px text-[#A81C24]" />
                  <span>
                    {{ formatHoverDate(hoverCard.event.date) }}
                    {{
                      hoverCard.event.start_time && hoverCard.event.start_time !== hoverCard.event.end_time
                        ? `${hoverCard.event.start_time} - ${hoverCard.event.end_time}`
                        : $t('sct.common.allDay')
                    }}
                  </span>
                </div>
                <div v-if="hoverCard.event.location" class="flex items-center gap-6px">
                  <SvgIcon icon="lucide:map-pin" class="flex-shrink-0 text-13px" />
                  <span class="truncate">{{ hoverCard.event.location }}</span>
                </div>
                <div v-if="hoverCard.event.owner" class="flex items-center gap-6px">
                  <SvgIcon icon="lucide:user" class="flex-shrink-0 text-13px" />
                  <span>{{ $t('sct.common.owner') }}：{{ workStore.memberName(hoverCard.event.owner) }}</span>
                </div>
              </div>

              <div
                v-if="hoverCard.event.agenda?.length"
                class="mt-8px rounded-8px bg-[var(--sct-soft)] px-9px py-6px text-11px text-[var(--sct-muted)]"
              >
                <div
                  v-for="(ag, idx) in hoverCard.event.agenda.slice(0, 2)"
                  :key="idx"
                  class="truncate leading-relaxed"
                >
                  {{ idx + 1 }}. {{ ag }}
                </div>
              </div>

              <!-- 悬浮窗快捷操作栏 -->
              <div class="mt-10px flex items-center justify-end gap-6px border-t border-[var(--sct-border)] pt-8px">
                <NButton size="tiny" quaternary @click="openDetail(hoverCard.event.id, hoverCard.event)">
                  <template #icon><SvgIcon icon="lucide:eye" /></template>
                  {{ $t('sct.common.detail') }}
                </NButton>
                <NButton size="tiny" secondary @click="openEditEvent(hoverCard.event)">
                  <template #icon><SvgIcon icon="lucide:pencil" /></template>
                  {{ $t('common.edit') }}
                </NButton>
                <NButton
                  v-if="hoverCard.event.status !== '已完成'"
                  size="tiny"
                  type="primary"
                  secondary
                  @click="quickMarkDone(hoverCard.event)"
                >
                  <template #icon><SvgIcon icon="lucide:check" /></template>
                  {{ $t('sct.common.done') }}
                </NButton>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <EventEditModal
      v-model:show="editModalShow"
      :event="editModalEvent"
      :preset="editModalPreset"
      @saved="detailShow = false"
    />
    <EventDetailDrawer
      v-model:show="detailShow"
      :event="detailEvent"
      @edit="openEditEvent($event)"
    />
  </div>
</template>

<style scoped>
.cal-topbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
}

@media (max-width: 768px) {
  .cal-topbar {
    grid-template-columns: 1fr;
    justify-items: stretch;
  }
}

/* 顶栏「日 / 周 / 月」分段控制器：显式背景与高对比度文字，彻底杜绝原生 button 黑底 */
.cal-seg-track {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background-color: var(--sct-soft);
  border: 1px solid var(--sct-border);
}

.cal-seg-btn {
  appearance: none;
  -webkit-appearance: none;
  padding: 4px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  background-color: transparent !important;
  color: var(--sct-muted) !important;
  border: none;
  transition: all 0.15s ease;
}

.cal-seg-btn:hover {
  color: var(--sct-ink) !important;
  background-color: rgba(128, 128, 128, 0.08) !important;
}

.cal-seg-btn.is-active {
  background-color: var(--sct-container) !important;
  color: var(--sct-ink) !important;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

/* 顶栏右侧「< | 今天 | >」导航按钮组 */
.cal-nav-group {
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid var(--sct-border);
  background-color: var(--sct-container);
}

.cal-nav-btn {
  appearance: none;
  -webkit-appearance: none;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--sct-container) !important;
  color: var(--sct-ink) !important;
  font-size: 12px;
  font-weight: 600;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.cal-nav-btn--icon {
  width: 28px;
}

.cal-nav-btn--today {
  padding: 0 12px;
  border-left: 1px solid var(--sct-border);
  border-right: 1px solid var(--sct-border);
}

.cal-nav-btn:hover {
  background-color: var(--sct-soft) !important;
  color: #a81c24 !important;
}

/* 日程类型筛选胶囊 */
.cal-type-pill {
  appearance: none;
  -webkit-appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px;
  border-radius: 999px;
  border-width: 1px;
  border-style: solid;
  font-size: 11px;
  font-weight: 600;
  transition: all 0.15s ease;
}

.cal-side-card:hover {
  border-color: rgba(168, 28, 36, 0.35);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
}

/* 悬浮小弹窗（Nuxt UI Popover 风格） */
.nuxt-cal-popover {
  position: fixed;
  z-index: 2100;
  width: 308px;
  padding: 12px 14px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 14px;
  box-shadow:
    0 12px 32px -4px rgba(15, 23, 42, 0.14),
    0 4px 12px -2px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(10px);
}

.cal-pop-enter-active,
.cal-pop-leave-active {
  transition: opacity 130ms ease, transform 130ms ease;
}
.cal-pop-enter-from,
.cal-pop-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
}

/* FullCalendar 深度定制为 Nuxt UI / Apple Calendar 极简网格风格 */
:deep(.fc) {
  @apply h-full text-12px;
  --fc-today-bg-color: rgba(168, 28, 36, 0.025);
  --fc-border-color: var(--sct-border);
  --fc-page-bg-color: transparent;
  --fc-neutral-bg-color: var(--sct-soft);
  --fc-now-indicator-color: #a81c24;
  font-variant-numeric: tabular-nums;
}

:deep(.fc-theme-standard .fc-scrollgrid) {
  border: none !important;
}

:deep(.fc .fc-col-header-cell) {
  padding: 8px 0;
  background: var(--sct-container);
  border-bottom: 1px solid var(--sct-border);
}

:deep(.nuxt-cal-month-head) {
  padding: 2px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--sct-muted);
}

:deep(.nuxt-cal-col-head) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
}

:deep(.nuxt-cal-col-head__wk) {
  font-size: 12px;
  font-weight: 600;
  color: var(--sct-muted);
}

:deep(.nuxt-cal-col-head__num) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: var(--sct-ink);
}

:deep(.nuxt-cal-col-head.is-today .nuxt-cal-col-head__wk) {
  color: #a81c24;
  font-weight: 700;
}

:deep(.nuxt-cal-col-head.is-today .nuxt-cal-col-head__num) {
  background: #a81c24;
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(168, 28, 36, 0.28);
}

:deep(.fc .fc-timegrid-slot) {
  height: 2.35em;
}

:deep(.fc .fc-timegrid-slot-minor) {
  border-top-style: dashed;
  border-top-color: rgba(148, 163, 184, 0.18);
}

:deep(.fc .fc-timegrid-slot-label-cushion) {
  padding-right: 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--sct-muted);
}

:deep(.fc .fc-timegrid-axis-cushion) {
  font-size: 11px;
  color: var(--sct-muted);
}

:deep(.fc-timegrid-event),
:deep(.fc-daygrid-event) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 1px !important;
}

:deep(.fc-event-main) {
  padding: 0 !important;
  height: 100%;
}

:deep(.nuxt-cal-ev) {
  display: flex;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  height: 100%;
  padding: 4px 7px 4px 5px;
  border-radius: 7px;
  background: var(--ev-soft, rgba(168, 28, 36, 0.12));
  border: 1px solid color-mix(in srgb, var(--ev-color, #a81c24) 22%, transparent);
  color: var(--sct-ink);
  overflow: hidden;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}

:deep(.nuxt-cal-ev:hover) {
  border-color: var(--ev-color, #a81c24);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.1);
}

:deep(.nuxt-cal-ev.is-done) {
  opacity: 0.62;
}

:deep(.nuxt-cal-ev.is-done .nuxt-cal-ev__title) {
  text-decoration: line-through;
}

:deep(.nuxt-cal-ev.is-cancelled) {
  opacity: 0.45;
  filter: grayscale(0.8);
}

:deep(.nuxt-cal-ev__pill) {
  width: 3.5px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--ev-color, #a81c24);
}

:deep(.nuxt-cal-ev__body) {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

:deep(.nuxt-cal-ev__title) {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ev-color, #a81c24);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.nuxt-cal-ev__meta) {
  margin-top: 2px;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.25;
  color: var(--sct-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.fc .fc-timegrid-now-indicator-line) {
  border-color: #a81c24;
  border-width: 2px 0 0;
}

:deep(.fc .fc-timegrid-now-indicator-arrow) {
  border-color: #a81c24;
  background: #a81c24;
  border-radius: 999px;
  width: 8px;
  height: 8px;
  border-width: 4px;
  margin-top: -4px;
}
</style>
