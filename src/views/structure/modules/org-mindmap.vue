<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { NPopconfirm } from 'naive-ui';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';

defineOptions({ name: 'OrgMindmap' });

interface Props {
  members: Sct.Member[];
  youthSlots: Sct.YouthCommitteeSlot[];
  partyGroupNames: string[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  assign: [role: string];
  clear: [role: string];
  selectMember: [member: Sct.Member];
  addYouth: [];
  editYouth: [slot: Sct.YouthCommitteeSlot];
  assignYouth: [slot: Sct.YouthCommitteeSlot];
  clearYouth: [slotId: string];
  removeYouth: [slotId: string];
  addGroup: [];
  renameGroup: [groupName: string];
  deleteGroup: [groupName: string];
  moveMemberGroup: [memberId: string, targetGroupName: string];
}>();

const CORE_ROLE_SLOTS = ['书记', '副书记', '组织委员', '宣传委员', '纪检委员'] as const;

const ROLE_DUTIES: Record<string, string> = {
  书记: '主持支部全面工作 · 召集支委会和党员大会',
  副书记: '协助书记日常工作 · 联系服务群众与制度建设',
  组织委员: '发展党员工作 · 党费收缴与组织关系转接',
  宣传委员: '政治理论学习 · 宣传教育与思想文化工作',
  纪检委员: '党风党纪教育 · 党内监督与党员民主权利保障'
};

const direction = ref<'horizontal' | 'vertical'>('horizontal');
const showGroups = ref(true);
const zoom = ref(100);
const editGroupsMode = ref(false);
const draggingMemberId = ref<string | null>(null);
const draggingMemberName = ref('');
const dragOverGroupId = ref<string | null>(null);
const dragPointer = reactive({ x: 0, y: 0 });
let groupDragOrigin: { x: number; y: number; member: Sct.Member } | null = null;
let suppressMemberClick = false;

function hitTestPartyGroup(x: number, y: number): { id: string; name: string; isUngrouped: boolean } | null {
  const el = document.elementFromPoint(x, y);
  const card = el?.closest?.('[data-party-group-id]') as HTMLElement | null;
  const gid = card?.dataset?.partyGroupId;
  if (!gid) return null;
  const found = partyGroupsView.value.find(g => g.id === gid);
  return found ? { id: found.id, name: found.name, isUngrouped: found.isUngrouped } : null;
}

function cleanupGroupDrag() {
  groupDragOrigin = null;
  draggingMemberId.value = null;
  draggingMemberName.value = '';
  dragOverGroupId.value = null;
  window.removeEventListener('pointermove', onGroupPointerMove);
  window.removeEventListener('pointerup', onGroupPointerUp);
  window.removeEventListener('pointercancel', cleanupGroupDrag);
  window.removeEventListener('keydown', onGroupDragKeydown);
}

function onGroupPointerMove(e: PointerEvent) {
  if (!groupDragOrigin) return;
  if (!draggingMemberId.value && Math.hypot(e.clientX - groupDragOrigin.x, e.clientY - groupDragOrigin.y) < 5) {
    return;
  }
  if (!draggingMemberId.value) {
    draggingMemberId.value = groupDragOrigin.member.id;
    draggingMemberName.value = groupDragOrigin.member.name;
    suppressMemberClick = true;
  }
  dragPointer.x = e.clientX;
  dragPointer.y = e.clientY;
  dragOverGroupId.value = hitTestPartyGroup(e.clientX, e.clientY)?.id ?? null;
}

function onGroupPointerUp(e: PointerEvent) {
  const memberId = draggingMemberId.value;
  const targetGrp = memberId ? hitTestPartyGroup(e.clientX, e.clientY) : null;
  cleanupGroupDrag();
  if (memberId && targetGrp) {
    emit('moveMemberGroup', memberId, targetGrp.isUngrouped ? '' : targetGrp.name);
  }
  if (suppressMemberClick) {
    setTimeout(() => {
      suppressMemberClick = false;
    }, 60);
  }
}

function onGroupDragKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') cleanupGroupDrag();
}

