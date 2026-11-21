<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { NButton, NPopconfirm, NTag } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSvgIcon } from '@/hooks/common/icon';
import { useSctI18n } from '@/hooks/common/sct-i18n';

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
const { SvgIconVNode } = useSvgIcon();
const { bi } = useSctI18n();

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

// ---------------- 记录列表（支持搜索、分页、列宽拖拽、排序、图标表头） ----------------
const searchKeyword = ref('');
const pagination = reactive({
  page: 1,
  pageSize: 10,
  showSizePicker: true,
  pageSizes: [10, 15, 25, 50],
  onChange: (page: number) => {
    pagination.page = page;
  },
  onUpdatePageSize: (pageSize: number) => {
    pagination.pageSize = pageSize;
    pagination.page = 1;
  }
});

const recordRows = computed<Sct.Talk[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  return [...workStore.talks]
    .filter(t => {
      if (!kw) return true;
      const memberNames = t.member_ids.map(id => workStore.memberName(id)).join(' ');
      return [t.date, t.type, t.content, t.follow_up, t.location, memberNames]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(kw));
    })
    .sort((a, b) => b.date.localeCompare(a.date));
});

function colHeader(icon: string, text: string) {
  return h('span', { class: 'inline-flex items-center gap-4px whitespace-nowrap' }, [
    SvgIconVNode({ icon, fontSize: 13 })?.(),
    h('span', text)
  ]);
}

const recordColumns = computed<DataTableColumns<Sct.Talk>>(() => [
  {
    title: () => colHeader('lucide:calendar', bi('日期', 'Date')),
    key: 'date',
    width: 115,
    resizable: true,
    sorter: (a, b) => a.date.localeCompare(b.date)
  },
  {
    title: () => colHeader('lucide:tag', bi('类型', 'Type')),
    key: 'type',
    width: 140,
    resizable: true,
    sorter: (a, b) => a.type.localeCompare(b.type),
    render: r => h(NTag, { size: 'tiny', bordered: false }, () => r.type)
  },
  {
    title: () => colHeader('lucide:users', bi('对象', 'Participants')),
    key: 'members',
    width: 150,
    resizable: true,
    render: r => r.member_ids.map((id: string) => workStore.memberName(id)).join('、')
  },
  {
    title: () => colHeader('lucide:message-square-text', bi('要点', 'Key Points')),
    key: 'content',
    minWidth: 200,
    resizable: true,
    ellipsis: { tooltip: true }
  },
  {
    title: () => colHeader('lucide:check-square', bi('后续跟进', 'Follow-up')),
    key: 'follow_up',
    width: 160,
    resizable: true,
    ellipsis: { tooltip: true },
    render: r => r.follow_up || '—'
  },
  {
    title: () => colHeader('lucide:sliders-horizontal', bi('操作', 'Actions')),
    key: 'op',
    width: 150,
    render: r =>
      h('div', { class: 'flex items-center gap-6px' }, [
        h(
          NButton,
          {
            size: 'tiny',
            secondary: true,
            type: 'primary',
            onClick: () => openEdit(r)
          },
          {
            icon: SvgIconVNode({ icon: 'lucide:pencil', fontSize: 13 }),
            default: () => bi('编辑', 'Edit')
          }
        ),
        h(
          NPopconfirm,
          { onPositiveClick: () => removeTalk(r.id) },
          {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'tiny',
                  secondary: true,
                  type: 'error'
                },
                {
                  icon: SvgIconVNode({ icon: 'lucide:trash-2', fontSize: 13 }),
                  default: () => bi('删除', 'Delete')
                }
              ),
            default: () => bi('确认删除该条谈心谈话记录？', 'Delete this talk record?')
          }
        )
      ])
  }
]);

// ---------------- 新建 / 编辑谈话 ----------------
const addShow = ref(false);
const editingTalkId = ref<string | null>(null);
const addForm = reactive({
  member_ids: [] as string[],
  type: '日常谈话',
  date: dayjs().format('YYYY-MM-DD'),
  location: '',
  content: '',
  follow_up: ''
});

function openCreate() {
  editingTalkId.value = null;
  Object.assign(addForm, {
    member_ids: [],
    type: '日常谈话',
    date: dayjs().format('YYYY-MM-DD'),
    location: '',
    content: '',
    follow_up: ''
  });
  addShow.value = true;
}

function openEdit(row: Sct.Talk) {
  editingTalkId.value = row.id;
  Object.assign(addForm, {
    member_ids: [...row.member_ids],
    type: row.type,
    date: row.date,
    location: row.location ?? '',
    content: row.content,
    follow_up: row.follow_up ?? ''
  });
  addShow.value = true;
}

