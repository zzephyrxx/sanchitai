<script setup lang="ts">
import { computed, h, onUnmounted, reactive, ref, watch } from 'vue';
import { NButton, NDropdown, NTag } from 'naive-ui';
import type { DropdownOption } from 'naive-ui';
import dayjs from 'dayjs';
import { FEE_STANDARD, MEMBER_TYPE_COLORS, MEMBER_TYPE_ORDER } from '@/constants/sanchitai';
import { MEMBER_LIFECYCLE_META, getMemberLifecycle } from '@/constants/workspace-presets';
import { generateNextMemberCode, getBranchAbbreviation, maskIdCard } from '@/utils/member-code';
import {
  computeDefaultFullDate,
  describePartyStatusRule,
  isPartyStatusAutoComputed,
  resolveEffectiveFullDate,
  resolveMemberTypeByDates
} from '@/utils/member-status';
import { onTourCommand } from '@/utils/onboarding-bus';
import { buildSeatSheet, printHtml } from '@/utils/print';
import { formatIdCardForExport, formatPhoneForExport, privacyModeFileSuffix } from '@/utils/privacy-export';
import { exportTransferRegistryExcel } from '@/utils/transfer';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSvgIcon } from '@/hooks/common/icon';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import { useTableColumnLayout } from '@/hooks/common/table-layout';
import PrivacyExportModal from '@/components/custom/privacy-export-modal.vue';
import BatchTransferOutModal from './modules/batch-transfer-out-modal.vue';
import IncomingAuditPanel from './modules/incoming-audit-panel.vue';
import MemberCard from './modules/member-card.vue';
import MemberImportModal from './modules/member-import-modal.vue';
import RosterBoard from './modules/roster-board.vue';
import TransferOutDrawer from './modules/transfer-out-drawer.vue';

defineOptions({ name: 'MembersPage' });

const workStore = useWorkDataStore();
const { SvgIconVNode } = useSvgIcon();
const { bi, tMemberType } = useSctI18n();

// ---------------- 生命周期状态 KPI 胶囊切换 ----------------
type LifecycleScope = 'active' | 'transferring_out' | 'incoming_audit' | 'floating' | 'archived';
const lifecycleScope = ref<LifecycleScope>('active');

const seatmapEnabled = computed(() => workStore.workspaceConfig.enabledModules.seatmap);
const customFieldDefs = computed(() => workStore.workspaceConfig.customFields);

// ---------------- 花名册自定义扩展字段管理（集成在列设置中） ----------------
const customFieldModalShow = ref(false);
const customFieldForm = reactive({
  label: '',
  type: 'text' as 'text' | 'select',
  optionsText: '',
  showInTable: true
});

function openAddCustomField() {
  customFieldForm.label = '';
  customFieldForm.type = 'text';
  customFieldForm.optionsText = '';
  customFieldForm.showInTable = true;
  customFieldModalShow.value = true;
}

async function handleAddCustomField() {
  const cleanLabel = customFieldForm.label.trim();
  if (!cleanLabel) {
    window.$message?.warning('请输入字段名称');
    return;
  }
  if (customFieldDefs.value.some(f => f.label === cleanLabel)) {
    window.$message?.warning(`字段「${cleanLabel}」已存在`);
    return;
  }
  const options =
    customFieldForm.type === 'select'
      ? customFieldForm.optionsText
          .split(/[,，、\n]+/)
          .map(s => s.trim())
          .filter(Boolean)
      : undefined;
  const newKey = `cf_${Date.now().toString(36).slice(-5)}`;
  const nextFields: Sct.CustomFieldDef[] = [
    ...customFieldDefs.value,
    {
      key: newKey,
      label: cleanLabel,
      type: customFieldForm.type,
      options,
      showInTable: customFieldForm.showInTable
    }
  ];
  await workStore.updateWorkspaceConfig({ customFields: nextFields });
  customFieldModalShow.value = false;
  window.$message?.success(`已新增自定义字段「${cleanLabel}」`);
}

async function toggleCustomFieldTableColumn(key: string, show: boolean) {
  const nextFields = customFieldDefs.value.map(f => (f.key === key ? { ...f, showInTable: show } : f));
  await workStore.updateWorkspaceConfig({ customFields: nextFields });
}

async function removeCustomField(key: string) {
  const nextFields = customFieldDefs.value.filter(f => f.key !== key);
  await workStore.updateWorkspaceConfig({ customFields: nextFields });
  window.$message?.success('已移除该自定义字段');
}

// ---------------- 视图与布区（默认打开列表页） ----------------
const activeTab = ref<'list' | 'roster'>('list');
watch(seatmapEnabled, enabled => {
  if (!enabled && activeTab.value === 'roster') {
    activeTab.value = 'list';
  }
});
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
  const active = workStore.activeMembers;
  const total = active.length;
  const typeCount = MEMBER_TYPE_ORDER.map(t => `${tMemberType(t)} ${active.filter(m => m.type === t).length}`).join(
    ' · '
  );
  return bi(`在册 ${total} 人 ｜ ${typeCount}`, `Active ${total} ｜ ${typeCount}`);
});

// ---------------- 组织关系转出 / 批量转出 / 流动登记 / 停止发展归档 / 隐私分级导出 ----------------
const transferDrawerShow = ref(false);
const transferMemberId = ref<string | null>(null);
const transferRecordId = ref<string | null>(null);
const batchTransferShow = ref(false);

