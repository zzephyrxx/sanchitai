<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { FEE_STANDARD, MEMBER_TYPE_COLORS } from '@/constants/sanchitai';
import { saveFileWithPicker } from '@/utils/save-file';
import { useThemeStore } from '@/store/modules/theme';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import { db } from '@/db/db';

defineOptions({ name: 'FeesPage' });

const workStore = useWorkDataStore();
const themeStore = useThemeStore();
const { bi, tFeeStatus, tFeeCategory } = useSctI18n();

const currentMonth = dayjs().format('YYYY-MM');
/** 展示的月份列：近 6 个月 */
const months = computed(() => {
  const arr: string[] = [];
  for (let i = 5; i >= 0; i -= 1) arr.push(dayjs().subtract(i, 'month').format('YYYY-MM'));
  return arr;
});

/** 当前在册需收缴党员（不含历史归档/已转出/流入未转入人员） */
const activeFeeMembers = computed(() =>
  workStore.inBranchRosterMembers.filter(m => m.type === '正式党员' || m.type === '预备党员')
);
const activeFeeMemberIdSet = computed(() => new Set(activeFeeMembers.value.map(m => m.id)));

/** 缴费人员：在册正式+预备党员，并保留当前视窗月份内已有缴费记录的历史归档党员（保证往期账实相符） */
const feeMembers = computed(() => {
  const monthSet = new Set(months.value);
  const hasFeeIds = new Set(workStore.feeRecords.filter(f => monthSet.has(f.year_month)).map(f => f.member_id));
  return workStore.members.filter(
    m =>
      (m.type === '正式党员' || m.type === '预备党员') && (activeFeeMemberIdSet.value.has(m.id) || hasFeeIds.has(m.id))
  );
});
const searchKeyword = ref('');
const filteredFeeMembers = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  if (!kw) return feeMembers.value;
  return feeMembers.value.filter(m =>
    [m.name, m.code, m.fee_category ?? '学生党员', m.group]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(kw))
  );
});

const feePagination = reactive({
  page: 1,
  pageSize: 15,
  pageSizes: [15, 25, 40, 60]
});

watch(searchKeyword, () => {
  feePagination.page = 1;
});

watch(
  () => filteredFeeMembers.value.length,
  total => {
    const maxPage = Math.max(1, Math.ceil(total / feePagination.pageSize));
    if (feePagination.page > maxPage) {
      feePagination.page = maxPage;
    }
  }
);

const pagedFeeMembers = computed(() => {
  const start = (feePagination.page - 1) * feePagination.pageSize;
  return filteredFeeMembers.value.slice(start, start + feePagination.pageSize);
});

/** 全局字号缩放增强系数（对党费表格放大/缩小响应额外增强 ~10%） */
const tableScaleBoost = computed(() => {
  const raw = Math.min(150, Math.max(85, themeStore.fontConfig?.scale ?? 100)) / 100;
  return raw === 1 ? 1 : Number((1 + (raw - 1) * 1.1).toFixed(3));
});

// ---------------- 党费表列顺序与列宽记忆 + 重置 ----------------
const FEE_LAYOUT_KEY = 'sct:table-layout:fees:v1';
const defaultFeeColOrder = computed(() => ['name', 'standard', ...months.value]);

function loadFeeLayout(): { order: string[]; widths: Record<string, number> } {
  try {
    const raw = localStorage.getItem(FEE_LAYOUT_KEY);
    if (!raw) return { order: [], widths: {} };
    const parsed = JSON.parse(raw) as { order?: string[]; widths?: Record<string, number> };
    return {
      order: Array.isArray(parsed.order) ? parsed.order : [],
      widths: parsed.widths && typeof parsed.widths === 'object' ? parsed.widths : {}
    };
  } catch {
    return { order: [], widths: {} };
  }
}

const savedFeeLayout = loadFeeLayout();
const feeColOrder = ref<string[]>(savedFeeLayout.order);
const feeColWidths = ref<Record<string, number>>(savedFeeLayout.widths);
const feeDraggingCol = ref<string | null>(null);
const feeDragOverCol = ref<string | null>(null);
const feeResizingCol = ref<string | null>(null);

const orderedFeeCols = computed(() => {
  const defaults = defaultFeeColOrder.value;
  const valid = new Set(defaults);
  const kept = feeColOrder.value.filter(k => valid.has(k));
  const missing = defaults.filter(k => !kept.includes(k));
  return [...kept, ...missing];
});

const hasCustomFeeLayout = computed(() => {
  if (Object.keys(feeColWidths.value).length > 0) return true;
  return orderedFeeCols.value.some((k, idx) => k !== defaultFeeColOrder.value[idx]);
});

watch(
  [feeColOrder, feeColWidths],
  () => {
    try {
      localStorage.setItem(FEE_LAYOUT_KEY, JSON.stringify({ order: orderedFeeCols.value, widths: feeColWidths.value }));
    } catch {
      /* ignore */
    }
  },
  { deep: true }
);

function resetFeeLayout() {
  feeColOrder.value = [];
  feeColWidths.value = {};
  try {
    localStorage.removeItem(FEE_LAYOUT_KEY);
  } catch {
    /* ignore */
  }
  window.$message?.success('党费收缴表列宽与列顺序已重置');
}

