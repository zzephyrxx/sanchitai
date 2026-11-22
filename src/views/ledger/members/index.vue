<script setup lang="ts">
import { computed, h, onUnmounted, reactive, ref, watch } from 'vue';
import { NButton, NPopconfirm, NTag } from 'naive-ui';
import dayjs from 'dayjs';
import { FEE_STANDARD, MEMBER_TYPE_COLORS, MEMBER_TYPE_ORDER } from '@/constants/sanchitai';
import { generateNextMemberCode, getBranchAbbreviation, maskIdCard } from '@/utils/member-code';
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
import { useTableColumnLayout } from '@/hooks/common/table-layout';
import MemberCard from './modules/member-card.vue';
import MemberImportModal from './modules/member-import-modal.vue';
import RosterBoard from './modules/roster-board.vue';

defineOptions({ name: 'MembersPage' });

const workStore = useWorkDataStore();
const { SvgIconVNode } = useSvgIcon();
const { bi, tMemberType } = useSctI18n();

// ---------------- 视图与布区（默认打开列表页） ----------------
const activeTab = ref<'list' | 'roster'>('list');
const activeMapId = ref('');
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

// ---------------- 座位图预设模板与自定义编辑 ----------------
interface SeatMapPreset {
  id: string;
  name: string;
  rows: number;
  cols: number;
  icon: string;
  desc: string;
}

const SEAT_MAP_PRESETS: SeatMapPreset[] = [
  {
    id: 'lab',
    name: '实验室工位',
    rows: 4,
    cols: 8,
    icon: 'lucide:monitor',
    desc: '4 行 × 8 列（32 位），适合科研课题组/工位布点'
  },
  {
    id: 'classroom',
    name: '标准教室',
    rows: 6,
    cols: 8,
    icon: 'lucide:school',
    desc: '6 行 × 8 列（48 位），适合大班党课/集中学习'
  },
  {
    id: 'meeting',
    name: '支部会议室',
    rows: 4,
    cols: 6,
    icon: 'lucide:users',
    desc: '4 行 × 6 列（24 位），适合支委会/组织生活会'
  },
  {
    id: 'hall',
    name: '报告厅阶梯',
    rows: 8,
    cols: 10,
    icon: 'lucide:landmark',
    desc: '8 行 × 10 列（80 位），适合大支部党员大会'
  }
];

const seatMapModalShow = ref(false);
const seatMapModalMode = ref<'create' | 'edit'>('create');
const seatMapForm = reactive({
  mapId: '',
  name: '',
  rows: 4,
  cols: 8
});

const seatMapOverflowCount = computed(() => {
  if (seatMapModalMode.value !== 'edit' || !seatMapForm.mapId) return 0;
  const rows = seatMapForm.rows;
  const cols = seatMapForm.cols;
  if (!rows || !cols) return 0;
  return workStore.members.filter(
    m => m.seat?.map_id === seatMapForm.mapId && (m.seat.x > cols || m.seat.y > rows || m.seat.x < 1 || m.seat.y < 1)
  ).length;
});

function openCreateSeatMapModal(preset?: SeatMapPreset) {
  seatMapModalMode.value = 'create';
  if (preset) {
    const existingCount = workStore.seatMaps.filter(m => m.name.startsWith(preset.name)).length;
    seatMapForm.mapId = '';
    seatMapForm.name = existingCount ? `${preset.name} ${existingCount + 1}` : preset.name;
    seatMapForm.rows = preset.rows;
    seatMapForm.cols = preset.cols;
  } else {
    seatMapForm.mapId = '';
    seatMapForm.name = `自定义布区 ${workStore.seatMaps.length + 1}`;
    seatMapForm.rows = 5;
    seatMapForm.cols = 6;
  }
  seatMapModalShow.value = true;
}

function openEditSeatMapModal() {
  const cur = activeMap.value;
  if (!cur) return;
  seatMapModalMode.value = 'edit';
  seatMapForm.mapId = cur.map_id;
  seatMapForm.name = cur.name;
  seatMapForm.rows = cur.grid.rows;
  seatMapForm.cols = cur.grid.cols;
  seatMapModalShow.value = true;
}

function fillSeatMapFormFromPreset(preset: SeatMapPreset) {
  const existingCount = workStore.seatMaps.filter(m => m.name.startsWith(preset.name)).length;
  seatMapForm.name = existingCount ? `${preset.name} ${existingCount + 1}` : preset.name;
  seatMapForm.rows = preset.rows;
  seatMapForm.cols = preset.cols;
}

async function handleSaveSeatMap() {
  const cleanName = seatMapForm.name.trim();
  if (!cleanName) {
    window.$message?.warning('请输入布区名称');
    return;
  }
  const rows = Math.max(1, Math.min(20, Math.round(seatMapForm.rows || 4)));
  const cols = Math.max(1, Math.min(20, Math.round(seatMapForm.cols || 6)));

  try {
    if (seatMapModalMode.value === 'create') {
      const newId = await workStore.addSeatMap({ name: cleanName, rows, cols });
      activeMapId.value = newId;
      window.$message?.success(`已创建座位图「${cleanName}」（${rows}×${cols}）`);
    } else if (seatMapForm.mapId) {
      const { releasedCount } = await workStore.updateSeatMap(seatMapForm.mapId, { name: cleanName, rows, cols });
      const extra = releasedCount ? `，已自动释放 ${releasedCount} 位越界座位` : '';
      window.$message?.success(`布区「${cleanName}」已更新为 ${rows} 行 × ${cols} 列${extra}`);
    }
    seatMapModalShow.value = false;
  } catch {
    // guardWrite 已提示
  }
}

async function handleDeleteActiveSeatMap() {
  const targetId = seatMapForm.mapId || activeMap.value?.map_id;
  if (!targetId) return;
  try {
    await workStore.deleteSeatMap(targetId);
    seatMapModalShow.value = false;
    window.$message?.success('座位图布区已删除（原在座成员已回到未入座名单）');
  } catch {
    // guardWrite 已提示
  }
}