function openTransferOut(memberId: string, recordId?: string | null) {
  transferMemberId.value = memberId;
  transferRecordId.value = recordId ?? null;
  transferDrawerShow.value = true;
}

const floatingModalShow = ref(false);
const floatingForm = reactive({
  member_id: null as string | null,
  direction: 'float_out' as 'float_out' | 'float_in',
  source_org: '',
  note: ''
});

function openFloatingModal(memberId?: string) {
  floatingForm.member_id = memberId ?? null;
  floatingForm.direction = 'float_out';
  floatingForm.source_org = '';
  floatingForm.note = '';
  floatingModalShow.value = true;
}

async function handleSaveFloating() {
  if (!floatingForm.member_id) {
    window.$message?.warning('请选择成员');
    return;
  }
  await workStore.setMemberFloating(
    floatingForm.member_id,
    floatingForm.direction,
    floatingForm.source_org,
    floatingForm.note
  );
  floatingModalShow.value = false;
  window.$message?.success('已更新流动党员状态');
}

const contactLogModalShow = ref(false);
const contactLogTransferId = ref<string | null>(null);
const contactLogSummary = ref('');

function openContactLogModal(transferId: string) {
  contactLogTransferId.value = transferId;
  contactLogSummary.value = '';
  contactLogModalShow.value = true;
}

async function handleSaveContactLog() {
  if (!contactLogTransferId.value || !contactLogSummary.value.trim()) {
    window.$message?.warning('请填写联系情况摘要');
    return;
  }
  await workStore.addFloatingContactLog(contactLogTransferId.value, contactLogSummary.value);
  contactLogModalShow.value = false;
  window.$message?.success('已记录流动党员联系日志');
}

const stopArchiveModalShow = ref(false);
const stopArchiveMemberId = ref<string | null>(null);
const stopArchiveReason = ref('');

function openStopArchiveModal(memberId: string) {
  stopArchiveMemberId.value = memberId;
  stopArchiveReason.value = '';
  stopArchiveModalShow.value = true;
}

async function handleConfirmStopArchive() {
  if (!stopArchiveMemberId.value) return;
  await workStore.archiveMemberStopped(stopArchiveMemberId.value, stopArchiveReason.value);
  stopArchiveModalShow.value = false;
  window.$message?.success('成员已移入历史归档（历史台账已完整保留）');
}

const outgoingTransferRows = computed(() => {
  return workStore.transferringOutMembers.map(member => {
    const transfer = workStore.transferRecords.find(
      r => r.member_id === member.id && r.direction === 'out' && r.status === '办理中'
    );
    return { member, transfer };
  });
});

const floatingTransferRows = computed(() => {
  return workStore.floatingMembers.map(member => {
    const transfer = workStore.transferRecords.find(
      r =>
        r.member_id === member.id &&
        (r.direction === 'float_out' || r.direction === 'float_in') &&
        r.status === '办理中'
    );
    return { member, transfer };
  });
});

const rosterExportShow = ref(false);
const rosterExportKind = ref<'roster' | 'transfer'>('roster');
const rosterExporting = ref(false);

function openRosterExport(kind: 'roster' | 'transfer') {
  rosterExportKind.value = kind;
  rosterExportShow.value = true;
}

async function handleConfirmRosterExport(privacyMode: Sct.ExportPrivacyMode) {
  rosterExporting.value = true;
  try {
    if (rosterExportKind.value === 'transfer') {
      const allOut = workStore.transferRecords.filter(r => r.direction === 'out' && r.status !== '已取消');
      const res = await exportTransferRegistryExcel({
        branchName: workStore.branchName,
        records: allOut.map(t => ({ transfer: t, member: workStore.memberOf(t.member_id) })),
        privacyMode
      });
      if (res === 'saved') {
        rosterExportShow.value = false;
        window.$message?.success('《组织关系转接登记表》已导出');
      }
      return;
    }

    const XLSX = await import('xlsx');
    const sourceList = lifecycleScope.value === 'archived' ? workStore.archivedMembers : listRows.value;
    const rows = sourceList.map((m, idx) => {
      const row: Record<string, unknown> = {
        序号: idx + 1,
        统一编号: m.code,
        支部名称: m.branch_name || workStore.branchName,
        姓名: m.name,
        政治面貌: m.type,
        状态: getMemberLifecycle(m),
        党内职务: m.role || '',
        党小组: m.group || '',
        学号: m.student_id || '',
        性别: m.gender || '',
        民族: m.ethnicity || '',
        出生年月: m.birth_date || '',
        层次: m.level || '',
        年级: m.grade || '',
        专业: m.major || '',
        班级: m.class_name || '',
        导师: m.advisor || '',
        宿舍: [m.dorm_building, m.dorm_room].filter(Boolean).join('-')
      };
      for (const cf of customFieldDefs.value) {
        row[cf.label] = m.custom_fields?.[cf.key] || '';
      }
      row.入党时间 = m.join_date || '';
      row.转正时间 = resolveEffectiveFullDate(m.join_date, m.full_date, m.key_dates?.probation_end) || '';
      row.联系电话 = formatPhoneForExport(m.phone, privacyMode);
      row.身份证号 = formatIdCardForExport(m.id_card, privacyMode);
      return row;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 提示: '暂无人员记录' }]);
    XLSX.utils.book_append_sheet(wb, ws, lifecycleScope.value === 'archived' ? '历史归档名册' : '在册人员花名册');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const { saveFileWithPicker } = await import('@/utils/save-file');
    const res = await saveFileWithPicker(blob, {
      suggestedName: `${workStore.branchName}_花名册${privacyModeFileSuffix(privacyMode)}_${dayjs().format('YYYYMMDD')}.xlsx`,
      types: [
        {
          description: 'Excel 工作簿',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          extensions: ['.xlsx']
        }
      ]
    });
    if (res.status === 'saved') {
      rosterExportShow.value = false;
      window.$message?.success('人员花名册已导出');
    }
  } finally {
    rosterExporting.value = false;
  }
}

