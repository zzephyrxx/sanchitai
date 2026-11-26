<script setup lang="ts">
/**
 * 新转入人员纸质档案核查矩阵 + 单人核查详情抽屉（v0.3.0）
 * 默认呈现多人核查矩阵（行=待核查成员，列=9项标准入党材料，单击循环切换 ✅齐全 / ❌缺失 / ⚠️存疑 / —未查）
 * 点击成员行打开核查抽屉：填写缺项说明、一键生成《商请核实党员档案材料的函》、一键「核查通过并正式入册」
 */
import { computed, reactive, ref } from 'vue';
import { INCOMING_AUDIT_ITEMS } from '@/constants/workspace-presets';
import { buildArchiveVerifyLetterText, downloadTextAsDoc } from '@/utils/transfer';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'IncomingAuditPanel' });

const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const addAuditModalShow = ref(false);
const addAuditMemberId = ref<string | null>(null);
const addAuditSourceOrg = ref('');

const detailDrawerShow = ref(false);
const activeTransferId = ref<string | null>(null);
const localNotes = reactive<Record<string, string>>({});
const localSourceOrg = ref('');

const incomingRows = computed(() => {
  return workStore.incomingAuditMembers.map(member => {
    const transfer = workStore.transferRecords.find(
      r => r.member_id === member.id && r.direction === 'in' && r.status === '办理中'
    );
    const items = transfer?.audit_items ?? {};
    const okCount = INCOMING_AUDIT_ITEMS.filter(it => items[it.key] === 'ok').length;
    const issueCount = INCOMING_AUDIT_ITEMS.filter(
      it => items[it.key] === 'missing' || items[it.key] === 'doubt'
    ).length;
    return { member, transfer, items, okCount, issueCount };
  });
});

const activeRow = computed(() => incomingRows.value.find(r => r.transfer?.id === activeTransferId.value));

const availableToAddOptions = computed(() =>
  workStore.activeMembers.map(m => ({ label: `${m.name}（${m.type} · ${m.code}）`, value: m.id }))
);

function nextAuditState(cur?: Sct.AuditItemState): Sct.AuditItemState {
  if (!cur || cur === 'unchecked') return 'ok';
  if (cur === 'ok') return 'missing';
  if (cur === 'missing') return 'doubt';
  return 'unchecked';
}

function stateVisual(st?: Sct.AuditItemState): { symbol: string; cls: string; tip: string } {
  if (st === 'ok') return { symbol: '✓', cls: 'audit-cell--ok', tip: '齐全' };
  if (st === 'missing') return { symbol: '✕', cls: 'audit-cell--missing', tip: '缺失' };
  if (st === 'doubt') return { symbol: '!', cls: 'audit-cell--doubt', tip: '存疑' };
  return { symbol: '—', cls: 'audit-cell--empty', tip: '未核查（点击切换）' };
}

async function cycleCell(member: Sct.Member, transfer: Sct.TransferRecord | undefined, itemKey: string) {
  let tid = transfer?.id;
  if (!tid) {
    tid = await workStore.markMemberIncomingAudit(member.id, '');
  }
  const curItems = { ...transfer?.audit_items };
  curItems[itemKey] = nextAuditState(curItems[itemKey]);
  await workStore.updateIncomingAudit(tid, curItems);
}

async function openDetailDrawer(member: Sct.Member, transfer?: Sct.TransferRecord) {
  let tid = transfer?.id;
  if (!tid) {
    tid = await workStore.markMemberIncomingAudit(member.id, '');
  }
  activeTransferId.value = tid;
  const fresh = workStore.transferRecords.find(r => r.id === tid);
  localSourceOrg.value = fresh?.source_org ?? '';
  for (const item of INCOMING_AUDIT_ITEMS) {
    localNotes[item.key] = fresh?.audit_notes?.[item.key] ?? '';
  }
  detailDrawerShow.value = true;
}

async function setDetailItemState(itemKey: string, state: Sct.AuditItemState) {
  if (!activeRow.value?.transfer) return;
  const nextItems = { ...activeRow.value.transfer.audit_items, [itemKey]: state };
  await workStore.updateIncomingAudit(activeRow.value.transfer.id, nextItems, { ...localNotes }, localSourceOrg.value);
}

async function saveDetailNotes() {
  if (!activeRow.value?.transfer) return;
  await workStore.updateIncomingAudit(
    activeRow.value.transfer.id,
    activeRow.value.transfer.audit_items ?? {},
    { ...localNotes },
    localSourceOrg.value
  );
  window.$message?.success('核查备注已保存');
}

async function handleApproveMember(transferId: string, name: string) {
  await workStore.approveIncomingAudit(transferId);
  detailDrawerShow.value = false;
  window.$message?.success(`「${name}」档案核查通过，已正式入册`);
}

