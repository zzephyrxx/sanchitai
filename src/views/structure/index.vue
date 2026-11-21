<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useWorkDataStore } from '@/store/modules/work-data';
import { DEV_NODES, type DevNodeDef } from '@/constants/dev-nodes';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';
import EmptyFancy from '@/components/custom/empty-fancy.vue';

defineOptions({ name: 'StructurePage' });

const workStore = useWorkDataStore();

const ROLE_SLOTS = ['书记', '副书记', '组织委员', '宣传委员', '纪检委员'] as const;

function memberOfRole(role: string) {
  return workStore.members.find(m => m.role === role);
}

const unassigned = computed(() =>
  workStore.members.filter(m => !ROLE_SLOTS.includes(m.role as (typeof ROLE_SLOTS)[number]))
);

/** 普通成员（无岗位的党员 + 预备 + 积极 + 发展 + 申请人） */
const regularMembers = computed(() =>
  workStore.members.filter(m => !ROLE_SLOTS.includes(m.role as (typeof ROLE_SLOTS)[number]))
);

const assignState = reactive({ role: '', show: false });
const assignValue = ref<string | null>(null);

function openAssign(role: string) {
  assignState.role = role;
  assignValue.value = null;
  assignState.show = true;
}

async function handleAssign() {
  if (!assignValue.value) return;
  const memberId = assignValue.value;
  const member = workStore.memberOf(memberId);
  if (member && member.role) {
    await workStore.updateMember(member.id, { role: '' });
  }
  const prev = memberOfRole(assignState.role);
  if (prev && prev.id !== memberId) {
    await workStore.updateMember(prev.id, { role: '' });
  }
  await workStore.updateMember(memberId, { role: assignState.role });
  window.$message?.success(`「${assignState.role}」已由 ${member?.name} 担任`);
  assignState.show = false;
}

async function clearRole(role: string) {
  const prev = memberOfRole(role);
  if (prev) {
    await workStore.updateMember(prev.id, { role: '' });
    window.$message?.success(`「${role}」岗位已清空`);
  }
}

const roleOptions = computed(() =>
  unassigned.value.map(m => ({ label: `${m.name}（${m.type}）`, value: m.id }))
);

// ---------------- 发展流程图 ----------------
const flowTab = ref<'org' | 'flow'>('org');
const flowMode = ref<'standard' | 'academy'>('standard');

const STAGES: Array<{ key: DevNodeDef['stage']; label: string }> = [
  { key: '申请人', label: '一、申请入党' },
  { key: '入党积极分子', label: '二、入党积极分子的确定和培养教育' },
  { key: '发展对象', label: '三、发展对象的确定和考察' },
  { key: '预备党员', label: '四、预备党员的接收' },
  { key: '正式党员', label: '五、预备党员的教育考察和转正' }
];

const nodesByStage = computed(() =>
  STAGES.map(s => ({ ...s, nodes: DEV_NODES.filter(n => n.stage === s.key) }))
);

const detailNode = ref<DevNodeDef | null>(null);
const detailShow = ref(false);

function openNode(n: DevNodeDef) {
  detailNode.value = n;
  detailShow.value = true;
}

// ---------------- 学院版流程 ----------------
interface AcademyNode {
  id: string;
  name: string;
  window: string;
  owner: string;
  note: string;
}

const academyNodes = ref<AcademyNode[]>([]);
const academyLoaded = ref(false);

onMounted(async () => {
  const { getMeta } = await import('@/db/db');
  const saved = await getMeta<AcademyNode[]>('academy-flow');
  academyNodes.value = saved ?? [
    { id: 'a1', name: '发展计划下发', window: '每学期初', owner: '学院党委', note: '下发发展计划与时间窗' },
    { id: 'a2', name: '预审材料报送', window: '11月上旬', owner: '支部书记', note: '三表一书齐全' },
    { id: 'a3', name: '发展对象考核四件套', window: '5月中下旬', owner: '组织委员', note: '考试/志愿时长/谈话/答辩' },
    { id: 'a4', name: '拟接收审查与公示', window: '12月上旬', owner: '支部书记', note: '公示5个工作日' }
  ];
  academyLoaded.value = true;
});

