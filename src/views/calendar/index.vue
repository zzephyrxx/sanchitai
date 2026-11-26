<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import type {
  CalendarOptions,
  DayHeaderContentArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventHoveringArg
} from '@fullcalendar/core';
import zhCnLocale from '@fullcalendar/core/locales/zh-cn';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import FullCalendar from '@fullcalendar/vue3';
import { EVENT_CATEGORY_COLORS } from '@/constants/sanchitai';
import { onTourCommand } from '@/utils/onboarding-bus';
import { $t } from '@/locales';
import { useAppStore } from '@/store/modules/app';
import { useWorkDataStore } from '@/store/modules/work-data';
import EmptyFancy from '@/components/custom/empty-fancy.vue';
import EventDetailDrawer from './modules/event-detail-drawer.vue';
import EventEditModal from './modules/event-edit-modal.vue';

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

// ---------------- 鼠标悬浮日程小弹窗（Hover Popover，带 0.25s 悬浮延迟） ----------------
const HOVER_OPEN_DELAY_MS = 250;

const hoverCard = reactive<{
  visible: boolean;
  suppressTransition: boolean;
  event: Sct.CalEvent | null;
  sourceEl: HTMLElement | null;
  x: number;
  y: number;
  placement: 'right' | 'left';
}>({
  visible: false,
  suppressTransition: false,
  event: null,
  sourceEl: null,
  x: 0,
  y: 0,
  placement: 'right'
});

let hoverShowTimer: ReturnType<typeof setTimeout> | null = null;
let hoverHideTimer: ReturnType<typeof setTimeout> | null = null;
let tearFinishTimer: ReturnType<typeof setTimeout> | null = null;

function clearHoverTimer() {
  if (hoverShowTimer) {
    clearTimeout(hoverShowTimer);
    hoverShowTimer = null;
  }
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer);
    hoverHideTimer = null;
  }
}

const isDraggingEvent = ref(false);

function dismissHoverPopover(instant = false) {
  clearHoverTimer();
  hoverCard.suppressTransition = instant;
  hoverCard.visible = false;
  hoverCard.sourceEl = null;
}

function openHoverPopoverNow(ev: Sct.CalEvent, targetEl: HTMLElement) {
  if (isDraggingEvent.value || moveConfirm.visible || tearFx.active) return;
  const rect = targetEl.getBoundingClientRect();
  const popWidth = 316;
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

  hoverCard.suppressTransition = false;
  hoverCard.event = ev;
  hoverCard.sourceEl = targetEl;
  hoverCard.x = Math.round(x);
  hoverCard.y = Math.round(y);
  hoverCard.placement = placement;
  hoverCard.visible = true;
}

function scheduleShowHoverPopover(ev: Sct.CalEvent, targetEl: HTMLElement) {
  if (isDraggingEvent.value || moveConfirm.visible || tearFx.active) return;
  clearHoverTimer();
  hoverShowTimer = setTimeout(() => {
    hoverShowTimer = null;
    openHoverPopoverNow(ev, targetEl);
  }, HOVER_OPEN_DELAY_MS);
}

function scheduleHideHoverPopover() {
  if (hoverShowTimer) {
    clearTimeout(hoverShowTimer);
    hoverShowTimer = null;
  }
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer);
    hoverHideTimer = null;
  }
  hoverHideTimer = setTimeout(() => {
    hoverCard.suppressTransition = false;
    hoverCard.visible = false;
    hoverCard.sourceEl = null;
  }, 160);
}

function onPopoverMouseEnter() {
  clearHoverTimer();
}

function onPopoverMouseLeave() {
  scheduleHideHoverPopover();
}

// ---------------- 日程真实撕纸删除动效（仅作用于日程本体，详情悬浮窗即时消失） + 5 秒撤销 ----------------
const tearFx = reactive<{
  active: boolean;
  key: number;
  left: number;
  top: number;
  width: number;
  height: number;
  title: string;
  meta: string;
  color: string;
  soft: string;
  isDone: boolean;
}>({
  active: false,
  key: 0,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  title: '',
  meta: '',
  color: '#A81C24',
  soft: 'rgba(168, 28, 36, 0.12)',
  isDone: false
});

