<script setup lang="ts">
/**
 * 发展台账个人详情：节点时间线 + 材料清单（支持友好交互与状态变更确认弹窗，防误操作）
 */
import { computed, reactive, ref } from 'vue';
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

const MATERIAL_STATUS_OPTIONS = [
  { label: '未开始', value: '未开始' },
  { label: '进行中', value: '进行中' },
  { label: '已归档', value: '已归档' }
];

const NEXT_STATUS_CYCLE: Record<string, string> = {
  未开始: '进行中',
  进行中: '已归档',
  已归档: '未开始'
};

const matModalShow = ref(false);
const matForm = reactive<{
  no: string;
  name: string;
  currentStatus: string;
  targetStatus: string;
  date: string;
}>({
  no: '',
  name: '',
  currentStatus: '未开始',
  targetStatus: '进行中',
  date: ''
});

function openMaterialConfirm(mat: Sct.DevMaterial) {
  matForm.no = mat.no;
  matForm.name = mat.name;
  matForm.currentStatus = mat.status;
  matForm.targetStatus = NEXT_STATUS_CYCLE[mat.status] ?? '进行中';
  matForm.date = mat.date || dayjs().format('YYYY-MM-DD');
  matModalShow.value = true;
}

async function confirmMaterialChange() {
  if (!stage.value || !matForm.no) return;
  const materials = (stage.value.materials ?? []).map(m => {
    if (m.no !== matForm.no || m.name !== matForm.name) return m;
    return {
      ...m,
      status: matForm.targetStatus,
      date: matForm.targetStatus === '已归档' ? matForm.date || dayjs().format('YYYY-MM-DD') : m.date
    };
  });
  await workStore.updateDevStage(stage.value.member_id, { materials });
  matModalShow.value = false;
  window.$message?.success(`已将「${matForm.no} ${matForm.name}」状态更新为「${matForm.targetStatus}」`);
}

function statusStyle(status: string) {
  if (status === '已归档') {
    return { bg: 'var(--sct-ok-soft)', color: '#3f9d63', dot: '#3f9d63' };
  }
  if (status === '进行中') {
    return { bg: 'var(--sct-warn-soft)', color: '#d97706', dot: '#d97706' };
  }
  return { bg: 'var(--sct-container)', color: '#64748b', dot: '#94a3b8' };
}
</script>