// ---------------- 人员卡 ----------------
const cardShow = ref(false);
const cardMemberId = ref<string | null>(null);
function openCard(memberId: string) {
  cardMemberId.value = memberId;
  cardShow.value = true;
}

const offMembersTour = onTourCommand(cmd => {
  if (cmd === 'members:open-first-card') {
    lifecycleScope.value = 'active';
    activeTab.value = 'list';
    const first = workStore.activeMembers[0];
    if (first) openCard(first.id);
  } else if (cmd === 'members:show-seatmap') {
    cardShow.value = false;
    lifecycleScope.value = 'active';
    if (seatmapEnabled.value) activeTab.value = 'roster';
  } else if (cmd === 'members:reset' || cmd === 'tour:cleanup') {
    cardShow.value = false;
    lifecycleScope.value = 'active';
    activeTab.value = 'list';
  }
});
onUnmounted(offMembersTour);

// ---------------- 空位安排成员 ----------------
const pickerShow = ref(false);
const pickerPos = ref<{ x: number; y: number } | null>(null);
const unseatedOptions = computed(() =>
  workStore.activeMembers.filter(m => !m.seat).map(m => ({ label: `${m.name}（${m.type}）`, value: m.id }))
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
  return workStore.activeMembers
    .filter(m => !typeFilter.value || m.type === typeFilter.value)
    .filter(m => {
      if (!kw) return true;
      const customVals = Object.values(m.custom_fields ?? {});
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
        m.department,
        m.job_title,
        m.office_location,
        m.phone,
        m.type,
        m.role,
        m.group,
        m.advisor,
        ...customVals
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
  ...Object.fromEntries(
    customFieldDefs.value.map(cf => [
      cf.key,
      {
        key: cf.key,
        defaultWidth: 118,
        minWidth: 82,
        ellipsis: { tooltip: true },
        titleContent: () => colHeader('lucide:tag', cf.label),
        sorter: (a: MemberRow, b: MemberRow) =>
          (a.custom_fields?.[cf.key] ?? '').localeCompare(b.custom_fields?.[cf.key] ?? '', 'zh-CN'),
        render: (row: MemberRow) => row.custom_fields?.[cf.key] || '—'
      }
    ])
  ),
  op: {
    key: 'op',
    defaultWidth: 256,
    fixed: 'right' as const,
    resizable: false,
    reorderable: false,
    titleContent: () => colHeader('lucide:sliders-horizontal', bi('操作', 'Actions')),
    render: (row: MemberRow) => {
      const moreOptions: DropdownOption[] = [
        { label: bi('登记为流动党员', 'Mark Floating'), key: 'floating' },
        { label: bi('加入转入档案核查', 'Incoming Audit'), key: 'audit' },
        { label: bi('停止发展 / 历史归档', 'Archive (Stopped)'), key: 'stop' },
        { type: 'divider', key: 'd1' },
        { label: bi('永久删除（仅限误录入）', 'Permanent Delete'), key: 'delete' }
      ];
      return h('div', { class: 'flex items-center gap-6px', onClick: (e: MouseEvent) => e.stopPropagation() }, [
        h(
          NButton,
          {
            size: 'tiny',
            class: 'sct-op-btn sct-op-btn--info',
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
            class: 'sct-op-btn sct-op-btn--neutral',
            onClick: () => openEditMember(row)
          },
          {
            icon: SvgIconVNode({ icon: 'lucide:pencil', fontSize: 13 }),
            default: () => bi('编辑', 'Edit')
          }
        ),
        h(
          NButton,
          {
            size: 'tiny',
            class: 'sct-op-btn sct-op-btn--primary',
            onClick: () => openTransferOut(row.id)
          },
          {
            icon: SvgIconVNode({ icon: 'lucide:send', fontSize: 12 }),
            default: () => bi('转出', 'Transfer')
          }
        ),
        h(
          NDropdown,
          {
            trigger: 'click',
            options: moreOptions,
            onSelect: (key: string) => handleMemberMoreAction(row, key)
          },
          {
            default: () =>
              h(
                NButton,
                {
                  size: 'tiny',
                  class: 'sct-op-btn sct-op-btn--neutral'
                },
                {
                  icon: SvgIconVNode({ icon: 'lucide:ellipsis', fontSize: 13 })
                }
              )
          }
        )
      ]);
    }
  }
}));

