<script setup lang="ts">
/**
 * RosterBoard：人员布点图（CSS Grid + pointer 三段式拖拽）
 *
 * 借鉴 classroom-workbench 的交互模式（5px 阈值二分点击/拖拽、幽灵头像、
 * elementFromPoint 落点探测、点选互换兜底），实现为原创 Vue3 代码。
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { MEMBER_TYPE_COLORS } from '@/constants/sanchitai';

defineOptions({ name: 'RosterBoard' });

interface Props {
  map: Sct.SeatMap;
  members: Sct.Member[];
  /** memberId → 欠缴角标 */
  feeBadges?: Record<string, boolean>;
  /** 编排模式（可拖拽/互换），false 为纯查看 */
  editable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  feeBadges: () => ({}),
  editable: false
});

const emit = defineEmits<{
  /** 移动成员到某坐标（目标有人则互换，无人则移入）；from 为原坐标（仅行列） */
  move: [payload: { memberId: string; from: { x: number; y: number } | null; to: { x: number; y: number } }];
  open: [memberId: string];
  'place-empty': [pos: { x: number; y: number }];
}>();

// ---------------- 布点索引 ----------------
const seatedMap = computed(() => {
  const m = new Map<string, Sct.Member>();
  props.members.forEach(mem => {
    if (mem.seat && mem.seat.map_id === props.map.map_id) {
      m.set(`${mem.seat.x}-${mem.seat.y}`, mem);
    }
  });
  return m;
});