// ---------------- 欠缴角标（座位图使用） ----------------
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

async function handleMove({
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
  try {
    await Promise.all(tasks);
    window.$message?.success('布点已更新');
  } catch {
    // guardWrite 已弹出错误提示
  }
}

async function handleUndo() {
  const snap = undoStack.value.pop();
  if (!snap) {
    window.$message?.info('没有可撤销的操作');
    return;
  }
  try {
    await Promise.all(snap.map(s => workStore.updateMember(s.id, { seat: s.seat })));
    window.$message?.success('已撤销');
  } catch {
    // guardWrite 已弹出错误提示
  }
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
  const total = workStore.members.length;
  const typeCount = MEMBER_TYPE_ORDER.map(
    t => `${tMemberType(t)} ${workStore.members.filter(m => m.type === t).length}`
  ).join(' · ');
  return bi(`共 ${total} 人 ｜ ${typeCount}`, `Total ${total} ｜ ${typeCount}`);
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

// ---------------- 列显示控制 & 身份证号自动隐藏 ----------------
type ToggleableColumnKey =
  | 'seq'
  | 'code'
  | 'branch_name'
  | 'student_id'
  | 'gender'
  | 'ethnicity'
  | 'birth_date'
  | 'dorm_building'
  | 'dorm_room'
  | 'level'
  | 'grade'
  | 'major'
  | 'class_name'
  | 'id_card'
  | 'phone'
  | 'type'
  | 'join_date'
  | 'full_date'
  | 'advisor'
  | 'role'
  | 'group';

const COL_STORAGE_KEY = 'sct:members:visible-columns:v1';

const COLUMN_PICKER_META: Array<{ key: ToggleableColumnKey; labelZh: string; labelEn: string; autoHide?: boolean }> = [
  { key: 'seq', labelZh: '序号', labelEn: 'No.' },
  { key: 'code', labelZh: '支部编号', labelEn: 'Code' },
  { key: 'branch_name', labelZh: '支部名称', labelEn: 'Branch' },
  { key: 'student_id', labelZh: '学号', labelEn: 'Student ID' },
  { key: 'gender', labelZh: '性别', labelEn: 'Gender' },
  { key: 'ethnicity', labelZh: '民族', labelEn: 'Ethnicity' },
  { key: 'birth_date', labelZh: '出生年月', labelEn: 'Birth Date' },
  { key: 'dorm_building', labelZh: '宿舍楼栋号', labelEn: 'Dorm Bldg' },
  { key: 'dorm_room', labelZh: '宿舍号', labelEn: 'Dorm Room' },
  { key: 'level', labelZh: '层次', labelEn: 'Level' },
  { key: 'grade', labelZh: '年级', labelEn: 'Grade' },
  { key: 'major', labelZh: '专业', labelEn: 'Major' },
  { key: 'class_name', labelZh: '班级', labelEn: 'Class' },
  { key: 'id_card', labelZh: '身份证号（默认自动隐藏）', labelEn: 'ID Card (Auto-hide)', autoHide: true },
  { key: 'phone', labelZh: '联系电话', labelEn: 'Phone' },
  { key: 'type', labelZh: '正式/预备党员', labelEn: 'Party Status' },
  { key: 'join_date', labelZh: '入党时间', labelEn: 'Join Date' },
  { key: 'full_date', labelZh: '转正时间', labelEn: 'Full Date' },
  { key: 'advisor', labelZh: '导师姓名', labelEn: 'Advisor' },
  { key: 'role', labelZh: '党内职务', labelEn: 'Role' },
  { key: 'group', labelZh: '党小组', labelEn: 'Party Group' }
];

const DEFAULT_VISIBLE_COLS: ToggleableColumnKey[] = [
  'seq',
  'code',
  'student_id',
  'type',
  'role',
  'level',
  'grade',
  'major',
  'join_date',
  'full_date',
  'advisor'
];

const ROSTER_STANDARD_COLS: ToggleableColumnKey[] = [
  'seq',
  'branch_name',
  'student_id',
  'gender',
  'ethnicity',
  'birth_date',
  'dorm_building',
  'dorm_room',
  'level',
  'grade',
  'major',
  'class_name',
  'phone',
  'type',
  'join_date',
  'full_date',
  'advisor'
];

function loadSavedVisibleCols(): ToggleableColumnKey[] {
  try {
    const raw = localStorage.getItem(COL_STORAGE_KEY);
    if (!raw) return [...DEFAULT_VISIBLE_COLS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_VISIBLE_COLS];
    const validKeys = new Set<string>(COLUMN_PICKER_META.map(c => c.key));
    // 安全兜底：刷新页面时身份证号仍自动恢复为隐藏状态
    const filtered = parsed.filter(
      (k): k is ToggleableColumnKey => typeof k === 'string' && validKeys.has(k) && k !== 'id_card'
    );
    return filtered.length ? filtered : [...DEFAULT_VISIBLE_COLS];
  } catch {
    return [...DEFAULT_VISIBLE_COLS];
  }
}

const visibleColKeys = ref<ToggleableColumnKey[]>(loadSavedVisibleCols());

watch(
  visibleColKeys,
  cols => {
    try {
      // 持久化时不保留 id_card，确保每次重新进入或刷新均自动隐藏身份证号列
      localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(cols.filter(k => k !== 'id_card')));
    } catch {
      /* ignore storage errors */
    }
  },
  { deep: true }
);

function applyColPreset(preset: 'default' | 'roster' | 'all') {
  if (preset === 'default') {
    visibleColKeys.value = [...DEFAULT_VISIBLE_COLS];
  } else if (preset === 'roster') {
    visibleColKeys.value = [...ROSTER_STANDARD_COLS];
  } else {
    visibleColKeys.value = COLUMN_PICKER_META.map(c => c.key).filter(k => k !== 'id_card');
  }
}

// 身份证号临时明文开关（勾选展示身份证号列后，默认脱敏掩码，点眼睛临时明文 15 秒后自动隐藏）
const revealIdCardColumn = ref(false);
let idCardAutoHideTimer: ReturnType<typeof setTimeout> | null = null;

function clearIdCardTimer() {
  if (idCardAutoHideTimer) {
    clearTimeout(idCardAutoHideTimer);
    idCardAutoHideTimer = null;
  }
}

function toggleRevealIdCardColumn(e: MouseEvent) {
  e.stopPropagation();
  clearIdCardTimer();
  revealIdCardColumn.value = !revealIdCardColumn.value;
  if (revealIdCardColumn.value) {
    idCardAutoHideTimer = setTimeout(() => {
      revealIdCardColumn.value = false;
      idCardAutoHideTimer = null;
    }, 15_000);
  }
}

watch(activeTab, () => {
  clearIdCardTimer();
  revealIdCardColumn.value = false;
});

onUnmounted(clearIdCardTimer);

// ---------------- 成员列表（搜索、分页、自定义列显隐、拖拽列宽） ----------------
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
  seqNo: number;
};

