<script setup lang="ts">
import { computed, ref } from 'vue';
import dayjs from 'dayjs';
import { saveAs } from 'file-saver';
import { useWorkDataStore } from '@/store/modules/work-data';
import { db } from '@/db/db';
import { FEE_STANDARD, MEMBER_TYPE_COLORS } from '@/constants/sanchitai';

defineOptions({ name: 'FeesPage' });

const workStore = useWorkDataStore();

/** 缴费人员：正式+预备党员（党费名单来源随类型自动同步，A13 联动） */
const feeMembers = computed(() => workStore.members.filter(m => m.type === '正式党员' || m.type === '预备党员'));

const currentMonth = dayjs().format('YYYY-MM');
/** 展示的月份列：近 6 个月 */
const months = computed(() => {
  const arr: string[] = [];
  for (let i = 5; i >= 0; i -= 1) arr.push(dayjs().subtract(i, 'month').format('YYYY-MM'));
  return arr;
});

const recordsMap = computed(() => {
  const m = new Map<string, Sct.FeeRecord>();
  workStore.feeRecords.forEach(r => m.set(`${r.member_id}|${r.year_month}`, r));
  return m;
});

function cellOf(memberId: string, ym: string): Sct.FeeRecord | undefined {
  return recordsMap.value.get(`${memberId}|${ym}`);
}

/** 连续欠缴（最新两月均欠缴）→ 红 */
function consecutiveOwed(memberId: string): boolean {
  const cur = cellOf(memberId, months.value[5]);
  const prev = cellOf(memberId, months.value[4]);
  return cur?.status === '欠缴' && prev?.status === '欠缴';
}

// ---------------- 生成名单（A15，按当前在册补齐 = 评审遗留 L2） ----------------
async function generateMonth() {
  const missing = feeMembers.value.filter(m => !cellOf(m.id, currentMonth));
  if (!missing.length) {
    window.$message?.info(`${currentMonth} 名单已完整（${feeMembers.value.length} 人），无新增需补录`);
    return;
  }
  const rows: Sct.FeeRecord[] = missing.map(m => ({
    member_id: m.id,
    year_month: currentMonth,
    amount: FEE_STANDARD.studentMonthly,
    status: '欠缴',
    identity: 'secretary'
  }));
  await dbPutRows(rows);
  window.$message?.success(`已补录 ${rows.length} 人（现名单 ${feeMembers.value.length} 人），合计 ${(feeMembers.value.length * FEE_STANDARD.studentMonthly).toFixed(1)} 元`);
}

function dbPutRows(rows: Sct.FeeRecord[]) {
  return db.feeRecords.bulkPut(rows);
}

// ---------------- 单元格状态循环 ----------------
const CYCLE: Record<string, Sct.FeeStatus> = { 欠缴: '已缴', 已缴: '减免', 减免: '未在校', 未在校: '欠缴' };

async function cycleCell(memberId: string, ym: string) {
  const cur = cellOf(memberId, ym);
  const nextStatus: Sct.FeeStatus = cur ? (CYCLE[cur.status] ?? '已缴') : '欠缴';
  await db.feeRecords.put({
    member_id: memberId,
    year_month: ym,
    amount: FEE_STANDARD.studentMonthly,
    status: nextStatus,
    paid_date: nextStatus === '已缴' ? dayjs().format('YYYY-MM-DD') : undefined,
    identity: 'secretary'
  });
}

// ---------------- 汇总 ----------------
const monthSummary = computed(() => {
  const rows = feeMembers.value.map(m => cellOf(m.id, currentMonth)).filter(Boolean) as Sct.FeeRecord[];
  const due = rows.length * FEE_STANDARD.studentMonthly;
  const paidRows = rows.filter(r => r.status === '已缴');
  const owed = rows.filter(r => r.status === '欠缴').length;
  return {
    count: rows.length,
    due: due.toFixed(1),
    paidAmount: (paidRows.length * FEE_STANDARD.studentMonthly).toFixed(1),
    paidCount: paidRows.length,
    owed
  };
});

