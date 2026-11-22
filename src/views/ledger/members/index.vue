<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue';
import { NButton, NPopconfirm, NTag } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import dayjs from 'dayjs';
import { FEE_STANDARD, MEMBER_TYPE_COLORS, MEMBER_TYPE_ORDER } from '@/constants/sanchitai';
import {
  computeDefaultFullDate,
  describePartyStatusRule,
  isPartyStatusAutoComputed,
  resolveEffectiveFullDate,
  resolveMemberTypeByDates
} from '@/utils/member-status';
import { buildSeatSheet, printHtml } from '@/utils/print';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSvgIcon } from '@/hooks/common/icon';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import MemberCard from './modules/member-card.vue';
import RosterBoard from './modules/roster-board.vue';

defineOptions({ name: 'MembersPage' });

const workStore = useWorkDataStore();
const { SvgIconVNode } = useSvgIcon();
const { bi, tMemberType, tFeeCategory, tFeeStatus } = useSctI18n();

// ---------------- 视图与布区 ----------------
const activeTab = ref<'roster' | 'list'>('roster');
const activeMapId = ref('');
// seatMaps 为 liveQuery 异步填充：默认选中第一张图
watch(
  () => workStore.seatMaps,
  maps => {
    if (maps.length && !maps.some(m => m.map_id === activeMapId.value)) {
      activeMapId.value = maps[0].map_id;
    }
  },
  { immediate: true }
);
const activeMap = computed(() => workStore.seatMaps.find(m => m.map_id === activeMapId.value) ?? workStore.seatMaps[0]);
const editable = ref(false);

// ---------------- 欠缴角标 ----------------
const feeBadges = computed(() => {
  const bad = new Set(workStore.feeRecords.filter(f => f.status === '欠缴').map(f => f.member_id));
  const map: Record<string, boolean> = {};
  bad.forEach(id => (map[id] = true));
  return map;
});

// ---------------- 座位操作（含撤销快照） ----------------
interface SeatSnapshot {
  id: string;
  seat: Sct.SeatPos | null;
}
const undoStack = ref<SeatSnapshot[][]>([]);

function snapshotSeats(): SeatSnapshot[] {
  return workStore.members.map(m => ({ id: m.id, seat: m.seat ? { ...m.seat } : null }));
}

function handleMove({
  memberId,
  from,
  to
}: {
  memberId: string;
  from: { x: number; y: number } | null;
  to: { x: number; y: number };
}) {
  undoStack.value.push(snapshotSeats());

  const mover = workStore.memberOf(memberId);
  if (!mover) return;
  const target = workStore.members.find(
    m => m.seat && m.seat.map_id === activeMapId.value && m.seat.x === to.x && m.seat.y === to.y && m.id !== memberId
  );

  const mapId = activeMapId.value;
  const tasks: Array<Promise<unknown>> = [];
  if (target) {
    tasks.push(
      workStore.updateMember(target.id, {
        seat: from ? { map_id: mapId, x: from.x, y: from.y } : (target.seat ?? null)
      })
    );
    tasks.push(workStore.updateMember(mover.id, { seat: { map_id: mapId, x: to.x, y: to.y } }));
  } else {
    tasks.push(workStore.updateMember(mover.id, { seat: { map_id: mapId, x: to.x, y: to.y } }));
  }
  Promise.all(tasks).then(() => window.$message?.success('布点已更新'));
}

function handleUndo() {
  const snap = undoStack.value.pop();
  if (!snap) {
    window.$message?.info('没有可撤销的操作');
    return;
  }
  Promise.all(snap.map(s => workStore.updateMember(s.id, { seat: s.seat }))).then(() =>
    window.$message?.success('已撤销')
  );
}

/** 打印座次/工位表 */
function printSeatMap() {
  if (!activeMap.value) return;
  const cells = workStore.members
    .filter(m => m.seat?.map_id === activeMapId.value)
    .map(m => ({ x: m.seat!.x, y: m.seat!.y, name: m.name, sub: `${m.type}${m.role ? `·${m.role}` : ''}` }));
  printHtml(
    activeMap.value.name,
    buildSeatSheet({
      title: activeMap.value.name,
      meta: `共 ${cells.length} 人在位`,
      cols: activeMap.value.grid.cols,
      rows: activeMap.value.grid.rows,
      cells
    })
  );
}

