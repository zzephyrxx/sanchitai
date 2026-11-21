<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import dayjs from 'dayjs';
import { useWorkDataStore } from '@/store/modules/work-data';
import { EVENT_CATEGORY_OPTIONS } from '@/constants/sanchitai';

defineOptions({ name: 'EventEditModal' });

interface Props {
  show: boolean;
  /** 编辑模式传入完整事件 */
  event: Sct.CalEvent | null;
  /** 新建模式预填 */
  preset: { date: string; start_time: string; end_time: string } | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'saved', id: string): void;
}>();

const workStore = useWorkDataStore();

const KIND_OPTIONS = [
  '支委会',
  '党员大会',
  '党小组会',
  '党课',
  '主题党日',
  '组织生活会',
  '民主评议',
  '书记例会',
  '集中培训',
  '发展节点',
  '材料节点',
  '日常事务',
  '其他'
].map(v => ({ label: v, value: v }));

const form = reactive({
  title: '',
  category: '组织生活' as Sct.EventCategory,
  kind: '其他',
  date: '',
  start_time: '14:00',
  end_time: '16:00',
  location: '',
  owner: '',
  helper: '',
  agenda: [] as string[],
  note: ''
});

const isEdit = computed(() => Boolean(props.event));
const show = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
});

watch(
  () => props.show,
  visible => {
    if (!visible) return;
    if (props.event) {
      Object.assign(form, {
        title: props.event.title,
        category: props.event.category,
        kind: props.event.kind ?? '其他',
        date: props.event.date,
        start_time: props.event.start_time || '',
        end_time: props.event.end_time || '',
        location: props.event.location ?? '',
        owner: props.event.owner ?? '',
        helper: props.event.helper ?? '',
        agenda: [...(props.event.agenda ?? [])],
        note: props.event.note ?? ''
      });
    } else if (props.preset) {
      Object.assign(form, {
        title: '',
        category: '组织生活',
        kind: '其他',
        date: props.preset.date,
        start_time: props.preset.start_time,
        end_time: props.preset.end_time,
        location: '',
        owner: '',
        helper: '',
        agenda: [],
        note: ''
      });
    }
  }
);

const memberOptions = computed(() =>
  workStore.members.map(m => ({
    label: `${m.name}（${m.type}${m.role ? ` · ${m.role}` : ''}）`,
    value: m.id
  }))
);

const dateTs = computed<number | null>({
  get: () => (form.date ? dayjs(form.date).valueOf() : null),
  set: v => {
    form.date = v ? dayjs(v).format('YYYY-MM-DD') : '';
  }
});

function timeStringToTs(s: string): number | null {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

const startTs = computed<number | null>({
  get: () => timeStringToTs(form.start_time),
  set: v => {
    form.start_time = v != null ? dayjs(v).format('HH:mm') : '';
  }
});

const endTs = computed<number | null>({
  get: () => timeStringToTs(form.end_time),
  set: v => {
    form.end_time = v != null ? dayjs(v).format('HH:mm') : '';
  }
});

const ownerOptions = computed(() => [{ label: '无', value: '' }, ...memberOptions.value]);

async function handleSave() {
  if (!form.title.trim()) {
    window.$message?.warning('请填写事项标题');
    return;
  }
  if (!form.date) {
    window.$message?.warning('请选择日期');
    return;
  }

  const payload: Partial<Sct.CalEvent> = {
    title: form.title.trim(),
    category: form.category,
    kind: form.kind,
    date: form.date,
    start_time: form.start_time,
    end_time: form.end_time,
    location: form.location.trim() || undefined,
    owner: form.owner || undefined,
    helper: form.helper || undefined,
    agenda: form.agenda.filter(Boolean).length ? form.agenda.filter(Boolean) : undefined,
    note: form.note.trim() || undefined
  };

  if (isEdit.value && props.event) {
    await workStore.updateEvent(props.event.id, payload);
    window.$message?.success('事项已更新');
    emit('saved', props.event.id);
  } else {
    const id = await workStore.addEvent(
      payload as Partial<Sct.CalEvent> & Pick<Sct.CalEvent, 'title' | 'date' | 'category'>
    );
    window.$message?.success('事项已加入台历');
    emit('saved', id);
  }
  show.value = false;
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    :title="isEdit ? '编辑事项' : '新建事项'"
    class="w-600px"
    :mask-closable="false"
  >
    <NForm label-placement="left" label-width="112" size="small">
      <NFormItem required>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:type" class="sct-field-icon" />
            <span>标题</span>
          </span>
        </template>
        <NInput v-model:value="form.title" placeholder="如：周三支委会 / 交党员信息统计表" />
      </NFormItem>
      <NFormItem required>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:layers" class="sct-field-icon" />
            <span>日程类型</span>
          </span>
        </template>
        <NSelect v-model:value="form.category" :options="EVENT_CATEGORY_OPTIONS" />
      </NFormItem>
      <NFormItem>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:tag" class="sct-field-icon" />
            <span>细分类型</span>
          </span>
        </template>
        <NSelect v-model:value="form.kind" :options="KIND_OPTIONS" tag filterable />
      </NFormItem>
      <NFormItem required>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:calendar" class="sct-field-icon" />
            <span>日期</span>
          </span>
        </template>
        <NDatePicker v-model:value="dateTs" type="date" class="w-full" :clearable="false" />
      </NFormItem>
      <NFormItem>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:clock" class="sct-field-icon" />
            <span>时间</span>
          </span>
        </template>
        <div class="w-full flex items-center gap-8px">
          <NTimePicker v-model:value="startTs" format="HH:mm" class="flex-1" />
          <span class="text-gray-400">至</span>
          <NTimePicker v-model:value="endTs" format="HH:mm" class="flex-1" />
        </div>
      </NFormItem>
      <NFormItem>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:map-pin" class="sct-field-icon" />
            <span>地点</span>
          </span>
        </template>
        <NInput v-model:value="form.location" placeholder="如：教六1115 / 线上" />
      </NFormItem>
      <NFormItem>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:user-check" class="sct-field-icon" />
            <span>主责人</span>
          </span>
        </template>
        <NSelect v-model:value="form.owner" :options="ownerOptions" filterable clearable />
      </NFormItem>
      <NFormItem>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:users" class="sct-field-icon" />
            <span>协助人</span>
          </span>
        </template>
        <NSelect v-model:value="form.helper" :options="ownerOptions" filterable clearable />
      </NFormItem>
      <NFormItem>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:list-ordered" class="sct-field-icon" />
            <span>议程要点</span>
          </span>
        </template>
        <NDynamicInput v-model:value="form.agenda" placeholder="议程/要点，逐条添加" />
      </NFormItem>
      <NFormItem>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:file-text" class="sct-field-icon" />
            <span>备注</span>
          </span>
        </template>
        <NInput
          v-model:value="form.note"
          type="textarea"
          :rows="2"
          placeholder="备注（如：固定时间会议，不受每月≤3次约束）"
        />
      </NFormItem>
    </NForm>
    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton @click="show = false">取消</NButton>
        <NButton type="primary" @click="handleSave">
          <template #icon><SvgIcon icon="lucide:check" /></template>
          保存
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
