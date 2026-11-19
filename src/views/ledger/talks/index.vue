<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { useWorkDataStore } from '@/store/modules/work-data';

// NDatePicker 时间戳适配
function useDateAdapter(form: { date: string }) {
  return computed<number | null>({
    get: () => (form.date ? dayjs(form.date).valueOf() : null),
    set: v => {
      form.date = v ? dayjs(v).format('YYYY-MM-DD') : '';
    }
  });
}

defineOptions({ name: 'TalksPage' });

const workStore = useWorkDataStore();

const year = dayjs().format('YYYY');

const TALK_TYPES = ['日常谈话', '思想动态', '发展节点谈话', '积极分子培养谈话', '转正征求意见'];

/** 覆盖矩阵：每人今年最近一次谈话（A17） */
const coverage = computed(() =>
  workStore.members.map(m => {
    const talks = workStore.talks
      .filter(t => t.member_ids.includes(m.id) && t.date.startsWith(year))
      .sort((a, b) => b.date.localeCompare(a.date));
    return { member: m, talks, latest: talks[0] };
  })
);

const uncovered = computed(() => coverage.value.filter(c => !c.latest).map(c => c.member.name));

/** 未布点提醒：申请人递交 1 个月内须谈话 */
const applicantAlert = computed(() =>
  workStore.members
    .filter(m => m.type === '申请人' && m.key_dates?.applied_at)
    .filter(m => dayjs().diff(dayjs(m.key_dates!.applied_at!), 'day') <= 30)
    .filter(m => !workStore.talks.some(t => t.member_ids.includes(m.id) && t.date >= m.key_dates!.applied_at!))
    .map(m => `${m.name}（${m.key_dates!.applied_at} 递交申请书，1 个月内须安排谈话）`)
);

// ---------------- 记录列表 ----------------
const recordRows = computed(() => [...workStore.talks].sort((a, b) => b.date.localeCompare(a.date)));

const recordColumns = [
  { title: '日期', key: 'date', width: 100 },
  { title: '类型', key: 'type', width: 130 },
  {
    title: '对象',
    key: 'members',
    render: (r: any) => r.member_ids.map((id: string) => workStore.memberName(id)).join('、')
  },
  { title: '要点', key: 'content', ellipsis: { tooltip: true } },
  { title: '后续跟进', key: 'follow_up', width: 160, ellipsis: { tooltip: true }, render: (r: any) => r.follow_up || '—' }
];

// ---------------- 新建谈话（3 步：选人→类型→要点） ----------------
const addShow = ref(false);
const addForm = reactive({
  member_ids: [] as string[],
  type: '日常谈话',
  date: dayjs().format('YYYY-MM-DD'),
  location: '',
  content: '',
  follow_up: ''
});

const memberOptions = computed(() =>
  workStore.members.map(m => ({ label: `${m.name}（${m.type}）`, value: m.id }))
);

const dateTs = useDateAdapter(addForm);

async function handleAdd() {
  if (!addForm.member_ids.length) {
    window.$message?.warning('请选择谈话对象');
    return;
  }
  if (!addForm.content.trim()) {
    window.$message?.warning('请填写谈话要点');
    return;
  }
  await workStore.addTalk({
    date: addForm.date,
    location: addForm.location || undefined,
    type: addForm.type,
    member_ids: addForm.member_ids,
    initiator: 'DY01',
    recorder: 'DY01',
    content: addForm.content.trim(),
    follow_up: addForm.follow_up.trim() || undefined
  });
  window.$message?.success('谈话记录已入档，覆盖表已更新');
  addShow.value = false;
  Object.assign(addForm, { member_ids: [], type: '日常谈话', date: dayjs().format('YYYY-MM-DD'), location: '', content: '', follow_up: '' });
}
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">谈心谈话</span>
          <span class="text-12px text-gray-400">支委与党员每年 ≥1 次（条例第十九条）· {{ year }} 年覆盖 {{ coverage.filter(c => c.latest).length }}/{{ coverage.length }}</span>
        </div>
      </template>
      <template #header-extra>
        <NButton type="primary" size="small" @click="addShow = true">＋ 新建谈话</NButton>
      </template>

      <!-- 硬提醒 -->
      <NAlert v-if="applicantAlert.length" type="warning" class="mb-12px" :show-icon="true">
        <div v-for="a in applicantAlert" :key="a">{{ a }}</div>
      </NAlert>
      <NAlert v-if="uncovered.length" type="info" class="mb-12px" :show-icon="false">
        今年未覆盖（{{ uncovered.length }}）：{{ uncovered.join('、') }}
      </NAlert>

      <!-- 覆盖矩阵 -->
      <div class="mb-14px grid grid-cols-2 gap-8px md:grid-cols-3 lg:grid-cols-4">
        <div
          v-for="c in coverage"
          :key="c.member.id"
          class="rounded-8px px-10px py-8px"
          :style="{ background: c.latest ? 'var(--sct-ok-soft)' : 'var(--sct-soft)' }"
        >
          <div class="flex items-center justify-between">
            <span class="text-13px font-bold">{{ c.member.name }}</span>
            <NTag size="tiny" :bordered="false" :color="{ color: c.latest ? 'var(--sct-ok-soft)' : '#F1F2F4', textColor: c.latest ? '#3f9d63' : '#8a8f99' }">
              {{ c.latest ? '已覆盖' : '未覆盖' }}
            </NTag>
          </div>
          <div class="mt-2px text-11px text-gray-500">
            {{ c.latest ? `${c.latest.date} · ${c.latest.type}` : '今年尚未谈心谈话' }}
          </div>
        </div>
      </div>

      <NDataTable :columns="recordColumns" :data="recordRows" size="small" :bordered="false" :row-key="(r: any) => r.id" />
    </NCard>

    <!-- 新建谈话 -->
    <NModal v-model:show="addShow" preset="card" title="新建谈心谈话" class="w-560px">
      <NForm label-placement="left" label-width="76" size="small">
        <NFormItem label="谈话对象" required>
          <NSelect v-model:value="addForm.member_ids" :options="memberOptions" multiple filterable />
        </NFormItem>
        <NFormItem label="类型">
          <NSelect v-model:value="addForm.type" :options="TALK_TYPES.map(v => ({ label: v, value: v }))" tag filterable />
        </NFormItem>
        <NFormItem label="日期">
          <NDatePicker v-model:value="dateTs" type="date" class="w-full" />
        </NFormItem>
        <NFormItem label="地点"><NInput v-model:value="addForm.location" /></NFormItem>
        <NFormItem label="谈话要点" required>
          <NInput v-model:value="addForm.content" type="textarea" :rows="4" placeholder="要点：思想动态/困难诉求/反馈提醒…" />
        </NFormItem>
        <NFormItem label="后续跟进"><NInput v-model:value="addForm.follow_up" /></NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="addShow = false">取消</NButton>
          <NButton type="primary" @click="handleAdd">保存入档</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped></style>