const undoBar = reactive<{
  visible: boolean;
  snapshot: Sct.CalEvent | null;
  key: number;
}>({
  visible: false,
  snapshot: null,
  key: 0
});

let undoTimer: ReturnType<typeof setTimeout> | null = null;

function clearUndoTimer() {
  if (undoTimer) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
}

function closeUndoBar() {
  clearUndoTimer();
  undoBar.visible = false;
  undoBar.snapshot = null;
}

function findEventElementById(eventId: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(eventId) : eventId;
  const gridEl = document.querySelector<HTMLElement>(`.fc-event [data-cal-event-id="${escaped}"]`);
  if (gridEl) {
    return (gridEl.closest('.fc-event') as HTMLElement | null) ?? gridEl;
  }
  return document.querySelector<HTMLElement>(`[data-cal-event-id="${escaped}"]`);
}

function triggerPaperTearDelete(ev: Sct.CalEvent, explicitEl?: HTMLElement | null) {
  if (tearFx.active) return;
  const targetEl = explicitEl ?? hoverCard.sourceEl ?? findEventElementById(ev.id);
  // 详情悬浮窗立即无动画消失
  dismissHoverPopover(true);
  hoverCard.event = null;

  const snapshot: Sct.CalEvent = JSON.parse(JSON.stringify(ev));
  const palette = EVENT_CATEGORY_COLORS[ev.category] ?? {
    color: '#A81C24',
    soft: 'rgba(168, 28, 36, 0.12)'
  };
  const timeRange = ev.start_time && ev.start_time !== ev.end_time ? `${ev.start_time} - ${ev.end_time}` : '';
  const metaText = `${timeRange}${ev.location ? ` · ${ev.location}` : ''}`;

  const rect = targetEl?.getBoundingClientRect();
  if (rect && rect.width > 4 && rect.height > 4) {
    if (targetEl) {
      targetEl.style.visibility = 'hidden';
    }
    tearFx.left = rect.left;
    tearFx.top = rect.top;
    tearFx.width = rect.width;
    tearFx.height = rect.height;
    tearFx.title = ev.title;
    tearFx.meta = metaText;
    tearFx.color = palette.color;
    tearFx.soft = palette.soft;
    tearFx.isDone = ev.status === '已完成';
    tearFx.key += 1;
    tearFx.active = true;
  }

  const finishDelete = async () => {
    tearFinishTimer = null;
    try {
      await workStore.deleteEvent(snapshot.id);
      if (targetEl) {
        targetEl.style.visibility = '';
      }
      tearFx.active = false;
      calendarRef.value?.getApi()?.refetchEvents();

      clearUndoTimer();
      undoBar.snapshot = snapshot;
      undoBar.key += 1;
      undoBar.visible = true;
      undoTimer = setTimeout(() => {
        undoBar.visible = false;
        undoBar.snapshot = null;
        undoTimer = null;
      }, 5000);
    } catch {
      if (targetEl) {
        targetEl.style.visibility = '';
      }
      tearFx.active = false;
      window.$message?.error('删除日程失败');
    }
  };

  if (tearFx.active) {
    tearFinishTimer = setTimeout(() => {
      void finishDelete();
    }, 520);
  } else {
    void finishDelete();
  }
}

function handleDrawerDelete(ev: Sct.CalEvent) {
  detailShow.value = false;
  // 给右侧抽屉收起留出短瞬视野，再对日历上对应日程播放高帧率撕纸动效
  setTimeout(() => {
    const el = findEventElementById(ev.id);
    triggerPaperTearDelete(ev, el);
  }, 140);
}

async function handleUndoDelete() {
  const snap = undoBar.snapshot;
  closeUndoBar();
  if (!snap) return;
  await workStore.addEvent(snap);
  calendarRef.value?.getApi()?.refetchEvents();
  window.$message?.success(`已撤销删除，恢复日程「${snap.title}」`);
}

