<script setup lang="ts">
/**
 * 人员详情抽屉：A8 六项信息（类型/年级/研究方向组/发展阶段/最近缴费/今年谈话次数）
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import dayjs from 'dayjs';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';
import { resolveEffectiveFullDate } from '@/utils/member-status';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'MemberCard' });

const props = defineProps<{ show: boolean; memberId: string | null }>();
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

const member = computed(() => (props.memberId ? workStore.memberOf(props.memberId) : undefined));

const devStage = computed(() =>
  props.memberId ? workStore.devStages.find(d => d.member_id === props.memberId) : undefined
);

const latestFee = computed(() => {
  if (!props.memberId) return undefined;
  return [...workStore.feeRecords]
    .filter(f => f.member_id === props.memberId)
    .sort((a, b) => b.year_month.localeCompare(a.year_month))[0];
});

const talksThisYear = computed(() => {
  if (!props.memberId) return 0;
  const year = dayjs().format('YYYY');
  return workStore.talks.filter(t => t.member_ids.includes(props.memberId!) && t.date.startsWith(year)).length;
});

const unpaidMonths = computed(() =>
  props.memberId
    ? workStore.feeRecords.filter(f => f.member_id === props.memberId && f.status === '欠缴').map(f => f.year_month)
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

const feeStatusType = computed<'success' | 'error' | 'default' | 'warning'>(() => {
  switch (latestFee.value?.status) {
    case '已缴':
      return 'success';
    case '欠缴':
      return 'error';
    case '未在校':
      return 'default';
    default:
      return 'warning';
  }
});
</script>

<template>
  <NDrawer v-model:show="show" :width="400">
    <NDrawerContent v-if="member" :title="`${member.name}（${member.code}）`" closable>
      <NSpace vertical size="large">
        <div class="flex items-center justify-between gap-8px">
          <div class="flex items-center gap-8px">
            <NTag :color="{ color: MEMBER_TYPE_COLORS[member.type] ?? '#666', textColor: '#fff' }" :bordered="false">
              {{ member.type }}
            </NTag>
            <NTag v-if="member.role" size="small" :bordered="false">{{ member.role }}</NTag>
          </div>
          <div class="flex items-center gap-6px">
            <NButton
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
          <NDescriptionsItem label="年级 / 层次">{{ member.grade }} · {{ member.level || '—' }}</NDescriptionsItem>
          <NDescriptionsItem label="研究方向组">{{ member.group || '—' }}</NDescriptionsItem>
          <NDescriptionsItem label="专业 / 导师">
            {{ member.major || '—' }}{{ member.advisor ? ` / ${member.advisor}` : '' }}
          </NDescriptionsItem>
          <NDescriptionsItem label="当前发展阶段">
            {{ devStage?.stage ?? member.type }}
            <template v-if="devStage?.stage_date">（{{ devStage.stage_date }} 起）</template>
          </NDescriptionsItem>
          <NDescriptionsItem v-if="member.type === '正式党员' || member.type === '预备党员'" label="党费标准">
            <span class="font-semibold">{{ member.fee_category ?? '学生党员' }}</span>
            <span class="ml-4px text-gray-500">· {{ workStore.memberMonthlyFee(member).toFixed(1) }} 元/月</span>
          </NDescriptionsItem>
          <NDescriptionsItem label="最近缴费状态">
            <NTag v-if="latestFee" :type="feeStatusType" size="small">
              {{ latestFee.year_month }} {{ latestFee.status
              }}{{ latestFee.status === '已缴' ? `（¥${latestFee.amount.toFixed(1)}）` : '' }}
            </NTag>
            <span v-else class="text-gray-400">无记录</span>
            <div v-if="unpaidMonths.length" class="mt-4px text-12px text-[#d43030]">
              欠缴月份：{{ unpaidMonths.join('、') }}
            </div>
          </NDescriptionsItem>
          <NDescriptionsItem label="今年谈心谈话">{{ talksThisYear }} 次</NDescriptionsItem>
          <NDescriptionsItem v-if="member.join_date || effectiveFullDate" label="入党 / 转正">
            {{ member.join_date || '—' }}
            <template v-if="effectiveFullDate">
              / {{ isProbationFuture ? '预计转正' : '转正' }} {{ effectiveFullDate }}
            </template>
          </NDescriptionsItem>
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
