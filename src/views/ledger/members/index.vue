<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue';
import { NPopconfirm } from 'naive-ui';
import { useWorkDataStore } from '@/store/modules/work-data';
import { buildSeatSheet, printHtml } from '@/utils/print';
import { MEMBER_TYPE_COLORS, MEMBER_TYPE_ORDER } from '@/constants/sanchitai';
import RosterBoard from './modules/roster-board.vue';
import MemberCard from './modules/member-card.vue';

defineOptions({ name: 'MembersPage' });

const workStore = useWorkDataStore();

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

function handleMove({ memberId, from, to }: { memberId: string; from: { x: number; y: number } | null; to: { x: number; y: number } }) {
  undoStack.value.push(snapshotSeats());

  const mover = workStore.memberOf(memberId);
  if (!mover) return;
  const target = workStore.members.find(
    m => m.seat && m.seat.map_id === activeMapId.value && m.seat.x === to.x && m.seat.y === to.y && m.id !== memberId
  );

  const mapId = activeMapId.value;
  const tasks: Array<Promise<unknown>> = [];
  if (target) {
    // 互换
    tasks.push(workStore.updateMember(target.id, { seat: from ? { map_id: mapId, x: from.x, y: from.y } : target.seat ?? null }));
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
  Promise.all(snap.map(s => workStore.updateMember(s.id, { seat: s.seat }))).then(() => window.$message?.success('已撤销'));
}

/** 打印座次/工位表 */
function printSeatMap() {
  if (!activeMap.value) return;
  const cells = workStore.members
    .filter(m => m.seat?.map_id === activeMapId.value)
    .map(m => ({ x: m.seat!.x, y: m.seat!.y, name: m.name, sub: `${m.type}${m.role ? `·${m.role}` : ''}` }));
  printHtml(activeMap.value.name, buildSeatSheet({
    title: activeMap.value.name,
    meta: `共 ${cells.length} 人在位`,
    cols: activeMap.value.grid.cols,
    rows: activeMap.value.grid.rows,
    cells
  }));
}

const statsText = computed(() => {
  const inMap = workStore.members.filter(m => m.seat?.map_id === activeMapId.value);
  const unseated = workStore.members.filter(m => !m.seat);
  const typeCount = MEMBER_TYPE_ORDER.map(t => `${t}${workStore.members.filter(m => m.type === t).length}`).join(' · ');
  const capacity = activeMap.value ? activeMap.value.grid.cols * activeMap.value.grid.rows : 0;
  return `在座 ${inMap.length}/${capacity} · 未入座 ${unseated.length} ｜ ${typeCount}`;
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
  workStore.members
    .filter(m => !m.seat)
    .map(m => ({ label: `${m.name}（${m.type}）`, value: m.id }))
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

// ---------------- 成员列表 ----------------
const typeFilter = ref<string>('');
const listRows = computed(() =>
  workStore.members
    .filter(m => !typeFilter.value || m.type === typeFilter.value)
    .map(m => {
      const stage = workStore.devStages.find(d => d.member_id === m.id);
      const latestFee = [...workStore.feeRecords].filter(f => f.member_id === m.id).sort((a, b) => b.year_month.localeCompare(a.year_month))[0];
      return { ...m, stage, latestFee };
    })
);

const listColumns = [
  { title: '编号', key: 'code', width: 70 },
  { title: '姓名', key: 'name', width: 90 },
  {
    title: '类型',
    key: 'type',
    width: 100,
    render: (row: (typeof listRows.value)[number]) =>
      h(
        'span',
        { class: 'inline-flex items-center gap-4px' },
        [
          h('span', { class: 'inline-block size-8px rounded-full', style: { background: MEMBER_TYPE_COLORS[row.type] } }),
          row.type
        ]
      )
  },
  { title: '角色', key: 'role', width: 80, render: (row: (typeof listRows.value)[number]) => row.role || '—' },
  { title: '研究方向组', key: 'group', width: 100, render: (row: (typeof listRows.value)[number]) => row.group || '—' },
  { title: '年级', key: 'grade', width: 80 },
  { title: '发展阶段', key: 'stage', width: 110, render: (row: (typeof listRows.value)[number]) => row.stage?.stage ?? row.type },
  {
    title: '最近缴费',
    key: 'fee',
    width: 110,
    render: (row: (typeof listRows.value)[number]) =>
      row.latestFee
        ? h('span', { style: { color: row.latestFee.status === '欠缴' ? '#d43030' : undefined } }, `${row.latestFee.year_month} ${row.latestFee.status}`)
        : '—'
  },
  { title: '入党时间', key: 'join_date', width: 110, render: (row: (typeof listRows.value)[number]) => row.join_date || '—' },
  {
    title: '',
    key: 'op',
    width: 110,
    render: (row: (typeof listRows.value)[number]) =>
      h('div', { class: 'flex gap-10px' }, [
        h('a', { style: { color: '#A81C24', cursor: 'pointer' }, onClick: () => openCard(row.id) }, '详情'),
        h(
          NPopconfirm,
          { onPositiveClick: () => removeMember(row.id) },
          {
            trigger: () => h('a', { style: { color: '#d43030', cursor: 'pointer' } }, '删除'),
            default: () => `确认删除成员「${row.name}」？（同步清理发展台账与党费记录）`
          }
        )
      ])
  }
];

// ---------------- 新增成员 ----------------
const addShow = ref(false);
const addForm = reactive({
  name: '',
  type: '正式党员' as Sct.MemberType,
  group: '',
  grade: '',
  major: '',
  advisor: '',
  note: ''
});
async function handleAddMember() {
  if (!addForm.name.trim()) {
    window.$message?.warning('请填写姓名');
    return;
  }
  await workStore.addMember({
    name: addForm.name.trim(),
    type: addForm.type,
    group: addForm.group,
    grade: addForm.grade,
    major: addForm.major,
    advisor: addForm.advisor,
    note: addForm.note || undefined
  });
  window.$message?.success('成员已加入（可在座位图编排布点）');
  addShow.value = false;
  Object.assign(addForm, { name: '', type: '正式党员', group: '', grade: '', major: '', advisor: '', note: '' });
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
          <span class="text-16px font-bold">人员</span>
          <span class="text-12px text-gray-400">{{ statsText }}</span>
        </div>
      </template>
      <template #header-extra>
        <div class="flex items-center gap-12px">
          <span v-if="activeTab === 'roster'" class="flex items-center gap-6px text-13px">
            编排模式
            <NSwitch v-model:value="editable" size="small" />
          </span>
          <NButton v-if="activeTab === 'roster' && editable" size="small" :disabled="!undoStack.length" @click="handleUndo">撤销</NButton>
          <NButton v-if="activeTab === 'roster'" size="small" @click="printSeatMap">打印座次表</NButton>
          <NButton type="primary" size="small" @click="addShow = true">＋ 新增成员</NButton>
        </div>
      </template>

      <NTabs v-model:value="activeTab" type="segment" size="small" class="mb-14px w-220px">
        <NTab name="roster" tab="座位图" />
        <NTab name="list" tab="列表" />
      </NTabs>

      <!-- 座位图 -->
      <div v-if="activeTab === 'roster'">
        <NTabs v-model:value="activeMapId" type="bar" size="small" class="mb-8px">
          <NTab v-for="m in workStore.seatMaps" :key="m.map_id" :name="m.map_id" :tab="m.name" />
        </NTabs>
        <div v-if="editable" class="mb-10px text-12px text-gray-400">
          拖拽头像换位（目标有人则互换）· 或先点一人再点另一处；点空位可安排未布点成员
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
        <div class="mb-10px w-200px">
          <NSelect v-model:value="typeFilter" :options="[{ label: '全部类型', value: '' }, ...typeOptions]" size="small" />
        </div>
        <NDataTable :columns="listColumns" :data="listRows" :bordered="false" size="small" :row-key="(r: any) => r.id" :row-props="(r: any) => ({ style: 'cursor: pointer', onClick: () => openCard(r.id) })" />
      </div>
    </NCard>

    <!-- 人员卡 -->
    <MemberCard v-model:show="cardShow" :member-id="cardMemberId" />

    <!-- 空位安排 -->
    <NModal v-model:show="pickerShow" preset="card" title="安排成员到此工位" class="w-360px">
      <NSelect :options="unseatedOptions" placeholder="选择未布点成员" @update:value="handlePlace" />
      <div v-if="!unseatedOptions.length" class="text-13px text-gray-400">所有成员均已布点</div>
    </NModal>

    <!-- 新增成员（必填仅 2 项，满足 A9 ≤8） -->
    <NModal v-model:show="addShow" preset="card" title="新增成员" class="w-520px">
      <NForm label-placement="left" label-width="88" size="small">
        <NFormItem label="姓名" required>
          <NInput v-model:value="addForm.name" placeholder="必填" />
        </NFormItem>
        <NFormItem label="类型" required>
          <NSelect v-model:value="addForm.type" :options="typeOptions" />
        </NFormItem>
        <NFormItem label="研究方向组"><NInput v-model:value="addForm.group" /></NFormItem>
        <NFormItem label="年级"><NInput v-model:value="addForm.grade" placeholder="如 2026级" /></NFormItem>
        <NFormItem label="专业"><NInput v-model:value="addForm.major" /></NFormItem>
        <NFormItem label="导师"><NInput v-model:value="addForm.advisor" /></NFormItem>
        <NFormItem label="备注"><NInput v-model:value="addForm.note" type="textarea" :rows="2" /></NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="addShow = false">取消</NButton>
          <NButton type="primary" @click="handleAddMember">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped></style>
