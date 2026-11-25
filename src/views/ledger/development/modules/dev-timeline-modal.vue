<script setup lang="ts">
/**
 * 党员发展时间线 S 型圆点里程碑弹窗：
 * - 双视图切换：默认「精简里程碑（12 节点，每行 4 个共 3 行）」/ 一键切换「完整流程（25 节点，每行 5 个共 5 行）」
 * - 全矢量数学坐标 S 型连续轨道：直线贯穿圆点里程碑，行末以平滑外扩半圆弯折返，彻底消除弹窗缩放动画导致的首次连线错位
 * - 节点上方展示序号与归档日期，下方短虚线引出紧凑可点选卡片；点击任意圆点或卡片展开底部材料详情并可快捷变更归档状态
 */
import { computed, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { DEV_NODES, DEV_STAGE_ORDER, KEY_MILESTONE_NOS, resolveNodeMaterials } from '@/constants/dev-nodes';
import type { DevNodeDef, DevStageName } from '@/constants/dev-nodes';
import { useThemeStore } from '@/store/modules/theme';
import { useWorkDataStore } from '@/store/modules/work-data';
import DevBatchArchiveModal from './dev-batch-archive-modal.vue';

defineOptions({ name: 'DevTimelineModal' });

const props = defineProps<{ show: boolean; memberId: string | null }>();
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>();

const workStore = useWorkDataStore();
const themeStore = useThemeStore();

const show = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
});

type ViewMode = 'milestone' | 'full';
const viewMode = ref<ViewMode>('milestone');
const selectedNodeNo = ref<string>('1');

const stageColorMap = computed<Record<string, { main: string; ring: string; soft: string }>>(() => {
  const dark = themeStore.darkMode;
  return {
    申请人: {
      main: dark ? '#cbd5e1' : '#475569',
      ring: dark ? '#94a3b8' : '#64748b',
      soft: dark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(100, 116, 139, 0.14)'
    },
    入党积极分子: {
      main: dark ? '#93c5fd' : '#1d4ed8',
      ring: dark ? '#60a5fa' : '#2563eb',
      soft: dark ? 'rgba(59, 130, 246, 0.22)' : 'rgba(37, 99, 235, 0.13)'
    },
    发展对象: {
      main: dark ? '#fcd34d' : '#b45309',
      ring: dark ? '#fbbf24' : '#d97706',
      soft: dark ? 'rgba(245, 158, 11, 0.22)' : 'rgba(217, 119, 6, 0.13)'
    },
    预备党员: {
      main: dark ? '#fda4af' : '#be123c',
      ring: dark ? '#fb7185' : '#e11d48',
      soft: dark ? 'rgba(244, 63, 94, 0.22)' : 'rgba(225, 29, 72, 0.13)'
    },
    正式党员: {
      main: dark ? '#86efac' : '#15803d',
      ring: dark ? '#4ade80' : '#16a34a',
      soft: dark ? 'rgba(34, 197, 94, 0.22)' : 'rgba(22, 163, 74, 0.13)'
    }
  };
});

const member = computed(() => (props.memberId ? workStore.memberOf(props.memberId) : undefined));
const devStage = computed(() =>
  props.memberId ? workStore.devStages.find(d => d.member_id === props.memberId) : undefined
);

interface EnrichedNode {
  def: DevNodeDef;
  materials: Sct.DevMaterial[];
  archivedCount: number;
  inProgressCount: number;
  totalCount: number;
  state: 'done' | 'active' | 'pending';
  keyDate: string;
  hasNoDateArchive: boolean;
  isCurrentStage: boolean;
  stageOrderIdx: number;
  seqIndex: number;
}

const currentStageIdx = computed(() => {
  const s = devStage.value?.stage ?? member.value?.type ?? '申请人';
  return Math.max(0, DEV_STAGE_ORDER.indexOf(s as (typeof DEV_STAGE_ORDER)[number]));
});