onBeforeUnmount(() => {
  clearHoverTimer();
  clearUndoTimer();
  if (tearFinishTimer) {
    clearTimeout(tearFinishTimer);
    tearFinishTimer = null;
  }
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
      success(rawEvents);
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
    const timeRange = ev?.start_time && ev.start_time !== ev.end_time ? `${ev.start_time} - ${ev.end_time}` : '';
    const title = ev?.title ?? arg.event.title;
    const loc = ev?.location ? ` · ${ev.location}` : '';

    return {
      html: `
        <div class="nuxt-cal-ev ${isDone ? 'is-done' : ''} ${isCancelled ? 'is-cancelled' : ''}" data-cal-event-id="${escapeHtml(arg.event.id)}" style="--ev-color: ${palette.color}; --ev-soft: ${palette.soft};">
          <span class="nuxt-cal-ev__pill"></span>
          <div class="nuxt-cal-ev__body">
            <div class="nuxt-cal-ev__title">${escapeHtml(title)}</div>
            ${timeRange || loc ? `<div class="nuxt-cal-ev__meta">${escapeHtml(timeRange)}${escapeHtml(loc)}</div>` : ''}
          </div>
        </div>
      `
    };
  },
  dateClick(info: DateClickArg) {
    openCreate(info.dateStr.slice(0, 10), info.date.getHours() || 14, info.date.getMinutes());
  },
  eventClick(info: EventClickArg) {
    dismissHoverPopover();
    openDetail(info.event.id, info.event.extendedProps?.event ?? null);
  },
  eventMouseEnter(info: EventHoveringArg) {
    if (isDraggingEvent.value || moveConfirm.visible || tearFx.active) return;
    const ev = info.event.extendedProps?.event as Sct.CalEvent | undefined;
    if (!ev) return;
    scheduleShowHoverPopover(ev, info.el);
  },
  eventMouseLeave() {
    scheduleHideHoverPopover();
  },
  eventDragStart() {
    isDraggingEvent.value = true;
    dismissHoverPopover();
  },
  eventDragStop() {
    isDraggingEvent.value = false;
    dismissHoverPopover();
  },
  eventResizeStart() {
    isDraggingEvent.value = true;
    dismissHoverPopover();
  },
  eventResizeStop() {
    isDraggingEvent.value = false;
    dismissHoverPopover();
  },
  eventDrop(info: EventDropArg) {
    isDraggingEvent.value = false;
    dismissHoverPopover();
    openMoveConfirm(info, 'move');
  },
  eventResize(info: EventResizeDoneArg) {
    isDraggingEvent.value = false;
    dismissHoverPopover();
    openMoveConfirm(info, 'resize');
  }
});

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface PendingMoveState {
  visible: boolean;
  saving: boolean;
  kind: 'move' | 'resize';
  title: string;
  color: string;
  oldText: string;
  newText: string;
  eventId: string;
  patch: Partial<Sct.CalEvent>;
  revert: (() => void) | null;
}

const moveConfirm = reactive<PendingMoveState>({
  visible: false,
  saving: false,
  kind: 'move',
  title: '',
  color: '#A81C24',
  oldText: '',
  newText: '',
  eventId: '',
  patch: {},
  revert: null
});

function formatEventSpan(startDate: Date | null, endDate: Date | null, allDay: boolean): string {
  if (!startDate) return '';
  const start = dayjs(startDate);
  if (allDay) {
    return `${start.format('YYYY-MM-DD')}（全天）`;
  }
  const end = endDate ? dayjs(endDate) : start.add(1, 'hour');
  return `${start.format('YYYY-MM-DD')} ${start.format('HH:mm')}–${end.format('HH:mm')}`;
}

function openMoveConfirm(info: EventDropArg | EventResizeDoneArg, kind: 'move' | 'resize') {
  const ev = info.event;
  if (!ev.start) {
    info.revert();
    return;
  }
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

  const raw = ev.extendedProps?.event as Sct.CalEvent | undefined;
  const catColor = raw ? (EVENT_CATEGORY_COLORS[raw.category]?.color ?? '#A81C24') : '#A81C24';

  moveConfirm.kind = kind;
  moveConfirm.title = raw?.title ?? ev.title;
  moveConfirm.color = catColor;
  moveConfirm.oldText = formatEventSpan(info.oldEvent.start, info.oldEvent.end, info.oldEvent.allDay);
  moveConfirm.newText = formatEventSpan(ev.start, ev.end, ev.allDay);
  moveConfirm.eventId = ev.id;
  moveConfirm.patch = patch;
  moveConfirm.revert = info.revert;
  moveConfirm.saving = false;
  moveConfirm.visible = true;
}