const statsText = computed(() => {
  const inMap = workStore.members.filter(m => m.seat?.map_id === activeMapId.value);
  const unseated = workStore.members.filter(m => !m.seat);
  const typeCount = MEMBER_TYPE_ORDER.map(
    t => `${tMemberType(t)} ${workStore.members.filter(m => m.type === t).length}`
  ).join(' · ');
  const capacity = activeMap.value ? activeMap.value.grid.cols * activeMap.value.grid.rows : 0;
  return bi(
    `在座 ${inMap.length}/${capacity} · 未入座 ${unseated.length} ｜ ${typeCount}`,
    `Seated ${inMap.length}/${capacity} · Unseated ${unseated.length} ｜ ${typeCount}`
  );
});

// ---------------- 人员卡 ----------------
const cardShow = ref(false);
const cardMemberId = ref<string | null>(null);
function openCard(memberId: string) {
  cardMemberId.value = memberId;
  cardShow.value = true;
}

// ---------------- 空位安排成员 ----------------
const pickerShow = ref(false);
const pickerPos = ref<{ x: number; y: number } | null>(null);
const unseatedOptions = computed(() =>
  workStore.members.filter(m => !m.seat).map(m => ({ label: `${m.name}（${m.type}）`, value: m.id }))
);
function openPicker(pos: { x: number; y: number }) {
  pickerPos.value = pos;
  pickerShow.value = true;
}
function handlePlace(memberId: string | null) {
  if (!memberId || !pickerPos.value) return;
  handleMove({ memberId, from: null, to: pickerPos.value });
  pickerShow.value = false;
}

// ---------------- 成员列表（支持拖拽列宽、排序、搜索、分页与图标表头） ----------------
const typeFilter = ref<string>('');
const searchKeyword = ref<string>('');
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

type MemberRow = Sct.Member & {
  stage?: Sct.DevStage;
  latestFee?: Sct.FeeRecord;
};

const listRows = computed<MemberRow[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  return workStore.members
    .filter(m => !typeFilter.value || m.type === typeFilter.value)
    .filter(m => {
      if (!kw) return true;
      return [m.code, m.name, m.type, m.role, m.group, m.grade, m.major, m.advisor]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(kw));
    })
    .map(m => {
      const stage = workStore.devStages.find(d => d.member_id === m.id);
      const latestFee = [...workStore.feeRecords]
        .filter(f => f.member_id === m.id)
        .sort((a, b) => b.year_month.localeCompare(a.year_month))[0];
      return { ...m, stage, latestFee };
    });
});

function colHeader(icon: string, text: string) {
  return h('span', { class: 'inline-flex items-center gap-4px whitespace-nowrap' }, [
    SvgIconVNode({ icon, fontSize: 13 })?.(),
    h('span', text)
  ]);
}