function defaultFeeColWidth(colKey: string): number {
  const factor = tableScaleBoost.value;
  if (colKey === 'name') return Math.round(154 * factor);
  if (colKey === 'standard') return Math.round(176 * factor);
  return Math.round(126 * factor);
}

function feeColStyle(colKey: string) {
  const w = feeColWidths.value[colKey] ?? defaultFeeColWidth(colKey);
  return { width: `${w}px`, minWidth: `${w}px` };
}

let feeResizeCleanup: (() => void) | null = null;
function startFeeColResize(e: MouseEvent, colKey: string) {
  e.stopPropagation();
  e.preventDefault();
  if (feeResizeCleanup) feeResizeCleanup();

  const thEl = (e.currentTarget as HTMLElement | null)?.closest('th');
  const measured = thEl ? Math.round(thEl.getBoundingClientRect().width) : defaultFeeColWidth(colKey);
  const startW = Math.max(80, feeColWidths.value[colKey] ?? measured);
  const startX = e.clientX;
  feeResizingCol.value = colKey;
  feeColWidths.value = { ...feeColWidths.value, [colKey]: startW };

  const prevCursor = document.body.style.cursor;
  const prevSelect = document.body.style.userSelect;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const onMove = (ev: MouseEvent) => {
    const nextW = Math.max(80, Math.min(520, Math.round(startW + (ev.clientX - startX))));
    feeColWidths.value = { ...feeColWidths.value, [colKey]: nextW };
  };
  const onUp = () => cleanup();
  const cleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = prevCursor;
    document.body.style.userSelect = prevSelect;
    feeResizingCol.value = null;
    feeResizeCleanup = null;
  };
  feeResizeCleanup = cleanup;
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

onUnmounted(() => {
  if (feeResizeCleanup) feeResizeCleanup();
});

function onFeeColDragStart(e: DragEvent, colKey: string) {
  if (feeResizingCol.value) {
    e.preventDefault();
    return;
  }
  feeDraggingCol.value = colKey;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', colKey);
  }
}

function onFeeColDrop(e: DragEvent, targetKey: string) {
  e.preventDefault();
  const fromKey = feeDraggingCol.value || e.dataTransfer?.getData('text/plain') || '';
  if (fromKey && fromKey !== targetKey) {
    const next = [...orderedFeeCols.value];
    const fromIdx = next.indexOf(fromKey);
    const toIdx = next.indexOf(targetKey);
    if (fromIdx >= 0 && toIdx >= 0) {
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      feeColOrder.value = next;
    }
  }
  feeDraggingCol.value = null;
  feeDragOverCol.value = null;
}

const recordsMap = computed(() => {
  const m = new Map<string, Sct.FeeRecord>();
  workStore.feeRecords.forEach(r => m.set(`${r.member_id}|${r.year_month}`, r));
  return m;
});

function cellOf(memberId: string, ym: string): Sct.FeeRecord | undefined {
  return recordsMap.value.get(`${memberId}|${ym}`);
}

function feeCellText(memberId: string, ym: string): string {
  const cell = cellOf(memberId, ym);
  if (!cell) return bi('未生成', 'Unset');
  if (cell.status === '已缴') return `${tFeeStatus('已缴')} ¥${cell.amount.toFixed(1)}`;
  if (cell.status === '未在校') return '/';
  return tFeeStatus(cell.status);
}

/** 连续欠缴（最新两月均欠缴）→ 红 */
function consecutiveOwed(memberId: string): boolean {
  const cur = cellOf(memberId, months.value[5]);
  const prev = cellOf(memberId, months.value[4]);
  return cur?.status === '欠缴' && prev?.status === '欠缴';
}

// ---------------- 生成名单（按每人各自的月应缴标准生成，仅针对当前在册党员） ----------------
async function generateMonth() {
  const roster = activeFeeMembers.value;
  const missing = roster.filter(m => !cellOf(m.id, currentMonth));
  if (!missing.length) {
    window.$message?.info(`${currentMonth} 在册名单已完整（${roster.length} 人），无新增需补录`);
    return;
  }
  const rows: Sct.FeeRecord[] = missing.map(m => ({
    member_id: m.id,
    year_month: currentMonth,
    amount: workStore.memberMonthlyFee(m),
    status: '欠缴',
    identity: 'secretary'
  }));
  await db.feeRecords.bulkPut(rows);
  const totalDue = roster.reduce((acc, m) => acc + workStore.memberMonthlyFee(m), 0);
  window.$message?.success(
    `已补录 ${rows.length} 人（在册名单 ${roster.length} 人），本月应缴合计 ${totalDue.toFixed(1)} 元`
  );
}

// ---------------- 混合批量标记已缴（工具栏弹窗 + 表头单月全员已缴快捷入口） ----------------
const batchPaidModalShow = ref(false);
const batchPaidMonth = ref(currentMonth);
const batchPaidDate = ref<string>(dayjs().format('YYYY-MM-DD'));
const batchPaidSearch = ref('');
const batchPaidCheckedIds = ref<string[]>([]);
const batchPaidSaving = ref(false);

interface BatchMemberRow {
  member: Sct.Member;
  currentStatus: Sct.FeeStatus | '未生成';
  amount: number;
  needsPayment: boolean;
}

