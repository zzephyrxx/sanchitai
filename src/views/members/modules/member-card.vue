<script setup lang="ts">
/**
 * 人员详情抽屉：A8 六项信息（类型/年级/研究方向组/发展阶段/最近缴费/今年谈话次数）
 */
import { computed } from 'vue';
import dayjs from 'dayjs';
import { useWorkDataStore } from '@/store/modules/work-data';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';

defineOptions({ name: 'MemberCard' });

const props = defineProps<{ show: boolean; memberId: string | null }>();
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>();

const workStore = useWorkDataStore();

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

const feeStatusType = computed(() => {
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
        <div class="flex items-center gap-8px">
          <NTag :color="{ color: MEMBER_TYPE_COLORS[member.type] ?? '#666', textColor: '#fff' }" :bordered="false">{{ member.type }}</NTag>
          <NTag v-if="member.role" size="small" :bordered="false">{{ member.role }}</NTag>
        </div>

        <NDescriptions :column="1" size="small" label-placement="left" bordered>
          <NDescriptionsItem label="年级 / 层次">{{ member.grade }} · {{ member.level || '—' }}</NDescriptionsItem>
          <NDescriptionsItem label="研究方向组">{{ member.group || '—' }}</NDescriptionsItem>
          <NDescriptionsItem label="专业 / 导师">{{ member.major || '—' }}{{ member.advisor ? ` / ${member.advisor}` : '' }}</NDescriptionsItem>
          <NDescriptionsItem label="当前发展阶段">
            {{ devStage?.stage ?? member.type }}
            <template v-if="devStage?.stage_date">（{{ devStage.stage_date }} 起）</template>
          </NDescriptionsItem>
          <NDescriptionsItem label="最近缴费状态">
            <NTag v-if="latestFee" :type="feeStatusType as any" size="small">
              {{ latestFee.year_month }} {{ latestFee.status }}
            </NTag>
            <span v-else class="text-gray-400">无记录</span>
            <div v-if="unpaidMonths.length" class="mt-4px text-12px text-[#d43030]">欠缴月份：{{ unpaidMonths.join('、') }}</div>
          </NDescriptionsItem>
          <NDescriptionsItem label="今年谈心谈话">{{ talksThisYear }} 次</NDescriptionsItem>
          <NDescriptionsItem v-if="member.join_date" label="入党 / 转正">{{ member.join_date }}{{ member.full_date ? ` / 转正 ${member.full_date}` : '' }}</NDescriptionsItem>
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