const visibleNodes = computed<EnrichedNode[]>(() => {
  const base = viewMode.value === 'milestone' ? DEV_NODES.filter(n => KEY_MILESTONE_NOS.includes(n.no)) : DEV_NODES;
  const rawMats = devStage.value?.materials ?? [];

  return base.map((def, seqIdx) => {
    const mats = resolveNodeMaterials(def, rawMats);
    const archived = mats.filter(m => m.status === '已归档');
    const inProgress = mats.filter(m => m.status === '进行中');
    const state: EnrichedNode['state'] =
      mats.length > 0 && archived.length === mats.length
        ? 'done'
        : archived.length > 0 || inProgress.length > 0
          ? 'active'
          : 'pending';

    const dated = archived
      .map(m => (m.date || '').trim())
      .filter(Boolean)
      .sort();
    const keyDate = dated.length > 0 ? dated[dated.length - 1] : '';
    const hasNoDateArchive = archived.length > 0 && !keyDate;
    const stageIdx = DEV_STAGE_ORDER.indexOf(def.stage);

    return {
      def,
      materials: mats,
      archivedCount: archived.length,
      inProgressCount: inProgress.length,
      totalCount: mats.length,
      state,
      keyDate,
      hasNoDateArchive,
      isCurrentStage: stageIdx === currentStageIdx.value,
      stageOrderIdx: stageIdx,
      seqIndex: seqIdx + 1
    };
  });
});

// ---------------- 纯矢量数学坐标 S 型轨道布局（彻底根治弹窗缩放错位） ----------------
const VIEW_W = 1040;
const INNER_LEFT = 152;
const INNER_RIGHT = 888;
const TOP_Y = 50;
const ROW_H = 138;
const TURN_SHOULDER = 32;
const TURN_R = ROW_H / 2;

const perRow = computed(() => (viewMode.value === 'milestone' ? 4 : 5));
const cardWidth = computed(() => (viewMode.value === 'milestone' ? 166 : 148));
const cardHeight = 56;
const totalRows = computed(() => Math.max(1, Math.ceil(visibleNodes.value.length / perRow.value)));
const viewH = computed(() => TOP_Y + (totalRows.value - 1) * ROW_H + 106);

function wrapTitleLines(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const line1 = text.slice(0, maxChars);
  const rest = text.slice(maxChars);
  const line2 = rest.length > maxChars ? `${rest.slice(0, maxChars - 1)}…` : rest;
  return [line1, line2];
}

interface PositionedNode {
  node: EnrichedNode;
  x: number;
  y: number;
  row: number;
  col: number;
  titleLines: string[];
  stageColor: string;
  stageRing: string;
  stageSoft: string;
  isFutureStage: boolean;
}

const positionedNodes = computed<PositionedNode[]>(() => {
  const cols = perRow.value;
  const maxChars = cols === 4 ? 10 : 8;
  const span = INNER_RIGHT - INNER_LEFT;

  return visibleNodes.value.map((node, idx) => {
    const row = Math.floor(idx / cols);
    const posInRow = idx % cols;
    const isRtl = row % 2 === 1;
    const visualCol = isRtl ? cols - 1 - posInRow : posInRow;
    const x = cols > 1 ? INNER_LEFT + (visualCol / (cols - 1)) * span : VIEW_W / 2;
    const y = TOP_Y + row * ROW_H;
    const palette = stageColorMap.value[node.def.stage] ?? {
      main: '#64748b',
      ring: '#64748b',
      soft: 'rgba(100,116,139,0.14)'
    };

    return {
      node,
      x,
      y,
      row,
      col: visualCol,
      titleLines: wrapTitleLines(node.def.node, maxChars),
      stageColor: palette.main,
      stageRing: palette.ring,
      stageSoft: palette.soft,
      isFutureStage: node.stageOrderIdx > currentStageIdx.value
    };
  });
});

interface TrackSegment {
  id: string;
  d: string;
  color: string;
  dashed: boolean;
  strokeWidth: number;
  opacity: number;
  arrowX: number;
  arrowY: number;
  arrowAngle: number;
}