const batchMonthRows = computed<BatchMemberRow[]>(() => {
  const ym = batchPaidMonth.value;
  return feeMembers.value
    .filter(m => activeFeeMemberIdSet.value.has(m.id) || Boolean(cellOf(m.id, ym)))
    .map(m => {
      const rec = cellOf(m.id, ym);
      const status: Sct.FeeStatus | '未生成' = rec?.status ?? '未生成';
      const amount = rec ? rec.amount : workStore.memberMonthlyFee(m);
      const needsPayment = status === '欠缴' || (status === '未生成' && activeFeeMemberIdSet.value.has(m.id));
      return { member: m, currentStatus: status, amount, needsPayment };
    });
});

const filteredBatchMonthRows = computed(() => {
  const kw = batchPaidSearch.value.trim().toLowerCase();
  if (!kw) return batchMonthRows.value;
  return batchMonthRows.value.filter(r =>
    [r.member.name, r.member.code, r.member.group, r.currentStatus]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(kw))
  );
});

function preselectUnpaidForBatch() {
  batchPaidCheckedIds.value = batchMonthRows.value.filter(r => r.needsPayment).map(r => r.member.id);
}

function openBatchPaidModal(targetYm?: string) {
  batchPaidMonth.value = targetYm || currentMonth;
  batchPaidDate.value = dayjs().format('YYYY-MM-DD');
  batchPaidSearch.value = '';
  preselectUnpaidForBatch();
  batchPaidModalShow.value = true;
}

watch(batchPaidMonth, () => {
  if (batchPaidModalShow.value) {
    preselectUnpaidForBatch();
  }
});

const batchSelectedTotalAmount = computed(() => {
  const idSet = new Set(batchPaidCheckedIds.value);
  return batchMonthRows.value
    .filter(r => idSet.has(r.member.id))
    .reduce((sum, r) => sum + r.amount, 0)
    .toFixed(1);
});

async function confirmBatchMarkPaid() {
  const idSet = new Set(batchPaidCheckedIds.value);
  const targets = batchMonthRows.value.filter(r => idSet.has(r.member.id));
  if (!targets.length) {
    window.$message?.warning('请至少勾选一位需要设为已缴的党员');
    return;
  }
  batchPaidSaving.value = true;
  try {
    const paidDate = batchPaidDate.value || dayjs().format('YYYY-MM-DD');
    const records: Sct.FeeRecord[] = targets.map(r => ({
      member_id: r.member.id,
      year_month: batchPaidMonth.value,
      amount: r.amount,
      status: '已缴',
      paid_date: paidDate,
      identity: 'secretary'
    }));
    await db.feeRecords.bulkPut(records);
    batchPaidModalShow.value = false;
    window.$message?.success(
      `已将 ${batchPaidMonth.value} 的 ${records.length} 名党员批量设为「已缴」（合计 ¥${batchSelectedTotalAmount.value}）`
    );
  } finally {
    batchPaidSaving.value = false;
  }
}

/** 统计指定月份待缴（在册欠缴/未生成 + 非在册历史欠缴）人数 */
function unpaidCountOfMonth(ym: string): number {
  let cnt = 0;
  for (const m of feeMembers.value) {
    const st = cellOf(m.id, ym)?.status;
    if (st === '欠缴' || (!st && activeFeeMemberIdSet.value.has(m.id))) cnt += 1;
  }
  return cnt;
}

/** 表头快捷操作：将某月所有欠缴人员及在册未生成人员一键设为已缴 */
async function markWholeMonthPaid(ym: string) {
  const today = dayjs().format('YYYY-MM-DD');
  const rows: Sct.FeeRecord[] = [];
  for (const m of feeMembers.value) {
    const cur = cellOf(m.id, ym);
    if (cur?.status === '欠缴' || (!cur && activeFeeMemberIdSet.value.has(m.id))) {
      rows.push({
        member_id: m.id,
        year_month: ym,
        amount: cur ? cur.amount : workStore.memberMonthlyFee(m),
        status: '已缴',
        paid_date: today,
        identity: 'secretary'
      });
    }
  }
  if (!rows.length) {
    window.$message?.info(`${ym} 暂无欠缴或未生成人员`);
    return;
  }
  await db.feeRecords.bulkPut(rows);
  window.$message?.success(`已将 ${ym} 其余 ${rows.length} 名党员一键设为「已缴」`);
}

// ---------------- 共享单元格编辑弹窗（替换每格独立 Popover，大幅提升 500 人性能） ----------------
const STATUS_OPTIONS: Array<{ label: string; value: Sct.FeeStatus; color: string }> = [
  { label: '已缴', value: '已缴', color: '#3f9d63' },
  { label: '欠缴', value: '欠缴', color: '#d43030' },
  { label: '减免', value: '减免', color: '#64748b' },
  { label: '未在校', value: '未在校', color: '#94a3b8' }
];

const FEE_CATEGORY_OPTIONS: Array<{ label: string; value: Sct.FeeCategory }> = [
  { label: `学生党员（${FEE_STANDARD.studentMonthly} 元/月）`, value: '学生党员' },
  { label: '在职党员（自定义金额）', value: '在职党员' }
];