const listRows = computed<MemberRow[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  return workStore.members
    .filter(m => !typeFilter.value || m.type === typeFilter.value)
    .filter(m => {
      if (!kw) return true;
      return [
        m.code,
        m.branch_name,
        m.name,
        m.student_id,
        m.gender,
        m.ethnicity,
        m.dorm_building,
        m.dorm_room,
        m.level,
        m.grade,
        m.major,
        m.class_name,
        m.phone,
        m.type,
        m.role,
        m.group,
        m.advisor
      ]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(kw));
    })
    .map((m, idx) => ({ ...m, seqNo: idx + 1 }));
});

function colHeader(icon: string, text: string) {
  return h('span', { class: 'inline-flex items-center gap-4px whitespace-nowrap' }, [
    SvgIconVNode({ icon, fontSize: 13 })?.(),
    h('span', text)
  ]);
}

function levelPillClass(level?: string): string {
  const s = (level ?? '').trim();
  if (/博/.test(s)) return 'sct-pill sct-pill--phd';
  if (/硕/.test(s)) return 'sct-pill sct-pill--master';
  if (/本/.test(s)) return 'sct-pill sct-pill--bachelor';
  return 'sct-pill sct-pill--neutral';
}

function gradePillClass(grade?: string): string {
  const s = (grade ?? '').trim();
  const match = s.match(/20(\d{2})/);
  if (!match) return 'sct-pill sct-pill--grade-4';
  const yr = Number(match[1]);
  const paletteIdx = (((26 - yr) % 5) + 5) % 5;
  return `sct-pill sct-pill--grade-${paletteIdx}`;
}

const ORDERED_COLUMN_SEQUENCE: Array<ToggleableColumnKey | 'name' | 'op'> = [
  'seq',
  'code',
  'branch_name',
  'name',
  'student_id',
  'gender',
  'ethnicity',
  'birth_date',
  'dorm_building',
  'dorm_room',
  'level',
  'grade',
  'major',
  'class_name',
  'id_card',
  'phone',
  'type',
  'join_date',
  'full_date',
  'advisor',
  'role',
  'group',
  'op'
];