const listColumns = computed<DataTableColumns<MemberRow>>(() => [
  {
    title: () => colHeader('lucide:hash', bi('编号', 'Code')),
    key: 'code',
    width: 90,
    resizable: true,
    sorter: (a, b) => a.code.localeCompare(b.code)
  },
  {
    title: () => colHeader('lucide:user', bi('姓名', 'Name')),
    key: 'name',
    width: 105,
    resizable: true,
    sorter: (a, b) => a.name.localeCompare(b.name)
  },
  {
    title: () => colHeader('lucide:award', bi('类型', 'Type')),
    key: 'type',
    width: 125,
    resizable: true,
    sorter: (a, b) => MEMBER_TYPE_ORDER.indexOf(a.type) - MEMBER_TYPE_ORDER.indexOf(b.type),
    render: row =>
      h('span', { class: 'inline-flex items-center gap-5px' }, [
        h('span', { class: 'inline-block size-8px rounded-full', style: { background: MEMBER_TYPE_COLORS[row.type] } }),
        tMemberType(row.type)
      ])
  },
  {
    title: () => colHeader('lucide:shield', bi('角色', 'Role')),
    key: 'role',
    width: 100,
    resizable: true,
    sorter: (a, b) => (a.role ?? '').localeCompare(b.role ?? ''),
    render: row => row.role || '—'
  },
  {
    title: () => colHeader('lucide:network', bi('研究方向组', 'Group')),
    key: 'group',
    width: 125,
    resizable: true,
    sorter: (a, b) => (a.group ?? '').localeCompare(b.group ?? ''),
    render: row => row.group || '—'
  },
  {
    title: () => colHeader('lucide:graduation-cap', bi('年级', 'Grade')),
    key: 'grade',
    width: 95,
    resizable: true,
    sorter: (a, b) => (a.grade ?? '').localeCompare(b.grade ?? '')
  },
  {
    title: () => colHeader('lucide:git-branch', bi('发展阶段', 'Stage')),
    key: 'stage',
    width: 120,
    resizable: true,
    sorter: (a, b) => (a.stage?.stage ?? a.type).localeCompare(b.stage?.stage ?? b.type),
    render: row => tMemberType(row.stage?.stage ?? row.type)
  },
  {
    title: () => colHeader('lucide:wallet', bi('党费类别', 'Dues Category')),
    key: 'fee_category',
    width: 115,
    resizable: true,
    sorter: (a, b) => (a.fee_category ?? '学生党员').localeCompare(b.fee_category ?? '学生党员'),
    render: row => {
      if (row.type !== '正式党员' && row.type !== '预备党员') return '—';
      const cat = row.fee_category ?? '学生党员';
      return h(
        NTag,
        {
          size: 'tiny',
          bordered: false,
          type: cat === '在职党员' ? 'warning' : 'default'
        },
        () => tFeeCategory(cat)
      );
    }
  },
  {
    title: () => colHeader('lucide:coins', bi('月应缴党费', 'Monthly Dues')),
    key: 'fee_monthly',
    width: 115,
    resizable: true,
    sorter: (a, b) => workStore.memberMonthlyFee(a) - workStore.memberMonthlyFee(b),
    render: row => {
      if (row.type !== '正式党员' && row.type !== '预备党员') return '—';
      return `¥${workStore.memberMonthlyFee(row).toFixed(1)} / ${bi('月', 'mo')}`;
    }
  },
  {
    title: () => colHeader('lucide:receipt', bi('最近缴费', 'Latest Dues')),
    key: 'fee',
    width: 125,
    resizable: true,
    sorter: (a, b) => (a.latestFee?.status ?? '').localeCompare(b.latestFee?.status ?? ''),
    render: row =>
      row.latestFee
        ? h(
            'span',
            {
              style: {
                color: row.latestFee.status === '欠缴' ? '#d43030' : undefined,
                fontWeight: row.latestFee.status === '欠缴' ? 600 : 400
              }
            },
            `${row.latestFee.year_month} ${tFeeStatus(row.latestFee.status)}`
          )
        : '—'
  },
  {
    title: () => colHeader('lucide:calendar', bi('入党时间', 'Join Date')),
    key: 'join_date',
    width: 118,
    resizable: true,
    sorter: (a, b) => (a.join_date ?? '').localeCompare(b.join_date ?? ''),
    render: row => row.join_date || '—'
  },
  {
    title: () => colHeader('lucide:calendar-check-2', bi('转正时间', 'Full Date')),
    key: 'full_date',
    width: 136,
    resizable: true,
    sorter: (a, b) =>
      resolveEffectiveFullDate(a.join_date, a.full_date, a.key_dates?.probation_end).localeCompare(
        resolveEffectiveFullDate(b.join_date, b.full_date, b.key_dates?.probation_end)
      ),
    render: row => {
      const fd = resolveEffectiveFullDate(row.join_date, row.full_date, row.key_dates?.probation_end);
      if (!fd) return '—';
      const isFuture = fd > dayjs().format('YYYY-MM-DD');
      if (!isFuture) return fd;
      return h('span', { class: 'inline-flex items-center gap-4px whitespace-nowrap' }, [
        h('span', fd),
        h(NTag, { size: 'tiny', bordered: false, type: 'warning' }, () => bi('预计', 'Est.'))
      ]);
    }
  },
  {
    title: () => colHeader('lucide:sliders-horizontal', bi('操作', 'Actions')),
    key: 'op',
    width: 210,
    render: row =>
      h('div', { class: 'flex items-center gap-6px', onClick: (e: MouseEvent) => e.stopPropagation() }, [
        h(
          NButton,
          {
            size: 'tiny',
            secondary: true,
            type: 'primary',
            onClick: () => openCard(row.id)
          },
          {
            icon: SvgIconVNode({ icon: 'lucide:eye', fontSize: 13 }),
            default: () => bi('详情', 'Details')
          }
        ),
        h(
          NButton,
          {
            size: 'tiny',
            secondary: true,
            onClick: () => openEditMember(row)
          },
          {
            icon: SvgIconVNode({ icon: 'lucide:pencil', fontSize: 13 }),
            default: () => bi('编辑', 'Edit')
          }
        ),
        h(
          NPopconfirm,
          { onPositiveClick: () => removeMember(row.id) },
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
            default: () =>
              bi(
                `确认删除成员「${row.name}」？（同步清理发展台账与党费记录）`,
                `Delete member "${row.name}"? (Also removes development & dues records)`
              )
          }
        )
      ])
  }
]);

