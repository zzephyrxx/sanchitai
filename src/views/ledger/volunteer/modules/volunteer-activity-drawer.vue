<script setup lang="ts">
/**
 * 新建 / 编辑志愿服务活动抽屉（v0.2.7 精修版）
 * - 清晰分区层级：快捷引入带 → 01 活动信息 → 02 参与人员快选（带搜索与身份色点） → 03 表格化时长微调清单
 * - 兼容墨韵 / KONTUR 电子纸双皮肤与深浅色模式
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { MEMBER_TYPE_COLORS, MEMBER_TYPE_ORDER } from '@/constants/sanchitai';
import { isMemberActive } from '@/constants/workspace-presets';
import { onTourCommand } from '@/utils/onboarding-bus';
import { parseWechatNameList, roundHours } from '@/utils/volunteer';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'VolunteerActivityDrawer' });

const props = defineProps<{
  show: boolean;
  editingActivity?: Sct.VolunteerActivity | null;
}>();

const emit = defineEmits<{
  'update:show': [val: boolean];
  saved: [];
}>();

const workStore = useWorkDataStore();

const form = reactive({
  title: '',
  date: dayjs().format('YYYY-MM-DD'),
  source: '支部内部' as Sct.VolunteerSource,
  default_hours: 2,
  status: '已认定' as Sct.VolunteerStatus,
  event_id: '' as string,
  note: ''
});

const participants = ref<Sct.VolunteerParticipant[]>([]);
const chipSearch = ref('');
const chipGroupFilter = ref<string | null>(null);
const chipTypeFilter = ref<string | null>(null);
const wechatOpen = ref(false);
const wechatText = ref('');
const unmatchedNames = ref<string[]>([]);

watch(
  () => [props.show, props.editingActivity],
  ([visible]) => {
    if (!visible) return;
    wechatOpen.value = false;
    wechatText.value = '';
    unmatchedNames.value = [];
    chipSearch.value = '';
    chipGroupFilter.value = null;
    chipTypeFilter.value = null;
    const act = props.editingActivity;
    if (act) {
      form.title = act.title;
      form.date = act.date;
      form.source = act.source;
      form.default_hours = act.default_hours;
      form.status = act.status;
      form.event_id = act.event_id ?? '';
      form.note = act.note ?? '';
      participants.value = act.participants.map(p => ({ ...p }));
    } else {
      form.title = '';
      form.date = dayjs().format('YYYY-MM-DD');
      form.source = '支部内部';
      form.default_hours = 2;
      form.status = '已认定';
      form.event_id = '';
      form.note = '';
      participants.value = [];
    }
  },
  { immediate: true }
);

const offVolDrawerTour = onTourCommand(cmd => {
  if (cmd === 'volunteer:open-wechat') {
    wechatOpen.value = true;
  }
});
onBeforeUnmount(offVolDrawerTour);

const sourceOptions: Array<{ label: string; value: Sct.VolunteerSource }> = [
  { label: '支部内部', value: '支部内部' },
  { label: '校院活动', value: '校院活动' },
  { label: '社会公益', value: '社会公益' },
  { label: '其他', value: '其他' }
];

const calEventOptions = computed(() =>
  workStore.calEvents
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 60)
    .map(ev => ({
      label: `${ev.date} · ${ev.title}（${ev.category}）`,
      value: ev.id
    }))
);

const candidateMembers = computed(() => {
  const kw = chipSearch.value.trim().toLowerCase();
  return workStore.activeMembers.filter(m => {
    if (chipGroupFilter.value && (m.group ?? '') !== chipGroupFilter.value) return false;
    if (chipTypeFilter.value && m.type !== chipTypeFilter.value) return false;
    if (kw && ![m.name, m.student_id, m.group].filter(Boolean).some(v => String(v).toLowerCase().includes(kw))) {
      return false;
    }
    return true;
  });
});

const selectedMemberIdSet = computed(() => new Set(participants.value.map(p => p.member_id)));

function memberDotColor(memberId: string): string {
  const m = workStore.memberOf(memberId);
  return m ? MEMBER_TYPE_COLORS[m.type] : '#94a3b8';
}

function toggleParticipant(m: Sct.Member) {
  const idx = participants.value.findIndex(p => p.member_id === m.id);
  if (idx >= 0) {
    participants.value.splice(idx, 1);
  } else {
    participants.value.push({
      member_id: m.id,
      name_snapshot: m.name,
      hours: roundHours(form.default_hours || 1),
      role_note: ''
    });
  }
}

function selectAllCandidates() {
  for (const m of candidateMembers.value) {
    if (!selectedMemberIdSet.value.has(m.id)) {
      participants.value.push({
        member_id: m.id,
        name_snapshot: m.name,
        hours: roundHours(form.default_hours || 1),
        role_note: ''
      });
    }
  }
}

function applyDefaultHoursToAll() {
  const h = roundHours(form.default_hours || 1);
  participants.value = participants.value.map(p => ({ ...p, hours: h }));
  window.$message?.success(`已将全体已选成员时长统一为 ${h} 小时`);
}

function handleImportFromCalEvent(eventId: string | null) {
  form.event_id = eventId ?? '';
  if (!eventId) return;
  const ev = workStore.calEvents.find(e => e.id === eventId);
  if (!ev) return;
  form.title = ev.title;
  form.date = ev.date;
  const att = workStore.attendanceOfEvent(eventId).filter(a => a.status === '到会' || a.status === '迟到');
  if (att.length) {
    const nextList: Sct.VolunteerParticipant[] = [];
    for (const a of att) {
      const m = workStore.memberOf(a.member_id);
      if (!m) continue;
      nextList.push({
        member_id: m.id,
        name_snapshot: m.name,
        hours: roundHours(form.default_hours || 2),
        role_note: ''
      });
    }
    if (nextList.length) {
      participants.value = nextList;
      window.$message?.success(`已引入活动「${ev.title}」并自动载入 ${nextList.length} 名到会人员`);
      return;
    }
  }
  window.$message?.info(`已引入活动日期与名称「${ev.title}」，请在下方勾选参与人员`);
}

function handleParseWechatList() {
  if (!wechatText.value.trim()) {
    window.$message?.warning('请先粘贴名单文本');
    return;
  }
  // 优先匹配在册成员，若历史活动中确有非在册人员（如归档/转出/待核查）则回退全库匹配
  const prioritizedMembers = [...workStore.activeMembers, ...workStore.members.filter(m => !isMemberActive(m))];
  const { matched, unmatched } = parseWechatNameList(
    wechatText.value,
    prioritizedMembers,
    roundHours(form.default_hours || 2)
  );
  unmatchedNames.value = unmatched;
  let added = 0;
  for (const item of matched) {
    const existing = participants.value.find(p => p.member_id === item.member.id);
    if (existing) {
      existing.hours = item.hours;
      if (item.roleNote) existing.role_note = item.roleNote;
    } else {
      participants.value.push({
        member_id: item.member.id,
        name_snapshot: item.member.name,
        hours: item.hours,
        role_note: item.roleNote
      });
      added += 1;
    }
  }
  window.$message?.success(
    `识别匹配 ${matched.length} 人（新加入 ${added} 人）${unmatched.length ? `，另有 ${unmatched.length} 个未匹配名称` : ''}`
  );
}

const totalActivityHours = computed(() =>
  roundHours(participants.value.reduce((acc, p) => acc + (Number(p.hours) || 0), 0))
);

async function handleSave() {
  if (!form.title.trim()) {
    window.$message?.warning('请填写志愿活动名称');
    return;
  }
  if (!participants.value.length) {
    window.$message?.warning('请至少选择一位参与成员');
    return;
  }
  const payload = {
    title: form.title.trim(),
    date: form.date || dayjs().format('YYYY-MM-DD'),
    source: form.source,
    default_hours: roundHours(form.default_hours || 1),
    status: form.status,
    event_id: form.event_id || undefined,
    participants: participants.value.map(p => ({
      member_id: p.member_id,
      name_snapshot: p.name_snapshot,
      hours: roundHours(Number(p.hours) || 0),
      role_note: p.role_note?.trim() || undefined
    })),
    note: form.note.trim() || undefined
  };

  if (props.editingActivity) {
    await workStore.updateVolunteerActivity(props.editingActivity.id, payload);
    window.$message?.success('志愿活动记录已更新');
  } else {
    await workStore.addVolunteerActivity(payload);
    window.$message?.success(`已登记志愿活动（${participants.value.length} 人 · 共 ${totalActivityHours.value}h）`);
  }
  emit('saved');
  emit('update:show', false);
}
</script>

<template>
  <NDrawer :show="show" :width="680" class="max-w-96vw" @update:show="val => emit('update:show', val)">
    <NDrawerContent closable>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-10px pr-8px">
          <div class="flex items-center gap-8px">
            <span class="vol-header-badge">
              <SvgIcon icon="lucide:heart-handshake" class="text-15px text-[#16a34a]" />
            </span>
            <span class="text-15px font-bold text-[var(--sct-ink)]">
              {{ editingActivity ? '编辑志愿活动记录' : '登记志愿服务活动' }}
            </span>
          </div>
          <div class="flex items-center gap-6px font-mono text-12px">
            <NTag size="small" :bordered="false" type="success">
              {{ participants.length }} 人 · {{ totalActivityHours }} h
            </NTag>
          </div>
        </div>
      </template>

      <div class="flex flex-col gap-14px">
        <!-- 快捷引入工具带 -->
        <div class="vol-section vol-section--soft">
          <div class="flex flex-wrap items-center gap-8px">
            <div class="min-w-240px flex-1">
              <NSelect
                :value="form.event_id || null"
                :options="calEventOptions"
                size="small"
                clearable
                filterable
                placeholder="从台历 / 三会一课已有活动一键带出日期与到会名单…"
                @update:value="handleImportFromCalEvent"
              />
            </div>
            <NButton
              size="small"
              :type="wechatOpen ? 'primary' : 'info'"
              :secondary="!wechatOpen"
              @click="wechatOpen = !wechatOpen"
            >
              <template #icon><SvgIcon icon="lucide:clipboard-paste" /></template>
              {{ wechatOpen ? '收起接龙识人' : '微信接龙识人' }}
            </NButton>
          </div>

          <!-- 微信接龙粘贴解析区 -->
          <div v-if="wechatOpen" data-tour="volunteer-wechat-box" class="vol-wechat-box mt-10px">
            <div class="flex items-center gap-6px text-12px font-semibold text-[var(--sct-ink)]">
              <SvgIcon icon="lucide:sparkles" class="text-14px text-[#16a34a]" />
              <span>粘贴群接龙或顿号/换行名单（自动识别单人时长如「2h」「1.5小时」与括号岗位）</span>
            </div>
            <NInput
              v-model:value="wechatText"
              type="textarea"
              :rows="3"
              placeholder="示例：&#10;1. 张明远 2h（现场引导）&#10;2. 李思涵 1.5小时&#10;3. 王子轩"
            />
            <div class="flex flex-wrap items-center justify-between gap-8px">
              <div v-if="unmatchedNames.length" class="flex flex-wrap items-center gap-4px text-11.5px text-[#d97706]">
                <SvgIcon icon="lucide:alert-triangle" class="text-12px" />
                <span>未匹配到：{{ unmatchedNames.join('、') }}</span>
              </div>
              <span v-else class="text-11.5px text-[var(--sct-muted)]">优先匹配在册花名册并自动去重</span>
              <NButton size="tiny" type="primary" @click="handleParseWechatList">
                <template #icon><SvgIcon icon="lucide:wand-2" /></template>
                智能识别并加入
              </NButton>
            </div>
          </div>
        </div>

        <!-- 01 · 活动基本信息 -->
        <div class="vol-section">
          <div class="vol-section__title">
            <span class="vol-step-num">01</span>
            <span>活动基本信息</span>
          </div>
          <NForm label-placement="left" label-width="86" size="small">
            <NFormItem required>
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:bookmark" class="sct-field-icon" />
                  <span>活动名称</span>
                </span>
              </template>
              <NInput v-model:value="form.title" placeholder="如：迎新志愿引导 / 社区科普宣讲 / 档案整理" />
            </NFormItem>
            <div class="grid grid-cols-1 gap-x-14px sm:grid-cols-2">
              <NFormItem required>
                <template #label>
                  <span class="sct-field-label">
                    <SvgIcon icon="lucide:calendar" class="sct-field-icon" />
                    <span>活动日期</span>
                  </span>
                </template>
                <NDatePicker v-model:formatted-value="form.date" type="date" value-format="yyyy-MM-dd" class="w-full" />
              </NFormItem>
              <NFormItem required>
                <template #label>
                  <span class="sct-field-label">
                    <SvgIcon icon="lucide:layers" class="sct-field-icon" />
                    <span>活动来源</span>
                  </span>
                </template>
                <NSelect v-model:value="form.source" :options="sourceOptions" />
              </NFormItem>
              <NFormItem required>
                <template #label>
                  <span class="sct-field-label">
                    <SvgIcon icon="lucide:clock" class="sct-field-icon" />
                    <span>默认时长</span>
                  </span>
                </template>
                <div class="w-full flex items-center gap-6px">
                  <NInputNumber v-model:value="form.default_hours" :min="0.1" :step="0.5" :precision="2" class="flex-1">
                    <template #suffix>h</template>
                  </NInputNumber>
                  <NButton size="tiny" secondary :disabled="!participants.length" @click="applyDefaultHoursToAll">
                    套用全员
                  </NButton>
                </div>
              </NFormItem>
              <NFormItem>
                <template #label>
                  <span class="sct-field-label">
                    <SvgIcon icon="lucide:badge-check" class="sct-field-icon" />
                    <span>认定状态</span>
                  </span>
                </template>
                <NRadioGroup v-model:value="form.status" size="small">
                  <NRadioButton value="已认定">已认定</NRadioButton>
                  <NRadioButton value="待核实">待核实</NRadioButton>
                </NRadioGroup>
              </NFormItem>
            </div>
            <NFormItem :show-feedback="false">
              <template #label>
                <span class="sct-field-label">
                  <SvgIcon icon="lucide:file-text" class="sct-field-icon" />
                  <span>活动备注</span>
                </span>
              </template>
              <NInput v-model:value="form.note" placeholder="选填：主办单位、服务地点或证明说明" />
            </NFormItem>
          </NForm>
        </div>

        <!-- 02 · 快捷勾选参与成员芯片区 -->
        <div class="vol-section">
          <div class="mb-8px flex flex-wrap items-center justify-between gap-8px">
            <div class="vol-section__title !mb-0">
              <span class="vol-step-num">02</span>
              <span>选择参与人员</span>
              <span class="text-11px font-normal text-[var(--sct-muted)]">
                全员兼容 · 匹配 {{ candidateMembers.length }} 人
              </span>
            </div>
            <div class="flex items-center gap-6px">
              <NButton size="tiny" secondary @click="selectAllCandidates">全选筛选结果</NButton>
              <NButton size="tiny" quaternary :disabled="!participants.length" @click="participants = []">
                清空已选
              </NButton>
            </div>
          </div>

          <!-- 搜索 + 党小组 + 身份紧凑筛栏 -->
          <div class="mb-10px grid grid-cols-1 gap-6px sm:grid-cols-3">
            <NInput v-model:value="chipSearch" size="tiny" clearable placeholder="快搜姓名 / 学号…">
              <template #prefix><SvgIcon icon="lucide:search" class="text-12px text-gray-400" /></template>
            </NInput>
            <NSelect
              v-model:value="chipGroupFilter"
              size="tiny"
              clearable
              placeholder="按党小组筛选"
              :options="workStore.partyGroupNames.map(g => ({ label: g, value: g }))"
            />
            <NSelect
              v-model:value="chipTypeFilter"
              size="tiny"
              clearable
              placeholder="按身份筛选"
              :options="MEMBER_TYPE_ORDER.map(t => ({ label: t, value: t }))"
            />
          </div>

          <div v-if="candidateMembers.length" class="max-h-144px flex flex-wrap gap-6px overflow-y-auto pr-2px">
            <button
              v-for="m in candidateMembers"
              :key="m.id"
              type="button"
              class="vol-chip"
              :class="{ 'is-selected': selectedMemberIdSet.has(m.id) }"
              @click="toggleParticipant(m)"
            >
              <span class="size-6px shrink-0 rounded-full" :style="{ backgroundColor: MEMBER_TYPE_COLORS[m.type] }" />
              <span>{{ m.name }}</span>
              <span class="text-10px opacity-65">{{ m.type.slice(0, 2) }}</span>
              <SvgIcon v-if="selectedMemberIdSet.has(m.id)" icon="lucide:check" class="text-11px text-[#16a34a]" />
            </button>
          </div>
          <div v-else class="py-14px text-center text-12px text-[var(--sct-muted)]">无符合条件的在册成员</div>
        </div>

        <!-- 03 · 已选人员表格化时长与分工清单 -->
        <div class="vol-section !p-0 overflow-hidden">
          <div class="vol-table-head">
            <div class="flex items-center gap-6px">
              <span class="vol-step-num">03</span>
              <span class="text-12.5px font-bold text-[var(--sct-ink)]">已选名单与时长微调</span>
            </div>
            <span class="font-mono text-12px font-semibold text-[#16a34a]">
              {{ participants.length }} 人 · 合计 {{ totalActivityHours }} 小时
            </span>
          </div>

          <div v-if="!participants.length" class="px-14px py-22px text-center text-12px text-[var(--sct-muted)]">
            尚未选择参与人员，请在上方点击人头芯片或使用「微信接龙识人」批量导入。
          </div>

          <template v-else>
            <div class="vol-grid-row vol-grid-row--header">
              <span>成员</span>
              <span>认定时长</span>
              <span>分工 / 岗位备注</span>
              <span class="text-center">移出</span>
            </div>
            <div class="max-h-230px divide-y divide-[var(--sct-border)] overflow-y-auto">
              <div v-for="(p, idx) in participants" :key="p.member_id" class="vol-grid-row vol-grid-row--body">
                <div class="flex min-w-0 items-center gap-6px">
                  <span
                    class="size-7px shrink-0 rounded-full"
                    :style="{ backgroundColor: memberDotColor(p.member_id) }"
                  />
                  <span class="truncate text-12.5px font-semibold text-[var(--sct-ink)]">{{ p.name_snapshot }}</span>
                </div>
                <NInputNumber v-model:value="p.hours" size="tiny" :min="0" :step="0.5" :precision="2" class="w-full">
                  <template #suffix>h</template>
                </NInputNumber>
                <NInput v-model:value="p.role_note" size="tiny" placeholder="选填：引导 / 摄影 / 宣讲" />
                <div class="flex justify-center">
                  <NButton size="tiny" quaternary type="error" @click="participants.splice(idx, 1)">
                    <template #icon><SvgIcon icon="lucide:x" class="text-12px" /></template>
                  </NButton>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <template #footer>
        <div class="flex w-full items-center justify-between gap-10px">
          <span class="text-11.5px text-[var(--sct-muted)]">
            状态为「已认定」的活动将自动计入成员年度志愿总时长，并支持积分草稿同步
          </span>
          <div class="flex shrink-0 items-center gap-8px">
            <NButton size="small" @click="emit('update:show', false)">取消</NButton>
            <NButton size="small" type="primary" @click="handleSave">
              <template #icon><SvgIcon icon="lucide:check" /></template>
              保存志愿活动
            </NButton>
          </div>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.vol-header-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--sct-radius, 7px);
  background: var(--sct-ok-soft, rgba(22, 163, 74, 0.1));
  border: 1px solid rgba(22, 163, 74, 0.25);
}

.vol-section {
  border-radius: var(--sct-radius, 8px);
  border: 1px solid var(--sct-border);
  background: var(--sct-page);
  padding: 12px;
}

.vol-section--soft {
  background: var(--sct-soft);
}

.vol-section__title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--sct-ink);
}

.vol-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 6px;
  border-radius: var(--sct-radius, 4px);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  font-weight: 700;
  color: #16a34a;
  background: var(--sct-ok-soft, rgba(22, 163, 74, 0.12));
}

.vol-wechat-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--sct-radius, 6px);
  border: 1px solid var(--sct-border);
  border-left: 3px solid #16a34a;
  background: var(--sct-container);
}

.vol-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: var(--sct-radius, 6px);
  border: 1px solid var(--sct-border);
  background: var(--sct-container);
  color: var(--sct-ink);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.vol-chip:hover {
  border-color: var(--sct-ink);
}

.vol-chip.is-selected {
  border-color: #16a34a;
  background: var(--sct-ok-soft, rgba(22, 163, 74, 0.1));
  color: #16a34a;
  font-weight: 600;
}

.vol-table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--sct-border);
  background: var(--sct-soft);
}

.vol-grid-row {
  display: grid;
  grid-template-columns: 112px 104px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
}

.vol-grid-row--header {
  font-size: 11px;
  font-weight: 600;
  color: var(--sct-muted);
  background: var(--sct-container);
  border-bottom: 1px solid var(--sct-border);
}

.vol-grid-row--body {
  background: var(--sct-page);
  transition: background-color 0.12s ease;
}

.vol-grid-row--body:hover {
  background: var(--sct-soft);
}
</style>
