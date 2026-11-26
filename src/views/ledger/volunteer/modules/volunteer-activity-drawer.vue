<script setup lang="ts">
/**
 * 新建 / 编辑志愿服务活动抽屉（v0.3.0 三合一高效录入）
 * 1. 按党小组 / 身份快捷勾选人头芯片（支持单人微调时长与岗位备注）
 * 2. 从台历 / 三会一课已有活动一键引入（带出日期、名称与到会人员）
 * 3. 粘贴微信群接龙 / 多行名单自动匹配花名册姓名与单人时长
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { MEMBER_TYPE_ORDER } from '@/constants/sanchitai';
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
const chipGroupFilter = ref<string>('');
const chipTypeFilter = ref<string>('');
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

const candidateMembers = computed(() =>
  workStore.activeMembers.filter(m => {
    if (chipGroupFilter.value && (m.group ?? '') !== chipGroupFilter.value) return false;
    if (chipTypeFilter.value && m.type !== chipTypeFilter.value) return false;
    return true;
  })
);

const selectedMemberIdSet = computed(() => new Set(participants.value.map(p => p.member_id)));

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
  const { matched, unmatched } = parseWechatNameList(
    wechatText.value,
    workStore.members,
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
  <NDrawer :show="show" :width="640" class="max-w-96vw" @update:show="val => emit('update:show', val)">
    <NDrawerContent :title="editingActivity ? '编辑志愿活动记录' : '登记志愿服务活动'" closable>
      <div class="flex flex-col gap-14px">
        <!-- 快捷工具条：从台历引入 + 微信接龙名单识人 -->
        <div
          class="flex flex-wrap items-center gap-8px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-10px"
        >
          <div class="min-w-220px flex-1">
            <NSelect
              :value="form.event_id || null"
              :options="calEventOptions"
              size="small"
              clearable
              filterable
              placeholder="快捷引入：从台历 / 三会一课已有活动一键带出…"
              @update:value="handleImportFromCalEvent"
            />
          </div>
          <NButton size="small" type="info" secondary @click="wechatOpen = !wechatOpen">
            <template #icon><SvgIcon icon="lucide:clipboard-paste" /></template>
            {{ wechatOpen ? '收起接龙识人' : '粘贴微信接龙名单' }}
          </NButton>
        </div>

        <!-- 微信接龙粘贴解析区 -->
        <div
          v-if="wechatOpen"
          data-tour="volunteer-wechat-box"
          class="flex flex-col gap-8px rounded-8px border border-[var(--sct-accent)] bg-[var(--sct-page)] p-10px"
        >
          <div class="text-12px font-semibold text-[var(--sct-ink)]">
            粘贴微信群接龙或顿号/换行分隔的姓名（支持识别单人时长如「2h」「1.5小时」与括号岗位）
          </div>
          <NInput
            v-model:value="wechatText"
            type="textarea"
            :rows="4"
            placeholder="示例：&#10;1. 张明远 2h（现场引导）&#10;2. 李思涵 1.5小时&#10;3. 王子轩"
          />
          <div class="flex flex-wrap items-center justify-between gap-8px">
            <div v-if="unmatchedNames.length" class="text-11.5px text-[#d97706]">
              未在花名册匹配到：{{ unmatchedNames.join('、') }}
            </div>
            <span v-else class="text-11.5px text-[var(--sct-muted)]">自动去重并匹配全库花名册</span>
            <NButton size="tiny" type="primary" @click="handleParseWechatList">智能识别并加入</NButton>
          </div>
        </div>

        <!-- 基本信息表单 -->
        <NForm label-placement="left" label-width="86" size="small">
          <NFormItem required>
            <template #label><span class="sct-field-label">活动名称</span></template>
            <NInput v-model:value="form.title" placeholder="如：迎新志愿引导 / 社区科普宣讲 / 档案整理" />
          </NFormItem>
          <div class="grid grid-cols-1 gap-x-12px sm:grid-cols-2">
            <NFormItem required>
              <template #label><span class="sct-field-label">活动日期</span></template>
              <NDatePicker v-model:formatted-value="form.date" type="date" value-format="yyyy-MM-dd" class="w-full" />
            </NFormItem>
            <NFormItem required>
              <template #label><span class="sct-field-label">活动来源</span></template>
              <NSelect v-model:value="form.source" :options="sourceOptions" />
            </NFormItem>
            <NFormItem required>
              <template #label><span class="sct-field-label">默认时长</span></template>
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
              <template #label><span class="sct-field-label">认定状态</span></template>
              <NRadioGroup v-model:value="form.status" size="small">
                <NRadioButton value="已认定">已认定</NRadioButton>
                <NRadioButton value="待核实">待核实</NRadioButton>
              </NRadioGroup>
            </NFormItem>
          </div>
          <NFormItem>
            <template #label><span class="sct-field-label">活动备注</span></template>
            <NInput v-model:value="form.note" placeholder="选填：主办单位、服务地点或证明说明" />
          </NFormItem>
        </NForm>

        <!-- 快捷勾选参与成员芯片区 -->
        <div class="rounded-8px border border-[var(--sct-border)] p-10px">
          <div class="mb-8px flex flex-wrap items-center justify-between gap-6px">
            <span class="text-12.5px font-bold">点选参与人员（全员兼容：党员 / 发展对象 / 积极分子）</span>
            <div class="flex flex-wrap items-center gap-6px">
              <NSelect
                v-model:value="chipGroupFilter"
                size="tiny"
                class="w-116px"
                clearable
                placeholder="按党小组"
                :options="workStore.partyGroupNames.map(g => ({ label: g, value: g }))"
              />
              <NSelect
                v-model:value="chipTypeFilter"
                size="tiny"
                class="w-116px"
                clearable
                placeholder="按身份"
                :options="MEMBER_TYPE_ORDER.map(t => ({ label: t, value: t }))"
              />
              <NButton size="tiny" secondary @click="selectAllCandidates">全选当前</NButton>
              <NButton size="tiny" quaternary @click="participants = []">清空</NButton>
            </div>
          </div>
          <div class="max-h-136px flex flex-wrap gap-6px overflow-y-auto">
            <button
              v-for="m in candidateMembers"
              :key="m.id"
              type="button"
              class="vol-chip"
              :class="{ 'is-selected': selectedMemberIdSet.has(m.id) }"
              @click="toggleParticipant(m)"
            >
              <span>{{ m.name }}</span>
              <span class="text-10px opacity-70">{{ m.type.slice(0, 2) }}</span>
            </button>
          </div>
        </div>

        <!-- 已选人员时长微调表 -->
        <div v-if="participants.length" class="rounded-8px border border-[var(--sct-border)]">
          <div
            class="flex items-center justify-between border-b border-[var(--sct-border)] bg-[var(--sct-soft)] px-10px py-6px text-12px"
          >
            <span class="font-bold">已选 {{ participants.length }} 人 · 合计 {{ totalActivityHours }} 小时</span>
            <span class="text-11px text-[var(--sct-muted)]">可针对不同岗位单独微调小时数</span>
          </div>
          <div class="max-h-220px divide-y divide-[var(--sct-border)] overflow-y-auto">
            <div
              v-for="(p, idx) in participants"
              :key="p.member_id"
              class="flex items-center gap-8px px-10px py-6px text-12px"
            >
              <span class="w-78px shrink-0 truncate font-semibold">{{ p.name_snapshot }}</span>
              <NInputNumber
                v-model:value="p.hours"
                size="tiny"
                :min="0"
                :step="0.5"
                :precision="2"
                class="w-98px shrink-0"
              >
                <template #suffix>h</template>
              </NInputNumber>
              <NInput v-model:value="p.role_note" size="tiny" class="flex-1" placeholder="分工/岗位备注（选填）" />
              <NButton size="tiny" quaternary type="error" @click="participants.splice(idx, 1)">
                <template #icon><SvgIcon icon="lucide:x" class="text-12px" /></template>
              </NButton>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="emit('update:show', false)">取消</NButton>
          <NButton size="small" type="primary" @click="handleSave">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            保存志愿活动
          </NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped>
.vol-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: var(--sct-radius, 6px);
  border: 1px solid var(--sct-border);
  background: var(--sct-page);
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
  background: var(--sct-ok-soft);
  color: #16a34a;
  font-weight: 600;
}
</style>