function cancelMoveConfirm() {
  if (moveConfirm.revert) {
    const revertFn = moveConfirm.revert;
    moveConfirm.revert = null;
    revertFn();
  }
  moveConfirm.visible = false;
}

async function confirmMoveAdjustment() {
  if (!moveConfirm.eventId || moveConfirm.saving) return;
  moveConfirm.saving = true;
  const revertFn = moveConfirm.revert;
  try {
    await workStore.updateEvent(moveConfirm.eventId, moveConfirm.patch);
    moveConfirm.revert = null;
    moveConfirm.visible = false;
    calendarRef.value?.getApi()?.refetchEvents();
    const p = moveConfirm.patch;
    window.$message?.success(`已更新日程时间：${p.date} ${p.start_time ? `${p.start_time}-${p.end_time}` : '全天'}`);
  } catch {
    revertFn?.();
    moveConfirm.revert = null;
    moveConfirm.visible = false;
    window.$message?.error('更新日程时间失败，已还原');
  } finally {
    moveConfirm.saving = false;
  }
}

function handleCalendarPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.fc-event')) {
    dismissHoverPopover();
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

const offCalTour = onTourCommand(cmd => {
  if (cmd === 'calendar:open-first-event') {
    const first = workStore.calEvents.find(e => !e.merged_into && e.status !== '已取消') ?? workStore.calEvents[0];
    if (first) openDetail(first.id, first);
  } else if (cmd === 'calendar:close-drawer' || cmd === 'tour:cleanup') {
    detailShow.value = false;
  }
});
onBeforeUnmount(offCalTour);

async function quickMarkDone(ev: Sct.CalEvent) {
  await workStore.setEventStatus(ev.id, '已完成');
  dismissHoverPopover();
  window.$message?.success(`「${ev.title}」已标记为已完成`);
}