// ---------------- 新增 / 编辑成员 ----------------
const addShow = ref(false);
const editingMemberId = ref<string | null>(null);
const lastAutoFullDate = ref<string>('');
const addForm = reactive({
  name: '',
  type: '正式党员' as Sct.MemberType,
  join_date: null as string | null,
  full_date: null as string | null,
  fee_category: '学生党员' as Sct.FeeCategory,
  fee_monthly: FEE_STANDARD.studentMonthly,
  group: '',
  grade: '',
  major: '',
  advisor: '',
  note: ''
});

const isDateAutoType = computed(() => isPartyStatusAutoComputed(addForm.join_date, addForm.full_date));
const effectiveFormType = computed<Sct.MemberType>(() =>
  resolveMemberTypeByDates(addForm.type, addForm.join_date, addForm.full_date)
);
const partyRuleInfo = computed(() => describePartyStatusRule(addForm.join_date, addForm.full_date));

function handleJoinDateChange(val: string | null) {
  addForm.join_date = val;
  if (val) {
    const suggested = computeDefaultFullDate(val);
    if (!addForm.full_date || addForm.full_date === lastAutoFullDate.value) {
      addForm.full_date = suggested || null;
      lastAutoFullDate.value = suggested;
    }
  } else if (addForm.full_date && addForm.full_date === lastAutoFullDate.value) {
    addForm.full_date = null;
    lastAutoFullDate.value = '';
  }
  addForm.type = resolveMemberTypeByDates(addForm.type, addForm.join_date, addForm.full_date);
}

function handleFullDateChange(val: string | null) {
  addForm.full_date = val;
  if (val !== lastAutoFullDate.value) {
    lastAutoFullDate.value = '';
  }
  addForm.type = resolveMemberTypeByDates(addForm.type, addForm.join_date, addForm.full_date);
}

function clearPartyDates() {
  addForm.join_date = null;
  addForm.full_date = null;
  lastAutoFullDate.value = '';
}

const feeCategoryOptions = [
  { label: `学生党员（${FEE_STANDARD.studentMonthly} 元/月）`, value: '学生党员' },
  { label: '在职党员（自定义金额）', value: '在职党员' }
];

function handleFeeCategoryChange(val: Sct.FeeCategory) {
  addForm.fee_category = val;
  if (val === '学生党员') {
    addForm.fee_monthly = FEE_STANDARD.studentMonthly;
  } else if (addForm.fee_monthly === FEE_STANDARD.studentMonthly) {
    addForm.fee_monthly = 35;
  }
}