const allColumnMap = computed(() => ({
  seq: {
    key: 'seq',
    defaultWidth: 66,
    minWidth: 54,
    titleContent: () => colHeader('lucide:list-ordered', bi('序号', 'No.')),
    render: (row: MemberRow) => row.seqNo
  },
  code: {
    key: 'code',
    defaultWidth: 104,
    minWidth: 78,
    titleContent: () => colHeader('lucide:hash', bi('编号', 'Code')),
    sorter: (a: MemberRow, b: MemberRow) => (a.code ?? '').localeCompare(b.code ?? '')
  },
  branch_name: {
    key: 'branch_name',
    defaultWidth: 155,
    minWidth: 96,
    ellipsis: { tooltip: true },
    titleContent: () => colHeader('lucide:building-2', bi('支部名称', 'Branch')),
    sorter: (a: MemberRow, b: MemberRow) =>
      (a.branch_name ?? workStore.branchName).localeCompare(b.branch_name ?? workStore.branchName),
    render: (row: MemberRow) => row.branch_name || workStore.branchName
  },
  name: {
    key: 'name',
    defaultWidth: 96,
    minWidth: 74,
    titleContent: () => colHeader('lucide:user', bi('姓名', 'Name')),
    sorter: (a: MemberRow, b: MemberRow) => a.name.localeCompare(b.name)
  },
  student_id: {
    key: 'student_id',
    defaultWidth: 120,
    minWidth: 88,
    titleContent: () => colHeader('lucide:id-card', bi('学号', 'Student ID')),
    sorter: (a: MemberRow, b: MemberRow) => (a.student_id ?? '').localeCompare(b.student_id ?? ''),
    render: (row: MemberRow) => row.student_id || '—'
  },
  gender: {
    key: 'gender',
    defaultWidth: 72,
    minWidth: 58,
    titleContent: () => colHeader('lucide:users', bi('性别', 'Gender')),
    sorter: (a: MemberRow, b: MemberRow) => (a.gender ?? '').localeCompare(b.gender ?? ''),
    render: (row: MemberRow) => row.gender || '—'
  },
  ethnicity: {
    key: 'ethnicity',
    defaultWidth: 82,
    minWidth: 64,
    titleContent: () => colHeader('lucide:flag', bi('民族', 'Ethnicity')),
    sorter: (a: MemberRow, b: MemberRow) => (a.ethnicity ?? '').localeCompare(b.ethnicity ?? ''),
    render: (row: MemberRow) => row.ethnicity || '—'
  },
  birth_date: {
    key: 'birth_date',
    defaultWidth: 108,
    minWidth: 84,
    titleContent: () => colHeader('lucide:cake', bi('出生年月', 'Birth')),
    sorter: (a: MemberRow, b: MemberRow) => (a.birth_date ?? '').localeCompare(b.birth_date ?? ''),
    render: (row: MemberRow) => row.birth_date || '—'
  },
  dorm_building: {
    key: 'dorm_building',
    defaultWidth: 112,
    minWidth: 84,
    titleContent: () => colHeader('lucide:home', bi('宿舍楼栋号', 'Dorm Bldg')),
    render: (row: MemberRow) => row.dorm_building || '—'
  },
  dorm_room: {
    key: 'dorm_room',
    defaultWidth: 88,
    minWidth: 68,
    titleContent: () => colHeader('lucide:door-open', bi('宿舍号', 'Room')),
    render: (row: MemberRow) => row.dorm_room || '—'
  },
  level: {
    key: 'level',
    defaultWidth: 96,
    minWidth: 74,
    titleContent: () => colHeader('lucide:layers', bi('层次', 'Level')),
    sorter: (a: MemberRow, b: MemberRow) => (a.level ?? '').localeCompare(b.level ?? ''),
    render: (row: MemberRow) => (row.level ? h('span', { class: levelPillClass(row.level) }, row.level) : '—')
  },
  grade: {
    key: 'grade',
    defaultWidth: 92,
    minWidth: 72,
    titleContent: () => colHeader('lucide:graduation-cap', bi('年级', 'Grade')),
    sorter: (a: MemberRow, b: MemberRow) => (a.grade ?? '').localeCompare(b.grade ?? ''),
    render: (row: MemberRow) => (row.grade ? h('span', { class: gradePillClass(row.grade) }, row.grade) : '—')
  },
  major: {
    key: 'major',
    defaultWidth: 145,
    minWidth: 90,
    ellipsis: { tooltip: true },
    titleContent: () => colHeader('lucide:book-open', bi('专业', 'Major')),
    sorter: (a: MemberRow, b: MemberRow) => (a.major ?? '').localeCompare(b.major ?? ''),
    render: (row: MemberRow) => row.major || '—'
  },
  class_name: {
    key: 'class_name',
    defaultWidth: 108,
    minWidth: 80,
    titleContent: () => colHeader('lucide:school', bi('班级', 'Class')),
    render: (row: MemberRow) => row.class_name || '—'
  },
  id_card: {
    key: 'id_card',
    defaultWidth: 180,
    minWidth: 140,
    titleContent: () =>
      h('span', { class: 'inline-flex items-center gap-4px whitespace-nowrap' }, [
        SvgIconVNode({ icon: 'lucide:shield-alert', fontSize: 13 })?.(),
        h('span', bi('身份证号', 'ID Card')),
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            title: revealIdCardColumn.value ? '点击隐藏明文' : '点击临时查看明文（15 秒后自动隐藏）',
            onClick: toggleRevealIdCardColumn
          },
          {
            icon: SvgIconVNode({ icon: revealIdCardColumn.value ? 'lucide:eye-off' : 'lucide:eye', fontSize: 13 })
          }
        )
      ]),
    render: (row: MemberRow) =>
      h(
        'span',
        { class: 'font-mono text-12px' },
        revealIdCardColumn.value ? row.id_card || '—' : maskIdCard(row.id_card)
      )
  },
  phone: {
    key: 'phone',
    defaultWidth: 124,
    minWidth: 96,
    titleContent: () => colHeader('lucide:phone', bi('联系电话', 'Phone')),
    render: (row: MemberRow) => row.phone || '—'
  },
  type: {
    key: 'type',
    defaultWidth: 132,
    minWidth: 96,
    titleContent: () => colHeader('lucide:award', bi('正式/预备党员', 'Party Status')),
    sorter: (a: MemberRow, b: MemberRow) => MEMBER_TYPE_ORDER.indexOf(a.type) - MEMBER_TYPE_ORDER.indexOf(b.type),
    render: (row: MemberRow) =>
      h('span', { class: 'inline-flex items-center gap-5px whitespace-nowrap' }, [
        h('span', { class: 'inline-block size-8px rounded-full', style: { background: MEMBER_TYPE_COLORS[row.type] } }),
        tMemberType(row.type)
      ])
  },
  join_date: {
    key: 'join_date',
    defaultWidth: 112,
    minWidth: 90,
    titleContent: () => colHeader('lucide:calendar', bi('入党时间', 'Join Date')),
    sorter: (a: MemberRow, b: MemberRow) => (a.join_date ?? '').localeCompare(b.join_date ?? ''),
    render: (row: MemberRow) => row.join_date || '—'
  },
  full_date: {
    key: 'full_date',
    defaultWidth: 134,
    minWidth: 96,
    titleContent: () => colHeader('lucide:calendar-check-2', bi('转正时间', 'Full Date')),
    sorter: (a: MemberRow, b: MemberRow) =>
      resolveEffectiveFullDate(a.join_date, a.full_date, a.key_dates?.probation_end).localeCompare(
        resolveEffectiveFullDate(b.join_date, b.full_date, b.key_dates?.probation_end)
      ),
    render: (row: MemberRow) => {
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
  advisor: {
    key: 'advisor',
    defaultWidth: 100,
    minWidth: 76,
    titleContent: () => colHeader('lucide:user-check', bi('导师姓名', 'Advisor')),
    sorter: (a: MemberRow, b: MemberRow) => (a.advisor ?? '').localeCompare(b.advisor ?? ''),
    render: (row: MemberRow) => row.advisor || '—'
  },
  role: {
    key: 'role',
    defaultWidth: 96,
    minWidth: 74,
    titleContent: () => colHeader('lucide:shield', bi('党内职务', 'Role')),
    sorter: (a: MemberRow, b: MemberRow) => (a.role ?? '').localeCompare(b.role ?? ''),
    render: (row: MemberRow) => row.role || '—'
  },
  group: {
    key: 'group',
    defaultWidth: 112,
    minWidth: 80,
    titleContent: () => colHeader('lucide:network', bi('党小组', 'Party Group')),
    sorter: (a: MemberRow, b: MemberRow) => (a.group ?? '').localeCompare(b.group ?? ''),
    render: (row: MemberRow) => row.group || '—'
  },
  op: {
    key: 'op',
    defaultWidth: 196,
    fixed: 'right' as const,
    resizable: false,
    reorderable: false,
    titleContent: () => colHeader('lucide:sliders-horizontal', bi('操作', 'Actions')),
    render: (row: MemberRow) =>
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
}));

const activeVisibleKeys = computed(() => [...visibleColKeys.value, 'name', 'op']);

const {
  columns: listColumns,
  scrollX: tableScrollX,
  hasCustomLayout,
  resetLayout: resetMemberTableLayout
} = useTableColumnLayout<MemberRow>({
  storageKey: 'members',
  defaultOrder: ORDERED_COLUMN_SEQUENCE,
  visibleKeys: activeVisibleKeys,
  pinnedEndKeys: ['op'],
  columnMap: allColumnMap,
  minTableWidth: 960
});

function handleResetTableLayout() {
  resetMemberTableLayout();
  window.$message?.success('成员列表列宽与列顺序已重置');
}

// ---------------- 新增 / 编辑成员 & 批量导入 ----------------
const importShow = ref(false);
const addShow = ref(false);
const editingMemberId = ref<string | null>(null);
const lastAutoFullDate = ref<string>('');
const addForm = reactive({
  code: '',
  branch_name: '',
  name: '',
  student_id: '',
  gender: '' as string,
  ethnicity: '',
  birth_date: '',
  dorm_building: '',
  dorm_room: '',
  level: '',
  grade: '',
  major: '',
  class_name: '',
  id_card: '',
  phone: '',
  type: '申请人' as Sct.MemberType,
  join_date: null as string | null,
  full_date: null as string | null,
  fee_category: '学生党员' as Sct.FeeCategory,
  fee_monthly: FEE_STANDARD.studentMonthly,
  group: '',
  advisor: '',
  note: ''
});

const genderOptions = [
  { label: '男', value: '男' },
  { label: '女', value: '女' }
];

const nextAutoCodePreview = computed(() =>
  generateNextMemberCode(
    addForm.branch_name || workStore.branchName,
    workStore.members.map(m => m.code)
  )
);

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
    code: '',
    branch_name: workStore.branchName,
    name: '',
    student_id: '',
    gender: '',
    ethnicity: '',
    birth_date: '',
    dorm_building: '',
    dorm_room: '',
    level: '',
    grade: '',
    major: '',
    class_name: '',
    id_card: '',
    phone: '',
    type: '申请人',
    join_date: null,
    full_date: null,
    fee_category: '学生党员',
    fee_monthly: FEE_STANDARD.studentMonthly,
    group: '',
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
    code: row.code ?? '',
    branch_name: row.branch_name || workStore.branchName,
    name: row.name,
    student_id: row.student_id ?? '',
    gender: row.gender ?? '',
    ethnicity: row.ethnicity ?? '',
    birth_date: row.birth_date ?? '',
    dorm_building: row.dorm_building ?? '',
    dorm_room: row.dorm_room ?? '',
    level: row.level ?? '',
    grade: row.grade ?? '',
    major: row.major ?? '',
    class_name: row.class_name ?? '',
    id_card: row.id_card ?? '',
    phone: row.phone ?? '',
    type: resolveMemberTypeByDates(row.type, row.join_date, resolvedFull),
    join_date: row.join_date || null,
    full_date: resolvedFull || null,
    fee_category: row.fee_category ?? '学生党员',
    fee_monthly: workStore.memberMonthlyFee(row),
    group: row.group ?? '',
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
  const payload: Partial<Sct.Member> = {
    code: addForm.code.trim() || undefined,
    branch_name: addForm.branch_name.trim() || workStore.branchName,
    name: addForm.name.trim(),
    student_id: addForm.student_id.trim(),
    gender: addForm.gender,
    ethnicity: addForm.ethnicity.trim(),
    birth_date: addForm.birth_date.trim(),
    dorm_building: addForm.dorm_building.trim(),
    dorm_room: addForm.dorm_room.trim(),
    level: addForm.level.trim(),
    grade: addForm.grade.trim(),
    major: addForm.major.trim(),
    class_name: addForm.class_name.trim(),
    id_card: addForm.id_card.trim(),
    phone: addForm.phone.trim(),
    type: finalType,
    join_date: joinDate,
    full_date: fullDate,
    fee_category: addForm.fee_category,
    fee_monthly: normalizedMonthly,
    group: addForm.group.trim(),
    advisor: addForm.advisor.trim(),
    note: addForm.note.trim() || undefined
  };

  if (editingMemberId.value) {
    await workStore.updateMember(editingMemberId.value, payload);
    window.$message?.success(`成员信息已更新（身份：${finalType}）`);
  } else {
    await workStore.addMember({
      ...payload,
      name: addForm.name.trim(),
      type: finalType
    });
    window.$message?.success(`成员已加入（身份：${finalType}，可在座位图编排布点）`);
  }
  addShow.value = false;
  editingMemberId.value = null;
}