async function quickRestorePlan(ev: Sct.CalEvent) {
  await workStore.setEventStatus(ev.id, '计划');
  dismissHoverPopover();
  window.$message?.success(`「${ev.title}」已恢复为计划中`);
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
      <div data-tour="calendar-topbar" class="cal-topbar border-b border-[var(--sct-border)] px-18px py-12px">
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
              {{ $t('sct.calendar.today') }}
              <b style="color: var(--sct-ink)">{{ todayEvents.length }}</b>
            </span>
            <span
              class="inline-flex items-center gap-4px rounded-full px-9px py-2px text-11px font-medium"
              style="background: var(--sct-soft); border: 1px solid var(--sct-border); color: var(--sct-muted)"
            >
              {{ $t('sct.calendar.thisWeek') }}
              <b style="color: var(--sct-ink)">{{ weekEvents.length }}</b>
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
            <button type="button" class="cal-nav-btn cal-nav-btn--today" @click="navToday">
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

      <!-- 日历主网格 -->
      <div
        data-tour="calendar-body"
        class="nuxt-cal-body min-h-0 flex-1"
        @pointerdown.capture="handleCalendarPointerDown"
      >
        <FullCalendar ref="calendarRef" :options="calendarOptions" />
      </div>
    </div>

    <!-- 右侧栏：常驻显示，采用内置胶囊色带卡片 -->
    <div data-tour="calendar-sidebar" class="w-288px flex flex-shrink-0 flex-col gap-12px overflow-y-auto">
      <!-- 1. 今日日程 -->
      <NCard :bordered="false" size="small" class="rounded-16px">
        <template #header>
          <div class="flex items-center gap-6px text-14px font-bold">
            <SvgIcon icon="lucide:calendar-check-2" class="text-15px text-[#A81C24]" />
            <span>{{ $t('sct.calendar.todaySchedule') }}</span>
          </div>
        </template>
        <template #header-extra>
          <div class="flex items-center gap-4px">
            <span v-if="todayEvents.length > 6" class="text-11px text-gray-400">
              {{ isEn ? 'Scroll' : '可滚动' }}
            </span>
            <NTag size="tiny" :bordered="false" round>{{ todayEvents.length }} {{ $t('sct.common.items') }}</NTag>
          </div>
        </template>
        <EmptyFancy
          v-if="!todayEvents.length"
          emoji="tea"
          :text="$t('sct.calendar.todayEmpty')"
          :sub="$t('sct.calendar.todayEmptySub')"
          compact
        />
        <div
          v-else
          class="cal-today-list flex flex-col gap-8px"
          :class="{ 'cal-today-list--scroll': todayEvents.length > 6 }"
        >
          <div
            v-for="ev in todayEvents"
            :key="ev.id"
            :data-cal-event-id="ev.id"
            class="cal-side-card group flex cursor-pointer items-stretch gap-10px rounded-10px border border-[var(--sct-border)] bg-[var(--sct-container)] p-10px transition"
            @click="openDetail(ev.id, ev)"
            @mouseenter="scheduleShowHoverPopover(ev, $event.currentTarget as HTMLElement)"
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

    <!-- 鼠标悬浮日程详情小弹窗（删除时即时无动画消失） -->
    <Teleport to="body">
      <Transition :name="hoverCard.suppressTransition ? '' : 'cal-pop'">
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
                <NTag size="tiny" :bordered="false" :type="eventStatusTagType(hoverCard.event.status)">
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

              <!-- 悬浮窗快捷操作栏（详情仅图标 · 编辑 · 完成/恢复计划 · 最右删除图标含 Peel 掀纸动画） -->
              <div class="mt-10px flex items-center justify-between gap-6px border-t border-[var(--sct-border)] pt-8px">
                <div class="flex items-center gap-6px">
                  <NButton
                    size="tiny"
                    quaternary
                    :title="$t('sct.common.detail')"
                    @click="openDetail(hoverCard.event.id, hoverCard.event)"
                  >
                    <template #icon><SvgIcon icon="lucide:eye" /></template>
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
                  <NButton v-else size="tiny" type="warning" secondary @click="quickRestorePlan(hoverCard.event)">
                    <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
                    {{ isEn ? 'Restore' : '恢复计划' }}
                  </NButton>
                </div>
                <NButton
                  size="tiny"
                  quaternary
                  type="error"
                  :title="isEn ? 'Delete Event' : '删除此日程'"
                  @click="triggerPaperTearDelete(hoverCard.event)"
                >
                  <template #icon><SvgIcon icon="lucide:trash-2" /></template>
                </NButton>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 仅作用于被删日程本体的纯 GPU 高帧率双片撕纸动效浮层 -->
    <Teleport to="body">
      <div
        v-if="tearFx.active"
        :key="tearFx.key"
        class="cal-tear-stage"
        :style="{
          left: `${tearFx.left}px`,
          top: `${tearFx.top}px`,
          width: `${tearFx.width}px`,
          height: `${tearFx.height}px`,
          '--ev-color': tearFx.color,
          '--ev-soft': tearFx.soft
        }"
      >
        <!-- 左残片（纯 CSS polygon 锯齿裁切，硬件加速） -->
        <div class="cal-tear-half cal-tear-half--left">
          <div class="cal-tear-card" :class="{ 'is-done': tearFx.isDone }">
            <span class="cal-tear-card__pill" />
            <div class="cal-tear-card__body">
              <div class="cal-tear-card__title">{{ tearFx.title }}</div>
              <div v-if="tearFx.meta" class="cal-tear-card__meta">{{ tearFx.meta }}</div>
            </div>
          </div>
        </div>

        <!-- 右撕裂纸片（纯 CSS polygon 互补锯齿 + 翻折高光，60/120fps 合成层） -->
        <div class="cal-tear-half cal-tear-half--right">
          <div class="cal-tear-card cal-tear-card--right" :class="{ 'is-done': tearFx.isDone }">
            <span class="cal-tear-card__pill" />
            <div class="cal-tear-card__body">
              <div class="cal-tear-card__title">{{ tearFx.title }}</div>
              <div v-if="tearFx.meta" class="cal-tear-card__meta">{{ tearFx.meta }}</div>
            </div>
          </div>
          <div class="cal-tear-curl-sheen" />
        </div>
      </div>
    </Teleport>

    <!-- 5 秒撤销删除浮动条 -->
    <Teleport to="body">
      <Transition name="cal-undo">
        <div v-if="undoBar.visible && undoBar.snapshot" :key="undoBar.key" class="cal-undo-bar">
          <div class="flex items-center gap-10px">
            <SvgIcon icon="lucide:trash-2" class="text-14px text-[#d43030]" />
            <span class="max-w-220px truncate text-12px font-medium text-[var(--sct-ink)]">
              {{ isEn ? `Deleted "${undoBar.snapshot.title}"` : `已删除「${undoBar.snapshot.title}」` }}
            </span>
            <NButton size="tiny" type="primary" secondary @click="handleUndoDelete">
              <template #icon><SvgIcon icon="lucide:undo-2" /></template>
              {{ isEn ? 'Undo' : '撤销删除' }}
            </NButton>
            <button type="button" class="text-12px text-gray-400 hover:text-gray-600" @click="closeUndoBar">
              <SvgIcon icon="lucide:x" />
            </button>
          </div>
          <div class="cal-undo-bar__progress" />
        </div>
      </Transition>
    </Teleport>

    <!-- 拖拽移动 / 拉伸时长确认小弹窗 -->
    <NModal
      :show="moveConfirm.visible"
      preset="card"
      :title="
        moveConfirm.kind === 'resize'
          ? isEn
            ? 'Confirm Duration Change'
            : '确认调整日程时长'
          : isEn
            ? 'Confirm Reschedule'
            : '确认调整日程时间'
      "
      class="w-420px max-w-92vw"
      :mask-closable="true"
      @update:show="val => !val && cancelMoveConfirm()"
    >
      <div class="flex flex-col gap-12px">
        <div class="flex items-center gap-8px text-14px font-bold text-[var(--sct-ink)]">
          <span class="inline-block size-9px shrink-0 rounded-full" :style="{ background: moveConfirm.color }" />
          <span class="truncate">{{ moveConfirm.title }}</span>
        </div>

        <div class="rounded-10px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-10px text-12px">
          <div class="flex items-center justify-between gap-8px text-gray-500">
            <span>{{ isEn ? 'Original' : '原时间' }}</span>
            <span class="font-mono">{{ moveConfirm.oldText }}</span>
          </div>
          <div class="my-6px flex justify-center text-gray-400">
            <SvgIcon icon="lucide:arrow-down" class="text-13px" />
          </div>
          <div class="flex items-center justify-between gap-8px font-semibold text-[var(--sct-ink)]">
            <span>{{ isEn ? 'Updated' : '调整为' }}</span>
            <span class="font-mono text-[var(--sct-accent)]">{{ moveConfirm.newText }}</span>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" secondary :disabled="moveConfirm.saving" @click="cancelMoveConfirm">
            {{ isEn ? 'Cancel & Revert' : '取消还原' }}
          </NButton>
          <NButton size="small" type="primary" :loading="moveConfirm.saving" @click="confirmMoveAdjustment">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            {{ isEn ? 'Confirm' : '确认调整' }}
          </NButton>
        </div>
      </template>
    </NModal>

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
      @delete="handleDrawerDelete($event)"
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
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
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