function handleMemberPointerDown(e: PointerEvent, member: Sct.Member) {
  if (!editGroupsMode.value || e.button !== 0) return;
  e.preventDefault();
  groupDragOrigin = { x: e.clientX, y: e.clientY, member };
  window.addEventListener('pointermove', onGroupPointerMove);
  window.addEventListener('pointerup', onGroupPointerUp);
  window.addEventListener('pointercancel', cleanupGroupDrag);
  window.addEventListener('keydown', onGroupDragKeydown);
}

onBeforeUnmount(cleanupGroupDrag);

function memberOfRole(role: string): Sct.Member | undefined {
  return props.members.find(m => m.role === role);
}

function memberById(id?: string | null): Sct.Member | undefined {
  if (!id) return undefined;
  return props.members.find(m => m.id === id);
}

/** 独立党小组分区数据：优先展示所有已建党小组（含空组），再按需补充「未分组」 */
const partyGroupsView = computed(() => {
  const byGroup = new Map<string, Sct.Member[]>();
  props.partyGroupNames.forEach(name => {
    const clean = name.trim();
    if (clean && !byGroup.has(clean)) {
      byGroup.set(clean, []);
    }
  });
  const ungrouped: Sct.Member[] = [];
  props.members.forEach(m => {
    const key = (m.group ?? '').trim();
    if (!key) {
      ungrouped.push(m);
    } else {
      byGroup.set(key, [...(byGroup.get(key) ?? []), m]);
    }
  });

  const list = [...byGroup.entries()].map(([name, listMembers], index) => ({
    id: `group-${index}`,
    name,
    isUngrouped: false,
    members: listMembers
  }));
  if (ungrouped.length || editGroupsMode.value) {
    list.push({
      id: 'group-ungrouped',
      name: '未分组',
      isUngrouped: true,
      members: ungrouped
    });
  }
  return list;
});

// ---------------- SVG 贝塞尔连线动态测量（仅连接支委树：书记 → 副书记 → 各支委含青年委员） ----------------
const canvasRef = ref<HTMLElement | null>(null);

interface EdgePath {
  id: string;
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  accent?: boolean;
}

const edges = ref<EdgePath[]>([]);
const svgSize = ref({ width: 900, height: 420 });

function buildBezier(x1: number, y1: number, x2: number, y2: number, dir: 'horizontal' | 'vertical'): string {
  if (dir === 'horizontal') {
    const mx = x1 + (x2 - x1) * 0.5;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }
  const my = y1 + (y2 - y1) * 0.5;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

function measureEdges() {
  const container = canvasRef.value;
  if (!container) return;

  const scale = zoom.value / 100;
  const cRect = container.getBoundingClientRect();
  svgSize.value = {
    width: Math.max(container.scrollWidth, Math.round(cRect.width / scale)),
    height: Math.max(container.scrollHeight, Math.round(cRect.height / scale))
  };

  function getAnchor(nodeId: string, side: 'start' | 'end'): { x: number; y: number } | null {
    const el = container!.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const left = (r.left - cRect.left) / scale;
    const top = (r.top - cRect.top) / scale;
    const width = r.width / scale;
    const height = r.height / scale;

    if (direction.value === 'horizontal') {
      return side === 'start' ? { x: left + width, y: top + height / 2 } : { x: left, y: top + height / 2 };
    }
    return side === 'start' ? { x: left + width / 2, y: top + height } : { x: left + width / 2, y: top };
  }

  const nextEdges: EdgePath[] = [];

  // 1. 书记 -> 副书记
  const pRoot = getAnchor('role-书记', 'start');
  const pDeputy = getAnchor('role-副书记', 'end');
  if (pRoot && pDeputy) {
    nextEdges.push({
      id: 'e-root-deputy',
      d: buildBezier(pRoot.x, pRoot.y, pDeputy.x, pDeputy.y, direction.value),
      x1: pRoot.x,
      y1: pRoot.y,
      x2: pDeputy.x,
      y2: pDeputy.y,
      accent: true
    });
  }

  // 2. 副书记 -> 各支委（组织/宣传/纪检 + 全部自定义青年委员）
  const pDeputyOut = getAnchor('role-副书记', 'start');
  if (pDeputyOut) {
    const targets: Array<{ id: string; accent: boolean }> = [
      ...CORE_ROLE_SLOTS.slice(2).map(role => ({ id: `role-${role}`, accent: true })),
      ...props.youthSlots.map(slot => ({ id: `youth-${slot.id}`, accent: false }))
    ];
    targets.forEach(t => {
      const target = getAnchor(t.id, 'end');
      if (target) {
        nextEdges.push({
          id: `e-deputy-${t.id}`,
          d: buildBezier(pDeputyOut.x, pDeputyOut.y, target.x, target.y, direction.value),
          x1: pDeputyOut.x,
          y1: pDeputyOut.y,
          x2: target.x,
          y2: target.y,
          accent: t.accent
        });
      }
    });
  }

  edges.value = nextEdges;
}

let resizeObserver: ResizeObserver | null = null;
let rafId: number | null = null;

function scheduleMeasure() {
  void nextTick(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      measureEdges();
    });
  });
}

