<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue';
import { NButton, NPopconfirm, NTag } from 'naive-ui';
import dayjs from 'dayjs';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSvgIcon } from '@/hooks/common/icon';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import { useTableColumnLayout } from '@/hooks/common/table-layout';

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

/** 覆盖矩阵仅统计预备党员与正式党员（单次 O(T) 建索引，避免 O(M×T) 嵌套扫描） */
const coverageFilter = ref<'all' | 'uncovered'>('all');
const showAllCoverage = ref(false);
const COVERAGE_INITIAL_LIMIT = 42;

const partyMembersForCoverage = computed(() =>
  workStore.members.filter(m => m.type === '正式党员' || m.type === '预备党员')
);

const latestYearTalkByMember = computed(() => {
  const map = new Map<string, Sct.Talk>();
  for (const t of workStore.talks) {
    if (!t.date.startsWith(year)) continue;
    for (const mid of t.member_ids) {
      const prev = map.get(mid);
      if (!prev || t.date > prev.date) {
        map.set(mid, t);
      }
    }
  }
  return map;
});

const latestAnyTalkDateByMember = computed(() => {
  const map = new Map<string, string>();
  for (const t of workStore.talks) {
    for (const mid of t.member_ids) {
      const prev = map.get(mid);
      if (!prev || t.date > prev) {
        map.set(mid, t.date);
      }
    }
  }
  return map;
});

/** 覆盖矩阵：仅覆盖预备/正式党员，每人今年最近一次谈话（A17） */
const coverage = computed(() => {
  const idxMap = latestYearTalkByMember.value;
  return partyMembersForCoverage.value.map(m => ({
    member: m,
    latest: idxMap.get(m.id)
  }));
});

const coveredCount = computed(() => coverage.value.filter(c => Boolean(c.latest)).length);
const uncovered = computed(() => coverage.value.filter(c => !c.latest).map(c => c.member.name));

const visibleCoverage = computed(() => {
  const base = coverageFilter.value === 'uncovered' ? coverage.value.filter(c => !c.latest) : coverage.value;
  if (showAllCoverage.value || base.length <= COVERAGE_INITIAL_LIMIT) return base;
  return base.slice(0, COVERAGE_INITIAL_LIMIT);
});

const hiddenCoverageCount = computed(() => {
  const total = coverageFilter.value === 'uncovered' ? uncovered.value.length : coverage.value.length;
  return Math.max(0, total - visibleCoverage.value.length);
});

/** 未布点提醒：申请人递交 1 个月内须谈话（O(M) 查表） */
const applicantAlert = computed(() => {
  const today = dayjs();
  const latestMap = latestAnyTalkDateByMember.value;
  const list: string[] = [];
  for (const m of workStore.members) {
    if (m.type !== '申请人' || !m.key_dates?.applied_at) continue;
    if (today.diff(dayjs(m.key_dates.applied_at), 'day') > 30) continue;
    const lastTalkDate = latestMap.get(m.id);
    if (!lastTalkDate || lastTalkDate < m.key_dates.applied_at) {
      list.push(`${m.name}（${m.key_dates.applied_at} 递交申请书，1 个月内须安排谈话）`);
    }
  }
  return list;
});

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

const TALK_COL_ORDER = ['date', 'type', 'members', 'content', 'follow_up', 'op'] as const;