const trackSegments = computed<TrackSegment[]>(() => {
  const pts = positionedNodes.value;
  const dark = themeStore.darkMode;
  const segs: TrackSegment[] = [];

  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const isTurn = a.row !== b.row;

    let d = '';
    let arrowX = 0;
    let arrowY = 0;
    let arrowAngle = 0;

    if (!isTurn) {
      d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
      arrowX = (a.x + b.x) / 2;
      arrowY = a.y;
      arrowAngle = b.x > a.x ? 0 : 180;
    } else if (a.row % 2 === 0) {
      // 偶数行（左→右）行末在右侧外扩半圆平滑折返到下一行右端
      const turnX = INNER_RIGHT + TURN_SHOULDER;
      d = `M ${a.x} ${a.y} L ${turnX} ${a.y} A ${TURN_R} ${TURN_R} 0 0 1 ${turnX} ${b.y} L ${b.x} ${b.y}`;
      arrowX = turnX + TURN_R;
      arrowY = (a.y + b.y) / 2;
      arrowAngle = 90;
    } else {
      // 奇数行（右→左）行末在左侧外扩半圆平滑折返到下一行左端
      const turnX = INNER_LEFT - TURN_SHOULDER;
      d = `M ${a.x} ${a.y} L ${turnX} ${a.y} A ${TURN_R} ${TURN_R} 0 0 0 ${turnX} ${b.y} L ${b.x} ${b.y}`;
      arrowX = turnX - TURN_R;
      arrowY = (a.y + b.y) / 2;
      arrowAngle = 90;
    }

    // 仅保留两态轨道：
    // 1) 起点属于当前及之前阶段且已归档 → 绿色实线（如 #6 已归档则 #6→#7 呈绿色，直观表示已推进到 #7）
    // 2) 其余为灰色虚线（未到达的未来阶段进一步降为极淡灰色）
    const isDoneLink = !a.isFutureStage && a.node.state === 'done';
    const isFutureLink = a.isFutureStage;

    const color = isDoneLink
      ? dark
        ? '#4ade80'
        : '#16a34a'
      : isFutureLink
        ? dark
          ? '#475569'
          : '#cbd5e1'
        : dark
          ? '#64748b'
          : '#94a3b8';

    segs.push({
      id: `${a.node.def.no}->${b.node.def.no}`,
      d,
      color,
      dashed: !isDoneLink,
      strokeWidth: isDoneLink ? 4 : isFutureLink ? 2.6 : 3.2,
      opacity: isDoneLink ? 0.95 : isFutureLink ? 0.45 : 0.82,
      arrowX,
      arrowY,
      arrowAngle
    });
  }

  return segs;
});

const svgPalette = computed(() => {
  const dark = themeStore.darkMode;
  return {
    cardBg: dark ? '#1f232b' : '#ffffff',
    cardBgFuture: dark ? 'rgba(31, 35, 43, 0.55)' : 'rgba(255, 255, 255, 0.65)',
    cardBgSelected: dark ? '#2a1d20' : '#fff8f8',
    cardBorder: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.10)',
    cardBorderFuture: dark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.24)',
    ink: dark ? '#f1f5f9' : '#1e293b',
    muted: dark ? '#94a3b8' : '#64748b',
    futureText: dark ? '#64748b' : '#94a3b8',
    futureRing: dark ? '#475569' : '#cbd5e1',
    futureCore: dark ? '#334155' : '#94a3b8',
    stem: dark ? 'rgba(148, 163, 184, 0.45)' : 'rgba(100, 116, 139, 0.48)',
    stemFuture: dark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(148, 163, 184, 0.35)',
    nodeCoreDark: dark ? '#0f172a' : '#262626',
    nodeHaloBg: dark ? '#14171d' : '#ffffff',
    doneGreen: dark ? '#4ade80' : '#16a34a',
    activeRed: dark ? '#f87171' : '#A81C24'
  };
});

const summaryStats = computed(() => {
  const all = visibleNodes.value;
  const doneNodes = all.filter(n => n.state === 'done').length;
  const totalMats = all.reduce((s, n) => s + n.totalCount, 0);
  const doneMats = all.reduce((s, n) => s + n.archivedCount, 0);
  return { doneNodes, totalNodes: all.length, doneMats, totalMats };
});

const selectedNode = computed<EnrichedNode | undefined>(
  () => visibleNodes.value.find(n => n.def.no === selectedNodeNo.value) ?? visibleNodes.value[0]
);