onMounted(() => {
  scheduleMeasure();
  if (typeof ResizeObserver !== 'undefined' && canvasRef.value) {
    resizeObserver = new ResizeObserver(() => {
      measureEdges();
    });
    resizeObserver.observe(canvasRef.value);
  }
  window.addEventListener('resize', measureEdges);
});

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  resizeObserver?.disconnect();
  window.removeEventListener('resize', measureEdges);
});

watch(
  [() => props.members, () => props.youthSlots, direction, zoom],
  () => {
    scheduleMeasure();
  },
  { deep: true }
);
</script>

<template>
  <div class="mindmap-wrapper">
    <!-- 组织架构控制栏 -->
    <div
      class="mb-14px flex flex-wrap items-center justify-between gap-10px rounded-10px bg-[var(--sct-soft)] px-12px py-8px"
    >
      <div class="flex flex-wrap items-center gap-10px">
        <span class="flex items-center gap-6px text-12px font-bold text-[var(--sct-ink)]">
          <SvgIcon icon="lucide:git-fork" class="text-14px text-[#A81C24]" />
          排列方向
        </span>
        <div class="flex items-center gap-6px">
          <NButton
            size="tiny"
            :type="direction === 'horizontal' ? 'primary' : 'default'"
            :secondary="direction !== 'horizontal'"
            @click="direction = 'horizontal'"
          >
            <template #icon><SvgIcon icon="lucide:align-horizontal-space-around" /></template>
            横向展开
          </NButton>
          <NButton
            size="tiny"
            :type="direction === 'vertical' ? 'primary' : 'default'"
            :secondary="direction !== 'vertical'"
            @click="direction = 'vertical'"
          >
            <template #icon><SvgIcon icon="lucide:align-vertical-space-around" /></template>
            纵向展开
          </NButton>
        </div>
        <NDivider vertical />
        <NButton size="tiny" secondary type="primary" @click="emit('addYouth')">
          <template #icon><SvgIcon icon="lucide:user-plus" /></template>
          添加青年委员
        </NButton>
        <NDivider vertical />
        <span class="flex items-center gap-6px text-12px text-gray-500">
          显示党小组
          <NSwitch v-model:value="showGroups" size="small" />
        </span>
      </div>

      <div class="flex items-center gap-6px">
        <NButton size="tiny" secondary @click="zoom = Math.max(70, zoom - 10)">
          <template #icon><SvgIcon icon="lucide:zoom-out" /></template>
        </NButton>
        <NButton size="tiny" secondary @click="zoom = 100">{{ zoom }}%</NButton>
        <NButton size="tiny" secondary @click="zoom = Math.min(130, zoom + 10)">
          <template #icon><SvgIcon icon="lucide:zoom-in" /></template>
        </NButton>
      </div>
    </div>

    <!-- 上半区：支委会组织架构树（书记 → 副书记 → 各委员，含自定义青年委员） -->
    <div class="mindmap-viewport">
      <div
        ref="canvasRef"
        class="mindmap-canvas"
        :class="direction === 'horizontal' ? 'mindmap-canvas--horizontal' : 'mindmap-canvas--vertical'"
        :style="{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }"
      >
        <!-- SVG 贝塞尔连线底层（z-index: 0，绝不遮挡节点卡片） -->
        <svg
          class="mindmap-svg"
          :width="svgSize.width"
          :height="svgSize.height"
          :viewBox="`0 0 ${svgSize.width} ${svgSize.height}`"
        >
          <g v-for="edge in edges" :key="edge.id">
            <path
              :d="edge.d"
              fill="none"
              :stroke="edge.accent ? '#A81C24' : '#2563eb'"
              :stroke-width="edge.accent ? 2 : 1.75"
              :stroke-dasharray="edge.accent ? 'none' : '5 3'"
              stroke-linecap="round"
              opacity="0.72"
            />
            <circle :cx="edge.x1" :cy="edge.y1" r="3.5" :fill="edge.accent ? '#A81C24' : '#2563eb'" />
            <circle :cx="edge.x2" :cy="edge.y2" r="3.5" :fill="edge.accent ? '#A81C24' : '#2563eb'" />
          </g>
        </svg>

        <!-- L1: 党支部书记 -->
        <div class="mindmap-level">
          <div data-node-id="role-书记" class="mm-node mm-node--root" @click="emit('assign', '书记')">
            <div class="flex items-center gap-10px">
              <NAvatar round :size="40" :style="{ backgroundColor: '#A81C24', color: '#fff', flexShrink: 0 }">
                <span class="text-15px font-bold">
                  {{ memberOfRole('书记')?.name.slice(0, 1) ?? '书' }}
                </span>
              </NAvatar>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-6px">
                  <span class="text-14px font-bold text-[var(--sct-ink)]">
                    {{ memberOfRole('书记')?.name ?? '待指派' }}
                  </span>
                  <NTag size="tiny" round :color="{ color: '#A81C24', textColor: '#fff' }" :bordered="false">
                    党支部书记
                  </NTag>
                </div>
                <div class="mt-3px text-11px text-gray-400">{{ ROLE_DUTIES['书记'] }}</div>
              </div>
            </div>
            <div
              class="mt-8px flex items-center justify-between border-t border-[var(--sct-border)] pt-6px text-11px text-gray-400"
            >
              <span>在册共 {{ members.length }} 人</span>
              <span class="inline-flex items-center gap-3px font-semibold text-[#A81C24]">
                <SvgIcon icon="lucide:user-cog" class="text-12px" />
                点击更换
              </span>
            </div>
          </div>
        </div>

        <!-- L2: 党支部副书记 -->
        <div class="mindmap-level">
          <div
            data-node-id="role-副书记"
            class="mm-node"
            :class="{ 'mm-node--empty': !memberOfRole('副书记') }"
            @click="emit('assign', '副书记')"
          >
            <div class="flex items-center gap-10px">
              <NAvatar
                round
                :size="36"
                :style="{ backgroundColor: 'var(--sct-soft)', color: 'var(--sct-ink)', flexShrink: 0 }"
              >
                <span class="text-14px font-bold">
                  {{ memberOfRole('副书记')?.name.slice(0, 1) ?? '＋' }}
                </span>
              </NAvatar>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-6px">
                  <span class="text-13px font-bold text-[var(--sct-ink)]">
                    {{ memberOfRole('副书记')?.name ?? '待指派' }}
                  </span>
                  <NTag size="tiny" :bordered="false">副书记</NTag>
                </div>
                <div class="mt-2px text-11px text-gray-400">{{ ROLE_DUTIES['副书记'] }}</div>
              </div>
            </div>
            <div v-if="memberOfRole('副书记')" class="mt-6px flex justify-end" @click.stop>
              <NPopconfirm @positive-click="emit('clear', '副书记')">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error">
                    <template #icon><SvgIcon icon="lucide:user-minus" /></template>
                    清空岗位
                  </NButton>
                </template>
                确认清空「副书记」岗位的当前任职人员吗？
              </NPopconfirm>
            </div>
          </div>
        </div>

        <!-- L3: 支委会委员（组织/宣传/纪检 + 自定义青年委员 × N） -->
        <div class="mindmap-level mindmap-level--committee">
          <div
            v-for="role in CORE_ROLE_SLOTS.slice(2)"
            :key="role"
            :data-node-id="`role-${role}`"
            class="mm-node mm-node--committee"
            :class="{ 'mm-node--empty': !memberOfRole(role) }"
            @click="emit('assign', role)"
          >
            <div class="flex items-center justify-between gap-8px">
              <div class="flex items-center gap-8px">
                <NAvatar
                  round
                  :size="32"
                  :style="{ backgroundColor: 'var(--sct-soft)', color: 'var(--sct-ink)', flexShrink: 0 }"
                >
                  <span class="text-13px font-bold">
                    {{ memberOfRole(role)?.name.slice(0, 1) ?? '＋' }}
                  </span>
                </NAvatar>
                <div>
                  <div class="flex items-center gap-5px">
                    <span class="text-13px font-bold text-[var(--sct-ink)]">
                      {{ memberOfRole(role)?.name ?? '点击指派' }}
                    </span>
                    <NTag size="tiny" :bordered="false">{{ role }}</NTag>
                  </div>
                  <div class="mt-2px text-11px text-gray-400">{{ ROLE_DUTIES[role] }}</div>
                </div>
              </div>
              <div v-if="memberOfRole(role)" @click.stop>
                <NPopconfirm @positive-click="emit('clear', role)">
                  <template #trigger>
                    <NButton size="tiny" quaternary type="error" title="清空该委员岗位">
                      <template #icon><SvgIcon icon="lucide:x" /></template>
                    </NButton>
                  </template>
                  确认清空「{{ role }}」岗位的当前任职人员吗？
                </NPopconfirm>
              </div>
            </div>
          </div>

          <!-- 自定义青年委员槽位（个数不定） -->
          <div
            v-for="slot in youthSlots"
            :key="slot.id"
            :data-node-id="`youth-${slot.id}`"
            class="mm-node mm-node--committee mm-node--youth"
            :class="{ 'mm-node--empty': !memberById(slot.member_id) }"
            @click="emit('assignYouth', slot)"
          >
            <div class="flex items-start justify-between gap-6px">
              <div class="flex min-w-0 items-center gap-8px">
                <NAvatar
                  round
                  :size="32"
                  :style="{ backgroundColor: 'var(--sct-info-soft)', color: '#2563eb', flexShrink: 0 }"
                >
                  <span class="text-13px font-bold">
                    {{ memberById(slot.member_id)?.name.slice(0, 1) ?? '青' }}
                  </span>
                </NAvatar>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-5px">
                    <span class="text-13px font-bold text-[var(--sct-ink)]">
                      {{ memberById(slot.member_id)?.name ?? '点击指派' }}
                    </span>
                    <NTag size="tiny" type="info" :bordered="false">{{ slot.title }}</NTag>
                  </div>
                  <div class="mt-2px text-11px text-gray-400">
                    {{ slot.duty || '联系青年团员 · 组织文体实践与推优入党' }}
                  </div>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2px" @click.stop>
                <NButton size="tiny" quaternary title="修改岗位名称或分工" @click="emit('editYouth', slot)">
                  <template #icon><SvgIcon icon="lucide:pencil" class="text-12px" /></template>
                </NButton>
                <NPopconfirm @positive-click="emit('removeYouth', slot.id)">
                  <template #trigger>
                    <NButton size="tiny" quaternary type="error" title="删除此青年委员岗位">
                      <template #icon><SvgIcon icon="lucide:trash-2" class="text-12px" /></template>
                    </NButton>
                  </template>
                  确认删除「{{ slot.title }}」岗位吗？（已任职成员的职务将同步清空）
                </NPopconfirm>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 下半独立分区：支部党小组（不与支委连线，支持自由新增与手动改名） -->
    <div
      v-if="showGroups"
      class="mt-16px rounded-12px border border-[var(--sct-border)] bg-[var(--sct-container)] p-14px"
    >
      <div
        class="mb-12px flex flex-wrap items-center justify-between gap-8px border-b border-dashed border-[var(--sct-border)] pb-10px"
      >
        <div class="flex items-center gap-8px">
          <SvgIcon icon="lucide:users-round" class="text-15px text-[#A81C24]" />
          <span class="text-14px font-bold text-[var(--sct-ink)]">支部党小组</span>
          <NTag size="tiny" :bordered="false" round>
            共 {{ partyGroupsView.filter(g => !g.isUngrouped).length }} 个党小组
          </NTag>
          <span class="hidden text-12px text-gray-400 md:inline">
            {{
              editGroupsMode
                ? '编辑模式已开启 · 按住人员标签拖入目标党小组卡片即可实时重新分组'
                : '独立分区展示（不与支委连线）· 点击组名右侧铅笔可手动改名并同步成员档案'
            }}
          </span>
        </div>
        <div class="flex items-center gap-6px">
          <NButton
            size="tiny"
            :type="editGroupsMode ? 'primary' : 'default'"
            :secondary="!editGroupsMode"
            @click="editGroupsMode = !editGroupsMode"
          >
            <template #icon>
              <SvgIcon :icon="editGroupsMode ? 'lucide:check' : 'lucide:arrow-left-right'" />
            </template>
            {{ editGroupsMode ? '完成编辑' : '编辑模式' }}
          </NButton>
          <NButton size="tiny" secondary type="primary" @click="emit('addGroup')">
            <template #icon><SvgIcon icon="lucide:plus" /></template>
            新增党小组
          </NButton>
        </div>
      </div>

      <div
        v-if="editGroupsMode"
        class="mb-12px flex items-center gap-8px rounded-8px border border-dashed border-[var(--sct-accent)] bg-[var(--sct-soft)] px-12px py-7px text-12px text-[var(--sct-ink)]"
      >
        <SvgIcon icon="lucide:hand" class="shrink-0 text-14px text-[var(--sct-accent)]" />
        <span>
          已进入分组拖拽编辑模式：拖动任意人员卡片到目标党小组（含「未分组」）松手即可实时保存，点击右上角「完成编辑」退出。
        </span>
      </div>

      <div class="grid grid-cols-1 gap-12px sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="grp in partyGroupsView"
          :key="grp.id"
          :data-party-group-id="grp.id"
          class="mm-group-card"
          :class="{
            'mm-group-card--editing': editGroupsMode,
            'mm-group-card--drop-active': editGroupsMode && dragOverGroupId === grp.id
          }"
        >
          <div class="mm-group-card__header">
            <span class="flex min-w-0 items-center gap-6px text-13px font-bold text-[var(--sct-ink)]">
              <span
                class="inline-block size-7px shrink-0 rounded-full"
                :style="{ background: grp.isUngrouped ? '#94a3b8' : '#A81C24' }"
              />
              <span class="truncate">{{ grp.name }}</span>
            </span>
            <div class="flex shrink-0 items-center gap-4px">
              <NTag
                v-if="editGroupsMode && dragOverGroupId === grp.id"
                size="tiny"
                type="primary"
                :bordered="false"
                round
              >
                松手移入
              </NTag>
              <NTag size="tiny" :bordered="false" round>{{ grp.members.length }} 人</NTag>
              <NButton
                v-if="!grp.isUngrouped"
                size="tiny"
                quaternary
                title="重命名党小组"
                @click="emit('renameGroup', grp.name)"
              >
                <template #icon><SvgIcon icon="lucide:pencil" class="text-12px" /></template>
              </NButton>
              <NPopconfirm v-if="!grp.isUngrouped" @positive-click="emit('deleteGroup', grp.name)">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error" title="删除党小组">
                    <template #icon><SvgIcon icon="lucide:trash-2" class="text-12px" /></template>
                  </NButton>
                </template>
                确认删除「{{ grp.name }}」吗？（组内成员将移入「未分组」，不会删除人员）
              </NPopconfirm>
            </div>
          </div>

          <div v-if="!grp.members.length" class="py-10px text-center text-12px text-gray-400">
            {{
              editGroupsMode
                ? '将人员卡片拖动到此处即可加入该组'
                : '暂无成员（可开启「编辑模式」拖拽分配或在人员页修改）'
            }}
          </div>
          <div v-else class="mm-group-card__members">
            <div
              v-for="m in grp.members"
              :key="m.id"
              class="mm-member-chip"
              :class="{
                'mm-member-chip--draggable': editGroupsMode,
                'mm-member-chip--dragging': draggingMemberId === m.id
              }"
              :title="
                editGroupsMode
                  ? `按住拖动「${m.name}」到目标党小组`
                  : `${m.name}（${m.type}${m.role ? ` · ${m.role}` : ''}）`
              "
              @pointerdown="handleMemberPointerDown($event, m)"
              @click="!editGroupsMode && !suppressMemberClick && emit('selectMember', m)"
            >
              <SvgIcon v-if="editGroupsMode" icon="lucide:grip-vertical" class="text-12px text-gray-400" />
              <span
                class="inline-block size-7px flex-shrink-0 rounded-full"
                :style="{ backgroundColor: MEMBER_TYPE_COLORS[m.type] ?? '#8a8f99' }"
              />
              <span class="font-semibold text-[var(--sct-ink)]">{{ m.name }}</span>
              <span v-if="m.role" class="text-10px font-semibold text-[#A81C24]">{{ m.role }}</span>
              <span v-else class="text-10px text-gray-400">{{ m.type.replace('入党', '').replace('党员', '') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="draggingMemberId"
        class="pointer-events-none fixed z-9999 inline-flex items-center gap-6px rounded-8px border border-[#A81C24] bg-[var(--sct-container)] px-12px py-6px text-12px font-bold text-[var(--sct-ink)] shadow-lg"
        :style="{ left: `${dragPointer.x + 12}px`, top: `${dragPointer.y + 12}px` }"
      >
        <SvgIcon icon="lucide:grip-vertical" class="text-13px text-[#A81C24]" />
        <span>{{ draggingMemberName }}</span>
        <span class="text-11px font-normal text-gray-400">拖入目标党小组松手</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mindmap-viewport {
  width: 100%;
  overflow: auto;
  padding: 20px 16px;
  background: radial-gradient(var(--sct-border) 1px, transparent 1px);
  background-size: 18px 18px;
  border: 1px solid var(--sct-border);
  border-radius: 12px;
  min-height: 360px;
}

.mindmap-canvas {
  position: relative;
  display: flex;
  min-width: max-content;
}

.mindmap-canvas--horizontal {
  flex-direction: row;
  align-items: center;
  gap: 64px;
  padding: 16px 24px;
}

.mindmap-canvas--vertical {
  flex-direction: column;
  align-items: center;
  gap: 50px;
  padding: 20px 16px;
}

.mindmap-svg {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 0;
  overflow: visible;
}

.mindmap-level {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mindmap-canvas--horizontal .mindmap-level--committee {
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
}

.mindmap-canvas--vertical .mindmap-level--committee {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  gap: 16px;
}

.mm-node {
  position: relative;
  z-index: 1;
  width: 244px;
  padding: 12px 14px;
  background: var(--sct-container);
  border: 1.5px solid var(--sct-border);
  border-radius: 10px;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease;
}

.mm-node:hover {
  transform: translateY(-2px);
  border-color: #a81c24;
  box-shadow: 0 6px 18px rgba(168, 28, 36, 0.12);
}

.mm-node--root {
  width: 256px;
  border-color: #a81c24;
  border-width: 2px;
}

.mm-node--committee {
  width: 258px;
}

.mm-node--youth {
  border-color: rgba(37, 99, 235, 0.35);
}

.mm-node--youth:hover {
  border-color: #2563eb;
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.12);
}

.mm-node--empty {
  border-style: dashed;
}

.mm-group-card {
  padding: 12px 14px;
  background: var(--sct-soft);
  border: 1px solid var(--sct-border);
  border-radius: 10px;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.mm-group-card--editing {
  border-style: dashed;
}

.mm-group-card--drop-active {
  border-color: var(--sct-accent, #a81c24);
  border-style: solid;
  background: var(--sct-container);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--sct-accent, #a81c24) 22%, transparent);
}

.mm-group-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 7px;
  border-bottom: 1px dashed var(--sct-border);
}

.mm-group-card__members {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mm-member-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  font-size: 12px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 6px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    transform 0.15s ease,
    opacity 0.15s ease;
}

.mm-member-chip:hover {
  border-color: #a81c24;
  transform: translateY(-1px);
}

.mm-member-chip--draggable {
  cursor: grab;
  user-select: none;
  border-style: dashed;
}

.mm-member-chip--draggable:active {
  cursor: grabbing;
}

.mm-member-chip--dragging {
  opacity: 0.42;
}
</style>