.cal-today-list {
  padding: 2px;
}

.cal-today-list--scroll {
  max-height: 444px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 3px 10px 6px 3px;
  margin: -3px -6px -4px -3px;
}

.cal-today-list--scroll::-webkit-scrollbar {
  width: 5px;
}

.cal-today-list--scroll::-webkit-scrollbar-track {
  background: transparent;
}

.cal-today-list--scroll::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.35);
  border-radius: 999px;
}

.cal-today-list--scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.6);
}

.cal-side-card {
  position: relative;
  z-index: 1;
}

.cal-side-card:hover {
  z-index: 2;
  border-color: rgba(168, 28, 36, 0.35);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
}

/* 悬浮小弹窗（Nuxt UI Popover 风格） */
.nuxt-cal-popover {
  position: fixed;
  z-index: 3200;
  width: 316px;
  padding: 12px 14px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 14px;
  box-shadow:
    0 12px 32px -4px rgba(15, 23, 42, 0.14),
    0 4px 12px -2px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(10px);
}

/* 日程纯 GPU 合成高帧率双片撕纸动效（仅作用于日程本体，零 SVG 滤镜重绘） */
.cal-tear-stage {
  position: fixed;
  z-index: 3250;
  pointer-events: none;
  contain: layout style;
}

.cal-tear-half {
  position: absolute;
  inset: 0;
  will-change: transform, opacity;
  backface-visibility: hidden;
  transform: translateZ(0);
}