const unseated = computed(() => props.members.filter(mem => !mem.seat || mem.seat.map_id !== props.map.map_id));

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${props.map.grid.cols}, minmax(96px, 1fr))`,
  gridAutoRows: '64px',
  gap: '8px'
}));

// ---------------- 拖拽（pointer 三段式） ----------------
const drag = ref<{
  memberId: string;
  from: Sct.SeatPos;
  startX: number;
  startY: number;
  ghostX: number;
  ghostY: number;
  overKey: string | null;
  moved: boolean;
} | null>(null);

const pickFirst = ref<{ memberId: string; x: number; y: number } | null>(null);

function cellKey(x: number, y: number) {
  return `${x}-${y}`;
}

function onCellPointerDown(e: PointerEvent, x: number, y: number) {
  if (!props.editable) return;
  const member = seatedMap.value.get(cellKey(x, y));
  if (!member?.seat) return;
  drag.value = {
    memberId: member.id,
    from: { ...member.seat },
    startX: e.clientX,
    startY: e.clientY,
    ghostX: e.clientX,
    ghostY: e.clientY,
    overKey: cellKey(x, y),
    moved: false
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e: PointerEvent) {
  const d = drag.value;
  if (!d) return;
  d.ghostX = e.clientX;
  d.ghostY = e.clientY;
  if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) {
    d.moved = true;
  }
  if (d.moved) {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cell = el?.closest('[data-cell]') as HTMLElement | null;
    d.overKey = cell?.dataset.cell ?? null;
  }
}

function onPointerUp(e: PointerEvent) {
  const d = drag.value;
  drag.value = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  if (!d) return;

  if (!d.moved) {
    // 点选逻辑：查看模式打开人员卡；编排模式两次点选互换
    if (!props.editable) {
      emit('open', d.memberId);
      return;
    }
    if (!pickFirst.value) {
      pickFirst.value = { memberId: d.memberId, x: d.from.x, y: d.from.y };
    } else if (pickFirst.value.memberId === d.memberId) {
      pickFirst.value = null;
    } else {
      emit('move', { memberId: pickFirst.value.memberId, from: { x: pickFirst.value.x, y: pickFirst.value.y }, to: { x: d.from.x, y: d.from.y } });
      pickFirst.value = null;
    }
    return;
  }

  const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  const cell = el?.closest('[data-cell]') as HTMLElement | null;
  if (!cell?.dataset.cell) return;
  const [tx, ty] = cell.dataset.cell.split('-').map(Number);
  if (tx === d.from.x && ty === d.from.y) return;
  emit('move', { memberId: d.memberId, from: { ...d.from }, to: { x: tx, y: ty } });
}

function onEmptyClick(x: number, y: number) {
  if (!props.editable) return;
  if (pickFirst.value) {
    // 点选互换的第二步落在空位：把第一人选的人移过来
    emit('move', { memberId: pickFirst.value.memberId, from: { x: pickFirst.value.x, y: pickFirst.value.y }, to: { x, y } });
    pickFirst.value = null;
    return;
  }
  emit('place-empty', { x, y });
}

function onEmptyPointerDown(e: PointerEvent, x: number, y: number) {
  // 空位不触发拖拽（未排座成员从"未布点"列表拖入的功能后置）
  e.preventDefault();
}

function cellClass(x: number, y: number) {
  const key = cellKey(x, y);
  const member = seatedMap.value.get(key);
  const isOver = drag.value?.moved && drag.value.overKey === key && drag.value.memberId !== member?.id;
  const isPicked = pickFirst.value?.x === x && pickFirst.value?.y === y;
  return {
    'roster-cell': true,
    'roster-cell--empty': !member,
    'roster-cell--over': Boolean(isOver),
    'roster-cell--picked': Boolean(isPicked)
  };
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
});
</script>

<template>
  <div class="roster-wrap">
    <!-- 讲台 -->
    <div class="roster-podium">讲台 / 主持位</div>

    <div class="roster-grid" :style="gridStyle">
      <template v-for="y in map.grid.rows" :key="`row-${y}`">
        <div
          v-for="x in map.grid.cols"
          :key="`cell-${x}-${y}`"
          :data-cell="`${x}-${y}`"
          :class="cellClass(x, y)"
          @pointerdown="onCellPointerDown($event, x, y)"
          @click.stop="!seatedMap.get(cellKey(x, y)) && onEmptyClick(x, y)"
        >
          <template v-if="seatedMap.get(cellKey(x, y))">
            <NPopover trigger="hover" placement="top" :show-arrow="false" style="padding: 10px 12px">
              <template #trigger>
                <div class="h-full w-full">
                  <div class="roster-cell__head">
                    <span class="roster-cell__dot" :style="{ background: MEMBER_TYPE_COLORS[seatedMap.get(cellKey(x, y))!.type] }" />
                    <span class="roster-cell__name">{{ seatedMap.get(cellKey(x, y))!.name }}</span>
                    <NTag v-if="seatedMap.get(cellKey(x, y))!.role" size="tiny" round :color="{ color: '#2B2926', textColor: '#fff' }" :bordered="false" class="roster-cell__role">
                      {{ seatedMap.get(cellKey(x, y))!.role }}
                    </NTag>
                  </div>
                  <div class="roster-cell__sub">
                    {{ seatedMap.get(cellKey(x, y))!.type }} · {{ seatedMap.get(cellKey(x, y))!.group || seatedMap.get(cellKey(x, y))!.grade }}
                  </div>
                  <span v-if="feeBadges[seatedMap.get(cellKey(x, y))!.id]" class="roster-cell__badge" title="党费欠缴">欠</span>
                </div>
              </template>
              <div class="w-200px text-12px leading-relaxed">
                <div class="text-14px font-bold">{{ seatedMap.get(cellKey(x, y))!.name }}（{{ seatedMap.get(cellKey(x, y))!.type }}）</div>
                <div class="mt-4px text-gray-500">{{ seatedMap.get(cellKey(x, y))!.grade }} · {{ seatedMap.get(cellKey(x, y))!.group || '未分组' }}</div>
                <div class="text-gray-500">{{ seatedMap.get(cellKey(x, y))!.major || '' }}{{ seatedMap.get(cellKey(x, y))!.advisor ? ` / ${seatedMap.get(cellKey(x, y))!.advisor}` : '' }}</div>
                <div v-if="feeBadges[seatedMap.get(cellKey(x, y))!.id]" class="mt-4px font-bold" style="color: #d43030">⚠ 党费欠缴</div>
                <div class="mt-4px text-11px text-gray-300">点击查看完整档案</div>
              </div>
            </NPopover>
          </template>
          <template v-else>
            <span class="roster-cell__plus">＋</span>
          </template>
        </div>
      </template>
    </div>

    <!-- 未布点成员 -->
    <div v-if="unseated.length && editable" class="roster-unseated">
      <span class="roster-unseated__label">未布点（{{ unseated.length }}）：</span>
      <NTag v-for="mem in unseated" :key="mem.id" size="small" :bordered="false" :color="{ color: '#f5f5f4', textColor: '#52525b' }">
        {{ mem.name }}
      </NTag>
    </div>

    <!-- 拖拽幽灵头像 -->
    <Teleport to="body">
      <div
        v-if="drag?.moved"
        class="roster-ghost"
        :style="{ left: `${drag.ghostX + 10}px`, top: `${drag.ghostY + 10}px` }"
      >
        {{ members.find(m => m.id === drag!.memberId)?.name }}
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.roster-wrap {
  user-select: none;
}
.roster-podium {
  width: 220px;
  margin: 0 auto 16px;
  padding: 6px 0;
  text-align: center;
  font-size: 12px;
  color: #a1a1aa;
  background: repeating-linear-gradient(45deg, #faf8f4, #faf8f4 6px, #f3f1ec 6px, #f3f1ec 12px);
  border: 1px dashed #d6d3cd;
  border-radius: 6px;
}
.roster-grid {
  display: grid;
}
.roster-cell {
  position: relative;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid #e7e4de;
  border-radius: 8px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.roster-cell--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border-style: dashed;
  color: #c4c1ba;
}
.roster-cell--empty:hover {
  border-color: #a81c24;
  color: #a81c24;
}
.roster-cell--over {
  border: 1.5px dashed #a81c24;
  background: #fdf5f5;
}
.roster-cell--picked {
  border-color: #a81c24;
  box-shadow: 0 0 0 2px rgba(168, 28, 36, 0.18);
}
.roster-cell__head {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.roster-cell__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.roster-cell__name {
  font-size: 13px;
  font-weight: 700;
  color: #2b2b2b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.roster-cell__role {
  flex: none;
  font-size: 10px;
  transform: scale(0.9);
}
.roster-cell__sub {
  margin-top: 3px;
  font-size: 11px;
  color: #9c9994;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.roster-cell__badge {
  position: absolute;
  top: -6px;
  right: -6px;
  padding: 1px 5px;
  font-size: 10px;
  color: #fff;
  background: #d43030;
  border-radius: 999px;
}
.roster-cell__plus {
  font-size: 16px;
}
.roster-unseated {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.roster-unseated__label {
  font-size: 12px;
  color: #9c9994;
}
.roster-ghost {
  position: fixed;
  z-index: 1000;
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: #a81c24;
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(168, 28, 36, 0.35);
  pointer-events: none;
}
</style>
