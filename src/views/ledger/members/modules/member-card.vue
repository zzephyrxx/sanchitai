<script setup lang="ts">
/**
 * 人员详情抽屉：完整展示支部党员档案（身份证号默认脱敏，点击临时查看 15 秒后自动隐藏）
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import dayjs from 'dayjs';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';
import { maskIdCard } from '@/utils/member-code';
import { resolveEffectiveFullDate } from '@/utils/member-status';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'MemberCard' });

const props = withDefaults(defineProps<{ show: boolean; memberId: string | null; editable?: boolean }>(), {
  editable: true
});
const emit = defineEmits<{ (e: 'update:show', v: boolean): void; (e: 'edit', member: Sct.Member): void }>();

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

// 身份证号临时明文展示（15 秒自动重新隐藏，关闭抽屉立即重置）
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

const devStage = computed(() =>
  props.memberId ? workStore.devStages.find(d => d.member_id === props.memberId) : undefined
);

const talksThisYear = computed(() => {
  if (!props.memberId) return 0;
  const year = dayjs().format('YYYY');
  return workStore.talks.filter(t => t.member_ids.includes(props.memberId!) && t.date.startsWith(year)).length;
});

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
</script>

<template>
  <NDrawer v-model:show="show" :width="440">
    <NDrawerContent v-if="member" :title="`${member.name}（${member.code}）`" closable>
      <NSpace vertical size="large">
        <div class="flex items-center justify-between gap-8px">
          <div class="flex flex-wrap items-center gap-6px">
            <NTag :color="{ color: MEMBER_TYPE_COLORS[member.type] ?? '#666', textColor: '#fff' }" :bordered="false">
              {{ member.type }}
            </NTag>
            <NTag v-if="member.role" size="small" :bordered="false">{{ member.role }}</NTag>
          </div>
          <div class="flex shrink-0 items-center gap-6px">
            <NButton
              v-if="props.editable"
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
              v-if="member.type === '正式党员' || member.type === '预备党员'"
              size="tiny"
              type="primary"
              secondary
              @click="goBirthdayCard(member.id)"
            >
              <template #icon><SvgIcon icon="lucide:gift" /></template>
              政治生日卡
            </NButton>
          </div>
        </div>

        <NDescriptions :column="1" size="small" label-placement="left" bordered>
          <NDescriptionsItem label="支部名称">{{ member.branch_name || workStore.branchName }}</NDescriptionsItem>
          <NDescriptionsItem v-if="member.student_id" label="学号">{{ member.student_id }}</NDescriptionsItem>
          <NDescriptionsItem v-if="member.gender || member.ethnicity" label="性别 / 民族">
            {{ [member.gender, member.ethnicity].filter(Boolean).join(' · ') }}
          </NDescriptionsItem>
          <NDescriptionsItem v-if="member.birth_date" label="出生年月">{{ member.birth_date }}</NDescriptionsItem>
          <NDescriptionsItem label="层次 / 年级">
            {{ [member.level, member.grade].filter(Boolean).join(' · ') || '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem label="专业 / 班级">
            {{ [member.major, member.class_name].filter(Boolean).join(' · ') || '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem v-if="dormText" label="宿舍">{{ dormText }}</NDescriptionsItem>
          <NDescriptionsItem label="导师姓名">{{ member.advisor || '—' }}</NDescriptionsItem>
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
          <NDescriptionsItem label="今年谈心谈话">{{ talksThisYear }} 次</NDescriptionsItem>
          <NDescriptionsItem v-if="member.note" label="备注">{{ member.note }}</NDescriptionsItem>
        </NDescriptions>

        <div v-if="devStage?.next_node">
          <div class="mb-6px text-13px font-bold">下一步</div>
          <div class="rounded-8px bg-[var(--sct-soft)] p-10px text-13px leading-relaxed">
            {{ devStage.next_node }}
            <div v-if="devStage.next_due" class="mt-4px text-12px text-[#d97706]">预计：{{ devStage.next_due }}</div>
          </div>
        </div>
      </NSpace>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