.cal-tear-half--left {
  clip-path: polygon(0% 0%, 30% 0%, 34% 14%, 28% 28%, 35% 43%, 29% 58%, 34% 72%, 28% 86%, 31% 100%, 0% 100%);
  transform-origin: left center;
  animation: cal-tear-left-stub 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.cal-tear-half--right {
  clip-path: polygon(30% 0%, 100% 0%, 100% 100%, 31% 100%, 28% 86%, 34% 72%, 29% 58%, 35% 43%, 28% 28%, 34% 14%);
  transform-origin: 32% 20%;
  animation: cal-tear-right-sheet 500ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.cal-tear-card {
  display: flex;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  height: 100%;
  padding: 4px 7px;
  box-sizing: border-box;
  border-radius: 6px;
  background: var(--ev-soft, rgba(168, 28, 36, 0.12));
  border: 1px solid color-mix(in srgb, var(--ev-color, #a81c24) 24%, transparent);
  overflow: hidden;
}

.cal-tear-card--right {
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14);
}

.cal-tear-card.is-done {
  opacity: 0.72;
}

.cal-tear-card.is-done .cal-tear-card__title {
  text-decoration: line-through;
}

.cal-tear-card__pill {
  width: 3.5px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--ev-color, #a81c24);
}

.cal-tear-card__body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.cal-tear-card__title {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ev-color, #a81c24);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-tear-card__meta {
  margin-top: 2px;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.25;
  color: var(--sct-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-tear-curl-sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    98deg,
    transparent 26%,
    rgba(255, 255, 255, 0.78) 31%,
    rgba(15, 23, 42, 0.1) 36%,
    transparent 45%
  );
}

@keyframes cal-tear-left-stub {
  0% {
    transform: translate3d(0, 0, 0) rotate(0deg);
    opacity: 1;
  }
  25% {
    transform: translate3d(-4px, 1px, 0) rotate(-3deg);
    opacity: 1;
  }
  100% {
    transform: translate3d(-14px, 18px, 0) rotate(-10deg);
    opacity: 0;
  }
}

@keyframes cal-tear-right-sheet {
  0% {
    transform: translate3d(0, 0, 0) rotate(0deg) scale(1);
    opacity: 1;
  }
  24% {
    transform: translate3d(10px, -6px, 0) rotate(7deg) scale(1.015);
    opacity: 1;
  }
  60% {
    transform: translate3d(26px, 6px, 0) rotate(17deg) scale(0.98);
    opacity: 0.92;
  }
  100% {
    transform: translate3d(48px, 40px, 0) rotate(28deg) scale(0.9);
    opacity: 0;
  }
}

/* 5 秒撤销删除浮动条 */
.cal-undo-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  z-index: 3300;
  transform: translateX(-50%);
  overflow: hidden;
  padding: 9px 14px 11px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 12px;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
}

.cal-undo-bar__progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2.5px;
  width: 100%;
  background: var(--sct-accent, #a81c24);
  transform-origin: left center;
  animation: cal-undo-countdown 5s linear forwards;
}

@keyframes cal-undo-countdown {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.cal-undo-enter-active,
.cal-undo-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.cal-undo-enter-from,
.cal-undo-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}

.cal-pop-enter-active,
.cal-pop-leave-active {
  transition:
    opacity 130ms ease,
    transform 130ms ease;
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
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    border-color 0.12s ease;
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