async function handleExportVerifyLetter() {
  if (!activeRow.value?.transfer) return;
  await saveDetailNotes();
  const text = buildArchiveVerifyLetterText({
    branchName: workStore.branchName,
    member: activeRow.value.member,
    transfer: {
      ...activeRow.value.transfer,
      source_org: localSourceOrg.value,
      audit_notes: { ...localNotes }
    }
  });
  const res = await downloadTextAsDoc(
    `关于商请核实${activeRow.value.member.name}同志党员档案材料的函.doc`,
    '关于商请核实党员档案材料的函',
    text
  );
  if (res === 'saved') {
    window.$message?.success('《商请核实党员档案材料的函》已导出');
  }
}

async function handleAddMemberToAudit() {
  if (!addAuditMemberId.value) {
    window.$message?.warning('请选择需要核查档案的成员');
    return;
  }
  await workStore.markMemberIncomingAudit(addAuditMemberId.value, addAuditSourceOrg.value);
  addAuditModalShow.value = false;
  addAuditMemberId.value = null;
  addAuditSourceOrg.value = '';
  window.$message?.success('已加入新生/转入档案核查矩阵');
}
</script>

<template>
  <div class="flex flex-col gap-12px">
    <div class="flex flex-wrap items-center justify-between gap-10px">
      <div class="flex flex-wrap items-center gap-10px text-12px text-[var(--sct-muted)]">
        <span>{{ bi('单击矩阵格子循环切换：', 'Click cell to cycle:') }}</span>
        <span class="inline-flex items-center gap-4px">
          <span class="audit-legend audit-cell--ok">✓</span>
          齐全
        </span>
        <span class="inline-flex items-center gap-4px">
          <span class="audit-legend audit-cell--missing">✕</span>
          缺失
        </span>
        <span class="inline-flex items-center gap-4px">
          <span class="audit-legend audit-cell--doubt">!</span>
          存疑
        </span>
        <span>{{ bi('· 点击成员姓名展开详情并生成核实函', '· Click name for detail & verify letter') }}</span>
      </div>
      <NButton size="small" type="primary" secondary @click="addAuditModalShow = true">
        <template #icon><SvgIcon icon="lucide:file-search" /></template>
        {{ bi('加入转入待核查人员', 'Add to Audit Queue') }}
      </NButton>
    </div>

    <div
      v-if="!incomingRows.length"
      class="rounded-8px border border-dashed border-[var(--sct-border)] py-36px text-center text-13px text-[var(--sct-muted)]"
    >
      {{
        bi(
          '当前暂无待核查的新转入人员。开学季或接收新党员时，点右上角「加入转入待核查人员」即可批量对账核查。',
          'No incoming members pending archive audit.'
        )
      }}
    </div>

    <!-- 多人档案核查矩阵 -->
    <div v-else class="overflow-x-auto rounded-8px border border-[var(--sct-border)]">
      <table class="w-full min-w-880px border-collapse text-12px">
        <thead>
          <tr class="border-b border-[var(--sct-border)] bg-[var(--sct-soft)] text-11px text-[var(--sct-muted)]">
            <th class="sticky left-0 z-2 bg-[var(--sct-soft)] px-12px py-8px text-left w-150px">成员 / 来源</th>
            <th
              v-for="item in INCOMING_AUDIT_ITEMS"
              :key="item.key"
              class="px-6px py-8px text-center font-medium"
              :title="item.reqNote"
            >
              <div>{{ item.shortLabel }}</div>
              <div class="text-10px opacity-65">{{ item.stageHint }}</div>
            </th>
            <th class="px-10px py-8px text-center w-140px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in incomingRows"
            :key="row.member.id"
            class="border-b border-[var(--sct-border)] last:border-b-0 hover:bg-[var(--sct-page)]"
          >
            <td
              class="sticky left-0 z-1 cursor-pointer bg-[var(--sct-container)] px-12px py-8px"
              @click="openDetailDrawer(row.member, row.transfer)"
            >
              <div class="flex items-center gap-6px font-bold text-[var(--sct-ink)]">
                <span>{{ row.member.name }}</span>
                <NTag size="tiny" :bordered="false">{{ row.member.type }}</NTag>
              </div>
              <div class="mt-2px truncate text-11px text-[var(--sct-muted)]">
                {{ row.transfer?.source_org || '点击补充原党组织' }}
              </div>
              <div class="mt-2px text-10.5px font-mono">
                <span class="text-[#16a34a]">齐 {{ row.okCount }}</span>
                <span v-if="row.issueCount" class="ml-6px text-[#dc2626]">缺/疑 {{ row.issueCount }}</span>
              </div>
            </td>
            <td v-for="item in INCOMING_AUDIT_ITEMS" :key="item.key" class="px-4px py-6px text-center">
              <button
                type="button"
                class="audit-cell-btn"
                :class="stateVisual(row.items[item.key]).cls"
                :title="`${item.fullLabel}：${stateVisual(row.items[item.key]).tip}`"
                @click="cycleCell(row.member, row.transfer, item.key)"
              >
                {{ stateVisual(row.items[item.key]).symbol }}
              </button>
            </td>
            <td class="px-8px py-6px text-center">
              <div class="flex items-center justify-center gap-6px">
                <NButton
                  size="tiny"
                  class="sct-op-btn sct-op-btn--info"
                  @click="openDetailDrawer(row.member, row.transfer)"
                >
                  核实函
                </NButton>
                <NPopconfirm
                  v-if="row.transfer"
                  @positive-click="handleApproveMember(row.transfer.id, row.member.name)"
                >
                  <template #trigger>
                    <NButton size="tiny" class="sct-op-btn sct-op-btn--primary">入册</NButton>
                  </template>
                  确认「{{ row.member.name }}」档案核查完毕并正式编入在册名单？
                </NPopconfirm>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 加入核查队列弹窗 -->
    <NModal v-model:show="addAuditModalShow" preset="card" title="加入新生/新转入档案核查" class="w-460px max-w-94vw">
      <NForm label-placement="left" label-width="102" size="small">
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:user" class="sct-field-icon" />
              选择成员
            </span>
          </template>
          <NSelect
            v-model:value="addAuditMemberId"
            :options="availableToAddOptions"
            filterable
            placeholder="从花名册选择刚导入的新成员"
          />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:landmark" class="sct-field-icon" />
              原所在党组织
            </span>
          </template>
          <NInput v-model:value="addAuditSourceOrg" placeholder="如：某某大学某某学院党委（供核实函抬头用）" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="addAuditModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="handleAddMemberToAudit">确认加入</NButton>
        </div>
      </template>
    </NModal>

    <!-- 单人核查详情抽屉 -->
    <NDrawer v-model:show="detailDrawerShow" :width="540" class="max-w-96vw">
      <NDrawerContent v-if="activeRow" :title="`档案核查详情 · ${activeRow.member.name}`" closable>
        <div class="flex flex-col gap-12px">
          <NForm label-placement="left" label-width="108" size="small">
            <NFormItem>
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:landmark" class="sct-field-icon" />
                  原所在党组织
                </span>
              </template>
              <NInput v-model:value="localSourceOrg" placeholder="商请核实函的发函对象" />
            </NFormItem>
          </NForm>

          <div class="flex flex-col gap-8px">
            <div
              v-for="item in INCOMING_AUDIT_ITEMS"
              :key="item.key"
              class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] p-10px"
            >
              <div class="flex flex-wrap items-center justify-between gap-6px">
                <div>
                  <div class="text-12.5px font-bold text-[var(--sct-ink)]">{{ item.fullLabel }}</div>
                  <div class="text-11px text-[var(--sct-muted)]">{{ item.reqNote }}</div>
                </div>
                <div class="flex items-center gap-4px">
                  <NButton
                    size="tiny"
                    :type="activeRow.items[item.key] === 'ok' ? 'success' : 'default'"
                    secondary
                    @click="setDetailItemState(item.key, 'ok')"
                  >
                    齐全
                  </NButton>
                  <NButton
                    size="tiny"
                    :type="activeRow.items[item.key] === 'missing' ? 'error' : 'default'"
                    secondary
                    @click="setDetailItemState(item.key, 'missing')"
                  >
                    缺失
                  </NButton>
                  <NButton
                    size="tiny"
                    :type="activeRow.items[item.key] === 'doubt' ? 'warning' : 'default'"
                    secondary
                    @click="setDetailItemState(item.key, 'doubt')"
                  >
                    存疑
                  </NButton>
                </div>
              </div>
              <NInput
                v-if="activeRow.items[item.key] === 'missing' || activeRow.items[item.key] === 'doubt'"
                v-model:value="localNotes[item.key]"
                size="tiny"
                class="mt-6px"
                placeholder="填写具体缺失/存疑说明（自动写入商请核实函）"
              />
            </div>
          </div>
        </div>
        <template #footer>
          <div class="w-full flex flex-wrap items-center justify-between gap-8px">
            <NButton size="small" secondary @click="saveDetailNotes">保存备注</NButton>
            <div class="flex items-center gap-8px">
              <NButton size="small" type="warning" secondary @click="handleExportVerifyLetter">
                <template #icon><SvgIcon icon="lucide:file-down" /></template>
                导出《商请核实函》
              </NButton>
              <NButton
                v-if="activeRow?.transfer"
                size="small"
                type="primary"
                @click="handleApproveMember(activeRow.transfer.id, activeRow.member.name)"
              >
                <template #icon><SvgIcon icon="lucide:check-circle-2" /></template>
                核查通过并入册
              </NButton>
            </div>
          </div>
        </template>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.audit-cell-btn {
  width: 30px;
  height: 26px;
  border-radius: var(--sct-radius, 5px);
  border: 1px solid var(--sct-border);
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: transform 0.1s ease;
}
.audit-cell-btn:hover {
  transform: scale(1.06);
}
.audit-legend {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}
.audit-cell--ok {
  background: var(--sct-ok-soft);
  color: #16a34a;
  border-color: rgba(22, 163, 74, 0.35);
}
.audit-cell--missing {
  background: var(--sct-err-soft);
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.35);
}
.audit-cell--doubt {
  background: var(--sct-warn-soft);
  color: #d97706;
  border-color: rgba(217, 119, 6, 0.35);
}
.audit-cell--empty {
  background: var(--sct-page);
  color: var(--sct-muted);
}
</style>