// 打开弹窗或切换成员/模式时，自动聚焦到当前阶段首个未完成节点
watch(
  [() => props.show, () => props.memberId, viewMode],
  ([visible]) => {
    if (!visible) return;
    const list = visibleNodes.value;
    const firstActive =
      list.find(n => n.isCurrentStage && n.state !== 'done') ?? list.find(n => n.isCurrentStage) ?? list[0];
    if (firstActive) {
      selectedNodeNo.value = firstActive.def.no;
    }
  },
  { immediate: true }
);

// ---------------- 快捷编辑材料状态与归档日期（支持「无」） ----------------
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

const editModalShow = ref(false);
const batchArchiveShow = ref(false);
const batchInitialStage = computed<DevStageName>(() => {
  const s = selectedNode.value?.def.stage ?? devStage.value?.stage ?? '申请人';
  return DEV_STAGE_ORDER.includes(s as DevStageName) ? (s as DevStageName) : '申请人';
});
const editForm = reactive<{
  nodeNo: string;
  no: string;
  name: string;
  currentStatus: string;
  targetStatus: string;
  dateMode: 'date' | 'none';
  date: string | null;
}>({
  nodeNo: '',
  no: '',
  name: '',
  currentStatus: '未开始',
  targetStatus: '已归档',
  dateMode: 'date',
  date: null
});

function openQuickEdit(nodeNo: string, mat: Sct.DevMaterial) {
  editForm.nodeNo = nodeNo;
  editForm.no = mat.no;
  editForm.name = mat.name;
  editForm.currentStatus = mat.status;
  editForm.targetStatus = NEXT_STATUS_CYCLE[mat.status] ?? '已归档';
  if (mat.status === '已归档' && !mat.date) {
    editForm.dateMode = 'none';
    editForm.date = null;
  } else {
    editForm.dateMode = 'date';
    editForm.date = mat.date || dayjs().format('YYYY-MM-DD');
  }
  editModalShow.value = true;
}

async function confirmQuickEdit() {
  if (!props.memberId || !editForm.no) return;
  const finalDate = editForm.targetStatus === '已归档' && editForm.dateMode === 'date' ? (editForm.date ?? '') : '';
  await workStore.upsertStageMaterial(props.memberId, editForm.nodeNo, {
    no: editForm.no,
    name: editForm.name,
    status: editForm.targetStatus,
    date: finalDate
  });
  editModalShow.value = false;
  window.$message?.success(`已更新「${editForm.name}」为「${editForm.targetStatus}」`);
}

function stateBadge(state: EnrichedNode['state']) {
  const dark = themeStore.darkMode;
  if (state === 'done') {
    return {
      text: '已归档',
      icon: 'lucide:check-circle-2',
      color: dark ? '#4ade80' : '#16a34a',
      bg: dark ? 'rgba(34, 197, 94, 0.18)' : 'rgba(22, 163, 74, 0.12)'
    };
  }
  if (state === 'active') {
    return {
      text: '进行中',
      icon: 'lucide:clock-3',
      color: dark ? '#fbbf24' : '#d97706',
      bg: dark ? 'rgba(245, 158, 11, 0.18)' : 'rgba(217, 119, 6, 0.12)'
    };
  }
  return {
    text: '未开始',
    icon: 'lucide:circle',
    color: dark ? '#94a3b8' : '#64748b',
    bg: dark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(100, 116, 139, 0.1)'
  };
}