// ---------------- 导出（A16） ----------------
function exportMatrix() {
  const header = ['序号', '姓名', ...months.value, '合计'];
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
    lines.push([String(i + 1), m.name, ...cells, total ? total.toFixed(1) : '0.0'].join(','));
  });
  const csv = `\uFEFF${lines.join('\n')}`;
  saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `党费收缴台账_${currentMonth}.csv`);
  window.$message?.success('已导出（Excel/Word 可直接打开）');
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
      return 'var(--sct-border)';
  }
}

const owedBadges = computed(() => {
  const map: Record<string, boolean> = {};
  workStore.feeRecords.filter(f => f.status === '欠缴').forEach(f => (map[f.member_id] = true));
  return map;
});
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">党费台账</span>
          <span class="text-12px text-gray-400">标准：学生党员 {{ FEE_STANDARD.studentMonthly }} 元/月（中组发〔2008〕3 号）</span>
        </div>
      </template>
      <template #header-extra>
        <div class="flex items-center gap-8px">
          <NButton size="small" @click="exportMatrix">导出逐月矩阵</NButton>
          <NButton type="primary" size="small" @click="generateMonth">生成本月名单</NButton>
        </div>
      </template>

      <!-- 本月汇总 -->
      <div class="mb-14px flex flex-wrap gap-10px">
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          本月应缴 <b class="text-[#A81C24]">{{ monthSummary.count }}</b> 人 · 合计 <b>{{ monthSummary.due }}</b> 元
        </div>
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          已缴 <b style="color: #3f9d63">{{ monthSummary.paidCount }}</b> 人 · {{ monthSummary.paidAmount }} 元
        </div>
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          欠缴 <b style="color: #d43030">{{ monthSummary.owed }}</b> 人
          <span v-if="monthSummary.owed" class="text-12px text-gray-500">（座位图已标红角标）</span>
        </div>
        <div class="text-12px text-gray-400 self-center">点单元格循环状态：欠缴 → 已缴 → 减免 → 未在校</div>
      </div>

      <!-- 人×月矩阵 -->
      <div class="fee-matrix">
        <table>
          <thead>
            <tr>
              <th class="fee-th">姓名</th>
              <th v-for="ym in months" :key="ym" class="fee-th" :class="{ 'fee-th--cur': ym === currentMonth }">{{ ym }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in feeMembers" :key="m.id">
              <td class="fee-td fee-td--name">
                <span class="inline-block size-8px rounded-full mr-4px" :style="{ background: MEMBER_TYPE_COLORS[m.type] }" />
                {{ m.name }}
                <span v-if="consecutiveOwed(m.id)" class="text-11px text-[#d43030] font-bold">连续欠缴</span>
              </td>
              <td
                v-for="ym in months"
                :key="ym"
                class="fee-td fee-cell"
                :class="{ 'fee-cell--cur': ym === currentMonth }"
                :style="{ color: feeColor(cellOf(m.id, ym)?.status) }"
                @click="cycleCell(m.id, ym)"
              >
                {{
                  !cellOf(m.id, ym)
                    ? '—'
                    : cellOf(m.id, ym)!.status === '已缴'
                      ? cellOf(m.id, ym)!.amount.toFixed(1)
                      : cellOf(m.id, ym)!.status === '未在校'
                        ? '/'
                        : cellOf(m.id, ym)!.status
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-8px text-12px text-gray-400">欠缴人员（{{ Object.keys(owedBadges).length }}）：{{ feeMembers.filter(m => owedBadges[m.id]).map(m => m.name).join('、') || '无' }}</div>
    </NCard>
  </div>
</template>

<style scoped>
.fee-matrix {
  overflow-x: auto;
}
.fee-matrix table {
  width: 100%;
  border-collapse: collapse;
}
.fee-th {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--sct-muted);
  background: var(--sct-soft);
  border: 1px solid var(--sct-border);
  text-align: center;
}
.fee-th--cur {
  background: #2b2926;
  color: #fff;
}
.fee-td {
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid var(--sct-border);
  text-align: center;
}
.fee-td--name {
  text-align: left;
  color: var(--sct-ink);
  white-space: nowrap;
}
.fee-cell {
  cursor: pointer;
  font-weight: 600;
  min-width: 64px;
}
.fee-cell:hover {
  background: var(--sct-soft);
}
.fee-cell--cur {
  background: var(--sct-soft);
}
</style>