function openAddMember() {
  editingMemberId.value = null;
  lastAutoFullDate.value = '';
  Object.assign(addForm, {
    name: '',
    type: '申请人',
    join_date: null,
    full_date: null,
    fee_category: '学生党员',
    fee_monthly: FEE_STANDARD.studentMonthly,
    group: '',
    grade: '',
    major: '',
    advisor: '',
    note: ''
  });
  addShow.value = true;
}

function openEditMember(row: Sct.Member) {
  editingMemberId.value = row.id;
  const resolvedFull = resolveEffectiveFullDate(row.join_date, row.full_date, row.key_dates?.probation_end);
  const autoFull = computeDefaultFullDate(row.join_date);
  lastAutoFullDate.value = resolvedFull && resolvedFull === autoFull ? autoFull : '';
  Object.assign(addForm, {
    name: row.name,
    type: resolveMemberTypeByDates(row.type, row.join_date, resolvedFull),
    join_date: row.join_date || null,
    full_date: resolvedFull || null,
    fee_category: row.fee_category ?? '学生党员',
    fee_monthly: workStore.memberMonthlyFee(row),
    group: row.group ?? '',
    grade: row.grade ?? '',
    major: row.major ?? '',
    advisor: row.advisor ?? '',
    note: row.note ?? ''
  });
  addShow.value = true;
}

async function handleSaveMember() {
  if (!addForm.name.trim()) {
    window.$message?.warning('请填写姓名');
    return;
  }
  const normalizedMonthly =
    typeof addForm.fee_monthly === 'number' && !Number.isNaN(addForm.fee_monthly) && addForm.fee_monthly >= 0
      ? Number(addForm.fee_monthly.toFixed(1))
      : FEE_STANDARD.studentMonthly;
  const finalType = effectiveFormType.value;
  const joinDate = addForm.join_date?.trim() ?? '';
  const fullDate = addForm.full_date?.trim() ?? '';

  if (editingMemberId.value) {
    await workStore.updateMember(editingMemberId.value, {
      name: addForm.name.trim(),
      type: finalType,
      join_date: joinDate,
      full_date: fullDate,
      fee_category: addForm.fee_category,
      fee_monthly: normalizedMonthly,
      group: addForm.group,
      grade: addForm.grade,
      major: addForm.major,
      advisor: addForm.advisor,
      note: addForm.note || undefined
    });
    window.$message?.success(`成员信息已更新（身份：${finalType}）`);
  } else {
    await workStore.addMember({
      name: addForm.name.trim(),
      type: finalType,
      join_date: joinDate,
      full_date: fullDate,
      fee_category: addForm.fee_category,
      fee_monthly: normalizedMonthly,
      group: addForm.group,
      grade: addForm.grade,
      major: addForm.major,
      advisor: addForm.advisor,
      note: addForm.note || undefined
    });
    window.$message?.success(`成员已加入（身份：${finalType}，可在座位图编排布点）`);
  }
  addShow.value = false;
  editingMemberId.value = null;
}

// 类型选项
const typeOptions = MEMBER_TYPE_ORDER.map(v => ({ label: v, value: v }));

