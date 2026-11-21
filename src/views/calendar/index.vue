<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import FullCalendar from '@fullcalendar/vue3';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { CalendarOptions, EventClickArg, EventDropArg } from '@fullcalendar/core';
import type { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import zhCnLocale from '@fullcalendar/core/locales/zh-cn';
import { useWorkDataStore } from '@/store/modules/work-data';
import { EVENT_CATEGORY_COLORS } from '@/constants/sanchitai';
import EventEditModal from './modules/event-edit-modal.vue';
import EventDetailDrawer from './modules/event-detail-drawer.vue';

defineOptions({ name: 'CalendarPage' });

const workStore = useWorkDataStore();

// 数据变化时让 FullCalendar 重新拉取（其事件函数不感知 store 更新）
const calendarRef = ref<InstanceType<typeof FullCalendar>>();
watch(
  () => [workStore.calEvents.length, workStore.members.length],
  () => {
    calendarRef.value?.getApi()?.refetchEvents();
  }
);

// ---------------- FullCalendar ----------------
const calendarOptions = ref<CalendarOptions>({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
  initialView: 'timeGridWeek',
  locale: zhCnLocale,
  firstDay: 1,
  headerToolbar: { left: 'prev,next today', center: 'title', right: 'timeGridWeek,dayGridMonth' },
  buttonText: { today: '今天', week: '周', month: '月' },
  slotMinTime: '07:00:00',
  slotMaxTime: '23:00:00',
  allDaySlot: true,
  allDayText: '全天/节点',
  nowIndicator: true,
  editable: true,
  selectable: true,
  height: '100%',
  expandRows: true,
  events(fetchInfo, success) {
    workStore.fullCalendarEvents(fetchInfo, success);
  },
  dateClick(info: DateClickArg) {
    openCreate(info.dateStr, info.date.getHours(), info.date.getMinutes());
  },
  eventClick(info: EventClickArg) {
    openDetail(info.event.id, info.event.extendedProps?.event ?? null);
  },
  eventDrop(info: EventDropArg) {
    void handleMove(info, false);
  },
  eventResize(info: EventResizeDoneArg) {
    void handleMove(info, true);
  },
  eventDidMount(info) {
    const ev = info.event.extendedProps?.event as Sct.CalEvent | undefined;
    if (!ev) return;
    if (ev.status === '已完成') {
      info.el.style.opacity = '0.55';
      info.el.style.textDecoration = 'line-through';
    } else if (ev.status === '已取消') {
      info.el.style.opacity = '0.45';
      info.el.style.textDecoration = 'line-through';
      info.el.style.filter = 'grayscale(0.8)';
    }
  }
});

function baseIdOf(id: string) {
  return id.includes('~occ~') ? id.split('~occ~')[0] : id;
}

async function handleMove(info: EventDropArg | EventResizeDoneArg, _resize: boolean) {
  const ev = info.event;
  const baseId = baseIdOf(ev.id);
  if (ev.id !== baseId) {
    info.revert();
    window.$message?.warning('重复事项暂不支持拖拽改期，请直接编辑该事项');
    return;
  }
  const base = workStore.calEvents.find(e => e.id === baseId);
  const start = dayjs(ev.start!);
  const patch: Partial<Sct.CalEvent> = { date: start.format('YYYY-MM-DD') };

  // 全天/节点事项（无时刻）只改日期，避免写入 00:00-01:00 破坏全天语义
  if (base?.start_time && base.start_time !== base.end_time) {
    const end = ev.end ? dayjs(ev.end) : start.add(1, 'hour');
    patch.start_time = start.format('HH:mm');
    patch.end_time = end.format('HH:mm');
  }
  await workStore.updateEvent(baseId, patch);
  window.$message?.success('已更新日程时间');
}

// ---------------- 新建 / 编辑 / 详情 ----------------
const editModalShow = ref(false);
const editModalEvent = ref<Sct.CalEvent | null>(null);
const editModalPreset = ref<{ date: string; start_time: string; end_time: string } | null>(null);

function openCreate(dateStr: string, hour: number, minute: number) {
  const snapped = Math.round(minute / 15) * 15;
  const start = `${String(hour).padStart(2, '0')}:${String(snapped).padStart(2, '0')}`;
  const endHour = Math.min(hour + 1, 23);
  editModalEvent.value = null;
  editModalPreset.value = { date: dateStr, start_time: start, end_time: `${String(endHour).padStart(2, '0')}:${String(snapped).padStart(2, '0')}` };
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
const visibleEvents = computed(() =>
  workStore.eventsInRange(today, today).filter(ev => ev.status !== '已取消' && !ev.merged_into)
);
const todayEvents = visibleEvents;
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
    <NCard :bordered="false" class="h-full flex-1 overflow-hidden" content-class="h-full flex-col" :content-style="{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 16px' }">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">台历</span>
          <span class="text-12px text-gray-400">点空白时段快速新建 · 拖拽可改期</span>
        </div>
      </template>
      <template #header-extra>
        <NButton type="primary" size="small" @click="openCreate(today, 14, 0)">＋ 新建事项</NButton>
      </template>
      <div class="min-h-0 flex-1">
        <FullCalendar ref="calendarRef" :options="calendarOptions" />
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
:deep(.fc) {
  @apply h-full text-13px;
  /* 今天列高亮：党建红 5% 淡色（覆盖 FC 默认黄） */
  --fc-today-bg-color: rgba(168, 28, 36, 0.05);
  --fc-border-color: var(--sct-border);
  --fc-page-bg-color: transparent;
}
:deep(.fc .fc-toolbar-title) {
  @apply text-16px font-bold;
}
:deep(.fc .fc-button) {
  @apply rounded-4px;
}
:deep(.fc .fc-button-primary:not(:disabled).fc-button-active),
:deep(.fc .fc-button-primary:not(:disabled):active) {
  background-color: #2b2926;
  border-color: #2b2926;
}
:deep(.fc .fc-button-primary:hover) {
  background-color: #44403c;
  border-color: #44403c;
}
:deep(.fc .fc-button-primary:not(:disabled).fc-button-active:hover) {
  background-color: #44403c;
  border-color: #44403c;
}
:deep(.fc .fc-event) {
  border-radius: 4px;
}
</style>