const talkColumnMap = computed(() => ({
  date: {
    key: 'date',
    defaultWidth: 118,
    minWidth: 90,
    titleContent: () => colHeader('lucide:calendar', bi('日期', 'Date')),
    sorter: (a: Sct.Talk, b: Sct.Talk) => a.date.localeCompare(b.date)
  },
  type: {
    key: 'type',
    defaultWidth: 140,
    minWidth: 96,
    titleContent: () => colHeader('lucide:tag', bi('类型', 'Type')),
    sorter: (a: Sct.Talk, b: Sct.Talk) => a.type.localeCompare(b.type),
    render: (r: Sct.Talk) => h(NTag, { size: 'tiny', bordered: false }, () => r.type)
  },
  members: {
    key: 'members',
    defaultWidth: 155,
    minWidth: 96,
    titleContent: () => colHeader('lucide:users', bi('对象', 'Participants')),
    render: (r: Sct.Talk) => r.member_ids.map((id: string) => workStore.memberName(id)).join('、')
  },
  content: {
    key: 'content',
    defaultWidth: 260,
    minWidth: 140,
    ellipsis: { tooltip: true },
    titleContent: () => colHeader('lucide:message-square-text', bi('要点', 'Key Points'))
  },
  follow_up: {
    key: 'follow_up',
    defaultWidth: 165,
    minWidth: 100,
    ellipsis: { tooltip: true },
    titleContent: () => colHeader('lucide:check-square', bi('后续跟进', 'Follow-up')),
    render: (r: Sct.Talk) => r.follow_up || '—'
  },
  op: {
    key: 'op',
    defaultWidth: 150,
    fixed: 'right' as const,
    resizable: false,
    reorderable: false,
    titleContent: () => colHeader('lucide:sliders-horizontal', bi('操作', 'Actions')),
    render: (r: Sct.Talk) =>
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
}));

const {
  columns: recordColumns,
  scrollX: talkScrollX,
  hasCustomLayout: hasCustomTalkLayout,
  resetLayout: resetTalkLayout
} = useTableColumnLayout<Sct.Talk>({
  storageKey: 'talks',
  defaultOrder: TALK_COL_ORDER,
  pinnedEndKeys: ['op'],
  columnMap: talkColumnMap,
  minTableWidth: 820
});

function handleResetTalkLayout() {
  resetTalkLayout();
  window.$message?.success('谈心谈话表列宽与列顺序已重置');
}

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

/** 点击覆盖矩阵中的党员卡片：直接弹出新建谈心谈话弹窗并预填该党员 */
function openQuickCreateForMember(member: Sct.Member) {
  editingTalkId.value = null;
  Object.assign(addForm, {
    member_ids: [member.id],
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

const memberOptions = computed(() => workStore.members.map(m => ({ label: `${m.name}（${m.type}）`, value: m.id })));

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
        <div class="flex flex-wrap items-center gap-12px">
          <span class="text-16px font-bold">{{ bi('谈心谈话', 'Heart-to-Heart Talks') }}</span>
          <span class="text-12px text-gray-400">
            {{
              bi(
                `仅覆盖预备/正式党员（条例第十九条）· ${year} 年覆盖 ${coveredCount}/${coverage.length}`,
                `Probationary & Full Members only (Art. 19) · ${year} Covered ${coveredCount}/${coverage.length}`
              )
            }}
          </span>
        </div>
      </template>
      <template #header-extra>
        <div class="flex items-center gap-8px">
          <NRadioGroup v-model:value="coverageFilter" size="small">
            <NRadioButton value="all">全部党员（{{ coverage.length }}）</NRadioButton>
            <NRadioButton value="uncovered">未覆盖（{{ uncovered.length }}）</NRadioButton>
          </NRadioGroup>
          <NButton type="primary" size="small" @click="openCreate">
            <template #icon><SvgIcon icon="lucide:message-square-plus" /></template>
            {{ bi('新建谈话', 'New Talk Record') }}
          </NButton>
        </div>
      </template>

      <!-- 硬提醒 -->
      <NAlert v-if="applicantAlert.length" type="warning" class="mb-12px" :show-icon="true">
        <div v-for="a in applicantAlert" :key="a">{{ a }}</div>
      </NAlert>
      <NAlert v-if="uncovered.length" type="info" class="mb-12px" :show-icon="false">
        {{ bi(`今年未覆盖预备/正式党员（${uncovered.length}）`, `Uncovered party members (${uncovered.length})`) }}：{{
          uncovered.slice(0, 30).join('、')
        }}{{ uncovered.length > 30 ? ` 等 ${uncovered.length} 人` : '' }}
      </NAlert>

      <!-- 覆盖矩阵（仅覆盖预备/正式党员，大样本下支持按需展开防卡顿） -->
      <div class="talks-coverage-wrap mb-14px" :class="{ 'talks-coverage-wrap--scroll': visibleCoverage.length > 35 }">
        <div class="grid grid-cols-2 gap-8px sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
          <div
            v-for="c in visibleCoverage"
            :key="c.member.id"
            class="group flex cursor-pointer items-center gap-7px rounded-8px border border-transparent px-8px py-7px transition hover:border-[#A81C24] hover:shadow-xs"
            :style="{ background: c.latest ? 'var(--sct-ok-soft)' : 'var(--sct-soft)' }"
            :title="
              bi(`点击为「${c.member.name}」新建谈心谈话记录`, `Click to record a new talk with ${c.member.name}`)
            "
            @click="openQuickCreateForMember(c.member)"
          >
            <IconSolarUserRoundedBoldDuotone
              class="shrink-0 text-20px"
              :style="{ color: c.latest ? '#3f9d63' : '#94a3b8' }"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-4px">
                <span class="truncate text-13px font-bold group-hover:text-[#A81C24]">{{ c.member.name }}</span>
                <span
                  class="inline-flex shrink-0 items-center gap-2px text-11px font-medium"
                  :style="{ color: c.latest ? '#3f9d63' : '#8a8f99' }"
                >
                  <SvgIcon
                    :icon="c.latest ? 'lucide:message-circle-check' : 'lucide:message-circle-plus'"
                    class="text-13px"
                  />
                  <span class="group-hover:hidden">{{ c.latest ? bi('已覆盖', 'Done') : bi('未覆盖', 'None') }}</span>
                  <span class="hidden text-[#A81C24] font-bold group-hover:inline">{{ bi('+谈话', '+Talk') }}</span>
                </span>
              </div>
              <div
                class="mt-2px truncate text-11px text-gray-500"
                :title="c.latest ? `${c.latest.date} · ${c.latest.type}` : ''"
              >
                {{ c.latest ? `${c.latest.date} · ${c.latest.type}` : bi('点击登记谈话', 'Click to add talk') }}
              </div>
            </div>
          </div>
        </div>
        <div v-if="hiddenCoverageCount > 0" class="mt-8px flex justify-center">
          <NButton size="tiny" dashed @click="showAllCoverage = true">
            展开其余 {{ hiddenCoverageCount }} 名党员
          </NButton>
        </div>
      </div>

      <div class="mb-10px flex flex-wrap items-center justify-between gap-10px">
        <div class="flex flex-nowrap items-center gap-8px">
          <div class="w-240px shrink-0">
            <NInput
              v-model:value="searchKeyword"
              size="small"
              clearable
              :placeholder="bi('搜索谈话对象、类型、要点或后续跟进…', 'Search participant, type, key points…')"
              @update:value="pagination.page = 1"
            >
              <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
            </NInput>
          </div>
          <NButton
            size="small"
            secondary
            class="shrink-0"
            :disabled="!hasCustomTalkLayout"
            @click="handleResetTalkLayout"
          >
            <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
            {{ bi('重置列宽', 'Reset Columns') }}
          </NButton>
        </div>
        <span class="text-12px text-gray-400">
          {{ bi('拖拽表头可换列顺序 · 共 ', 'Drag headers to reorder · Total ') }}{{ recordRows.length
          }}{{ bi(' 条记录', ' records') }}
        </span>
      </div>

      <NDataTable
        :columns="recordColumns"
        :data="recordRows"
        :pagination="pagination"
        size="small"
        :bordered="false"
        :scroll-x="talkScrollX"
        :row-key="(r: Sct.Talk) => r.id"
      />
    </NCard>

    <!-- 新建 / 编辑谈话（label-width="112" 带图标防折行） -->
    <NModal
      v-model:show="addShow"
      preset="card"
      :title="editingTalkId ? '编辑谈心谈话' : '新建谈心谈话'"
      class="w-580px"
    >
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
          <NSelect
            v-model:value="addForm.type"
            :options="TALK_TYPES.map(v => ({ label: v, value: v }))"
            tag
            filterable
          />
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
          <NInput
            v-model:value="addForm.content"
            type="textarea"
            :rows="4"
            placeholder="要点：思想动态/困难诉求/反馈提醒…"
          />
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

<style scoped>
.talks-coverage-wrap--scroll {
  max-height: 320px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 2px 8px 2px 0;
}

.talks-coverage-wrap--scroll::-webkit-scrollbar {
  width: 5px;
}

.talks-coverage-wrap--scroll::-webkit-scrollbar-track {
  background: transparent;
}

.talks-coverage-wrap--scroll::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.35);
  border-radius: 999px;
}
</style>