function matPillStyle(status: string) {
  const dark = themeStore.darkMode;
  if (status === '已归档') return { bg: 'var(--sct-ok-soft)', color: dark ? '#4ade80' : '#15803d', dot: '#16a34a' };
  if (status === '进行中') return { bg: 'var(--sct-warn-soft)', color: dark ? '#fbbf24' : '#b45309', dot: '#d97706' };
  return { bg: 'var(--sct-container)', color: dark ? '#cbd5e1' : '#64748b', dot: '#94a3b8' };
}
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    :title="member ? `${member.name} · 党员发展时间线` : '党员发展时间线'"
    class="w-[94vw] max-w-1080px"
    :bordered="false"
  >
    <template #header-extra>
      <div class="flex flex-wrap items-center gap-10px">
        <NTag v-if="devStage" size="small" :bordered="false" type="error">当前阶段：{{ devStage.stage }}</NTag>
        <NButton v-if="devStage" size="small" type="primary" secondary @click="batchArchiveShow = true">
          <template #icon><SvgIcon icon="lucide:folder-check" /></template>
          一键归档
        </NButton>
        <NRadioGroup v-model:value="viewMode" size="small">
          <NRadioButton value="milestone">精简里程碑（12）</NRadioButton>
          <NRadioButton value="full">完整流程（25）</NRadioButton>
        </NRadioGroup>
      </div>
    </template>

    <div v-if="member && devStage" class="flex flex-col gap-12px">
      <!-- 顶部概览与轨道图例 -->
      <div
        class="flex flex-wrap items-center justify-between gap-10px rounded-10px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-8px text-12px"
      >
        <div class="flex flex-wrap items-center gap-12px">
          <span>
            节点进度：
            <strong class="text-[var(--sct-ink)]">{{ summaryStats.doneNodes }} / {{ summaryStats.totalNodes }}</strong>
          </span>
          <span>
            材料归档：
            <strong class="text-[#16a34a]">{{ summaryStats.doneMats }} / {{ summaryStats.totalMats }}</strong>
          </span>
          <span v-if="member.join_date" class="text-gray-500">入党日期：{{ member.join_date }}</span>
          <span v-if="member.full_date" class="text-gray-500">转正日期：{{ member.full_date }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-12px text-11px text-gray-500">
          <span class="inline-flex items-center gap-5px">
            <span class="inline-block h-3px w-16px rounded-full bg-[#16a34a]" />
            已归档流向
          </span>
          <span class="inline-flex items-center gap-5px">
            <span class="inline-block h-0 w-16px border-t-3 border-dashed border-[#94a3b8]" />
            待归档 / 未到达阶段
          </span>
        </div>
      </div>

      <!-- 纯矢量 S 型圆点里程碑画布（精确数学坐标，无缩放错位） -->
      <div class="tl-svg-wrap rounded-10px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-10px py-8px">
        <svg
          :viewBox="`0 0 ${VIEW_W} ${viewH}`"
          class="tl-svg-canvas block h-auto w-full select-none"
          role="img"
          aria-label="党员发展 S 型里程碑时间线"
        >
          <!-- 1. 连续 S 型轨道与外扩半圆折返弯 -->
          <g class="tl-tracks">
            <g v-for="seg in trackSegments" :key="seg.id" :opacity="seg.opacity">
              <path
                :d="seg.d"
                fill="none"
                :stroke="seg.color"
                :stroke-width="seg.strokeWidth"
                :stroke-dasharray="seg.dashed ? '7 5' : 'none'"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <!-- 轨道中点方向小三角 -->
              <g :transform="`translate(${seg.arrowX}, ${seg.arrowY}) rotate(${seg.arrowAngle})`">
                <path
                  d="M -4 -4 L 4.5 0 L -4 4 Z"
                  :fill="seg.color"
                  :stroke="svgPalette.nodeHaloBg"
                  stroke-width="1"
                  stroke-linejoin="round"
                />
              </g>
            </g>
          </g>

          <!-- 2. 里程碑圆环节点 + 上方序号/日期 + 下方短虚线与精简卡片 -->
          <g
            v-for="pt in positionedNodes"
            :key="pt.node.def.no"
            class="tl-node-group"
            :class="{
              'tl-node-group--selected': selectedNode?.def.no === pt.node.def.no,
              'tl-node-group--future': pt.isFutureStage
            }"
            tabindex="0"
            role="button"
            :aria-label="`第 ${pt.node.def.no} 步 ${pt.node.def.node}`"
            @click="selectedNodeNo = pt.node.def.no"
            @keydown.enter.prevent="selectedNodeNo = pt.node.def.no"
            @keydown.space.prevent="selectedNodeNo = pt.node.def.no"
          >
            <!-- 节点上方：醒目序号 + 归档日期（未来阶段呈淡灰色） -->
            <text
              :x="pt.x"
              :y="pt.y - 23"
              text-anchor="middle"
              font-size="11.5"
              font-weight="800"
              :fill="
                selectedNode?.def.no === pt.node.def.no
                  ? svgPalette.activeRed
                  : pt.isFutureStage
                    ? svgPalette.futureText
                    : pt.stageColor
              "
              class="font-mono"
            >
              #{{ pt.node.def.no }}
              <tspan v-if="!pt.isFutureStage && pt.node.keyDate" :fill="svgPalette.doneGreen" font-weight="700">
                · {{ pt.node.keyDate }}
              </tspan>
              <tspan
                v-else-if="!pt.isFutureStage && pt.node.hasNoDateArchive"
                :fill="svgPalette.muted"
                font-weight="600"
              >
                · 无日期
              </tspan>
            </text>

            <!-- 选中外光环 -->
            <circle
              v-if="selectedNode?.def.no === pt.node.def.no"
              :cx="pt.x"
              :cy="pt.y"
              r="20.5"
              fill="none"
              :stroke="svgPalette.activeRed"
              stroke-width="2"
              stroke-dasharray="4 3"
              opacity="0.7"
            />

            <!-- 节点外白垫底环（隔断轨道交叉） -->
            <circle :cx="pt.x" :cy="pt.y" r="15.5" :fill="svgPalette.nodeHaloBg" />

            <!-- 节点圆环（未到达的未来阶段呈淡灰，当前及之前阶段按阶段色/归档绿呈现） -->
            <circle
              :cx="pt.x"
              :cy="pt.y"
              r="13.5"
              :fill="
                pt.isFutureStage
                  ? svgPalette.futureRing
                  : pt.node.state === 'done'
                    ? svgPalette.doneGreen
                    : pt.stageRing
              "
              :stroke="
                selectedNode?.def.no === pt.node.def.no
                  ? svgPalette.activeRed
                  : pt.isFutureStage
                    ? svgPalette.futureCore
                    : svgPalette.nodeCoreDark
              "
              :stroke-width="selectedNode?.def.no === pt.node.def.no ? 2.4 : pt.isFutureStage ? 1.5 : 2"
            />
            <!-- 已归档：白色对勾；进行中/待办：居中圆心 -->
            <path
              v-if="!pt.isFutureStage && pt.node.state === 'done'"
              :d="`M ${pt.x - 4.8} ${pt.y + 0.2} L ${pt.x - 1.4} ${pt.y + 3.6} L ${pt.x + 5.2} ${pt.y - 3.6}`"
              fill="none"
              stroke="#ffffff"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle
              v-else-if="!pt.isFutureStage && pt.node.state === 'active'"
              :cx="pt.x"
              :cy="pt.y"
              r="5"
              fill="#ffffff"
              :stroke="svgPalette.activeRed"
              stroke-width="2"
            />
            <circle
              v-else
              :cx="pt.x"
              :cy="pt.y"
              :r="pt.isFutureStage ? 4.4 : 5.2"
              :fill="pt.isFutureStage ? svgPalette.futureCore : svgPalette.nodeCoreDark"
            />

            <!-- 下方短虚线引出线 -->
            <line
              :x1="pt.x"
              :y1="pt.y + 15.5"
              :x2="pt.x"
              :y2="pt.y + 33"
              :stroke="
                selectedNode?.def.no === pt.node.def.no
                  ? svgPalette.activeRed
                  : pt.isFutureStage
                    ? svgPalette.stemFuture
                    : svgPalette.stem
              "
              stroke-width="1.6"
              stroke-dasharray="3 3"
            />

            <!-- 精简悬浮小卡片 -->
            <rect
              class="tl-mini-card"
              :x="pt.x - cardWidth / 2"
              :y="pt.y + 34"
              :width="cardWidth"
              :height="cardHeight"
              rx="8"
              ry="8"
              :fill="
                selectedNode?.def.no === pt.node.def.no
                  ? svgPalette.cardBgSelected
                  : pt.isFutureStage
                    ? svgPalette.cardBgFuture
                    : svgPalette.cardBg
              "
              :stroke="
                selectedNode?.def.no === pt.node.def.no
                  ? svgPalette.activeRed
                  : pt.isFutureStage
                    ? svgPalette.cardBorderFuture
                    : pt.node.state === 'done'
                      ? svgPalette.doneGreen
                      : svgPalette.cardBorder
              "
              :stroke-width="selectedNode?.def.no === pt.node.def.no ? 1.8 : 1.1"
            />

            <!-- 节点名称（1~2行自适应居中） -->
            <text
              v-if="pt.titleLines.length === 1"
              :x="pt.x"
              :y="pt.y + 58"
              text-anchor="middle"
              font-size="11.5"
              :font-weight="pt.isFutureStage ? '600' : '700'"
              :fill="pt.isFutureStage ? svgPalette.futureText : svgPalette.ink"
            >
              {{ pt.titleLines[0] }}
            </text>
            <template v-else>
              <text
                :x="pt.x"
                :y="pt.y + 52"
                text-anchor="middle"
                font-size="11"
                :font-weight="pt.isFutureStage ? '600' : '700'"
                :fill="pt.isFutureStage ? svgPalette.futureText : svgPalette.ink"
              >
                {{ pt.titleLines[0] }}
              </text>
              <text
                :x="pt.x"
                :y="pt.y + 66"
                text-anchor="middle"
                font-size="11"
                :font-weight="pt.isFutureStage ? '600' : '700'"
                :fill="pt.isFutureStage ? svgPalette.futureText : svgPalette.ink"
              >
                {{ pt.titleLines[1] }}
              </text>
            </template>

            <!-- 卡片底部小字：阶段名 · 归档进度 -->
            <text
              :x="pt.x"
              :y="pt.y + 82"
              text-anchor="middle"
              font-size="10"
              font-weight="600"
              :fill="
                pt.isFutureStage
                  ? svgPalette.futureText
                  : pt.node.state === 'done'
                    ? svgPalette.doneGreen
                    : pt.stageColor
              "
            >
              {{ pt.node.def.stage }} · {{ pt.node.archivedCount }}/{{ pt.node.totalCount }}
            </text>
          </g>
        </svg>
      </div>

      <!-- 节点详情展开区 -->
      <div v-if="selectedNode" class="rounded-10px border border-[var(--sct-border)] bg-[var(--sct-container)] p-14px">
        <div class="flex flex-wrap items-center justify-between gap-8px border-b border-[var(--sct-border)] pb-10px">
          <div class="flex flex-wrap items-center gap-8px">
            <span
              class="rounded-6px px-8px py-2px text-12px font-bold"
              :style="{
                background: stageColorMap[selectedNode.def.stage]?.soft,
                color: stageColorMap[selectedNode.def.stage]?.main
              }"
            >
              第 {{ selectedNode.def.no }} 步 · {{ selectedNode.def.stage }}
            </span>
            <span class="text-14px font-bold text-[var(--sct-ink)]">{{ selectedNode.def.node }}</span>
            <NTag v-if="selectedNode.def.deadline" size="tiny" type="warning" :bordered="false">
              时限：{{ selectedNode.def.deadline }}
            </NTag>
          </div>
          <NTag
            size="small"
            :bordered="false"
            :color="{ color: stateBadge(selectedNode.state).bg, textColor: stateBadge(selectedNode.state).color }"
          >
            {{ stateBadge(selectedNode.state).text }}（{{ selectedNode.archivedCount }}/{{ selectedNode.totalCount }}）
          </NTag>
        </div>

        <div
          v-if="selectedNode.def.req || selectedNode.def.note"
          class="mt-8px flex flex-wrap gap-x-16px gap-y-4px text-12px text-[var(--sct-muted)]"
        >
          <span v-if="selectedNode.def.req">
            <strong>工作要求：</strong>
            {{ selectedNode.def.req }}
          </span>
          <span v-if="selectedNode.def.note">
            <strong>注意事项：</strong>
            {{ selectedNode.def.note }}
          </span>
        </div>

        <div class="mt-10px grid grid-cols-1 gap-8px md:grid-cols-2">
          <div
            v-for="mat in selectedNode.materials"
            :key="`${mat.no}-${mat.name}`"
            class="flex items-center justify-between gap-8px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-10px py-8px"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-12px font-semibold text-[var(--sct-ink)]">
                <span class="mr-4px font-mono text-11px text-[var(--sct-muted)]">{{ mat.no }}</span>
                <span>{{ mat.name }}</span>
              </div>
              <div class="mt-2px text-11px text-[var(--sct-muted)]">
                <template v-if="mat.status === '已归档'">归档日期：{{ mat.date ? mat.date : '无' }}</template>
                <template v-else>尚未归档</template>
              </div>
            </div>
            <button
              type="button"
              class="inline-flex shrink-0 items-center gap-5px rounded-full border border-[var(--sct-border)] px-10px py-3px text-11px font-bold transition hover:border-[#A81C24]"
              :style="{
                background: matPillStyle(mat.status).bg,
                color: matPillStyle(mat.status).color
              }"
              @click="openQuickEdit(selectedNode.def.no, mat)"
            >
              <span class="inline-block size-6px rounded-full" :style="{ background: matPillStyle(mat.status).dot }" />
              <span>{{ mat.status }}</span>
              <SvgIcon icon="lucide:pencil" class="text-11px opacity-75" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </NModal>

  <!-- 快捷变更材料状态弹窗（支持归档日期选「无」） -->
  <NModal v-model:show="editModalShow" preset="card" title="变更材料归档状态" class="w-440px" :mask-closable="false">
    <div class="mb-12px rounded-8px bg-[var(--sct-soft)] px-12px py-10px text-13px">
      <div class="font-bold text-[var(--sct-ink)]">{{ editForm.no }} {{ editForm.name }}</div>
      <div class="mt-4px text-12px text-gray-500">当前状态：{{ editForm.currentStatus }}</div>
    </div>

    <NForm label-placement="left" label-width="96" size="small">
      <NFormItem label="目标状态" required>
        <NSelect v-model:value="editForm.targetStatus" :options="MATERIAL_STATUS_OPTIONS" />
      </NFormItem>
      <NFormItem v-if="editForm.targetStatus === '已归档'" label="归档日期">
        <div class="flex w-full flex-col gap-8px">
          <NRadioGroup v-model:value="editForm.dateMode" size="small">
            <NRadio value="date">填写日期</NRadio>
            <NRadio value="none">无（不填日期）</NRadio>
          </NRadioGroup>
          <NDatePicker
            v-if="editForm.dateMode === 'date'"
            v-model:formatted-value="editForm.date"
            type="date"
            value-format="yyyy-MM-dd"
            clearable
            class="w-full"
          />
        </div>
      </NFormItem>
    </NForm>

    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton size="small" @click="editModalShow = false">取消</NButton>
        <NButton size="small" type="primary" @click="confirmQuickEdit">
          <template #icon><SvgIcon icon="lucide:check" /></template>
          确认保存
        </NButton>
      </div>
    </template>
  </NModal>

  <!-- 按阶段一键归档弹窗 -->
  <DevBatchArchiveModal
    v-model:show="batchArchiveShow"
    :member-id="props.memberId"
    :initial-stage="batchInitialStage"
  />
</template>

<style scoped>
.tl-svg-wrap {
  max-height: 460px;
  overflow-y: auto;
  overflow-x: auto;
}
.tl-svg-canvas {
  min-width: 760px;
}
.tl-node-group {
  cursor: pointer;
  outline: none;
  transition: opacity 0.15s ease;
}
.tl-node-group--future {
  opacity: 0.45;
}
.tl-node-group--future:hover,
.tl-node-group--future.tl-node-group--selected {
  opacity: 0.92;
}
.tl-node-group .tl-mini-card {
  transition:
    stroke 0.15s ease,
    filter 0.15s ease;
}
.tl-node-group:hover .tl-mini-card,
.tl-node-group:focus-visible .tl-mini-card {
  stroke: #a81c24;
  filter: drop-shadow(0 2px 6px rgba(168, 28, 36, 0.16));
}
.tl-node-group--selected .tl-mini-card {
  filter: drop-shadow(0 2px 8px rgba(168, 28, 36, 0.18));
}
</style>