const visibleCustomColKeys = computed(() => customFieldDefs.value.filter(f => f.showInTable).map(f => f.key));
const activeVisibleKeys = computed(() => [...visibleColKeys.value, ...visibleCustomColKeys.value, 'name', 'op']);

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
  department: '',
  job_title: '',
  office_location: '',
  custom_fields: {} as Record<string, string>,
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
    department: '',
    job_title: '',
    office_location: '',
    custom_fields: {},
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
    department: row.department ?? '',
    job_title: row.job_title ?? '',
    office_location: row.office_location ?? '',
    custom_fields: { ...row.custom_fields },
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
    department: addForm.department.trim(),
    job_title: addForm.job_title.trim(),
    office_location: addForm.office_location.trim(),
    custom_fields: { ...addForm.custom_fields },
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
  const ok = await workStore.deleteMember(id);
  if (ok) {
    window.$message?.success('成员已永久删除');
  }
}

async function handleMemberMoreAction(row: MemberRow, key: string) {
  if (key === 'floating') {
    openFloatingModal(row.id);
  } else if (key === 'audit') {
    await workStore.markMemberIncomingAudit(row.id, '');
    lifecycleScope.value = 'incoming_audit';
    window.$message?.success(`已将「${row.name}」加入转入档案核查矩阵`);
  } else if (key === 'stop') {
    openStopArchiveModal(row.id);
  } else if (key === 'delete') {
    await removeMember(row.id);
  }
}