const cellModalShow = ref(false);
const cellDraft = reactive<{
  memberId: string;
  memberName: string;
  ym: string;
  status: Sct.FeeStatus;
  amount: number;
  feeCategory: Sct.FeeCategory;
  paidDate: string;
  syncMemberStandard: boolean;
}>({
  memberId: '',
  memberName: '',
  ym: '',
  status: '已缴',
  amount: FEE_STANDARD.studentMonthly,
  feeCategory: '学生党员',
  paidDate: dayjs().format('YYYY-MM-DD'),
  syncMemberStandard: false
});

function openCellEditor(member: Sct.Member, ym: string) {
  const cur = cellOf(member.id, ym);
  const stdAmount = workStore.memberMonthlyFee(member);
  cellDraft.memberId = member.id;
  cellDraft.memberName = member.name;
  cellDraft.ym = ym;
  cellDraft.status = cur?.status ?? '已缴';
  cellDraft.amount = cur ? cur.amount : stdAmount;
  cellDraft.feeCategory = member.fee_category ?? (stdAmount > FEE_STANDARD.studentMonthly ? '在职党员' : '学生党员');
  cellDraft.paidDate = cur?.paid_date || dayjs().format('YYYY-MM-DD');
  cellDraft.syncMemberStandard = false;
  cellModalShow.value = true;
}

function onCellCategoryChange(cat: Sct.FeeCategory) {
  cellDraft.feeCategory = cat;
  cellDraft.syncMemberStandard = true;
  if (cat === '学生党员') {
    cellDraft.amount = FEE_STANDARD.studentMonthly;
  } else if (cellDraft.amount === FEE_STANDARD.studentMonthly) {
    cellDraft.amount = 35;
  }
}

async function saveCellEdit() {
  if (!cellDraft.memberId || !cellDraft.ym) return;
  const amount =
    typeof cellDraft.amount === 'number' && !Number.isNaN(cellDraft.amount) && cellDraft.amount >= 0
      ? Number(cellDraft.amount.toFixed(1))
      : FEE_STANDARD.studentMonthly;

  await db.feeRecords.put({
    member_id: cellDraft.memberId,
    year_month: cellDraft.ym,
    amount,
    status: cellDraft.status,
    paid_date: cellDraft.status === '已缴' ? cellDraft.paidDate || dayjs().format('YYYY-MM-DD') : undefined,
    identity: 'secretary'
  });

  if (cellDraft.syncMemberStandard) {
    const inferredCategory: Sct.FeeCategory =
      cellDraft.feeCategory === '在职党员' || amount !== FEE_STANDARD.studentMonthly ? '在职党员' : '学生党员';
    await workStore.updateMember(cellDraft.memberId, {
      fee_category: inferredCategory,
      fee_monthly: amount
    });
  }

  cellModalShow.value = false;
  window.$message?.success(`已更新 ${cellDraft.memberName}（${cellDraft.ym}）党费状态为「${cellDraft.status}」`);
}

// ---------------- 党员党费标准列快捷调整弹窗 ----------------
const stdModalShow = ref(false);
const stdForm = reactive<{
  memberId: string;
  memberName: string;
  fee_category: Sct.FeeCategory;
  fee_monthly: number;
  applyToCurrentOwed: boolean;
}>({
  memberId: '',
  memberName: '',
  fee_category: '学生党员',
  fee_monthly: FEE_STANDARD.studentMonthly,
  applyToCurrentOwed: true
});

function openStandardModal(member: Sct.Member) {
  stdForm.memberId = member.id;
  stdForm.memberName = member.name;
  stdForm.fee_category = member.fee_category ?? '学生党员';
  stdForm.fee_monthly = workStore.memberMonthlyFee(member);
  stdForm.applyToCurrentOwed = true;
  stdModalShow.value = true;
}

function onStdCategoryChange(cat: Sct.FeeCategory) {
  stdForm.fee_category = cat;
  if (cat === '学生党员') {
    stdForm.fee_monthly = FEE_STANDARD.studentMonthly;
  } else if (stdForm.fee_monthly === FEE_STANDARD.studentMonthly) {
    stdForm.fee_monthly = 35;
  }
}

async function saveStandardModal() {
  if (!stdForm.memberId) return;
  const amount =
    typeof stdForm.fee_monthly === 'number' && !Number.isNaN(stdForm.fee_monthly) && stdForm.fee_monthly >= 0
      ? Number(stdForm.fee_monthly.toFixed(1))
      : FEE_STANDARD.studentMonthly;

  await workStore.updateMember(stdForm.memberId, {
    fee_category: stdForm.fee_category,
    fee_monthly: amount
  });

  if (stdForm.applyToCurrentOwed) {
    const curRec = cellOf(stdForm.memberId, currentMonth);
    if (curRec) {
      await db.feeRecords.put({
        ...curRec,
        amount
      });
    }
  }

  stdModalShow.value = false;
  window.$message?.success(`已同步更新 ${stdForm.memberName} 的党费标准（人员表与党费台账已联动）`);
}

