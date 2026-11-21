<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import dayjs from 'dayjs';
import { saveAs } from 'file-saver';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import { db } from '@/db/db';
import { FEE_STANDARD, MEMBER_TYPE_COLORS } from '@/constants/sanchitai';

defineOptions({ name: 'FeesPage' });

const workStore = useWorkDataStore();
const { bi, tFeeStatus, tFeeCategory } = useSctI18n();

/** 缴费人员：正式+预备党员（党费名单来源随类型自动同步，A13 联动） */
const feeMembers = computed(() => workStore.members.filter(m => m.type === '正式党员' || m.type === '预备党员'));
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

// ---------------- 生成名单（按每人各自的月应缴标准生成） ----------------
async function generateMonth() {
  const missing = feeMembers.value.filter(m => !cellOf(m.id, currentMonth));
  if (!missing.length) {
    window.$message?.info(`${currentMonth} 名单已完整（${feeMembers.value.length} 人），无新增需补录`);
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
  const totalDue = feeMembers.value.reduce((acc, m) => acc + workStore.memberMonthlyFee(m), 0);
  window.$message?.success(
    `已补录 ${rows.length} 人（现名单 ${feeMembers.value.length} 人），本月应缴合计 ${totalDue.toFixed(1)} 元`
  );
}

// ---------------- 单元格下拉/浮层编辑（告别误触点击即切换） ----------------
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

const activeCellKey = ref<string | null>(null);
const cellDraft = reactive<{
  memberId: string;
  memberName: string;
  ym: string;
  status: Sct.FeeStatus;
  amount: number;
  feeCategory: Sct.FeeCategory;
  syncMemberStandard: boolean;
}>({
  memberId: '',
  memberName: '',
  ym: '',
  status: '已缴',
  amount: FEE_STANDARD.studentMonthly,
  feeCategory: '学生党员',
  syncMemberStandard: false
});

function openCellPopover(member: Sct.Member, ym: string) {
  const cur = cellOf(member.id, ym);
  const stdAmount = workStore.memberMonthlyFee(member);
  cellDraft.memberId = member.id;
  cellDraft.memberName = member.name;
  cellDraft.ym = ym;
  cellDraft.status = cur?.status ?? '已缴';
  cellDraft.amount = cur ? cur.amount : stdAmount;
  cellDraft.feeCategory = member.fee_category ?? (stdAmount > FEE_STANDARD.studentMonthly ? '在职党员' : '学生党员');
  cellDraft.syncMemberStandard = false;
  activeCellKey.value = `${member.id}|${ym}`;
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
    paid_date: cellDraft.status === '已缴' ? dayjs().format('YYYY-MM-DD') : undefined,
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

  activeCellKey.value = null;
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

// ---------------- 汇总 ----------------
const monthSummary = computed(() => {
  const rows = feeMembers.value.map(m => cellOf(m.id, currentMonth)).filter(Boolean) as Sct.FeeRecord[];
  const dueRows = rows.filter(r => r.status !== '未在校' && r.status !== '减免');
  const due = dueRows.reduce((acc, r) => acc + r.amount, 0);
  const paidRows = rows.filter(r => r.status === '已缴');
  const paidAmount = paidRows.reduce((acc, r) => acc + r.amount, 0);
  const owed = rows.filter(r => r.status === '欠缴').length;
  const inServiceCount = feeMembers.value.filter(m => m.fee_category === '在职党员').length;
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
function exportMatrix() {
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
      return 'var(--sct-muted)';
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
        <div class="flex items-center gap-8px">
          <NButton size="small" secondary @click="exportMatrix">
            <template #icon><SvgIcon icon="lucide:download" /></template>
            {{ bi('导出逐月矩阵', 'Export Matrix CSV') }}
          </NButton>
          <NButton type="primary" size="small" @click="generateMonth">
            <template #icon><SvgIcon icon="lucide:user-check" /></template>
            {{ bi('生成本月名单', 'Generate Monthly List') }}
          </NButton>
        </div>
      </template>

      <!-- 本月汇总 -->
      <div class="mb-14px flex flex-wrap gap-10px">
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          {{ bi('本月应缴', 'Due This Month') }} <b class="text-[#A81C24]">{{ monthSummary.count }}</b>
          {{ bi('人 · 合计', 'members · Total') }} <b>¥{{ monthSummary.due }}</b>
        </div>
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          {{ bi('已缴', 'Paid') }} <b style="color: #3f9d63">{{ monthSummary.paidCount }}</b>
          {{ bi('人', 'members') }} · ¥{{ monthSummary.paidAmount }}
        </div>
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          {{ bi('欠缴', 'Overdue') }} <b style="color: #d43030">{{ monthSummary.owed }}</b> {{ bi('人', 'members') }}
          <span v-if="monthSummary.owed" class="text-12px text-gray-500">
            {{ bi('（座位图已标红角标）', '(Red badge on seat map)') }}
          </span>
        </div>
        <div class="rounded-8px bg-[var(--sct-soft)] px-12px py-8px text-13px">
          {{ bi('在职/自定义标准', 'In-service / Custom') }}
          <b class="text-[#d97706]">{{ monthSummary.inServiceCount }}</b> {{ bi('人', 'members') }}
        </div>
      </div>

      <!-- 搜索与提示栏 -->
      <div class="mb-10px flex flex-wrap items-center justify-between gap-10px">
        <NInput
          v-model:value="searchKeyword"
          size="small"
          clearable
          class="w-240px"
          :placeholder="bi('搜索党员姓名、编号、党费类别…', 'Search member name, code, category…')"
        >
          <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
        </NInput>
        <span class="text-12px text-gray-400">
          {{
            bi(
              '点击任意月份单元格可下拉选择缴费状态与自定义金额 · 点击「党费标准」列可修改党员固定月标准',
              'Click any month cell to update status & custom amount · Click "Dues Standard" to edit monthly rate'
            )
          }}
        </span>
      </div>

      <!-- 人×月矩阵 -->
      <div class="fee-matrix">
        <table>
          <thead>
            <tr>
              <th class="fee-th">
                <span class="inline-flex items-center gap-4px">
                  <SvgIcon icon="lucide:user" class="text-13px opacity-80" />
                  <span>{{ bi('姓名', 'Name') }}</span>
                </span>
              </th>
              <th class="fee-th">
                <span class="inline-flex items-center gap-4px">
                  <SvgIcon icon="lucide:coins" class="text-13px opacity-80" />
                  <span>{{ bi('党费标准（点击修改）', 'Dues Standard (Click to Edit)') }}</span>
                </span>
              </th>
              <th
                v-for="ym in months"
                :key="ym"
                class="fee-th"
                :class="{ 'fee-th--cur': ym === currentMonth }"
              >
                <span class="inline-flex items-center gap-4px">
                  <SvgIcon icon="lucide:calendar" class="text-12px opacity-75" />
                  <span>{{ ym }}</span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in filteredFeeMembers" :key="m.id">
              <td class="fee-td fee-td--name">
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
              <td class="fee-td">
                <button
                  type="button"
                  class="inline-flex items-center gap-5px rounded-6px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-8px py-3px text-12px transition hover:border-[#A81C24]"
                  :title="bi('点击设置该党员的党费类别与月应缴标准', 'Click to set dues category & monthly rate')"
                  @click="openStandardModal(m)"
                >
                  <NTag
                    size="tiny"
                    :bordered="false"
                    :type="m.fee_category === '在职党员' ? 'warning' : 'default'"
                  >
                    {{ tFeeCategory(m.fee_category) }}
                  </NTag>
                  <span class="font-bold text-[var(--sct-ink)]">
                    ¥{{ workStore.memberMonthlyFee(m).toFixed(1) }}/{{ bi('月', 'mo') }}
                  </span>
                  <SvgIcon icon="lucide:pencil" class="text-11px text-gray-400" />
                </button>
              </td>
              <td
                v-for="ym in months"
                :key="ym"
                class="fee-td fee-cell"
                :class="{ 'fee-cell--cur': ym === currentMonth }"
              >
                <NPopover
                  :show="activeCellKey === `${m.id}|${ym}`"
                  trigger="click"
                  placement="bottom"
                  :show-arrow="true"
                  @update:show="v => (activeCellKey = v ? `${m.id}|${ym}` : null)"
                >
                  <template #trigger>
                    <button
                      type="button"
                      class="fee-cell__btn"
                      :style="{ color: feeColor(cellOf(m.id, ym)?.status) }"
                      @click="openCellPopover(m, ym)"
                    >
                      <span>{{ feeCellText(m.id, ym) }}</span>
                      <SvgIcon icon="lucide:chevron-down" class="fee-cell__chevron text-11px opacity-45" />
                    </button>
                  </template>

                  <div class="w-260px p-4px">
                    <div class="mb-8px flex items-center justify-between border-b border-[var(--sct-border)] pb-6px">
                      <span class="text-13px font-bold text-[var(--sct-ink)]">{{ m.name }} · {{ ym }}</span>
                      <NTag size="tiny" :bordered="false">{{ m.fee_category ?? '学生党员' }}</NTag>
                    </div>

                    <div class="flex flex-col gap-10px">
                      <div>
                        <div class="mb-4px flex items-center gap-4px text-11px font-semibold text-gray-500">
                          <SvgIcon icon="lucide:check-circle-2" class="text-12px text-[#A81C24]" />
                          <span>缴费状态</span>
                        </div>
                        <NSelect
                          v-model:value="cellDraft.status"
                          :options="STATUS_OPTIONS"
                          size="small"
                        />
                      </div>

                      <div>
                        <div class="mb-4px flex items-center gap-4px text-11px font-semibold text-gray-500">
                          <SvgIcon icon="lucide:wallet" class="text-12px text-[#A81C24]" />
                          <span>党费类别</span>
                        </div>
                        <NSelect
                          :value="cellDraft.feeCategory"
                          :options="FEE_CATEGORY_OPTIONS"
                          size="small"
                          @update:value="onCellCategoryChange"
                        />
                      </div>

                      <div>
                        <div class="mb-4px flex items-center gap-4px text-11px font-semibold text-gray-500">
                          <SvgIcon icon="lucide:coins" class="text-12px text-[#A81C24]" />
                          <span>本月金额（元，支持自定义）</span>
                        </div>
                        <NInputNumber
                          v-model:value="cellDraft.amount"
                          size="small"
                          :min="0"
                          :step="0.5"
                          :precision="1"
                          class="w-full"
                        >
                          <template #suffix>元</template>
                        </NInputNumber>
                      </div>

                      <NCheckbox v-model:checked="cellDraft.syncMemberStandard" size="small">
                        <span class="text-11px text-gray-500">同步设为该党员默认月应缴标准</span>
                      </NCheckbox>

                      <div class="flex justify-end gap-6px pt-2px">
                        <NButton size="tiny" @click="activeCellKey = null">取消</NButton>
                        <NButton size="tiny" type="primary" @click="saveCellEdit">
                          <template #icon><SvgIcon icon="lucide:check" /></template>
                          确定
                        </NButton>
                      </div>
                    </div>
                  </div>
                </NPopover>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-8px text-12px text-gray-400">
        全期欠缴人员（含历史月份，共 {{ Object.keys(owedBadges).length }} 人）：{{
          feeMembers.filter(m => owedBadges[m.id]).map(m => m.name).join('、') || '无'
        }}
      </div>
    </NCard>

    <!-- 修改党员党费标准弹窗（与人员信息表双向同步） -->
    <NModal
      v-model:show="stdModalShow"
      preset="card"
      :title="`设置党费标准：${stdForm.memberName}`"
      class="w-460px"
    >
      <NForm label-placement="left" label-width="120" size="small">
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:wallet" class="sct-field-icon" />
              <span>党费类别</span>
            </span>
          </template>
          <NSelect
            :value="stdForm.fee_category"
            :options="FEE_CATEGORY_OPTIONS"
            @update:value="onStdCategoryChange"
          />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:coins" class="sct-field-icon" />
              <span>月应缴党费</span>
            </span>
          </template>
          <NInputNumber
            v-model:value="stdForm.fee_monthly"
            :min="0"
            :step="0.5"
            :precision="1"
            class="w-full"
          >
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
.fee-matrix {
  overflow-x: auto;
}
.fee-matrix table {
  width: 100%;
  border-collapse: collapse;
}
.fee-th {
  padding: 8px 10px;
  font-size: 12px;
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
.fee-td {
  padding: 5px 8px;
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
  padding: 3px 4px;
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
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
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