/** 删除成员（P2-5：联动清理发展台账与党费记录） */
async function removeMember(id: string) {
  await workStore.deleteMember(id);
  window.$message?.success('成员已删除');
}
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">{{ bi('人员', 'Members') }}</span>
          <span class="text-12px text-gray-400">{{ statsText }}</span>
        </div>
      </template>
      <template #header-extra>
        <div class="flex items-center gap-10px">
          <span v-if="activeTab === 'roster'" class="flex items-center gap-6px text-13px">
            {{ bi('编排模式', 'Edit Layout') }}
            <NSwitch v-model:value="editable" size="small" />
          </span>
          <NButton
            v-if="activeTab === 'roster' && editable"
            size="small"
            secondary
            :disabled="!undoStack.length"
            @click="handleUndo"
          >
            <template #icon><SvgIcon icon="lucide:undo-2" /></template>
            {{ bi('撤销', 'Undo') }}
          </NButton>
          <NButton v-if="activeTab === 'roster'" size="small" secondary @click="printSeatMap">
            <template #icon><SvgIcon icon="lucide:printer" /></template>
            {{ bi('打印座次表', 'Print Seat Map') }}
          </NButton>
          <NButton type="primary" size="small" @click="openAddMember">
            <template #icon><SvgIcon icon="lucide:user-plus" /></template>
            {{ bi('新增成员', 'Add Member') }}
          </NButton>
        </div>
      </template>

      <NTabs v-model:value="activeTab" type="segment" size="small" class="mb-14px w-220px">
        <NTab name="roster" :tab="bi('座位图', 'Seat Map')" />
        <NTab name="list" :tab="bi('列表', 'List View')" />
      </NTabs>

      <!-- 座位图 -->
      <div v-if="activeTab === 'roster'">
        <NTabs v-model:value="activeMapId" type="bar" size="small" class="mb-12px">
          <NTab v-for="m in workStore.seatMaps" :key="m.map_id" :name="m.map_id" :tab="m.name" />
        </NTabs>
        <div v-if="editable" class="mb-10px text-12px text-gray-400">
          {{
            bi(
              '拖拽头像换位（目标有人则互换）· 或先点一人再点另一处；点空位可安排未布点成员',
              'Drag avatars to swap seats · or click one then another; click an empty seat to assign unseated members'
            )
          }}
        </div>
        <RosterBoard
          v-if="activeMap"
          :key="activeMap.map_id"
          :map="activeMap"
          :members="workStore.members"
          :fee-badges="feeBadges"
          :editable="editable"
          @move="handleMove"
          @open="openCard"
          @place-empty="openPicker"
        />
      </div>

      <!-- 列表 -->
      <div v-else>
        <div class="mb-10px flex flex-wrap items-center justify-between gap-12px">
          <div class="flex flex-wrap items-center gap-10px">
            <div class="w-180px">
              <NSelect
                v-model:value="typeFilter"
                :options="[{ label: bi('全部类型', 'All Types'), value: '' }, ...typeOptions]"
                size="small"
                @update:value="pagination.page = 1"
              />
            </div>
            <NInput
              v-model:value="searchKeyword"
              size="small"
              clearable
              class="w-240px"
              :placeholder="bi('搜索姓名、编号、方向组、导师…', 'Search name, code, group, advisor…')"
              @update:value="pagination.page = 1"
            >
              <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
            </NInput>
          </div>
          <span class="text-12px text-gray-400">
            {{
              bi(
                '支持拖拽表头分隔线调整列宽 · 点击列头可排序',
                'Drag column dividers to resize · Click column headers to sort'
              )
            }}
          </span>
        </div>
        <NDataTable
          :columns="listColumns"
          :data="listRows"
          :pagination="pagination"
          :bordered="false"
          size="small"
          :row-key="(r: MemberRow) => r.id"
          :row-props="(r: MemberRow) => ({ style: 'cursor: pointer', onClick: () => openCard(r.id) })"
        />
      </div>
    </NCard>

    <!-- 人员卡 -->
    <MemberCard v-model:show="cardShow" :member-id="cardMemberId" @edit="openEditMember" />

    <!-- 空位安排 -->
    <NModal v-model:show="pickerShow" preset="card" title="安排成员到此工位" class="w-420px">
      <NForm label-placement="left" label-width="104" size="small">
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:user-plus" class="sct-field-icon" />
              <span>选择成员</span>
            </span>
          </template>
          <NSelect :options="unseatedOptions" placeholder="选择未布点成员" @update:value="handlePlace" />
        </NFormItem>
      </NForm>
      <div v-if="!unseatedOptions.length" class="text-13px text-gray-400">所有成员均已布点</div>
    </NModal>

    <!-- 新增 / 编辑成员（label-width="116" 确保带图标绝不折行） -->
    <NModal v-model:show="addShow" preset="card" :title="editingMemberId ? '编辑成员' : '新增成员'" class="w-560px">
      <NForm label-placement="left" label-width="116" size="small">
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:user" class="sct-field-icon" />
              <span>姓名</span>
            </span>
          </template>
          <NInput v-model:value="addForm.name" placeholder="必填" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:calendar" class="sct-field-icon" />
              <span>{{ bi('入党时间', 'Join Date') }}</span>
            </span>
          </template>
          <NDatePicker
            :formatted-value="addForm.join_date"
            type="date"
            value-format="yyyy-MM-dd"
            clearable
            class="w-full"
            :placeholder="
              bi('选填：接收为预备党员日期（自动推算转正时间）', 'Optional: date accepted as probationary member')
            "
            @update:formatted-value="handleJoinDateChange"
          />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:calendar-check-2" class="sct-field-icon" />
              <span>{{ bi('转正时间', 'Full Date') }}</span>
            </span>
          </template>
          <NDatePicker
            :formatted-value="addForm.full_date"
            type="date"
            value-format="yyyy-MM-dd"
            clearable
            class="w-full"
            :placeholder="
              bi('默认按入党满 1 年计算，支持按实际转正/延期手动调整', 'Defaults to +1 year; editable if extended')
            "
            @update:formatted-value="handleFullDateChange"
          />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:award" class="sct-field-icon" />
              <span>{{ bi('党员身份', 'Status') }}</span>
            </span>
          </template>
          <div class="w-full flex flex-col gap-6px">
            <div
              v-if="isDateAutoType"
              class="flex items-center justify-between gap-8px rounded-6px bg-[var(--sct-soft)] px-10px py-6px"
            >
              <div class="flex items-center gap-8px">
                <NTag
                  size="small"
                  :bordered="false"
                  :color="{ color: MEMBER_TYPE_COLORS[effectiveFormType], textColor: '#fff' }"
                >
                  {{ tMemberType(effectiveFormType) }}
                </NTag>
                <span class="text-12px text-gray-500">{{ bi('按日期自动判定', 'Auto-computed') }}</span>
              </div>
              <NButton size="tiny" quaternary @click="clearPartyDates">
                {{ bi('清空日期手动选择', 'Clear dates') }}
              </NButton>
            </div>
            <NSelect v-else v-model:value="addForm.type" :options="typeOptions" />
            <div class="text-11px leading-snug text-gray-400">
              {{ bi(partyRuleInfo.reasonZh, partyRuleInfo.reasonEn) }}
            </div>
          </div>
        </NFormItem>
        <template v-if="effectiveFormType === '正式党员' || effectiveFormType === '预备党员'">
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:wallet" class="sct-field-icon" />
                <span>党费类别</span>
              </span>
            </template>
            <NSelect
              :value="addForm.fee_category"
              :options="feeCategoryOptions"
              @update:value="handleFeeCategoryChange"
            />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:coins" class="sct-field-icon" />
                <span>月应缴党费</span>
              </span>
            </template>
            <div class="w-full flex items-center gap-8px">
              <NInputNumber v-model:value="addForm.fee_monthly" :min="0" :step="0.5" :precision="1" class="flex-1">
                <template #suffix>元/月</template>
              </NInputNumber>
              <span class="text-11px text-gray-400">同步至党费台账</span>
            </div>
          </NFormItem>
        </template>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:network" class="sct-field-icon" />
              <span>研究方向组</span>
            </span>
          </template>
          <NInput v-model:value="addForm.group" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:graduation-cap" class="sct-field-icon" />
              <span>年级</span>
            </span>
          </template>
          <NInput v-model:value="addForm.grade" placeholder="如 2026级" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:book-open" class="sct-field-icon" />
              <span>专业</span>
            </span>
          </template>
          <NInput v-model:value="addForm.major" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:user-check" class="sct-field-icon" />
              <span>导师</span>
            </span>
          </template>
          <NInput v-model:value="addForm.advisor" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:file-text" class="sct-field-icon" />
              <span>备注</span>
            </span>
          </template>
          <NInput v-model:value="addForm.note" type="textarea" :rows="2" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="addShow = false">取消</NButton>
          <NButton type="primary" @click="handleSaveMember">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            保存
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped></style>