async function removeTalk(id: string) {
  await workStore.deleteTalk(id);
  window.$message?.success('谈话记录已删除');
}

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
    id: editingTalkId.value ?? undefined,
    date: addForm.date,
    location: addForm.location || undefined,
    type: addForm.type,
    member_ids: addForm.member_ids,
    initiator: 'DY01',
    recorder: 'DY01',
    content: addForm.content.trim(),
    follow_up: addForm.follow_up.trim() || undefined
  });
  window.$message?.success(editingTalkId.value ? '谈话记录已更新' : '谈话记录已入档，覆盖表已更新');
  addShow.value = false;
  editingTalkId.value = null;
}
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">{{ bi('谈心谈话', 'Heart-to-Heart Talks') }}</span>
          <span class="text-12px text-gray-400">
            {{
              bi(
                `支委与党员每年 ≥1 次（条例第十九条）· ${year} 年覆盖 ${coverage.filter(c => c.latest).length}/${coverage.length}`,
                `≥1 talk per member annually (Art. 19) · ${year} Covered ${coverage.filter(c => c.latest).length}/${coverage.length}`
              )
            }}
          </span>
        </div>
      </template>
      <template #header-extra>
        <NButton type="primary" size="small" @click="openCreate">
          <template #icon><SvgIcon icon="lucide:message-square-plus" /></template>
          {{ bi('新建谈话', 'New Talk Record') }}
        </NButton>
      </template>

      <!-- 硬提醒 -->
      <NAlert v-if="applicantAlert.length" type="warning" class="mb-12px" :show-icon="true">
        <div v-for="a in applicantAlert" :key="a">{{ a }}</div>
      </NAlert>
      <NAlert v-if="uncovered.length" type="info" class="mb-12px" :show-icon="false">
        {{ bi(`今年未覆盖（${uncovered.length}）`, `Uncovered this year (${uncovered.length})`) }}：{{ uncovered.join('、') }}
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
            <NTag
              size="tiny"
              :bordered="false"
              :color="{
                color: c.latest ? 'var(--sct-ok-soft)' : 'var(--sct-soft)',
                textColor: c.latest ? '#3f9d63' : '#8a8f99'
              }"
            >
              {{ c.latest ? bi('已覆盖', 'Covered') : bi('未覆盖', 'Uncovered') }}
            </NTag>
          </div>
          <div class="mt-2px text-11px text-gray-500">
            {{ c.latest ? `${c.latest.date} · ${c.latest.type}` : bi('今年尚未谈心谈话', 'No talk recorded this year') }}
          </div>
        </div>
      </div>

      <div class="mb-10px flex flex-wrap items-center justify-between gap-10px">
        <NInput
          v-model:value="searchKeyword"
          size="small"
          clearable
          class="w-260px"
          :placeholder="bi('搜索谈话对象、类型、要点或后续跟进…', 'Search participant, type, key points…')"
          @update:value="pagination.page = 1"
        >
          <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
        </NInput>
        <span class="text-12px text-gray-400">
          {{ bi('支持拖拽列宽与排序 · 共 ', 'Resizable & sortable · Total ') }}{{ recordRows.length }}{{ bi(' 条记录', ' records') }}
        </span>
      </div>

      <NDataTable
        :columns="recordColumns"
        :data="recordRows"
        :pagination="pagination"
        size="small"
        :bordered="false"
        :row-key="(r: Sct.Talk) => r.id"
      />
    </NCard>

    <!-- 新建 / 编辑谈话（label-width="112" 带图标防折行） -->
    <NModal v-model:show="addShow" preset="card" :title="editingTalkId ? '编辑谈心谈话' : '新建谈心谈话'" class="w-580px">
      <NForm label-placement="left" label-width="112" size="small">
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:users" class="sct-field-icon" />
              <span>谈话对象</span>
            </span>
          </template>
          <NSelect v-model:value="addForm.member_ids" :options="memberOptions" multiple filterable />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:tag" class="sct-field-icon" />
              <span>类型</span>
            </span>
          </template>
          <NSelect v-model:value="addForm.type" :options="TALK_TYPES.map(v => ({ label: v, value: v }))" tag filterable />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:calendar" class="sct-field-icon" />
              <span>日期</span>
            </span>
          </template>
          <NDatePicker v-model:value="dateTs" type="date" class="w-full" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:map-pin" class="sct-field-icon" />
              <span>地点</span>
            </span>
          </template>
          <NInput v-model:value="addForm.location" />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:message-square-text" class="sct-field-icon" />
              <span>谈话要点</span>
            </span>
          </template>
          <NInput v-model:value="addForm.content" type="textarea" :rows="4" placeholder="要点：思想动态/困难诉求/反馈提醒…" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:check-square" class="sct-field-icon" />
              <span>后续跟进</span>
            </span>
          </template>
          <NInput v-model:value="addForm.follow_up" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="addShow = false">取消</NButton>
          <NButton type="primary" @click="handleAdd">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            保存入档
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped></style>
