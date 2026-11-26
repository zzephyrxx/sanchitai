<script setup lang="ts">
/**
 * 会议详情：议程、参会考勤（默认正式+预备党员"到会"）、自动到会率、党课并入
 */
import { computed, h, ref, watch } from 'vue';
import { NSelect } from 'naive-ui';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';
import { buildSignInSheet, printHtml } from '@/utils/print';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSvgIcon } from '@/hooks/common/icon';

defineOptions({ name: 'MeetingDetail' });

const props = defineProps<{ show: boolean; eventId: string | null }>();
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>();

const workStore = useWorkDataStore();
const { SvgIconVNode } = useSvgIcon();

function colHeader(icon: string, text: string) {
  return h('span', { class: 'inline-flex items-center gap-4px whitespace-nowrap' }, [
    SvgIconVNode({ icon, fontSize: 13 })?.(),
    h('span', text)
  ]);
}

const show = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
});

const event = computed(() => (props.eventId ? workStore.calEvents.find(e => e.id === props.eventId) : undefined));

watch(
  () => [props.show, props.eventId],
  ([visible]) => {
    if (visible && props.eventId) {
      void workStore.initAttendance(props.eventId);
      initRows();
    }
  }
);

// ---------------- 考勤行 ----------------
const STATUS_OPTIONS = ['到会', '请假', '未到会', '迟到'].map(v => ({ label: v, value: v }));
const localRows = ref<Array<{ memberId: string; name: string; type: string; status: Sct.Attendance['status'] }>>([]);

function initRows() {
  if (!props.eventId) return;
  const att = workStore.attendanceOfEvent(props.eventId);
  const statusMap = new Map(att.map(a => [a.member_id, a.status]));
  const activeIds = new Set(workStore.activeMembers.map(m => m.id));
  localRows.value = workStore.members
    .filter(m => (m.type === '正式党员' || m.type === '预备党员') && (activeIds.has(m.id) || statusMap.has(m.id)))
    .map(m => ({
      memberId: m.id,
      name: m.name,
      type: m.type,
      status: statusMap.get(m.id) ?? '到会'
    }));
}

async function onStatusChange(memberId: string, status: Sct.Attendance['status']) {
  if (!props.eventId) return;
  const row = localRows.value.find(r => r.memberId === memberId);
  if (row) row.status = status;
  await workStore.setAttendance(props.eventId, memberId, status);
}

const rate = computed(() => {
  const present = localRows.value.filter(r => r.status === '到会' || r.status === '迟到').length;
  const due = localRows.value.length;
  return due ? { present, due, pct: Math.round((present / due) * 100) } : null;
});

const attColumns = [
  {
    title: () => colHeader('lucide:user', '姓名'),
    key: 'name',
    width: 110,
    render: (r: (typeof localRows.value)[number]) =>
      h('span', { class: 'inline-flex items-center gap-5px font-medium' }, [
        h('span', {
          class: 'inline-block size-8px rounded-full',
          style: { background: MEMBER_TYPE_COLORS[r.type as Sct.MemberType] }
        }),
        r.name
      ])
  },
  { title: () => colHeader('lucide:award', '类型'), key: 'type', width: 100 },
  {
    title: () => colHeader('lucide:check-circle-2', '状态'),
    key: 'status',
    width: 140,
    render: (r: (typeof localRows.value)[number]) =>
      h(NSelect, {
        value: r.status,
        options: STATUS_OPTIONS,
        size: 'tiny',
        onChange: (v: Sct.Attendance['status']) => onStatusChange(r.memberId, v)
      })
  }
];

// ---------------- 党课并入（A4） ----------------
const mergeOptions = computed(() =>
  workStore.calEvents
    .filter(ev => ev.kind === '党员大会' && ev.id !== props.eventId)
    .map(ev => ({ label: `${ev.date} ${ev.title}`, value: ev.id }))
);

async function mergeInto(targetId: string | null) {
  if (!props.eventId) return;
  await workStore.updateEvent(props.eventId, targetId ? { merged_into: targetId } : { merged_into: undefined });
  window.$message?.success(targetId ? '已并入党员大会（不计入当月线下会议次数）' : '已取消并入');
}

