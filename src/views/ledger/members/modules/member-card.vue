<script setup lang="ts">
/**
 * 人员详情 & 历史档案全景抽屉（v0.3.0 升级）
 * - 生命周期状态徽章（支持历史归档只读全景视图 + 一键恢复在册）
 * - 按场景字段组展示高校/企事业/社区字段 + 自定义扩展字段
 * - 集成个人志愿时长摘要与组织关系转接轨迹
 * - 快捷发起「关系转出」与「政治生日贺卡」
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import dayjs from 'dayjs';
import { computeNextDevNode } from '@/constants/dev-nodes';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';
import { MEMBER_LIFECYCLE_META, getMemberLifecycle, isMemberArchived } from '@/constants/workspace-presets';
import { maskIdCard } from '@/utils/member-code';
import { resolveEffectiveFullDate } from '@/utils/member-status';
import { roundHours } from '@/utils/volunteer';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'MemberCard' });

const props = withDefaults(defineProps<{ show: boolean; memberId: string | null; editable?: boolean }>(), {
  editable: true
});
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void;
  (e: 'edit', member: Sct.Member): void;
  (e: 'transfer-out', memberId: string): void;
}>();

const router = useRouter();
const workStore = useWorkDataStore();

function goBirthdayCard(memberId: string) {
  emit('update:show', false);
  void router.push({ path: '/library/birthday', query: { memberId } });
}

const show = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
});

const revealIdCard = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function toggleRevealIdCard() {
  clearHideTimer();
  revealIdCard.value = !revealIdCard.value;
  if (revealIdCard.value) {
    hideTimer = setTimeout(() => {
      revealIdCard.value = false;
      hideTimer = null;
    }, 15_000);
  }
}

watch(
  () => [props.show, props.memberId],
  () => {
    clearHideTimer();
    revealIdCard.value = false;
  }
);

onUnmounted(clearHideTimer);

const member = computed(() => (props.memberId ? workStore.memberOf(props.memberId) : undefined));
const lifecycle = computed(() => getMemberLifecycle(member.value));
const lifecycleMeta = computed(() => MEMBER_LIFECYCLE_META[lifecycle.value]);
const archived = computed(() => isMemberArchived(member.value));

const customFieldDefs = computed(() => workStore.workspaceConfig.customFields);

const devStage = computed(() =>
  props.memberId ? workStore.devStages.find(d => d.member_id === props.memberId) : undefined
);

const effectiveNextNode = computed(() =>
  devStage.value ? computeNextDevNode(devStage.value.stage, devStage.value.materials) : ''
);

const talksThisYear = computed(() => {
  if (!props.memberId) return 0;
  const year = dayjs().format('YYYY');
  return workStore.talks.filter(t => t.member_ids.includes(props.memberId!) && t.date.startsWith(year)).length;
});

const feePaidCount = computed(() =>
  props.memberId ? workStore.feeRecords.filter(f => f.member_id === props.memberId && f.status === '已缴').length : 0
);

const volunteerSummary = computed(() => {
  if (!props.memberId)
    return { hours: 0, count: 0, recent: [] as Array<{ date: string; title: string; hours: number }> };
  let hours = 0;
  const recent: Array<{ date: string; title: string; hours: number }> = [];
  for (const act of workStore.volunteerActivities) {
    const hit = act.participants.find(p => p.member_id === props.memberId);
    if (!hit) continue;
    if (act.status === '已认定') {
      hours = roundHours(hours + (Number(hit.hours) || 0));
    }
    recent.push({ date: act.date, title: act.title, hours: hit.hours });
  }
  recent.sort((a, b) => b.date.localeCompare(a.date));
  return { hours, count: recent.length, recent: recent.slice(0, 4) };
});

const memberTransfers = computed(() =>
  props.memberId
    ? workStore.transferRecords
        .filter(r => r.member_id === props.memberId)
        .slice()
        .sort((a, b) => (b.initiated_date || '').localeCompare(a.initiated_date || ''))
    : []
);

const effectiveFullDate = computed(() =>
  member.value
    ? resolveEffectiveFullDate(member.value.join_date, member.value.full_date, member.value.key_dates?.probation_end)
    : ''
);

const isProbationFuture = computed(() =>
  Boolean(effectiveFullDate.value && effectiveFullDate.value > dayjs().format('YYYY-MM-DD'))
);

const dormText = computed(() => {
  if (!member.value) return '';
  return [member.value.dorm_building, member.value.dorm_room].filter(Boolean).join(' · ');
});

async function handleRestore() {
  if (!member.value) return;
  await workStore.restoreMemberToActive(member.value.id);
  window.$message?.success(`已将「${member.value.name}」恢复为在册正常`);
}
</script>

<template>
  <NDrawer v-model:show="show" :width="470" class="max-w-96vw">
    <NDrawerContent v-if="member" :title="`${member.name}（${member.code}）`" closable>
      <NSpace data-tour="member-card-drawer" vertical size="large">
        <!-- 归档横幅 -->
        <NAlert v-if="archived" type="warning" :show-icon="true">
          <div class="flex flex-wrap items-center justify-between gap-8px">
            <div class="text-12px">
              <strong>{{ lifecycle }}</strong>
              <span v-if="member.archived_at">（{{ member.archived_at }}）</span>
              <div v-if="member.archive_reason" class="mt-2px opacity-85">{{ member.archive_reason }}</div>
            </div>
            <NPopconfirm v-if="props.editable" @positive-click="handleRestore">
              <template #trigger>
                <NButton size="tiny" type="primary" secondary>恢复在册</NButton>
              </template>
              确认将「{{ member.name }}」恢复为在册正常？
            </NPopconfirm>
          </div>
        </NAlert>

        <div class="flex flex-wrap items-center justify-between gap-8px">
          <div class="flex flex-wrap items-center gap-6px">
            <NTag :color="{ color: MEMBER_TYPE_COLORS[member.type] ?? '#666', textColor: '#fff' }" :bordered="false">
              {{ member.type }}
            </NTag>
            <NTag :type="lifecycleMeta.tagType" size="small" :bordered="false">
              {{ lifecycleMeta.labelZh }}
            </NTag>
            <NTag v-if="member.role" size="small" :bordered="false">{{ member.role }}</NTag>
          </div>
          <div class="flex shrink-0 items-center gap-6px">
            <NButton
              v-if="props.editable && !archived"
              size="tiny"
              secondary
              @click="
                emit('update:show', false);
                emit('edit', member);
              "
            >
              <template #icon><SvgIcon icon="lucide:pencil" /></template>
              编辑
            </NButton>
            <NButton
              v-if="!archived && props.editable"
              size="tiny"
              type="warning"
              secondary
              @click="
                emit('update:show', false);
                emit('transfer-out', member.id);
              "
            >
              <template #icon><SvgIcon icon="lucide:send" /></template>
              关系转出
            </NButton>
            <NButton
              v-if="
                workStore.workspaceConfig.enabledModules.birthday &&
                (member.type === '正式党员' || member.type === '预备党员')
              "
              size="tiny"
              type="primary"
              secondary
              @click="goBirthdayCard(member.id)"
            >
              <template #icon><SvgIcon icon="lucide:gift" /></template>
              生日卡
            </NButton>
          </div>
        </div>

        <NDescriptions :column="1" size="small" label-placement="left" bordered>
          <NDescriptionsItem label="支部名称">{{ member.branch_name || workStore.branchName }}</NDescriptionsItem>
          <NDescriptionsItem v-if="member.student_id" label="学号 / 工号">{{ member.student_id }}</NDescriptionsItem>
          <NDescriptionsItem v-if="member.gender || member.ethnicity" label="性别 / 民族">
            {{ [member.gender, member.ethnicity].filter(Boolean).join(' · ') }}
          </NDescriptionsItem>
          <NDescriptionsItem v-if="member.birth_date" label="出生年月">{{ member.birth_date }}</NDescriptionsItem>

          <!-- 高校学生字段 -->
          <NDescriptionsItem v-if="member.level || member.grade" label="层次 / 年级">
            {{ [member.level, member.grade].filter(Boolean).join(' · ') }}
          </NDescriptionsItem>
          <NDescriptionsItem v-if="member.major || member.class_name" label="专业 / 班级">
            {{ [member.major, member.class_name].filter(Boolean).join(' · ') }}
          </NDescriptionsItem>
          <NDescriptionsItem v-if="dormText" label="宿舍">{{ dormText }}</NDescriptionsItem>
          <NDescriptionsItem v-if="member.advisor" label="导师姓名">{{ member.advisor }}</NDescriptionsItem>

          <!-- 自定义扩展字段 -->
          <NDescriptionsItem v-for="cf in customFieldDefs" :key="cf.key" :label="cf.label">
            {{ member.custom_fields?.[cf.key] || '—' }}
          </NDescriptionsItem>

          <NDescriptionsItem v-if="member.group" label="党小组">{{ member.group }}</NDescriptionsItem>
          <NDescriptionsItem v-if="member.phone" label="联系电话">{{ member.phone }}</NDescriptionsItem>
          <NDescriptionsItem v-if="member.id_card" label="身份证号">
            <div class="flex items-center justify-between gap-8px">
              <span class="font-mono text-12px">
                {{ revealIdCard ? member.id_card : maskIdCard(member.id_card) }}
              </span>
              <NButton size="tiny" quaternary @click="toggleRevealIdCard">
                <template #icon>
                  <SvgIcon :icon="revealIdCard ? 'lucide:eye-off' : 'lucide:eye'" />
                </template>
                {{ revealIdCard ? '隐藏' : '临时查看' }}
              </NButton>
            </div>
          </NDescriptionsItem>
          <NDescriptionsItem v-if="member.join_date || effectiveFullDate" label="入党 / 转正">
            {{ member.join_date || '—' }}
            <template v-if="effectiveFullDate">
              / {{ isProbationFuture ? '预计转正' : '转正' }} {{ effectiveFullDate }}
            </template>
          </NDescriptionsItem>
          <NDescriptionsItem label="历史台账留痕">
            已缴党费 {{ feePaidCount }} 月 · 今年谈话 {{ talksThisYear }} 次
          </NDescriptionsItem>
          <NDescriptionsItem v-if="member.note" label="备注">{{ member.note }}</NDescriptionsItem>
        </NDescriptions>

        <!-- 志愿时长摘要（当志愿模块开启或存在记录时显示） -->
        <div
          v-if="workStore.workspaceConfig.enabledModules.volunteer || volunteerSummary.count > 0"
          class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] p-10px"
        >
          <div class="mb-6px flex items-center justify-between text-12.5px font-bold">
            <span class="flex items-center gap-5px">
              <SvgIcon icon="lucide:heart-handshake" class="text-[#16a34a]" />
              志愿服务时长
            </span>
            <span class="font-mono text-[#16a34a]">
              {{ volunteerSummary.hours }} h（{{ volunteerSummary.count }} 场）
            </span>
          </div>
          <div v-if="volunteerSummary.recent.length" class="flex flex-col gap-4px text-11.5px text-[var(--sct-muted)]">
            <div
              v-for="(item, idx) in volunteerSummary.recent"
              :key="idx"
              class="flex items-center justify-between gap-8px"
            >
              <span class="truncate">{{ item.date }} · {{ item.title }}</span>
              <span class="shrink-0 font-mono font-semibold text-[var(--sct-ink)]">{{ item.hours }}h</span>
            </div>
          </div>
          <div v-else class="text-11.5px text-[var(--sct-muted)]">暂无志愿服务记录</div>
        </div>

        <!-- 组织关系转接 / 流动轨迹 -->
        <div
          v-if="memberTransfers.length"
          class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] p-10px"
        >
          <div class="mb-6px text-12.5px font-bold">组织关系转接 / 流动记录</div>
          <div class="flex flex-col gap-6px text-11.5px">
            <div
              v-for="t in memberTransfers"
              :key="t.id"
              class="border-b border-dashed border-[var(--sct-border)] pb-5px last:border-b-0 last:pb-0"
            >
              <div class="flex items-center justify-between">
                <span class="font-semibold">
                  {{
                    t.direction === 'out'
                      ? '关系转出'
                      : t.direction === 'in'
                        ? '转入核查'
                        : t.direction === 'float_out'
                          ? '流出党员'
                          : '流入党员'
                  }}
                </span>
                <NTag size="tiny" :bordered="false">{{ t.status }}</NTag>
              </div>
              <div class="mt-2px text-[var(--sct-muted)]">
                {{ t.initiated_date }} · {{ t.target_branch || t.target_committee || t.source_org || '未填写对方组织' }}
              </div>
            </div>
          </div>
        </div>

        <div v-if="effectiveNextNode && !archived">
          <div class="mb-6px text-13px font-bold">下一步发展待办</div>
          <div class="rounded-8px bg-[var(--sct-soft)] p-10px text-13px leading-relaxed">
            {{ effectiveNextNode }}
            <div v-if="devStage?.next_due" class="mt-4px text-12px text-[#d97706]">预计：{{ devStage.next_due }}</div>
          </div>
        </div>
      </NSpace>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