const typeOptions = MEMBER_TYPE_ORDER.map(v => ({ label: v, value: v }));
const branchAbbrHint = computed(() => getBranchAbbreviation(addForm.branch_name || workStore.branchName));

async function removeMember(id: string) {
  await workStore.deleteMember(id);
  window.$message?.success('成员已删除');
}
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex flex-wrap items-center gap-12px">
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
          <NButton size="small" secondary @click="importShow = true">
            <template #icon><SvgIcon icon="lucide:file-spreadsheet" /></template>
            {{ bi('批量导入', 'Batch Import') }}
          </NButton>
          <NButton type="primary" size="small" @click="openAddMember">
            <template #icon><SvgIcon icon="lucide:user-plus" /></template>
            {{ bi('新增成员', 'Add Member') }}
          </NButton>
        </div>
      </template>

      <NTabs v-model:value="activeTab" type="segment" size="small" class="mb-14px w-220px">
        <NTab name="list" :tab="bi('列表', 'List View')" />
        <NTab name="roster" :tab="bi('座位图', 'Seat Map')" />
      </NTabs>

      <!-- 列表（默认页） -->
      <div v-if="activeTab === 'list'">
        <div class="mb-10px flex flex-wrap items-center justify-between gap-10px">
          <div class="flex flex-nowrap items-center gap-8px overflow-x-auto">
            <div class="w-150px shrink-0">
              <NSelect
                v-model:value="typeFilter"
                :options="[{ label: bi('全部身份', 'All Status'), value: '' }, ...typeOptions]"
                size="small"
                @update:value="pagination.page = 1"
              />
            </div>
            <div class="w-230px shrink-0">
              <NInput
                v-model:value="searchKeyword"
                size="small"
                clearable
                :placeholder="bi('搜索姓名、学号、编号、导师…', 'Search name, ID, code, advisor…')"
                @update:value="pagination.page = 1"
              >
                <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
              </NInput>
            </div>
            <NPopover trigger="click" placement="bottom-start" :width="400">
              <template #trigger>
                <NButton size="small" secondary class="shrink-0">
                  <template #icon><SvgIcon icon="lucide:columns-3" /></template>
                  {{ bi(`列设置（${visibleColKeys.length + 1}/${COLUMN_PICKER_META.length + 1}）`, 'Columns') }}
                </NButton>
              </template>
              <div class="flex flex-col gap-10px p-4px">
                <div class="flex items-center justify-between gap-8px">
                  <span class="text-13px font-semibold">{{ bi('自定义显示列', 'Visible Columns') }}</span>
                  <div class="flex items-center gap-6px">
                    <NButton size="tiny" secondary @click="applyColPreset('default')">
                      {{ bi('默认', 'Default') }}
                    </NButton>
                    <NButton size="tiny" secondary @click="applyColPreset('roster')">
                      {{ bi('花名册全列', 'Roster') }}
                    </NButton>
                    <NButton size="tiny" secondary @click="applyColPreset('all')">{{ bi('全部', 'All') }}</NButton>
                  </div>
                </div>
                <NCheckboxGroup v-model:value="visibleColKeys">
                  <div class="grid grid-cols-2 gap-x-10px gap-y-6px">
                    <NCheckbox v-for="col in COLUMN_PICKER_META" :key="col.key" :value="col.key" size="small">
                      <span class="text-12px">{{ bi(col.labelZh, col.labelEn) }}</span>
                    </NCheckbox>
                  </div>
                </NCheckboxGroup>
                <div
                  class="border-t border-gray-100 pt-6px text-11px leading-relaxed text-gray-400 dark:border-gray-800"
                >
                  {{
                    bi(
                      '「姓名」与「操作」列常驻显示；「身份证号」每次刷新自动恢复隐藏，展示时亦默认脱敏（点表头眼睛临时查看 15 秒后自动隐藏）。',
                      'Name & Actions stay pinned; ID Card auto-hides on reload and masks values by default.'
                    )
                  }}
                </div>
              </div>
            </NPopover>
            <NButton
              size="small"
              secondary
              class="shrink-0"
              :disabled="!hasCustomLayout"
              @click="handleResetTableLayout"
            >
              <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
              {{ bi('重置列宽', 'Reset Columns') }}
            </NButton>
          </div>
          <span class="text-12px text-gray-400">
            {{
              bi(
                '拖拽表头可换列顺序 · 拖右侧边线调列宽（自动记忆）',
                'Drag headers to reorder · Drag edge to resize (saved)'
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
          :scroll-x="tableScrollX"
          :row-key="(r: MemberRow) => r.id"
          :row-props="(r: MemberRow) => ({ style: 'cursor: pointer', onClick: () => openCard(r.id) })"
        />
      </div>

      <!-- 座位图 -->
      <div v-else>
        <!-- 空布区时展示预设模板选择 + 自定义新建 -->
        <div v-if="!workStore.seatMaps.length" class="flex flex-col gap-14px py-8px">
          <div class="flex flex-wrap items-center justify-between gap-10px">
            <NAlert type="info" :show-icon="true" class="flex-1">
              {{
                bi(
                  '当前暂无座位图布区，可点击预设模板（支持自定义名称与行列数）或直接新建自定义尺寸布区：',
                  'No seat maps yet. Pick a preset (customizable name & size) or create a custom layout:'
                )
              }}
            </NAlert>
            <NButton size="small" type="primary" @click="openCreateSeatMapModal()">
              <template #icon><SvgIcon icon="lucide:plus" /></template>
              {{ bi('自定义新建布区', 'Custom Seat Map') }}
            </NButton>
          </div>
          <div class="grid grid-cols-1 gap-12px sm:grid-cols-2 lg:grid-cols-4">
            <div
              v-for="preset in SEAT_MAP_PRESETS"
              :key="preset.id"
              class="flex flex-col justify-between gap-10px border border-gray-200 rounded-10px bg-[var(--sct-soft)] p-14px transition-all dark:border-gray-700 hover:border-[var(--sct-accent)]"
            >
              <div class="flex flex-col gap-6px">
                <div class="flex items-center justify-between">
                  <span class="inline-flex items-center gap-6px text-14px font-bold">
                    <SvgIcon :icon="preset.icon" class="text-16px text-[var(--sct-accent)]" />
                    {{ preset.name }}
                  </span>
                  <NTag size="tiny" :bordered="false">{{ preset.rows }}×{{ preset.cols }}</NTag>
                </div>
                <div class="text-12px leading-relaxed text-gray-500">{{ preset.desc }}</div>
              </div>
              <NButton size="small" type="primary" secondary @click="openCreateSeatMapModal(preset)">
                <template #icon><SvgIcon icon="lucide:sliders-horizontal" /></template>
                使用并自定义
              </NButton>
            </div>
          </div>
        </div>

        <template v-else>
          <div class="mb-12px flex flex-wrap items-center justify-between gap-10px">
            <NTabs v-model:value="activeMapId" type="bar" size="small" class="min-w-0 flex-1">
              <NTab v-for="m in workStore.seatMaps" :key="m.map_id" :name="m.map_id" :tab="m.name" />
            </NTabs>
            <div class="flex shrink-0 items-center gap-8px">
              <NButton v-if="activeMap" size="tiny" secondary @click="openEditSeatMapModal">
                <template #icon><SvgIcon icon="lucide:pencil" /></template>
                {{ bi('编辑布区', 'Edit Map') }}
              </NButton>
              <NPopover trigger="click" placement="bottom-end" :width="290">
                <template #trigger>
                  <NButton size="tiny" secondary>
                    <template #icon><SvgIcon icon="lucide:layout-grid" /></template>
                    {{ bi('新建 / 预设模板', 'New / Presets') }}
                  </NButton>
                </template>
                <div class="flex flex-col gap-6px p-2px">
                  <div class="px-4px text-12px text-gray-500 font-semibold">
                    {{ bi('选预设（可改名和行列）', 'Presets (Editable)') }}
                  </div>
                  <div
                    v-for="preset in SEAT_MAP_PRESETS"
                    :key="preset.id"
                    class="flex cursor-pointer items-center justify-between rounded-6px px-8px py-6px hover:bg-[var(--sct-soft)]"
                    @click="openCreateSeatMapModal(preset)"
                  >
                    <div class="flex items-center gap-6px">
                      <SvgIcon :icon="preset.icon" class="text-14px text-[var(--sct-accent)]" />
                      <div>
                        <div class="text-12px font-medium">{{ preset.name }}</div>
                        <div class="text-11px text-gray-400">{{ preset.rows }} 行 × {{ preset.cols }} 列</div>
                      </div>
                    </div>
                    <SvgIcon icon="lucide:plus" class="text-13px text-gray-400" />
                  </div>
                  <div class="mt-2px border-t border-gray-100 pt-6px dark:border-gray-800">
                    <NButton size="tiny" type="primary" secondary block @click="openCreateSeatMapModal()">
                      <template #icon><SvgIcon icon="lucide:plus-square" /></template>
                      {{ bi('完全自定义新建布区…', 'Custom Rows & Cols…') }}
                    </NButton>
                  </div>
                </div>
              </NPopover>
            </div>
          </div>
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
        </template>
      </div>
    </NCard>

    <!-- 人员卡 -->
    <MemberCard v-model:show="cardShow" :member-id="cardMemberId" @edit="openEditMember" />

    <!-- 批量导入向导 -->
    <MemberImportModal v-model:show="importShow" />

    <!-- 新建 / 编辑座位图布区（预设可改名 + 自定义行数/列数） -->
    <NModal
      v-model:show="seatMapModalShow"
      preset="card"
      :title="
        seatMapModalMode === 'edit' ? bi('编辑座位图布区', 'Edit Seat Map') : bi('新建座位图布区', 'Create Seat Map')
      "
      class="w-480px max-w-95vw"
    >
      <div class="flex flex-col gap-12px">
        <div v-if="seatMapModalMode === 'create'" class="flex flex-wrap items-center gap-6px">
          <span class="text-12px text-gray-500">{{ bi('快捷套用预设：', 'Presets:') }}</span>
          <NButton
            v-for="preset in SEAT_MAP_PRESETS"
            :key="preset.id"
            size="tiny"
            secondary
            @click="fillSeatMapFormFromPreset(preset)"
          >
            {{ preset.name }}（{{ preset.rows }}×{{ preset.cols }}）
          </NButton>
        </div>

        <NForm label-placement="left" label-width="92" size="small">
          <NFormItem required>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:tag" class="sct-field-icon" />
                <span>{{ bi('布区名称', 'Map Name') }}</span>
              </span>
            </template>
            <NInput
              v-model:value="seatMapForm.name"
              :placeholder="bi('如：教六 1115 会议室 / 实验室 A 区', 'e.g. Lab A / Room 1115')"
              maxlength="30"
            />
          </NFormItem>
          <div class="grid grid-cols-2 gap-12px">
            <NFormItem required>
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:rows-3" class="sct-field-icon" />
                  <span>{{ bi('行数', 'Rows') }}</span>
                </span>
              </template>
              <NInputNumber v-model:value="seatMapForm.rows" :min="1" :max="20" class="w-full" />
            </NFormItem>
            <NFormItem required>
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:columns-3" class="sct-field-icon" />
                  <span>{{ bi('列数', 'Cols') }}</span>
                </span>
              </template>
              <NInputNumber v-model:value="seatMapForm.cols" :min="1" :max="20" class="w-full" />
            </NFormItem>
          </div>
        </NForm>

        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-12px text-gray-500">
          {{ bi('布区规格预览：', 'Capacity: ') }}
          <strong>{{ seatMapForm.rows }} {{ bi('行', 'rows') }} × {{ seatMapForm.cols }} {{ bi('列', 'cols') }}</strong>
          （{{ bi('共', 'Total') }}
          <strong>{{ (seatMapForm.rows || 0) * (seatMapForm.cols || 0) }}</strong>
          {{ bi('个座位', 'seats') }}）
        </div>

        <NAlert v-if="seatMapOverflowCount > 0" type="warning" :show-icon="true">
          缩小尺寸后，有
          <strong>{{ seatMapOverflowCount }}</strong>
          位已入座成员超出新边界，保存时将自动释放回「未入座名单」（不删除成员档案）。
        </NAlert>
      </div>

      <template #footer>
        <div class="flex items-center justify-between gap-8px">
          <div>
            <NPopconfirm v-if="seatMapModalMode === 'edit'" @positive-click="handleDeleteActiveSeatMap">
              <template #trigger>
                <NButton size="small" type="error" ghost>
                  <template #icon><SvgIcon icon="lucide:trash-2" /></template>
                  {{ bi('删除此布区', 'Delete Map') }}
                </NButton>
              </template>
              {{
                bi(
                  '确认删除当前座位图布区？（成员档案保留，仅解除该图座位绑定）',
                  'Delete this seat map? Members stay intact.'
                )
              }}
            </NPopconfirm>
          </div>
          <div class="flex items-center gap-8px">
            <NButton size="small" @click="seatMapModalShow = false">{{ bi('取消', 'Cancel') }}</NButton>
            <NButton
              size="small"
              type="primary"
              :disabled="!seatMapForm.name.trim() || !seatMapForm.rows || !seatMapForm.cols"
              @click="handleSaveSeatMap"
            >
              <template #icon><SvgIcon icon="lucide:check" /></template>
              {{ seatMapModalMode === 'edit' ? bi('保存修改', 'Save') : bi('确认创建', 'Create') }}
            </NButton>
          </div>
        </div>
      </template>
    </NModal>

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

    <!-- 新增 / 编辑成员 -->
    <NModal
      v-model:show="addShow"
      preset="card"
      :title="editingMemberId ? '编辑成员档案' : '新增成员档案'"
      class="max-w-95vw w-720px"
    >
      <NForm label-placement="left" label-width="102" size="small">
        <div class="grid grid-cols-1 gap-x-14px sm:grid-cols-2">
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
                <SvgIcon icon="lucide:hash" class="sct-field-icon" />
                <span>支部编号</span>
              </span>
            </template>
            <NInput
              v-model:value="addForm.code"
              :placeholder="`留空自动生成：${nextAutoCodePreview}（${branchAbbrHint}+3位）`"
            />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:building-2" class="sct-field-icon" />
                <span>支部名称</span>
              </span>
            </template>
            <NInput v-model:value="addForm.branch_name" :placeholder="workStore.branchName" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:id-card" class="sct-field-icon" />
                <span>学号</span>
              </span>
            </template>
            <NInput v-model:value="addForm.student_id" placeholder="选填" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:users" class="sct-field-icon" />
                <span>性别</span>
              </span>
            </template>
            <NSelect v-model:value="addForm.gender" :options="genderOptions" clearable placeholder="请选择" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:flag" class="sct-field-icon" />
                <span>民族</span>
              </span>
            </template>
            <NInput v-model:value="addForm.ethnicity" placeholder="如 汉族" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:cake" class="sct-field-icon" />
                <span>出生年月</span>
              </span>
            </template>
            <NInput v-model:value="addForm.birth_date" placeholder="如 2001-05" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:phone" class="sct-field-icon" />
                <span>联系电话</span>
              </span>
            </template>
            <NInput v-model:value="addForm.phone" placeholder="选填" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:home" class="sct-field-icon" />
                <span>宿舍楼栋</span>
              </span>
            </template>
            <NInput v-model:value="addForm.dorm_building" placeholder="如 西区3舍" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:door-open" class="sct-field-icon" />
                <span>宿舍号</span>
              </span>
            </template>
            <NInput v-model:value="addForm.dorm_room" placeholder="如 402" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:layers" class="sct-field-icon" />
                <span>层次</span>
              </span>
            </template>
            <NInput v-model:value="addForm.level" placeholder="如 硕士 / 博士 / 本科" />
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
                <SvgIcon icon="lucide:school" class="sct-field-icon" />
                <span>班级</span>
              </span>
            </template>
            <NInput v-model:value="addForm.class_name" placeholder="如 计硕2501" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:user-check" class="sct-field-icon" />
                <span>导师姓名</span>
              </span>
            </template>
            <NInput v-model:value="addForm.advisor" />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:network" class="sct-field-icon" />
                <span>党小组</span>
              </span>
            </template>
            <NSelect
              v-model:value="addForm.group"
              :options="workStore.partyGroupNames.map(g => ({ label: g, value: g }))"
              filterable
              tag
              clearable
              placeholder="选择或输入，如：第一党小组"
            />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:calendar" class="sct-field-icon" />
                <span>入党时间</span>
              </span>
            </template>
            <NDatePicker
              :formatted-value="addForm.join_date"
              type="date"
              value-format="yyyy-MM-dd"
              clearable
              class="w-full"
              placeholder="接收为预备党员日期"
              @update:formatted-value="handleJoinDateChange"
            />
          </NFormItem>
          <NFormItem>
            <template #label>
              <span class="sct-field-label">
                <SvgIcon icon="lucide:calendar-check-2" class="sct-field-icon" />
                <span>转正时间</span>
              </span>
            </template>
            <NDatePicker
              :formatted-value="addForm.full_date"
              type="date"
              value-format="yyyy-MM-dd"
              clearable
              class="w-full"
              placeholder="默认按入党满 1 年计算"
              @update:formatted-value="handleFullDateChange"
            />
          </NFormItem>
        </div>

        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:shield-alert" class="sct-field-icon" />
              <span>身份证号</span>
            </span>
          </template>
          <NInput
            v-model:value="addForm.id_card"
            type="password"
            show-password-on="mousedown"
            placeholder="选填（仅存本机，列表默认自动隐藏并脱敏）"
            :maxlength="20"
          />
        </NFormItem>

        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:award" class="sct-field-icon" />
              <span>党员身份</span>
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

        <div
          v-if="effectiveFormType === '正式党员' || effectiveFormType === '预备党员'"
          class="grid grid-cols-1 gap-x-14px sm:grid-cols-2"
        >
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
            <NInputNumber v-model:value="addForm.fee_monthly" :min="0" :step="0.5" :precision="1" class="w-full">
              <template #suffix>元/月</template>
            </NInputNumber>
          </NFormItem>
        </div>

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