<template>
  <NDrawer v-model:show="show" :width="560">
    <NDrawerContent v-if="member && stage" :title="`${member.name} · 发展时间线`" closable>
      <NSpace vertical size="large">
        <div class="flex items-center gap-8px">
          <NTag :bordered="false" size="small" :color="{ color: 'var(--sct-err-soft)', textColor: '#A81C24' }">
            {{ stage.stage }}
          </NTag>
          <span class="text-12px text-gray-500">自 {{ stage.stage_date }} 起 · {{ daysInStage }} 天</span>
        </div>

        <!-- 下一步卡片 -->
        <div v-if="stage.next_node" class="rounded-10px border border-[#f0d9d9] bg-[var(--sct-err-soft)] p-12px">
          <div class="text-12px font-bold text-[#A81C24]">下一步待办</div>
          <div class="mt-4px text-13px leading-relaxed">{{ stage.next_node }}</div>
          <div v-if="stage.next_due" class="mt-4px text-12px text-[#d97706]">预计 {{ stage.next_due }}</div>
        </div>

        <!-- 本阶段节点材料库（显式操作按钮 + 确认弹窗） -->
        <div>
          <div class="mb-8px flex items-center justify-between">
            <span class="text-13px font-bold">本阶段节点与材料清单</span>
            <span class="text-11px text-gray-400">点击右侧状态按钮可变更进度（带确认提示）</span>
          </div>
          <div class="flex flex-col gap-10px">
            <div
              v-for="n in stageNodes"
              :key="n.no"
              class="rounded-10px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-10px"
            >
              <div class="flex items-center justify-between gap-8px text-12px font-bold">
                <div>
                  <span class="mr-4px text-[#A81C24]">{{ n.no }}</span>
                  <span>{{ n.node }}</span>
                </div>
                <NTag v-if="n.deadline" size="tiny" type="warning" :bordered="false">{{ n.deadline }}</NTag>
              </div>

              <div class="mt-8px flex flex-col gap-6px">
                <div
                  v-for="mat in (stage.materials ?? []).filter(x =>
                    n.materials.some(nm => x.name.includes(nm.slice(0, 6)))
                  )"
                  :key="`${mat.no}-${mat.name}`"
                  class="flex items-center justify-between gap-8px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-container)] px-10px py-6px"
                >
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-12px font-medium text-[var(--sct-ink)]">
                      <span class="mr-4px font-mono text-11px text-gray-400">{{ mat.no }}</span>
                      <span>{{ mat.name }}</span>
                    </div>
                    <div v-if="mat.date" class="mt-2px text-11px text-gray-400">归档日期：{{ mat.date }}</div>
                  </div>

                  <button
                    type="button"
                    class="inline-flex flex-shrink-0 items-center gap-5px rounded-full border border-[var(--sct-border)] px-10px py-3px text-11px font-bold transition hover:border-[#A81C24]"
                    :style="{
                      background: statusStyle(mat.status).bg,
                      color: statusStyle(mat.status).color
                    }"
                    title="点击修改该材料状态"
                    @click="openMaterialConfirm(mat)"
                  >
                    <span
                      class="inline-block size-6px rounded-full"
                      :style="{ background: statusStyle(mat.status).dot }"
                    />
                    <span>{{ mat.status }}</span>
                    <SvgIcon icon="lucide:chevron-down" class="text-11px opacity-75" />
                  </button>
                </div>

                <span
                  v-if="!(stage.materials ?? []).some(x => n.materials.some(nm => x.name.includes(nm.slice(0, 6))))"
                  class="text-12px text-gray-400"
                >
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
            <NStep
              v-for="(t, i) in timeline"
              :key="i"
              :title="t.node"
              :description="`${t.date}${t.note ? ` · ${t.note}` : ''}`"
            />
          </NSteps>
          <div v-else class="text-12px text-gray-400">暂无记录</div>
        </div>
      </NSpace>
    </NDrawerContent>
  </NDrawer>

  <!-- 材料状态变更确认弹窗 -->
  <NModal
    v-model:show="matModalShow"
    preset="card"
    title="确认变更材料状态"
    class="w-460px"
    :mask-closable="false"
  >
    <div class="mb-12px rounded-8px bg-[var(--sct-soft)] px-12px py-10px text-13px">
      <div class="font-bold text-[var(--sct-ink)]">{{ matForm.no }} {{ matForm.name }}</div>
      <div class="mt-4px text-12px text-gray-500">当前状态：{{ matForm.currentStatus }}</div>
    </div>

    <NForm label-placement="left" label-width="112" size="small">
      <NFormItem required>
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:check-circle-2" class="sct-field-icon" />
            <span>变更为状态</span>
          </span>
        </template>
        <NSelect v-model:value="matForm.targetStatus" :options="MATERIAL_STATUS_OPTIONS" />
      </NFormItem>
      <NFormItem v-if="matForm.targetStatus === '已归档'">
        <template #label>
          <span class="sct-field-label">
            <SvgIcon icon="lucide:calendar-check" class="sct-field-icon" />
            <span>归档日期</span>
          </span>
        </template>
        <NInput v-model:value="matForm.date" placeholder="YYYY-MM-DD" />
      </NFormItem>
    </NForm>

    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton size="small" @click="matModalShow = false">取消</NButton>
        <NButton size="small" type="primary" @click="confirmMaterialChange">
          <template #icon><SvgIcon icon="lucide:check" /></template>
          确认变更
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
