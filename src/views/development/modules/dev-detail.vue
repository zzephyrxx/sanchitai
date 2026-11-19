<script setup lang="ts">
/**
 * 发展台账个人详情：节点时间线 + 材料清单（A13/A14）
 */
import { computed } from 'vue';
import dayjs from 'dayjs';
import { useWorkDataStore } from '@/store/modules/work-data';
import { nodesOfStage } from '@/constants/dev-nodes';

defineOptions({ name: 'DevDetail' });

const props = defineProps<{ show: boolean; memberId: string | null }>();
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>();

const workStore = useWorkDataStore();

const show = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
});

const member = computed(() => (props.memberId ? workStore.memberOf(props.memberId) : undefined));
const stage = computed(() => (props.memberId ? workStore.devStages.find(d => d.member_id === props.memberId) : undefined));

/** 本阶段参考节点库（A14：下一步要看什么材料） */
const stageNodes = computed(() => (stage.value ? nodesOfStage(stage.value.stage) : []));

const daysInStage = computed(() => {
  if (!stage.value?.stage_date) return null;
  return dayjs().diff(dayjs(stage.value.stage_date), 'day');
});

const timeline = computed(() => [...(stage.value?.timeline ?? [])].sort((a, b) => a.date.localeCompare(b.date)));

function toggleMaterial(no: string) {
  if (!stage.value) return;
  const materials = (stage.value.materials ?? []).map(m => {
    if (m.no !== no) return m;
    const cycle: Record<string, string> = { 未开始: '进行中', 进行中: '已归档', 已归档: '未开始' };
    return { ...m, status: cycle[m.status] ?? '进行中' };
  });
  void workStore.updateDevStage(stage.value.member_id, { materials });
}
</script>

<template>
  <NDrawer v-model:show="show" :width="520">
    <NDrawerContent v-if="member && stage" :title="`${member.name} · 发展时间线`" closable>
      <NSpace vertical size="large">
        <div class="flex items-center gap-8px">
          <NTag :bordered="false" size="small" :color="{ color: 'var(--sct-err-soft)', textColor: '#A81C24' }">{{ stage.stage }}</NTag>
          <span class="text-12px text-gray-500">自 {{ stage.stage_date }} 起 · {{ daysInStage }} 天</span>
        </div>

        <!-- 下一步卡片 -->
        <div v-if="stage.next_node" class="rounded-8px border border-[#f0d9d9] bg-[var(--sct-err-soft)] p-10px">
          <div class="text-12px font-bold text-[#A81C24]">下一步</div>
          <div class="mt-4px text-13px leading-relaxed">{{ stage.next_node }}</div>
          <div v-if="stage.next_due" class="mt-4px text-12px text-[#d97706]">预计 {{ stage.next_due }}</div>
        </div>

        <!-- 本阶段节点材料库 -->
        <div>
          <div class="mb-6px text-13px font-bold">本阶段节点与材料（点击材料状态循环切换）</div>
          <div class="flex-col gap-8px">
            <div v-for="n in stageNodes" :key="n.no" class="rounded-8px bg-[var(--sct-soft)] p-8px">
              <div class="text-12px font-bold">
                <span class="text-[#A81C24]">{{ n.no }}</span>
                {{ n.node }}
                <NTag v-if="n.deadline" size="tiny" type="warning" :bordered="false" class="ml-4px">{{ n.deadline }}</NTag>
              </div>
              <div class="mt-4px flex flex-wrap gap-6px">
                <NTag
                  v-for="mat in (stage.materials ?? []).filter(x => n.materials.some(nm => x.name.includes(nm.slice(0, 6))))"
                  :key="mat.no"
                  size="tiny"
                  :bordered="false"
                  class="cursor-pointer"
                  :color="{
                    color: mat.status === '已归档' ? 'var(--sct-ok-soft)' : mat.status === '进行中' ? 'var(--sct-warn-soft)' : '#EEF1F5',
                    textColor: mat.status === '已归档' ? '#3f9d63' : mat.status === '进行中' ? '#d97706' : '#64748b'
                  }"
                  @click="toggleMaterial(mat.no)"
                >
                  {{ mat.no }} {{ mat.name }} · {{ mat.status }}{{ mat.date ? ` ${mat.date}` : '' }}
                </NTag>
                <span v-if="!(stage.materials ?? []).some(x => n.materials.some(nm => x.name.includes(nm.slice(0, 6))))" class="text-12px text-gray-400">
                  {{ n.materials.join(' / ') }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 时间线 -->
        <div>
          <div class="mb-6px text-13px font-bold">时间线</div>
          <NSteps v-if="timeline.length" vertical size="small">
            <NStep v-for="(t, i) in timeline" :key="i" :title="t.node" :description="`${t.date}${t.note ? ` · ${t.note}` : ''}`" />
          </NSteps>
          <div v-else class="text-12px text-gray-400">暂无记录</div>
        </div>
      </NSpace>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
