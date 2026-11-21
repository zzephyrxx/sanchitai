<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NPopconfirm } from 'naive-ui';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';

defineOptions({ name: 'OrgMindmap' });

interface Props {
  members: Sct.Member[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  assign: [role: string];
  clear: [role: string];
  selectMember: [member: Sct.Member];
}>();

const ROLE_SLOTS = ['书记', '副书记', '组织委员', '宣传委员', '纪检委员'] as const;

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

function memberOfRole(role: string): Sct.Member | undefined {
  return props.members.find(m => m.role === role);
}

const regularMembers = computed(() =>
  props.members.filter(m => !ROLE_SLOTS.includes(m.role as (typeof ROLE_SLOTS)[number]))
);

const memberGroups = computed(() => {
  const map = new Map<string, Sct.Member[]>();
  regularMembers.value.forEach(m => {
    const key = m.group?.trim() || '综合方向组';
    map.set(key, [...(map.get(key) ?? []), m]);
  });
  return [...map.entries()].map(([name, list], index) => ({
    id: `group-${index}`,
    name,
    members: list
  }));
});

// ---------------- SVG 贝塞尔连线动态测量 ----------------
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
const svgSize = ref({ width: 900, height: 500 });

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
      return side === 'start'
        ? { x: left + width, y: top + height / 2 }
        : { x: left, y: top + height / 2 };
    }
    return side === 'start'
      ? { x: left + width / 2, y: top + height }
      : { x: left + width / 2, y: top };
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

  // 2. 副书记 -> 各支委
  const pDeputyOut = getAnchor('role-副书记', 'start');
  const committeeRoles = ROLE_SLOTS.slice(2);
  if (pDeputyOut) {
    committeeRoles.forEach(role => {
      const target = getAnchor(`role-${role}`, 'end');
      if (target) {
        nextEdges.push({
          id: `e-deputy-${role}`,
          d: buildBezier(pDeputyOut.x, pDeputyOut.y, target.x, target.y, direction.value),
          x1: pDeputyOut.x,
          y1: pDeputyOut.y,
          x2: target.x,
          y2: target.y,
          accent: true
        });
      }
    });
  }

  // 3. 支委 -> 各方向党小组/课题组（按索引就近连接对应支委，彻底消除跨卡交叉）
  if (showGroups.value && memberGroups.value.length) {
    const committeeAnchors = committeeRoles
      .map(r => getAnchor(`role-${r}`, 'start'))
      .filter(Boolean) as Array<{ x: number; y: number }>;

    if (committeeAnchors.length) {
      memberGroups.value.forEach((grp, idx) => {
        const gTarget = getAnchor(grp.id, 'end');
        if (!gTarget) return;
        const srcIdx = Math.min(
          committeeAnchors.length - 1,
          Math.floor((idx / Math.max(1, memberGroups.value.length)) * committeeAnchors.length)
        );
        const src = committeeAnchors[srcIdx];
        nextEdges.push({
          id: `e-comm-${grp.id}`,
          d: buildBezier(src.x, src.y, gTarget.x, gTarget.y, direction.value),
          x1: src.x,
          y1: src.y,
          x2: gTarget.x,
          y2: gTarget.y,
          accent: false
        });
      });
    }
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

watch([() => props.members, direction, showGroups, zoom], () => {
  scheduleMeasure();
}, { deep: true });
</script>

<template>
  <div class="mindmap-wrapper">
    <!-- 组织架构控制栏 -->
    <div class="mb-14px flex flex-wrap items-center justify-between gap-10px rounded-10px bg-[var(--sct-soft)] px-12px py-8px">
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
        <span class="flex items-center gap-6px text-12px text-gray-500">
          展开方向组成员
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

    <!-- 思维导图画布 -->
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
              :stroke="edge.accent ? '#A81C24' : 'var(--sct-muted)'"
              :stroke-width="edge.accent ? 2 : 1.5"
              :stroke-dasharray="edge.accent ? 'none' : '4 3'"
              stroke-linecap="round"
              opacity="0.72"
            />
            <circle :cx="edge.x1" :cy="edge.y1" r="3.5" :fill="edge.accent ? '#A81C24' : 'var(--sct-muted)'" />
            <circle :cx="edge.x2" :cy="edge.y2" r="3.5" :fill="edge.accent ? '#A81C24' : 'var(--sct-muted)'" />
          </g>
        </svg>

        <!-- L1: 党支部书记 -->
        <div class="mindmap-level">
          <div
            data-node-id="role-书记"
            class="mm-node mm-node--root"
            @click="emit('assign', '书记')"
          >
            <div class="flex items-center gap-10px">
              <NAvatar
                round
                :size="40"
                :style="{ backgroundColor: '#A81C24', color: '#fff', flexShrink: 0 }"
              >
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
            <div class="mt-8px flex items-center justify-between border-t border-[var(--sct-border)] pt-6px text-11px text-gray-400">
              <span>在册共 {{ members.length }} 人</span>
              <span class="inline-flex items-center gap-3px text-[#A81C24] font-semibold">
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

        <!-- L3: 支委会三委员 -->
        <div class="mindmap-level mindmap-level--committee">
          <div
            v-for="role in ROLE_SLOTS.slice(2)"
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
                    <NButton
                      size="tiny"
                      quaternary
                      type="error"
                      title="清空该委员岗位"
                    >
                      <template #icon><SvgIcon icon="lucide:x" /></template>
                    </NButton>
                  </template>
                  确认清空「{{ role }}」岗位的当前任职人员吗？
                </NPopconfirm>
              </div>
            </div>
          </div>
        </div>

        <!-- L4: 各研究方向组/党小组及成员分支 -->
        <div v-if="showGroups && memberGroups.length" class="mindmap-level mindmap-level--groups">
          <div
            v-for="grp in memberGroups"
            :key="grp.id"
            :data-node-id="grp.id"
            class="mm-group-card"
          >
            <div class="mm-group-card__header">
              <span class="flex items-center gap-6px text-12px font-bold text-[var(--sct-ink)]">
                <span class="inline-block size-7px rounded-full bg-[#A81C24]" />
                {{ grp.name }}
              </span>
              <NTag size="tiny" :bordered="false" round>{{ grp.members.length }} 人</NTag>
            </div>
            <div class="mm-group-card__members">
              <div
                v-for="m in grp.members"
                :key="m.id"
                class="mm-member-chip"
                :title="`${m.name}（${m.type} · ${m.grade || ''}）`"
                @click="emit('selectMember', m)"
              >
                <span
                  class="inline-block size-7px flex-shrink-0 rounded-full"
                  :style="{ backgroundColor: MEMBER_TYPE_COLORS[m.type] ?? '#8a8f99' }"
                />
                <span class="font-semibold text-[var(--sct-ink)]">{{ m.name }}</span>
                <span class="text-10px text-gray-400">{{ m.type.replace('入党', '').replace('党员', '') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
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
  min-height: 440px;
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
  gap: 54px;
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

.mindmap-canvas--horizontal .mindmap-level--committee,
.mindmap-canvas--horizontal .mindmap-level--groups {
  flex-direction: column;
  align-items: stretch;
  gap: 18px;
}

.mindmap-canvas--vertical .mindmap-level--committee,
.mindmap-canvas--vertical .mindmap-level--groups {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  gap: 20px;
}

.mm-node {
  position: relative;
  z-index: 1;
  width: 240px;
  padding: 12px 14px;
  background: var(--sct-container);
  border: 1.5px solid var(--sct-border);
  border-radius: 10px;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
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
  width: 248px;
}

.mm-node--empty {
  border-style: dashed;
}

.mm-group-card {
  position: relative;
  z-index: 1;
  width: 270px;
  padding: 10px 12px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.mm-group-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding-bottom: 6px;
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
  padding: 3px 8px;
  font-size: 11px;
  background: var(--sct-soft);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.mm-member-chip:hover {
  border-color: #a81c24;
}
</style>
