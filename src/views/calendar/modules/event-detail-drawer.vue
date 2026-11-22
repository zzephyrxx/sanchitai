<script setup lang="ts">
import { computed } from 'vue';
import { EVENT_CATEGORY_COLORS } from '@/constants/sanchitai';
import { $t } from '@/locales';
import { useAppStore } from '@/store/modules/app';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'EventDetailDrawer' });

interface Props {
  show: boolean;
  event: Sct.CalEvent | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'edit', event: Sct.CalEvent): void;
  (e: 'delete', event: Sct.CalEvent): void;
}>();

const appStore = useAppStore();
const workStore = useWorkDataStore();
const isEn = computed(() => appStore.locale === 'en-US');

const show = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
});

/** 实时事件：支持单次事件与重复事项实例（含 overrides 改期/改时长） */
const event = computed(() => {
  if (!props.event) return null;
  const rawId = props.event.id;
  if (rawId.includes('-occ-')) {
    const [baseId, occDate] = rawId.split('-occ-');
    const base = workStore.calEvents.find(e => e.id === baseId);
    if (!base) return props.event;
    const override = (base.recurrence?.overrides ?? []).find(o => o.date === occDate) as
      | (Partial<Sct.CalEvent> & { date: string; new_date?: string })
      | undefined;
    const effectiveDate = typeof override?.new_date === 'string' && override.new_date ? override.new_date : occDate;
    return {
      ...base,
      ...override,
      id: rawId,
      date: effectiveDate
    };
  }
  const base = workStore.calEvents.find(e => e.id === rawId);
  return base ?? props.event;
});

const isRecurringInstance = computed(() => Boolean(props.event?.id.includes('-occ-')));
const statusType = computed<'success' | 'default' | 'info' | 'warning'>(() => {
  switch (event.value?.status) {
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

const ownerName = computed(() => (event.value?.owner ? workStore.memberName(event.value.owner) : ''));
const helperDisplay = computed(() => {
  const h = event.value?.helper;
  if (!h) return '';
  return h
    .split(/[、,，]/)
    .map(id => workStore.memberName(id.trim()))
    .filter(Boolean)
    .join('、');
});

async function setStatus(status: Sct.EventStatus) {
  const target = event.value;
  if (!target) return;
  await workStore.setEventStatus(target.id, status);
  window.$message?.success(`已标记为「${status}」`);
}

const deleteConfirmNote = computed(() => {
  if (!isRecurringInstance.value) return '';
  return isEn.value ? ' (Deletes entire recurring series)' : '（将删除整条重复规则）';
});

function handleDelete() {
  const target = event.value;
  if (!target) return;
  show.value = false;
  emit('delete', target);
}
</script>

<template>
  <NDrawer v-model:show="show" :width="420">
    <NDrawerContent v-if="event" :title="event.title" closable>
      <NAlert v-if="isRecurringInstance" type="info" :show-icon="true" class="mb-12px">
        这是重复事项的一个实例：拖拽改期或编辑仅更新本次实例，删除将移除整条重复规则。
      </NAlert>

      <NSpace vertical size="large">
        <div class="flex items-center gap-8px">
          <NTag
            :color="{
              color: EVENT_CATEGORY_COLORS[event.category]?.soft,
              textColor: EVENT_CATEGORY_COLORS[event.category]?.color
            }"
            :bordered="false"
            size="small"
          >
            {{ event.category }}
          </NTag>
          <NTag v-if="event.kind" size="small" :bordered="false">{{ event.kind }}</NTag>
          <NTag :type="statusType" size="small">{{ event.status }}</NTag>
          <NTag v-if="event.merged_into" size="small" type="info" :bordered="false">已并入其他会议</NTag>
        </div>

        <NDescriptions :column="1" size="small" label-placement="left" bordered>
          <NDescriptionsItem :label="isEn ? 'Date' : '日期'">{{ event.date }}</NDescriptionsItem>
          <NDescriptionsItem :label="isEn ? 'Time' : '时间'">
            {{
              event.start_time && event.start_time !== event.end_time
                ? `${event.start_time} - ${event.end_time}`
                : $t('sct.common.allDay')
            }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="isEn ? 'Location' : '地点'">{{ event.location || '—' }}</NDescriptionsItem>
          <NDescriptionsItem :label="$t('sct.common.owner')">{{ ownerName || '—' }}</NDescriptionsItem>
          <NDescriptionsItem :label="isEn ? 'Helper' : '协助人'">{{ helperDisplay || '—' }}</NDescriptionsItem>
          <NDescriptionsItem v-if="event.note" :label="isEn ? 'Note' : '备注'">{{ event.note }}</NDescriptionsItem>
        </NDescriptions>

        <div v-if="event.agenda?.length">
          <div class="mb-6px text-13px font-bold">{{ isEn ? 'Agenda' : '议程要点' }}</div>
          <ol class="ma-0 pl-20px text-13px leading-relaxed">
            <li v-for="(item, i) in event.agenda" :key="i">{{ item }}</li>
          </ol>
        </div>

        <div class="flex flex-wrap gap-8px">
          <NButton size="small" type="primary" ghost @click="emit('edit', event)">
            <template #icon><SvgIcon icon="lucide:pencil" /></template>
            {{ $t('common.edit') }}
          </NButton>
          <NButton v-if="event.status !== '已完成'" size="small" type="primary" @click="setStatus('已完成')">
            <template #icon><SvgIcon icon="lucide:check-circle-2" /></template>
            {{ $t('sct.calendar.markDone') }}
          </NButton>
          <NButton v-if="event.status !== '计划'" size="small" @click="setStatus('计划')">
            <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
            {{ isEn ? 'Restore Planned' : '恢复计划' }}
          </NButton>
          <NButton v-if="event.status !== '已取消'" size="small" @click="setStatus('已取消')">
            <template #icon><SvgIcon icon="lucide:ban" /></template>
            {{ isEn ? 'Cancel Event' : '取消事项' }}
          </NButton>
          <NPopconfirm :key="event.id" @positive-click="handleDelete">
            <template #trigger>
              <NButton size="small" type="error" ghost>
                <template #icon><SvgIcon icon="lucide:trash-2" /></template>
                {{ $t('common.delete') }}
              </NButton>
            </template>
            {{ $t('common.confirmDelete') }}{{ deleteConfirmNote }}
          </NPopconfirm>
        </div>
      </NSpace>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