async function setStatus(status: Sct.EventStatus) {
  if (!props.eventId) return;
  await workStore.setEventStatus(props.eventId, status);
  window.$message?.success(`会议已标记为「${status}」`);
}

function printSignIn() {
  if (!event.value) return;
  const rows = localRows.value.map(r => ({
    name: r.name,
    type: r.type,
    group: workStore.memberOf(r.memberId)?.group ?? ''
  }));
  printHtml(
    event.value.title,
    buildSignInSheet({
      title: event.value.title,
      meta: `${event.value.date} ${event.value.start_time || ''} · ${event.value.location || ''}`,
      rows
    })
  );
}
</script>

<template>
  <NDrawer v-model:show="show" :width="580">
    <NDrawerContent
      v-if="event"
      :title="event.title"
      closable
      :body-content-style="{ height: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }"
    >
      <div class="flex flex-wrap items-center gap-8px">
        <NTag size="small" :bordered="false" :color="{ color: 'var(--sct-err-soft)', textColor: '#A81C24' }">
          {{ event.kind }}
        </NTag>
        <span class="text-13px">
          {{ event.date }}
          {{ event.start_time && event.start_time !== event.end_time ? `${event.start_time}-${event.end_time}` : '' }}
        </span>
        <span class="text-13px text-gray-500">{{ event.location }}</span>
        <NTag v-if="event.status === '计划'" size="small" type="warning">计划</NTag>
        <NTag v-else-if="event.status === '已完成'" size="small" type="success">已完成</NTag>
      </div>

      <div v-if="event.agenda?.length" class="rounded-10px bg-[var(--sct-soft)] px-12px py-10px">
        <div class="mb-4px text-12px font-bold text-gray-500">会议议程</div>
        <ol class="ma-0 pl-18px text-13px leading-relaxed">
          <li v-for="(item, i) in event.agenda" :key="i">{{ item }}</li>
        </ol>
      </div>

      <div v-if="event.kind === '党课'" class="rounded-10px bg-[var(--sct-soft)] p-10px">
        <div class="mb-6px text-13px font-bold">合并设置（并入党员大会）</div>
        <NSelect
          :options="mergeOptions"
          placeholder="选择要并入的党员大会"
          size="small"
          clearable
          :value="event.merged_into ?? null"
          @update:value="v => mergeInto(v)"
        />
        <div class="mt-4px text-12px text-gray-400">并入后：本会议不计入“每月线下会议 ≤3 次”统计</div>
      </div>

      <!-- 参会考勤列表：自适应撑满剩余全部高度 -->
      <div class="min-h-0 flex flex-1 flex-col">
        <div class="mb-8px flex items-center justify-between">
          <span class="text-13px font-bold">参会考勤（共 {{ localRows.length }} 人）</span>
          <span v-if="rate" class="text-13px font-bold" :style="{ color: rate.pct >= 80 ? '#3f9d63' : '#d97706' }">
            到会率 {{ rate.pct }}%（{{ rate.present }}/{{ rate.due }}）
          </span>
        </div>
        <div class="min-h-0 flex-1">
          <NDataTable
            :columns="attColumns"
            :data="localRows"
            size="small"
            :bordered="false"
            flex-height
            class="h-full min-h-420px"
            :row-key="(r: { memberId: string }) => r.memberId"
          />
        </div>
      </div>

      <template #footer>
        <div class="w-full flex items-center justify-between gap-8px">
          <NButton size="small" secondary @click="printSignIn">
            <template #icon><SvgIcon icon="lucide:printer" /></template>
            打印签到表
          </NButton>
          <div class="flex gap-8px">
            <NButton v-if="event.status !== '计划'" size="small" secondary @click="setStatus('计划')">
              <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
              恢复计划
            </NButton>
            <NButton v-if="event.status !== '已取消'" size="small" secondary @click="setStatus('已取消')">
              <template #icon><SvgIcon icon="lucide:ban" /></template>
              取消会议
            </NButton>
            <NButton v-if="event.status !== '已完成'" size="small" type="primary" @click="setStatus('已完成')">
              <template #icon><SvgIcon icon="lucide:check-circle-2" /></template>
              标记完成
            </NButton>
          </div>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