// ---------------- 汇总（仅口径对齐本月在册应缴党员） ----------------
const monthSummary = computed(() => {
  const roster = activeFeeMembers.value;
  const rows = roster.map(m => cellOf(m.id, currentMonth)).filter(Boolean) as Sct.FeeRecord[];
  const dueRows = rows.filter(r => r.status !== '未在校' && r.status !== '减免');
  const due = dueRows.reduce((acc, r) => acc + r.amount, 0);
  const paidRows = rows.filter(r => r.status === '已缴');
  const paidAmount = paidRows.reduce((acc, r) => acc + r.amount, 0);
  const owed = rows.filter(r => r.status === '欠缴').length;
  const inServiceCount = roster.filter(m => m.fee_category === '在职党员').length;
  return {
    count: rows.length,
    due: due.toFixed(1),
    paidAmount: paidAmount.toFixed(1),
    paidCount: paidRows.length,
    owed,
    inServiceCount
  };
});

// ---------------- 导出（A16） ----------------
async function exportMatrix() {
  const header = ['序号', '姓名', '党费类别', '月应缴标准(元)', ...months.value, '实缴合计(元)'];
  const lines: string[] = [header.join(',')];
  feeMembers.value.forEach((m, i) => {
    const cells = months.value.map(ym => {
      const r = cellOf(m.id, ym);
      if (!r) return '';
      if (r.status === '未在校') return '/';
      if (r.status === '已缴') return r.amount.toFixed(1);
      if (r.status === '减免') return '减免';
      return '欠缴';
    });
    const total = months.value.reduce((acc, ym) => {
      const r = cellOf(m.id, ym);
      return acc + (r?.status === '已缴' ? r.amount : 0);
    }, 0);
    lines.push(
      [
        String(i + 1),
        m.name,
        m.fee_category ?? '学生党员',
        workStore.memberMonthlyFee(m).toFixed(1),
        ...cells,
        total ? total.toFixed(1) : '0.0'
      ].join(',')
    );
  });
  const csv = `\uFEFF${lines.join('\n')}`;
  const res = await saveFileWithPicker(new Blob([csv], { type: 'text/csv;charset=utf-8' }), {
    suggestedName: `党费收缴台账_${currentMonth}.csv`,
    types: [{ description: 'CSV 表格文件', mime: 'text/csv', extensions: ['.csv'] }]
  });
  if (res.status === 'saved') {
    window.$message?.success('已导出（Excel/Word 可直接打开）');
  }
}

// ---------------- 视图 ----------------
function feeColor(status?: Sct.FeeStatus): string {
  switch (status) {
    case '已缴':
      return '#3f9d63';
    case '欠缴':
      return '#d43030';
    case '减免':
      return '#64748b';
    case '未在校':
      return '#c4c1ba';
    default:
      return 'var(--sct-muted)';
  }
}