async function saveAcademy() {
  try {
    const { setMeta } = await import('@/db/db');
    await setMeta('academy-flow', JSON.parse(JSON.stringify(academyNodes.value)));
    window.$message?.success('学院版流程已保存');
  } catch (err) {
    window.$message?.error(`保存失败：${(err as Error).message}`);
  }
}

function addAcademyNode() {
  academyNodes.value.push({
    id: `a-${Date.now().toString(36)}`,
    name: '新节点',
    window: '',
    owner: '',
    note: ''
  });
}

function removeAcademyNode(id: string) {
  academyNodes.value = academyNodes.value.filter(n => n.id !== id);
}
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">组织与流程</span>
        </div>
      </template>

      <NTabs v-model:value="flowTab" type="segment" size="small" class="mb-18px w-280px">
        <NTab name="org" tab="组织架构" />
        <NTab name="flow" tab="发展流程图" />
      </NTabs>

      <!-- ============ 组织架构（树形图） ============ -->
      <div v-if="flowTab === 'org'" class="org-tree-container">
        <!-- L1: 书记 -->
        <div class="org-tree__level">
          <div v-if="memberOfRole('书记')" class="org-node org-node--root" @click="openAssign('书记')">
            <NAvatar round :size="42" :style="{ backgroundColor: '#A81C24', color: '#fff' }">
              <span class="text-16px font-bold">{{ memberOfRole('书记')!.name.slice(0, 1) }}</span>
            </NAvatar>
            <div class="mt-4px text-14px font-bold">{{ memberOfRole('书记')!.name }}</div>
            <NTag size="tiny" round :color="{ color: '#A81C24', textColor: '#fff' }">书记</NTag>
          </div>
          <div v-else class="org-node org-node--empty" @click="openAssign('书记')">
            <span class="text-20px text-gray-300">＋</span>
            <div class="text-12px text-gray-400">书记（待指派）</div>
          </div>
        </div>

        <!-- 连线 L1→L2 -->
        <div class="org-tree__vline" />

        <!-- L2: 副书记 -->
        <div class="org-tree__level">
          <div v-if="memberOfRole('副书记')" class="org-node" @click="openAssign('副书记')">
            <NAvatar round :size="36" :style="{ backgroundColor: 'var(--sct-soft)', color: 'var(--sct-ink)' }">
              <span class="text-14px font-bold">{{ memberOfRole('副书记')!.name.slice(0, 1) }}</span>
            </NAvatar>
            <div class="mt-4px text-13px font-bold">{{ memberOfRole('副书记')!.name }}</div>
            <NTag size="tiny" :bordered="false">副书记</NTag>
          </div>
          <div v-else class="org-node org-node--empty" @click="openAssign('副书记')">
            <span class="text-16px text-gray-300">＋</span>
            <div class="text-11px text-gray-400">副书记（待指派）</div>
          </div>
        </div>

        <!-- 连线 L2→L3（竖线 + 横线 + 三根竖线） -->
        <div class="org-tree__vline" />
        <div class="org-tree__hline-wrap">
          <div class="org-tree__hline" />
        </div>

        <!-- L3: 委员 -->
        <div class="org-tree__level org-tree__level--row">
          <template v-for="role in ROLE_SLOTS.slice(2)" :key="role">
            <div class="org-tree__branch">
              <div class="org-tree__vline-sm" />
              <div v-if="memberOfRole(role)" class="org-node" @click="openAssign(role)">
                <NAvatar round :size="34" :style="{ backgroundColor: 'var(--sct-soft)', color: 'var(--sct-ink)' }">
                  <span class="text-13px font-bold">{{ memberOfRole(role)!.name.slice(0, 1) }}</span>
                </NAvatar>
                <div class="mt-4px text-12px font-bold">{{ memberOfRole(role)!.name }}</div>
                <NTag size="tiny" :bordered="false">{{ role }}</NTag>
                <a class="mt-2px text-10px text-gray-300 hover:text-gray-500" @click.stop="clearRole(role)">清空</a>
              </div>
              <div v-else class="org-node org-node--empty" @click="openAssign(role)">
                <span class="text-14px text-gray-300">＋</span>
                <div class="text-10px text-gray-400">{{ role }}</div>
              </div>
            </div>
          </template>
        </div>

        <!-- 连线 L3→成员 -->
        <div class="org-tree__vline" />

        <!-- L4: 普通成员 -->
        <div class="org-tree__level">
          <div class="org-members-grid">
            <div
              v-for="m in regularMembers"
              :key="m.id"
              class="org-member-card"
              :title="`${m.type} · ${m.group || ''}`"
            >
              <NAvatar round :size="30" :style="{ backgroundColor: MEMBER_TYPE_COLORS[m.type] ?? '#8a8f99', color: '#fff' }">
                <span class="text-12px font-bold">{{ m.name.slice(0, 1) }}</span>
              </NAvatar>
              <div class="mt-2px text-11px font-bold truncate w-full text-center">{{ m.name }}</div>
              <div class="text-10px text-gray-400 truncate w-full text-center">{{ m.type }}</div>
            </div>
          </div>
        </div>

        <div class="mt-16px rounded-10px p-12px text-12px leading-relaxed text-gray-400" style="background: var(--sct-soft)">
          点击委员卡片可指派/更换岗位（写回人员档案）· 组织架构依据《支部工作条例》第二十条
        </div>
      </div>

      <!-- ============ 发展流程图 ============ -->
      <div v-if="flowTab === 'flow'">
        <div class="mb-12px">
          <NTabs v-model:value="flowMode" type="segment" size="small" class="w-260px">
            <NTab name="standard" tab="标准流程（重绘）" />
            <NTab name="academy" tab="学院版" />
          </NTabs>
        </div>

        <div v-if="flowMode === 'standard'" class="flex flex-col gap-14px">
          <div v-for="stage in nodesByStage" :key="stage.key">
            <div class="mb-8px rounded-8px px-12px py-6px text-14px font-bold" style="background: var(--sct-soft); color: var(--sct-ink)">
              {{ stage.label }}
            </div>
            <div class="grid grid-cols-2 gap-10px lg:grid-cols-3">
              <div v-for="n in stage.nodes" :key="n.no" class="flow-node" @click="openNode(n)">
                <div class="flex items-center gap-8px">
                  <span class="flow-node__no">{{ n.no }}</span>
                  <span class="text-13px font-bold">{{ n.node }}</span>
                </div>
                <div class="mt-4px truncate text-11px text-gray-400">{{ n.req || n.note }}</div>
                <div v-if="n.deadline" class="mt-2px text-11px" style="color: #d97706">⏱ {{ n.deadline }}</div>
              </div>
            </div>
            <div class="my-6px text-center text-16px text-gray-300">↓</div>
          </div>
        </div>

        <div v-if="flowMode === 'academy' && academyLoaded" class="flex-col gap-10px">
          <div class="mb-6px text-12px text-gray-400">学院每年初下发时间节点表，可在此维护本学院口径的流程节点：</div>
          <div v-for="(n, idx) in academyNodes" :key="n.id" class="grid grid-cols-[28px_1fr_110px_90px_auto] items-center gap-8px rounded-10px p-8px" style="background: var(--sct-soft)">
            <span class="text-12px font-bold text-gray-400">{{ idx + 1 }}</span>
            <NInput v-model:value="n.name" placeholder="节点名称" size="small" />
            <NInput v-model:value="n.window" placeholder="时间窗" size="small" />
            <NInput v-model:value="n.owner" placeholder="责任" size="small" />
            <NButton size="tiny" quaternary type="error" @click="removeAcademyNode(n.id)">删除</NButton>
          </div>
          <div class="flex gap-8px">
            <NButton size="small" @click="addAcademyNode">＋ 添加节点</NButton>
            <NButton size="small" type="primary" @click="saveAcademy">保存学院版</NButton>
          </div>
        </div>
      </div>
    </NCard>

    <!-- 岗位指派 -->
    <NModal v-model:show="assignState.show" preset="card" :title="`指派岗位：${assignState.role}`" class="w-380px">
      <NSelect v-model:value="assignValue" :options="roleOptions" placeholder="选择担任该岗位的成员" filterable />
      <div v-if="!roleOptions.length" class="mt-6px text-12px text-gray-400">所有成员均已担任岗位</div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton @click="assignState.show = false">取消</NButton>
          <NButton type="primary" :disabled="!assignValue" @click="handleAssign">确定</NButton>
        </div>
      </template>
    </NModal>

    <!-- 节点详情 -->
    <NDrawer v-model:show="detailShow" :width="440">
      <NDrawerContent v-if="detailNode" :title="`${detailNode.no} ${detailNode.node}`" closable>
        <NSpace vertical size="large">
          <NTag :bordered="false" size="small">{{ detailNode.stage }}</NTag>
          <NDescriptions :column="1" size="small" label-placement="top" bordered>
            <NDescriptionsItem v-if="detailNode.obj" label="对象">{{ detailNode.obj }}</NDescriptionsItem>
            <NDescriptionsItem v-if="detailNode.req" label="要求">{{ detailNode.req }}<NTag v-if="detailNode.deadline" size="tiny" type="warning" :bordered="false" class="ml-6px">{{ detailNode.deadline }}</NTag></NDescriptionsItem>
            <NDescriptionsItem v-if="detailNode.note" label="说明">{{ detailNode.note }}</NDescriptionsItem>
            <NDescriptionsItem label="所需材料">
              <div class="flex flex-wrap gap-4px">
                <NTag v-for="m in detailNode.materials" :key="m" size="tiny" :bordered="false">{{ m }}</NTag>
              </div>
            </NDescriptionsItem>
          </NDescriptions>
          <div class="text-11px text-gray-400">依据《中国共产党发展党员工作细则》与中央组织部流程图重绘。</div>
        </NSpace>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.org-tree-container {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.org-tree__level {
  width: 100%;
  display: flex;
  justify-content: center;
}

.org-tree__level--row {
  display: flex;
  justify-content: center;
  gap: 0;
  width: 100%;
}

.org-tree__vline {
  width: 2px;
  height: 24px;
  background: var(--sct-muted);
}

.org-tree__hline-wrap {
  display: flex;
  justify-content: center;
  width: 100%;
}

.org-tree__hline {
  position: relative;
  height: 2px;
  background: var(--sct-muted);
  width: 60%;
}

.org-tree__vline-sm {
  width: 2px;
  height: 14px;
  background: var(--sct-muted);
  margin: 0 auto;
}

.org-tree__branch {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  max-width: 160px;
}

.org-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 16px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: var(--sct-radius);
  cursor: pointer;
  transition: box-shadow 0.15s;
  box-shadow: var(--sct-shadow);
  min-width: 110px;
}

.org-node:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
}

.org-node--root {
  border-color: #a81c24;
  border-width: 2px;
}

.org-node--empty {
  justify-content: center;
  border-style: dashed;
  min-height: 80px;
}

.org-members-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  width: 100%;
  padding: 0 20px;
}

.org-member-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 72px;
  padding: 8px 4px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: var(--sct-radius);
  transition: transform 0.12s;
}

.org-member-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
}
</style>