async function handleRestoreMember(id: string, name: string) {
  await workStore.restoreMemberToActive(id);
  window.$message?.success(`已将「${name}」恢复为在册正常`);
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
        <div data-tour="members-actions" class="flex flex-wrap items-center gap-8px">
          <span
            v-if="lifecycleScope === 'active' && activeTab === 'roster'"
            class="flex items-center gap-6px text-13px"
          >
            {{ bi('编排模式', 'Edit Layout') }}
            <NSwitch v-model:value="editable" size="small" />
          </span>
          <NButton
            v-if="lifecycleScope === 'active' && activeTab === 'roster' && editable"
            size="small"
            secondary
            :disabled="!undoStack.length"
            @click="handleUndo"
          >
            <template #icon><SvgIcon icon="lucide:undo-2" /></template>
            {{ bi('撤销', 'Undo') }}
          </NButton>
          <NButton
            v-if="lifecycleScope === 'active' && activeTab === 'roster'"
            size="small"
            secondary
            @click="printSeatMap"
          >
            <template #icon><SvgIcon icon="lucide:printer" /></template>
            {{ bi('打印座次表', 'Print Seat Map') }}
          </NButton>
          <NButton size="small" secondary @click="batchTransferShow = true">
            <template #icon><SvgIcon icon="lucide:send" /></template>
            {{ bi('批量转出', 'Batch Transfer') }}
          </NButton>
          <NButton
            size="small"
            secondary
            @click="openRosterExport(lifecycleScope === 'transferring_out' ? 'transfer' : 'roster')"
          >
            <template #icon><SvgIcon icon="lucide:download" /></template>
            {{ bi('导出', 'Export') }}
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

      <!-- 顶部全生命周期 KPI 胶囊状态栏（对标台历事项内缩竖条与 KONTUR 电子纸直角框线） -->
      <div data-tour="members-lifecycle" class="mb-14px flex flex-wrap items-center gap-8px">
        <button
          type="button"
          class="lifecycle-kpi-pill"
          :class="{ 'is-active': lifecycleScope === 'active' }"
          @click="lifecycleScope = 'active'"
        >
          <SvgIcon icon="lucide:users" class="text-14px text-[#16a34a]" />
          <span>{{ bi('在册人员', 'Active') }}</span>
          <b class="font-mono">{{ workStore.activeMembers.length }}</b>
        </button>

        <button
          type="button"
          class="lifecycle-kpi-pill lifecycle-kpi-pill--warn"
          :class="{ 'is-active': lifecycleScope === 'transferring_out' }"
          @click="lifecycleScope = 'transferring_out'"
        >
          <SvgIcon icon="lucide:send" class="text-14px text-[#dc2626]" />
          <span>{{ bi('转出办理中', 'Transferring Out') }}</span>
          <b class="font-mono" :style="{ color: workStore.transferringOutMembers.length ? '#dc2626' : undefined }">
            {{ workStore.transferringOutMembers.length }}
          </b>
          <span v-if="workStore.transferringOutMembers.length" class="lifecycle-dot lifecycle-dot--red" />
        </button>

        <button
          type="button"
          class="lifecycle-kpi-pill lifecycle-kpi-pill--amber"
          :class="{ 'is-active': lifecycleScope === 'incoming_audit' }"
          @click="lifecycleScope = 'incoming_audit'"
        >
          <SvgIcon icon="lucide:file-search" class="text-14px text-[#d97706]" />
          <span>{{ bi('转入待核查', 'Incoming Audit') }}</span>
          <b class="font-mono" :style="{ color: workStore.incomingAuditMembers.length ? '#d97706' : undefined }">
            {{ workStore.incomingAuditMembers.length }}
          </b>
          <span v-if="workStore.incomingAuditMembers.length" class="lifecycle-dot lifecycle-dot--amber" />
        </button>

        <button
          type="button"
          class="lifecycle-kpi-pill lifecycle-kpi-pill--info"
          :class="{ 'is-active': lifecycleScope === 'floating' }"
          @click="lifecycleScope = 'floating'"
        >
          <SvgIcon icon="lucide:compass" class="text-14px text-[#2563eb]" />
          <span>{{ bi('流动党员', 'Floating') }}</span>
          <b class="font-mono">{{ workStore.floatingMembers.length }}</b>
        </button>

        <button
          type="button"
          class="lifecycle-kpi-pill"
          :class="{ 'is-active': lifecycleScope === 'archived' }"
          @click="lifecycleScope = 'archived'"
        >
          <SvgIcon icon="lucide:archive" class="text-14px text-[var(--sct-muted)]" />
          <span>{{ bi('历史归档', 'Archived') }}</span>
          <b class="font-mono">{{ workStore.archivedMembers.length }}</b>
        </button>
      </div>

      <!-- 视图 A：在册人员（列表 / 座位图双视图） -->
      <template v-if="lifecycleScope === 'active'">
        <div data-tour="members-view-tabs" class="inline-block">
          <NTabs v-if="seatmapEnabled" v-model:value="activeTab" type="segment" size="small" class="mb-14px w-220px">
            <NTab name="list" :tab="bi('列表', 'List View')" />
            <NTab name="roster" :tab="bi('座位图', 'Seat Map')" />
          </NTabs>
        </div>

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
              <NPopover trigger="click" placement="bottom-start" :width="430">
                <template #trigger>
                  <NButton size="small" secondary class="shrink-0">
                    <template #icon><SvgIcon icon="lucide:columns-3" /></template>
                    {{
                      bi(
                        `列设置（${visibleColKeys.length + visibleCustomColKeys.length + 1}/${COLUMN_PICKER_META.length + customFieldDefs.length + 1}）`,
                        'Columns'
                      )
                    }}
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

                  <!-- 花名册自定义扩展字段（直接支持列显隐 + 新增/删除） -->
                  <div class="border-t border-dashed border-[var(--sct-border)] pt-8px">
                    <div class="mb-6px flex items-center justify-between gap-8px">
                      <span class="flex items-center gap-4px text-12px font-semibold text-[var(--sct-ink)]">
                        <SvgIcon icon="lucide:tags" class="text-13px text-[#A81C24]" />
                        <span>{{ bi('自定义扩展字段', 'Custom Fields') }}</span>
                      </span>
                      <NButton size="tiny" type="primary" secondary @click="openAddCustomField">
                        <template #icon><SvgIcon icon="lucide:plus" /></template>
                        {{ bi('新增字段', 'Add Field') }}
                      </NButton>
                    </div>
                    <div v-if="customFieldDefs.length" class="flex flex-col gap-5px">
                      <div
                        v-for="cf in customFieldDefs"
                        :key="cf.key"
                        class="flex items-center justify-between gap-8px rounded-6px bg-[var(--sct-soft)] px-8px py-4px"
                      >
                        <NCheckbox
                          :checked="Boolean(cf.showInTable)"
                          size="small"
                          @update:checked="val => toggleCustomFieldTableColumn(cf.key, val)"
                        >
                          <span class="text-12px">
                            {{ cf.label }}
                            <span class="text-10.5px text-[var(--sct-muted)]">
                              （{{ cf.type === 'select' ? '下拉' : '文本' }}）
                            </span>
                          </span>
                        </NCheckbox>
                        <NPopconfirm @positive-click="removeCustomField(cf.key)">
                          <template #trigger>
                            <NButton size="tiny" quaternary type="error">
                              <template #icon><SvgIcon icon="lucide:trash-2" class="text-12px" /></template>
                            </NButton>
                          </template>
                          确定移除字段「{{ cf.label }}」？
                        </NPopconfirm>
                      </div>
                    </div>
                    <div v-else class="text-11.5px text-[var(--sct-muted)]">
                      暂无自定义字段，点击右上角「新增字段」可按支部需要扩展（如：实验室、特长技能），自动联动人员编辑与导出。
                    </div>
                  </div>

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
        <div v-else data-tour="members-seatmap-area">
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
              :members="workStore.activeMembers"
              :fee-badges="feeBadges"
              :editable="editable"
              @move="handleMove"
              @open="openCard"
              @place-empty="openPicker"
            />
          </template>
        </div>
      </template>

      <!-- 视图 B：转出办理中 -->
      <div v-else-if="lifecycleScope === 'transferring_out'" class="flex flex-col gap-12px">
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <span class="text-12px text-[var(--sct-muted)]">
            {{
              bi(
                '已发起转出但尚未收回回执/办结的成员；办结后将自动移入历史归档，历史账目完整保留。',
                'Pending outgoing transfers awaiting receipt confirmation.'
              )
            }}
          </span>
          <div class="flex items-center gap-8px">
            <NButton size="small" secondary @click="openRosterExport('transfer')">
              <template #icon><SvgIcon icon="lucide:file-spreadsheet" /></template>
              导出《转接登记表》
            </NButton>
            <NButton size="small" type="primary" secondary @click="batchTransferShow = true">
              <template #icon><SvgIcon icon="lucide:send" /></template>
              毕业季批量转出
            </NButton>
          </div>
        </div>
        <div
          v-if="!outgoingTransferRows.length"
          class="rounded-8px border border-dashed border-[var(--sct-border)] py-36px text-center text-13px text-[var(--sct-muted)]"
        >
          当前没有待办结的关系转出记录。在「在册人员」列表点击任意成员的「转出」或点击右上角「批量转出」即可发起。
        </div>
        <div v-else class="overflow-x-auto rounded-8px border border-[var(--sct-border)]">
          <table class="w-full min-w-780px border-collapse text-12.5px">
            <thead>
              <tr
                class="border-b border-[var(--sct-border)] bg-[var(--sct-soft)] text-left text-11px text-[var(--sct-muted)]"
              >
                <th class="px-12px py-8px">姓名 / 身份</th>
                <th class="px-10px py-8px">转接方式</th>
                <th class="px-10px py-8px">接收党组织</th>
                <th class="px-10px py-8px">党费交至 / 档案去向</th>
                <th class="px-10px py-8px">发起日期 / 进度</th>
                <th class="px-10px py-8px text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in outgoingTransferRows"
                :key="row.member.id"
                class="border-b border-[var(--sct-border)] last:border-b-0 hover:bg-[var(--sct-page)]"
              >
                <td class="px-12px py-9px">
                  <div class="font-bold">{{ row.member.name }}</div>
                  <div class="text-11px text-[var(--sct-muted)]">{{ row.member.type }} · {{ row.member.code }}</div>
                </td>
                <td class="px-10px py-9px">
                  <NTag size="tiny" :bordered="false">{{ row.transfer?.transfer_mode ?? '线上系统转接' }}</NTag>
                  <div v-if="row.transfer?.letter_no" class="mt-2px font-mono text-11px text-[var(--sct-muted)]">
                    号：{{ row.transfer.letter_no }}
                  </div>
                </td>
                <td class="px-10px py-9px">
                  <div class="font-medium">{{ row.transfer?.target_branch || '未填具体支部' }}</div>
                  <div class="text-11px text-[var(--sct-muted)]">{{ row.transfer?.target_committee || '—' }}</div>
                </td>
                <td class="px-10px py-9px">
                  <div class="font-mono">{{ row.transfer?.fee_paid_until || '—' }}</div>
                  <div class="text-11px text-[var(--sct-muted)]">{{ row.transfer?.archive_dest || '—' }}</div>
                </td>
                <td class="px-10px py-9px">
                  <div class="font-mono">{{ row.transfer?.initiated_date || '—' }}</div>
                  <div class="text-11px text-[#dc2626]">第 {{ row.transfer?.step ?? 1 }} / 4 步 · 待回执</div>
                </td>
                <td class="px-10px py-9px text-right">
                  <div class="flex items-center justify-end gap-6px">
                    <NButton
                      size="tiny"
                      class="sct-op-btn sct-op-btn--primary"
                      @click="openTransferOut(row.member.id, row.transfer?.id)"
                    >
                      继续办理 / 录回执
                    </NButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 视图 C：转入待核查（多人核查矩阵 + 核实函） -->
      <IncomingAuditPanel v-else-if="lifecycleScope === 'incoming_audit'" />

      <!-- 视图 D：流动党员（流出/流入 + 定期联系日志） -->
      <div v-else-if="lifecycleScope === 'floating'" class="flex flex-col gap-12px">
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <span class="text-12px text-[var(--sct-muted)]">
            追踪长期外出实习、联培、驻外等流出党员与来本支部参加组织生活的流入党员，留存定期联系日志。
          </span>
          <NButton size="small" type="primary" secondary @click="openFloatingModal()">
            <template #icon><SvgIcon icon="lucide:compass" /></template>
            登记流动党员
          </NButton>
        </div>
        <div
          v-if="!floatingTransferRows.length"
          class="rounded-8px border border-dashed border-[var(--sct-border)] py-36px text-center text-13px text-[var(--sct-muted)]"
        >
          当前暂无流动党员记录。
        </div>
        <div v-else class="grid grid-cols-1 gap-10px md:grid-cols-2">
          <div
            v-for="row in floatingTransferRows"
            :key="row.member.id"
            class="flex flex-col justify-between gap-10px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] p-12px"
          >
            <div>
              <div class="flex items-center justify-between gap-8px">
                <div class="flex items-center gap-6px">
                  <span class="text-14px font-bold">{{ row.member.name }}</span>
                  <NTag
                    size="tiny"
                    :type="getMemberLifecycle(row.member) === '流出党员' ? 'info' : 'success'"
                    :bordered="false"
                  >
                    {{ getMemberLifecycle(row.member) }}
                  </NTag>
                </div>
                <span class="font-mono text-11px text-[var(--sct-muted)]">
                  {{ row.transfer?.initiated_date || '' }}
                </span>
              </div>
              <div class="mt-6px text-12px text-[var(--sct-muted)]">
                去向/来源：{{ row.transfer?.source_org || '未填写' }}
              </div>
              <div
                v-if="row.transfer?.contact_logs?.length"
                class="mt-8px flex flex-col gap-4px border-t border-dashed border-[var(--sct-border)] pt-6px text-11.5px"
              >
                <div v-for="(log, idx) in row.transfer.contact_logs.slice(-3)" :key="idx" class="text-[var(--sct-ink)]">
                  <span class="font-mono text-[var(--sct-muted)]">{{ log.date }}</span>
                  · {{ log.summary }}
                </div>
              </div>
            </div>
            <div class="flex items-center justify-end gap-6px">
              <NButton
                v-if="row.transfer"
                size="tiny"
                class="sct-op-btn sct-op-btn--info"
                @click="openContactLogModal(row.transfer.id)"
              >
                记联系日志
              </NButton>
              <NButton
                size="tiny"
                class="sct-op-btn sct-op-btn--neutral"
                @click="handleRestoreMember(row.member.id, row.member.name)"
              >
                结束流动回归
              </NButton>
            </div>
          </div>
        </div>
      </div>

      <!-- 视图 E：历史归档库（已转出 / 停止发展） -->
      <div v-else class="flex flex-col gap-12px">
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <span class="text-12px text-[var(--sct-muted)]">
            历史归档库永久保留已转出、停止发展成员的全部往年党费、考勤、发展材料、谈话、积分与志愿记录，支持随时查档或恢复在册。
          </span>
          <NButton size="small" secondary @click="openRosterExport('roster')">
            <template #icon><SvgIcon icon="lucide:download" /></template>
            导出历史归档名册
          </NButton>
        </div>
        <div
          v-if="!workStore.archivedMembers.length"
          class="rounded-8px border border-dashed border-[var(--sct-border)] py-36px text-center text-13px text-[var(--sct-muted)]"
        >
          历史归档库为空。
        </div>
        <div v-else class="overflow-x-auto rounded-8px border border-[var(--sct-border)]">
          <table class="w-full min-w-720px border-collapse text-12.5px">
            <thead>
              <tr
                class="border-b border-[var(--sct-border)] bg-[var(--sct-soft)] text-left text-11px text-[var(--sct-muted)]"
              >
                <th class="px-12px py-8px">姓名 / 编号</th>
                <th class="px-10px py-8px">原身份</th>
                <th class="px-10px py-8px">归档状态</th>
                <th class="px-10px py-8px">归档日期 / 去向说明</th>
                <th class="px-10px py-8px text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in workStore.archivedMembers"
                :key="m.id"
                class="border-b border-[var(--sct-border)] last:border-b-0 hover:bg-[var(--sct-page)]"
              >
                <td class="px-12px py-9px">
                  <div class="font-bold">{{ m.name }}</div>
                  <div class="font-mono text-11px text-[var(--sct-muted)]">{{ m.code }}</div>
                </td>
                <td class="px-10px py-9px">{{ m.type }}</td>
                <td class="px-10px py-9px">
                  <NTag size="tiny" :type="MEMBER_LIFECYCLE_META[getMemberLifecycle(m)].tagType" :bordered="false">
                    {{ getMemberLifecycle(m) }}
                  </NTag>
                </td>
                <td class="px-10px py-9px">
                  <div class="font-mono text-11.5px">{{ m.archived_at || '—' }}</div>
                  <div class="text-11.5px text-[var(--sct-muted)]">{{ m.archive_reason || '—' }}</div>
                </td>
                <td class="px-10px py-9px text-right">
                  <div class="flex items-center justify-end gap-6px">
                    <NButton size="tiny" class="sct-op-btn sct-op-btn--info" @click="openCard(m.id)">
                      历史全景卡
                    </NButton>
                    <NButton
                      size="tiny"
                      class="sct-op-btn sct-op-btn--neutral"
                      @click="handleRestoreMember(m.id, m.name)"
                    >
                      恢复在册
                    </NButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </NCard>

    <!-- 人员卡 -->
    <MemberCard
      v-model:show="cardShow"
      :member-id="cardMemberId"
      @edit="openEditMember"
      @transfer-out="openTransferOut"
    />

    <!-- 单人 4 步关系转出抽屉 -->
    <TransferOutDrawer
      v-model:show="transferDrawerShow"
      :member-id="transferMemberId"
      :transfer-id="transferRecordId"
    />

    <!-- 毕业季批量关系转出工作台 -->
    <BatchTransferOutModal v-model:show="batchTransferShow" />

    <!-- 全局隐私分级导出弹窗 -->
    <!-- 新增自定义扩展字段弹窗 -->
    <NModal v-model:show="customFieldModalShow" preset="card" title="新增花名册自定义字段" class="w-430px max-w-94vw">
      <NForm label-placement="left" label-width="86" size="small">
        <NFormItem required>
          <template #label><span class="sct-field-label">字段名称</span></template>
          <NInput
            v-model:value="customFieldForm.label"
            placeholder="如：所属实验室 / 特长技能 / 联系楼栋"
            maxlength="20"
          />
        </NFormItem>
        <NFormItem>
          <template #label><span class="sct-field-label">字段类型</span></template>
          <NRadioGroup v-model:value="customFieldForm.type" size="small">
            <NRadioButton value="text">文本输入</NRadioButton>
            <NRadioButton value="select">下拉选项</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NFormItem v-if="customFieldForm.type === 'select'">
          <template #label><span class="sct-field-label">选项列表</span></template>
          <NInput v-model:value="customFieldForm.optionsText" placeholder="用顿号或逗号分隔，如：一区、二区、三区" />
        </NFormItem>
        <NFormItem>
          <template #label><span class="sct-field-label">列表显示</span></template>
          <NSwitch v-model:value="customFieldForm.showInTable" size="small" />
          <span class="ml-8px text-12px text-[var(--sct-muted)]">立即作为花名册表格列展示</span>
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="customFieldModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="handleAddCustomField">添加字段</NButton>
        </div>
      </template>
    </NModal>

    <PrivacyExportModal
      v-model:show="rosterExportShow"
      :title="rosterExportKind === 'transfer' ? '导出《组织关系转接登记表》' : '导出人员花名册'"
      :loading="rosterExporting"
      @confirm="handleConfirmRosterExport"
    />

    <!-- 登记流动党员弹窗 -->
    <NModal
      v-model:show="floatingModalShow"
      preset="card"
      title="登记流动党员（流出 / 流入）"
      class="w-460px max-w-94vw"
    >
      <NForm label-placement="left" label-width="96" size="small">
        <NFormItem required>
          <template #label><span class="sct-field-label">选择成员</span></template>
          <NSelect
            v-model:value="floatingForm.member_id"
            :options="workStore.activeMembers.map(m => ({ label: `${m.name}（${m.type}）`, value: m.id }))"
            filterable
            placeholder="请选择成员"
          />
        </NFormItem>
        <NFormItem required>
          <template #label><span class="sct-field-label">流动方向</span></template>
          <NRadioGroup v-model:value="floatingForm.direction" size="small">
            <NRadioButton value="float_out">流出党员</NRadioButton>
            <NRadioButton value="float_in">流入党员</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NFormItem>
          <template #label><span class="sct-field-label">去向 / 来源</span></template>
          <NInput v-model:value="floatingForm.source_org" placeholder="流入地党组织/实习单位或原所属支部" />
        </NFormItem>
        <NFormItem>
          <template #label><span class="sct-field-label">备注</span></template>
          <NInput v-model:value="floatingForm.note" type="textarea" :rows="2" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="floatingModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="handleSaveFloating">确认登记</NButton>
        </div>
      </template>
    </NModal>

    <!-- 流动党员联系日志弹窗 -->
    <NModal v-model:show="contactLogModalShow" preset="card" title="记录流动党员联系情况" class="w-440px max-w-94vw">
      <NInput
        v-model:value="contactLogSummary"
        type="textarea"
        :rows="3"
        placeholder="填写本次电话/微信/线下联系的思想动态、学习与组织生活参与情况"
      />
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="contactLogModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="handleSaveContactLog">保存联系日志</NButton>
        </div>
      </template>
    </NModal>

    <!-- 停止发展 / 历史离队归档弹窗 -->
    <NModal v-model:show="stopArchiveModalShow" preset="card" title="停止发展 / 历史归档" class="w-440px max-w-94vw">
      <div class="flex flex-col gap-10px">
        <div class="text-12px text-[var(--sct-muted)]">
          该成员将移入「历史归档库」，退出当前在册花名册与未来统计，但完整保留其过往考察与活动记录，可随时恢复。
        </div>
        <NInput
          v-model:value="stopArchiveReason"
          type="textarea"
          :rows="2"
          placeholder="填写归档原因（如：毕业离校接续培养 / 本人撤回申请 / 考察调整）"
        />
      </div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="stopArchiveModalShow = false">取消</NButton>
          <NButton size="small" type="warning" @click="handleConfirmStopArchive">确认归档</NButton>
        </div>
      </template>
    </NModal>

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

        <!-- 用户自定义扩展字段 -->
        <div
          v-if="customFieldDefs.length"
          class="mb-10px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)]/50 p-10px"
        >
          <div class="mb-8px text-12px font-bold text-[var(--sct-ink)]">自定义扩展字段</div>
          <div class="grid grid-cols-1 gap-x-14px sm:grid-cols-2">
            <NFormItem v-for="cf in customFieldDefs" :key="cf.key">
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:tag" class="sct-field-icon" />
                  <span>{{ cf.label }}</span>
                </span>
              </template>
              <NSelect
                v-if="cf.type === 'select' && cf.options?.length"
                v-model:value="addForm.custom_fields[cf.key]"
                :options="cf.options.map(o => ({ label: o, value: o }))"
                clearable
                placeholder="请选择"
              />
              <NInput v-else v-model:value="addForm.custom_fields[cf.key]" placeholder="选填" />
            </NFormItem>
          </div>
        </div>
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

<style scoped>
.lifecycle-kpi-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 14px;
  border-radius: var(--sct-radius, 7px);
  border: 1px solid var(--sct-border);
  background: var(--sct-page);
  color: var(--sct-ink);
  font-size: 12.5px;
  cursor: pointer;
  transition:
    border-color 0.14s ease,
    background-color 0.14s ease;
}