const owedMemberNames = computed(() => {
  const owedSet = new Set<string>();
  for (const f of workStore.feeRecords) {
    if (f.status === '欠缴') owedSet.add(f.member_id);
  }
  const names: string[] = [];
  for (const m of feeMembers.value) {
    if (owedSet.has(m.id)) names.push(m.name);
  }
  return names;
});
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex flex-wrap items-center gap-12px">
          <span class="text-16px font-bold">{{ bi('党费收缴', 'Dues Collection') }}</span>
          <span class="text-12px text-gray-400">
            {{
              bi(
                `标准：学生党员 ${FEE_STANDARD.studentMonthly} 元/月 · 在职党员支持自定义月应缴金额（中组发〔2008〕3 号）`,
                `Standard: Student ¥${FEE_STANDARD.studentMonthly}/mo · In-service members support custom monthly dues`
              )
            }}
          </span>
        </div>
      </template>
      <template #header-extra>
        <div data-tour="fees-actions" class="flex flex-wrap items-center gap-8px">
          <NButton size="small" secondary @click="exportMatrix">
            <template #icon><SvgIcon icon="lucide:download" /></template>
            {{ bi('导出逐月矩阵', 'Export Matrix CSV') }}
          </NButton>
          <NButton size="small" type="success" secondary @click="openBatchPaidModal()">
            <template #icon><SvgIcon icon="lucide:check-check" /></template>
            {{ bi('批量标记已缴', 'Batch Mark Paid') }}
          </NButton>
          <NButton type="primary" size="small" @click="generateMonth">
            <template #icon><SvgIcon icon="lucide:user-check" /></template>
            {{ bi('生成本月名单', 'Generate Monthly List') }}
          </NButton>
        </div>
      </template>

      <!-- 本月汇总 -->
      <div data-tour="fees-summary" class="mb-14px flex flex-wrap gap-10px">
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          {{ bi('本月应缴', 'Due This Month') }}
          <b class="text-[#A81C24]">{{ monthSummary.count }}</b>
          {{ bi('人 · 合计', 'members · Total') }}
          <b>¥{{ monthSummary.due }}</b>
        </div>
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          {{ bi('已缴', 'Paid') }}
          <b style="color: #3f9d63">{{ monthSummary.paidCount }}</b>
          {{ bi('人', 'members') }} · ¥{{ monthSummary.paidAmount }}
        </div>
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          {{ bi('欠缴', 'Overdue') }}
          <b style="color: #d43030">{{ monthSummary.owed }}</b>
          {{ bi('人', 'members') }}
          <span v-if="monthSummary.owed" class="text-12px text-gray-500">
            {{ bi('（座位图已标红角标）', '(Red badge on seat map)') }}
          </span>
        </div>
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          {{ bi('在职/自定义标准', 'In-service / Custom') }}
          <b class="text-[#d97706]">{{ monthSummary.inServiceCount }}</b>
          {{ bi('人', 'members') }}
        </div>
      </div>

      <!-- 搜索与提示栏（搜索框加宽至 290px 确保完整显示占位文字） -->
      <div class="mb-10px flex flex-wrap items-center justify-between gap-10px">
        <div class="flex flex-wrap items-center gap-8px">
          <div class="fee-search-box shrink-0">
            <NInput
              v-model:value="searchKeyword"
              size="small"
              clearable
              :placeholder="bi('搜索党员姓名、编号、类别或党小组…', 'Search member name, code, category…')"
            >
              <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
            </NInput>
          </div>
          <NButton size="small" secondary class="shrink-0" :disabled="!hasCustomFeeLayout" @click="resetFeeLayout">
            <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
            {{ bi('重置列宽', 'Reset Columns') }}
          </NButton>
        </div>
        <span class="text-12px text-gray-400">
          {{
            bi(
              '拖拽表头调列顺序 · 拖边线调列宽 · 月份表头支持「全员已缴」快捷操作',
              'Drag headers to reorder · Resize edges · Quick mark-all-paid on month headers'
            )
          }}
        </span>
      </div>

      <!-- 人×月矩阵（支持列顺序拖拽 + 列宽调整 + 记忆 + 月表头一键全员已缴） -->
      <div data-tour="fees-matrix" class="fee-matrix">
        <table>
          <thead>
            <tr>
              <th
                v-for="colKey in orderedFeeCols"
                :key="colKey"
                class="fee-th relative"
                :class="{
                  'fee-th--cur': colKey === currentMonth,
                  'sct-th-wrap--dragging': feeDraggingCol === colKey,
                  'sct-th-wrap--over': feeDragOverCol === colKey && feeDraggingCol !== colKey
                }"
                :style="feeColStyle(colKey)"
                :draggable="!feeResizingCol"
                @dragstart="onFeeColDragStart($event, colKey)"
                @dragover.prevent="feeDragOverCol = colKey"
                @dragleave="feeDragOverCol === colKey && (feeDragOverCol = null)"
                @drop="onFeeColDrop($event, colKey)"
                @dragend="
                  feeDraggingCol = null;
                  feeDragOverCol = null;
                "
              >
                <div class="inline-flex items-center justify-center gap-4px select-none">
                  <template v-if="colKey === 'name'">
                    <SvgIcon icon="lucide:user" class="text-13px opacity-80" />
                    <span>{{ bi('姓名', 'Name') }}</span>
                  </template>
                  <template v-else-if="colKey === 'standard'">
                    <SvgIcon icon="lucide:coins" class="text-13px opacity-80" />
                    <span>{{ bi('党费标准（点击修改）', 'Dues Standard') }}</span>
                  </template>
                  <template v-else>
                    <SvgIcon icon="lucide:calendar" class="text-12px opacity-75" />
                    <span>{{ colKey }}</span>
                    <NPopconfirm v-if="unpaidCountOfMonth(colKey) > 0" @positive-click="markWholeMonthPaid(colKey)">
                      <template #trigger>
                        <button
                          type="button"
                          class="fee-th__quick"
                          :class="colKey === currentMonth ? 'fee-th__quick--dark' : ''"
                          :title="`将 ${colKey} 全部未缴人员一键设为已缴`"
                          @click.stop
                        >
                          <SvgIcon icon="lucide:check-check" class="text-12px" />
                        </button>
                      </template>
                      确认将 {{ colKey }} 尚待缴费的 {{ unpaidCountOfMonth(colKey) }} 名党员全部设为「已缴」？
                    </NPopconfirm>
                  </template>
                </div>
                <span
                  class="sct-col-resizer"
                  :class="{ 'sct-col-resizer--active': feeResizingCol === colKey }"
                  title="拖拽调整列宽"
                  @mousedown="startFeeColResize($event, colKey)"
                  @click.stop.prevent
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in pagedFeeMembers" :key="m.id">
              <template v-for="colKey in orderedFeeCols" :key="`${m.id}-${colKey}`">
                <td v-if="colKey === 'name'" class="fee-td fee-td--name" :style="feeColStyle(colKey)">
                  <div class="flex items-center gap-6px">
                    <span
                      class="inline-block size-8px flex-shrink-0 rounded-full"
                      :style="{ background: MEMBER_TYPE_COLORS[m.type] }"
                    />
                    <span class="font-semibold">{{ m.name }}</span>
                    <span v-if="consecutiveOwed(m.id)" class="text-11px font-bold text-[#d43030]">
                      {{ bi('连续欠缴', '2+ Months Overdue') }}
                    </span>
                  </div>
                </td>
                <td v-else-if="colKey === 'standard'" class="fee-td" :style="feeColStyle(colKey)">
                  <button
                    type="button"
                    class="fee-std-btn inline-flex items-center gap-5px rounded-6px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-8px py-3px transition hover:border-[#A81C24]"
                    :title="bi('点击设置该党员的党费类别与月应缴标准', 'Click to set dues category & monthly rate')"
                    @click="openStandardModal(m)"
                  >
                    <NTag size="tiny" :bordered="false" :type="m.fee_category === '在职党员' ? 'warning' : 'default'">
                      {{ tFeeCategory(m.fee_category) }}
                    </NTag>
                    <span class="font-bold text-[var(--sct-ink)]">
                      ¥{{ workStore.memberMonthlyFee(m).toFixed(1) }}/{{ bi('月', 'mo') }}
                    </span>
                    <SvgIcon icon="lucide:pencil" class="text-11px text-gray-400" />
                  </button>
                </td>
                <td
                  v-else
                  class="fee-td fee-cell"
                  :class="{ 'fee-cell--cur': colKey === currentMonth }"
                  :style="feeColStyle(colKey)"
                >
                  <button
                    type="button"
                    class="fee-cell__btn"
                    :style="{ color: feeColor(cellOf(m.id, colKey)?.status) }"
                    @click="openCellEditor(m, colKey)"
                  >
                    <span>{{ feeCellText(m.id, colKey) }}</span>
                    <SvgIcon icon="lucide:chevron-down" class="fee-cell__chevron text-11px opacity-45" />
                  </button>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-12px flex flex-wrap items-center justify-between gap-10px">
        <div class="text-12px text-gray-400">
          全期欠缴人员（含历史月份，共 {{ owedMemberNames.length }} 人）：{{
            owedMemberNames.slice(0, 30).join('、') || '无'
          }}{{ owedMemberNames.length > 30 ? ` 等 ${owedMemberNames.length} 人` : '' }}
        </div>
        <NPagination
          v-model:page="feePagination.page"
          v-model:page-size="feePagination.pageSize"
          :item-count="filteredFeeMembers.length"
          :page-sizes="feePagination.pageSizes"
          show-size-picker
          size="small"
        >
          <template #prefix="{ itemCount }">
            <span class="text-12px text-gray-400">{{ bi(`共 ${itemCount} 人`, `Total ${itemCount}`) }}</span>
          </template>
        </NPagination>
      </div>
    </NCard>

    <!-- 共享单元格党费状态编辑弹窗 -->
    <NModal
      v-model:show="cellModalShow"
      preset="card"
      :title="`修改缴费状态：${cellDraft.memberName} · ${cellDraft.ym}`"
      class="w-420px"
    >
      <NForm label-placement="left" label-width="96" size="small">
        <NFormItem label="缴费状态" required>
          <NSelect v-model:value="cellDraft.status" :options="STATUS_OPTIONS" />
        </NFormItem>
        <NFormItem v-if="cellDraft.status === '已缴'" label="实缴日期">
          <NDatePicker
            v-model:formatted-value="cellDraft.paidDate"
            type="date"
            value-format="yyyy-MM-dd"
            class="w-full"
          />
        </NFormItem>
        <NFormItem label="党费类别">
          <NSelect
            :value="cellDraft.feeCategory"
            :options="FEE_CATEGORY_OPTIONS"
            @update:value="onCellCategoryChange"
          />
        </NFormItem>
        <NFormItem label="本月金额">
          <NInputNumber v-model:value="cellDraft.amount" :min="0" :step="0.5" :precision="1" class="w-full">
            <template #suffix>元</template>
          </NInputNumber>
        </NFormItem>
        <NFormItem label="同步标准">
          <NCheckbox v-model:checked="cellDraft.syncMemberStandard">同步设为该党员默认月应缴标准</NCheckbox>
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="cellModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="saveCellEdit">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            确认保存
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 批量标记党费已缴弹窗 -->
    <NModal
      v-model:show="batchPaidModalShow"
      preset="card"
      title="批量设置党费已缴"
      class="w-600px"
      :mask-closable="false"
    >
      <div class="flex flex-col gap-12px">
        <div class="grid grid-cols-1 gap-10px sm:grid-cols-2">
          <div>
            <div class="mb-4px text-12px font-semibold text-gray-500">选择月份</div>
            <NSelect
              v-model:value="batchPaidMonth"
              size="small"
              :options="months.map(m => ({ label: `${m}（待缴 ${unpaidCountOfMonth(m)} 人）`, value: m }))"
            />
          </div>
          <div>
            <div class="mb-4px text-12px font-semibold text-gray-500">统一实缴日期</div>
            <NDatePicker
              v-model:formatted-value="batchPaidDate"
              type="date"
              value-format="yyyy-MM-dd"
              size="small"
              class="w-full"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-8px">
          <div class="w-240px">
            <NInput v-model:value="batchPaidSearch" size="small" clearable placeholder="筛选姓名、编号或党小组…">
              <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
            </NInput>
          </div>
          <div class="flex items-center gap-6px">
            <NButton size="tiny" secondary @click="preselectUnpaidForBatch">勾选未缴/未生成</NButton>
            <NButton size="tiny" secondary @click="batchPaidCheckedIds = batchMonthRows.map(r => r.member.id)">
              全选
            </NButton>
            <NButton size="tiny" quaternary @click="batchPaidCheckedIds = []">清空</NButton>
          </div>
        </div>

        <NCheckboxGroup
          v-model:value="batchPaidCheckedIds"
          class="max-h-320px flex flex-col gap-6px overflow-y-auto rounded-8px border border-[var(--sct-border)] p-8px"
        >
          <div
            v-for="row in filteredBatchMonthRows"
            :key="row.member.id"
            class="flex items-center justify-between gap-8px rounded-6px px-8px py-5px transition hover:bg-[var(--sct-soft)]"
          >
            <div class="flex items-center gap-8px">
              <NCheckbox :value="row.member.id" />
              <span class="text-13px font-medium text-[var(--sct-ink)]">{{ row.member.name }}</span>
              <span v-if="row.member.group" class="text-11px text-gray-400">{{ row.member.group }}</span>
            </div>
            <div class="flex items-center gap-8px">
              <span class="font-mono text-12px font-semibold">¥{{ row.amount.toFixed(1) }}</span>
              <NTag
                size="tiny"
                :bordered="false"
                :type="row.currentStatus === '已缴' ? 'success' : row.currentStatus === '欠缴' ? 'error' : 'default'"
              >
                {{ row.currentStatus }}
              </NTag>
            </div>
          </div>
        </NCheckboxGroup>
      </div>

      <template #footer>
        <div class="flex items-center justify-between">
          <span class="text-12px text-gray-500">
            已勾选
            <strong>{{ batchPaidCheckedIds.length }}</strong>
            人 · 合计
            <strong class="text-[#16a34a]">¥{{ batchSelectedTotalAmount }}</strong>
          </span>
          <div class="flex gap-8px">
            <NButton size="small" @click="batchPaidModalShow = false">取消</NButton>
            <NButton
              size="small"
              type="primary"
              :loading="batchPaidSaving"
              :disabled="!batchPaidCheckedIds.length"
              @click="confirmBatchMarkPaid"
            >
              <template #icon><SvgIcon icon="lucide:check-check" /></template>
              确认批量设为已缴
            </NButton>
          </div>
        </div>
      </template>
    </NModal>

    <!-- 修改党员党费标准弹窗（与人员信息表双向同步） -->
    <NModal v-model:show="stdModalShow" preset="card" :title="`设置党费标准：${stdForm.memberName}`" class="w-460px">
      <NForm label-placement="left" label-width="120" size="small">
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:wallet" class="sct-field-icon" />
              <span>党费类别</span>
            </span>
          </template>
          <NSelect :value="stdForm.fee_category" :options="FEE_CATEGORY_OPTIONS" @update:value="onStdCategoryChange" />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:coins" class="sct-field-icon" />
              <span>月应缴党费</span>
            </span>
          </template>
          <NInputNumber v-model:value="stdForm.fee_monthly" :min="0" :step="0.5" :precision="1" class="w-full">
            <template #suffix>元/月</template>
          </NInputNumber>
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:refresh-cw" class="sct-field-icon" />
              <span>同步本月记录</span>
            </span>
          </template>
          <NCheckbox v-model:checked="stdForm.applyToCurrentOwed">
            同步更新当前月份（{{ currentMonth }}）的应缴金额
          </NCheckbox>
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="stdModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="saveStandardModal">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            保存标准
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.fee-search-box {
  width: clamp(270px, calc(285px * var(--sct-font-scale-boost, 1)), 420px);
}
.fee-matrix {
  overflow-x: auto;
}
.fee-matrix table {
  width: max-content;
  min-width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
.fee-th {
  padding: calc(8px * var(--sct-density-scale, 1)) calc(10px * var(--sct-density-scale, 1));
  font-size: calc(12.5px * var(--sct-font-scale-boost, 1));
  font-weight: 600;
  color: var(--sct-muted);
  background: var(--sct-soft);
  border: 1px solid var(--sct-border);
  text-align: center;
  white-space: nowrap;
}
.fee-th--cur {
  background: #2b2926;
  color: #fff;
}
.fee-th__quick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 3px;
  padding: 2px 4px;
  border-radius: 4px;
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
  cursor: pointer;
  transition: background-color 0.15s;
}
.fee-th__quick:hover {
  background: rgba(22, 163, 74, 0.24);
}
.fee-th__quick--dark {
  color: #86efac;
  background: rgba(134, 239, 172, 0.16);
}
.fee-td {
  padding: calc(6px * var(--sct-density-scale, 1)) calc(8px * var(--sct-density-scale, 1));
  font-size: calc(13.5px * var(--sct-font-scale-boost, 1));
  border: 1px solid var(--sct-border);
  text-align: center;
}
.fee-td--name {
  text-align: left;
  color: var(--sct-ink);
  white-space: nowrap;
}
.fee-std-btn {
  font-size: calc(12.5px * var(--sct-font-scale-boost, 1));
}
.fee-cell {
  padding: calc(3px * var(--sct-density-scale, 1)) 4px;
}
.fee-cell--cur {
  background: rgba(168, 28, 36, 0.04);
}
.fee-cell__btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: calc(5px * var(--sct-density-scale, 1)) 8px;
  border-radius: 6px;
  font-weight: 600;
  font-size: calc(12.5px * var(--sct-font-scale-boost, 1));
  background: transparent;
  transition: background-color 0.15s ease;
}
.fee-cell__btn:hover {
  background: var(--sct-soft);
}
.fee-cell__btn:hover .fee-cell__chevron {
  opacity: 1;
}
</style>
