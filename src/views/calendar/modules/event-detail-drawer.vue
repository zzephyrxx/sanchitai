<script setup lang="ts">
import { computed } from 'vue';
import { useWorkDataStore } from '@/store/modules/work-data';
import { EVENT_CATEGORY_COLORS, MEMBER_TYPE_COLORS } from '@/constants/sanchitai';

defineOptions({ name: 'EventDetailDrawer' });

interface Props {
  show: boolean;
  event: Sct.CalEvent | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'edit', event: Sct.CalEvent): void;
}>();

const workStore = useWorkDataStore();

const show = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
});

/** 实时事件：状态/字段变更即时反映（P2-3），重复实例展示时用投影日期 */
const event = computed(() => {
  if (!props.event) return null;
  const baseId = props.event.id.includes('-occ-') ? props.event.id.split('-occ-')[0] : props.event.id;
  const base = workStore.calEvents.find(e => e.id === baseId);
  if (!base) return props.event;
  return { ...base, ...(props.event.id !== baseId ? { date: props.event.date } : {}) };
});

const isRecurringInstance = computed(() => Boolean(props.event?.id.includes('-occ-')));
const statusType = computed<'success' | 'default' | 'info' | 'warning'>(() => {
  switch (props.event?.status) {
    case '已完成':
      return 'success';
    case '已取消':
      return 'default';
    case '进行中':
      return 'info';
    default:
      return 'warning';
  }
});

const ownerName = computed(() => (props.event?.owner ? workStore.memberName(props.event.owner) : ''));
const helperDisplay = computed(() => {
  const h = props.event?.helper;
  if (!h) return '';
  // 兼容 "DY02、DY03" 逗号分隔写法
  return h
    .split(/[、,，]/)
    .map(id => workStore.memberName(id.trim()))
    .filter(Boolean)
    .join('、');
});

async function setStatus(status: Sct.EventStatus) {
  const target = props.event;
  if (!target) return;
  const baseId = target.id.includes('-occ-') ? target.id.split('-occ-')[0] : target.id;
  await workStore.setEventStatus(baseId, status);
  window.$message?.success(`已标记为「${status}」`);
}

async function handleDelete() {
  const target = props.event;
  if (!target) return;
  const baseId = target.id.includes('-occ-') ? target.id.split('-occ-')[0] : target.id;
  show.value = false; // 先关抽屉（P2-2：删除后不再显示已删事项）
  await workStore.deleteEvent(baseId);
  window.$message?.success('事项已删除');
}
</script>

<template>
  <NDrawer v-model:show="show" :width="420">
    <NDrawerContent v-if="event" :title="event.title" closable>
      <NAlert v-if="isRecurringInstance" type="info" :show-icon="true" class="mb-12px">
        这是重复事项的一个实例，编辑/删除将作用于整条重复规则。
      </NAlert>

      <NSpace vertical size="large">
        <div class="flex items-center gap-8px">
          <NTag :color="{ color: EVENT_CATEGORY_COLORS[event.category]?.soft, textColor: EVENT_CATEGORY_COLORS[event.category]?.color }" :bordered="false" size="small">
            {{ event.category }}
          </NTag>
          <NTag v-if="event.kind" size="small" :bordered="false">{{ event.kind }}</NTag>
          <NTag :type="statusType" size="small">{{ event.status }}</NTag>
          <NTag v-if="event.merged_into" size="small" type="info" :bordered="false">已并入其他会议</NTag>
        </div>

        <NDescriptions :column="1" size="small" label-placement="left" bordered>
          <NDescriptionsItem label="日期">{{ event.date }}</NDescriptionsItem>
          <NDescriptionsItem label="时间">{{ event.start_time && event.start_time !== event.end_time ? `${event.start_time} - ${event.end_time}` : '全天/节点' }}</NDescriptionsItem>
          <NDescriptionsItem label="地点">{{ event.location || '—' }}</NDescriptionsItem>
          <NDescriptionsItem label="主责人">{{ ownerName || '—' }}</NDescriptionsItem>
          <NDescriptionsItem label="协助人">{{ helperDisplay || '—' }}</NDescriptionsItem>
          <NDescriptionsItem v-if="event.note" label="备注">{{ event.note }}</NDescriptionsItem>
        </NDescriptions>

        <div v-if="event.agenda?.length">
          <div class="mb-6px text-13px font-bold">议程要点</div>
          <ol class="ma-0 pl-20px text-13px leading-relaxed">
            <li v-for="(item, i) in event.agenda" :key="i">{{ item }}</li>
          </ol>
        </div>

        <div class="flex flex-wrap gap-8px">
          <NButton size="small" type="primary" ghost @click="emit('edit', event)">编辑</NButton>
          <NButton size="small" type="primary" @click="setStatus('已完成')">标记完成</NButton>
          <NButton v-if="event.status !== '计划'" size="small" @click="setStatus('计划')">恢复计划</NButton>
          <NButton size="small" @click="setStatus('已取消')">取消事项</NButton>
          <NPopconfirm :key="event.id" @positive-click="handleDelete">
            <template #trigger>
              <NButton size="small" type="error" ghost>删除</NButton>
            </template>
            确认删除该事项？{{ isRecurringInstance ? '（将删除整条重复规则）' : '' }}
          </NPopconfirm>
        </div>
      </NSpace>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