.lifecycle-kpi-pill::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 5px;
  bottom: 5px;
  width: 3px;
  border-radius: 999px;
  background: transparent;
  transition: background-color 0.14s ease;
}

.lifecycle-kpi-pill:hover {
  border-color: var(--sct-ink);
}

.lifecycle-kpi-pill.is-active {
  border-color: color-mix(in srgb, var(--sct-accent) 45%, transparent);
  background: color-mix(in srgb, var(--sct-accent) 7%, var(--sct-container));
  font-weight: 700;
}
.lifecycle-kpi-pill.is-active::before {
  background: var(--sct-accent);
}

.lifecycle-kpi-pill--warn.is-active {
  border-color: color-mix(in srgb, #dc2626 45%, transparent);
  background: var(--sct-err-soft);
}
.lifecycle-kpi-pill--warn.is-active::before {
  background: #dc2626;
}

.lifecycle-kpi-pill--amber.is-active {
  border-color: color-mix(in srgb, #d97706 45%, transparent);
  background: var(--sct-warn-soft);
}
.lifecycle-kpi-pill--amber.is-active::before {
  background: #d97706;
}

.lifecycle-kpi-pill--info.is-active {
  border-color: color-mix(in srgb, #2563eb 45%, transparent);
  background: var(--sct-info-soft);
}
.lifecycle-kpi-pill--info.is-active::before {
  background: #2563eb;
}

.lifecycle-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}
.lifecycle-dot--red {
  background: #dc2626;
}
.lifecycle-dot--amber {
  background: #d97706;
}
</style>
