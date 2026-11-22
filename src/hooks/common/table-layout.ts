/**
 * 统一表格列布局组合式函数：
 * 1. 表头拖拽调整列顺序（支持 localStorage 记忆）
 * 2. 自定义平滑拖拽列宽（起拖读取 <th> 真实像素宽度防跳变，释放拦截捕获阶段 click 彻底避免误触排序）
 * 3. 支持一键重置列宽与列顺序
 */
import { computed, h, onUnmounted, ref, watch } from 'vue';
import type { ComputedRef, Ref, VNodeChild } from 'vue';
import type { DataTableColumn, DataTableColumns } from 'naive-ui';

export interface TableLayoutState {
  order: string[];
  widths: Record<string, number>;
}

export interface TableLayoutOptions<T> {
  storageKey: string;
  defaultOrder: readonly string[];
  /** 可选：动态限定当前可见列（如人员表的列显隐设置） */
  visibleKeys?: Ref<readonly string[]> | ComputedRef<readonly string[]>;
  /** 永远固定在末尾且不可拖拽排序的列 key（如 'op'） */
  pinnedEndKeys?: readonly string[];
  /** 每个列 key 对应的列配置工厂（支持返回自定义 title 节点，系统会自动包裹拖拽与列宽手柄） */
  columnMap: ComputedRef<
    Record<
      string,
      Omit<DataTableColumn<T>, 'title'> & {
        titleContent: () => VNodeChild;
        defaultWidth?: number;
        minWidth?: number;
        resizable?: boolean;
        reorderable?: boolean;
      }
    >
  >;
  minTableWidth?: number;
}

function loadLayoutState(storageKey: string, defaultOrder: readonly string[]): TableLayoutState {
  try {
    const raw = localStorage.getItem(`sct:table-layout:${storageKey}:v1`);
    if (!raw) return { order: [...defaultOrder], widths: {} };
    const parsed = JSON.parse(raw) as Partial<TableLayoutState>;
    const validSet = new Set(defaultOrder);
    const savedOrder = Array.isArray(parsed.order)
      ? parsed.order.filter((k): k is string => typeof k === 'string' && validSet.has(k))
      : [];
    const missing = defaultOrder.filter(k => !savedOrder.includes(k));
    const widths: Record<string, number> = {};
    if (parsed.widths && typeof parsed.widths === 'object') {
      Object.entries(parsed.widths).forEach(([k, v]) => {
        if (validSet.has(k) && typeof v === 'number' && Number.isFinite(v) && v >= 48 && v <= 900) {
          widths[k] = Math.round(v);
        }
      });
    }
    return { order: [...savedOrder, ...missing], widths };
  } catch {
    return { order: [...defaultOrder], widths: {} };
  }
}

export function useTableColumnLayout<T>(options: TableLayoutOptions<T>) {
  const initial = loadLayoutState(options.storageKey, options.defaultOrder);
  const colOrder = ref<string[]>(initial.order);
  const colWidths = ref<Record<string, number>>(initial.widths);
  const draggingKey = ref<string | null>(null);
  const dragOverKey = ref<string | null>(null);
  const resizingKey = ref<string | null>(null);

  const pinnedEndSet = new Set(options.pinnedEndKeys ?? []);

  function persistState() {
    try {
      localStorage.setItem(
        `sct:table-layout:${options.storageKey}:v1`,
        JSON.stringify({ order: colOrder.value, widths: colWidths.value })
      );
    } catch {
      /* ignore storage errors */
    }
  }

  watch([colOrder, colWidths], persistState, { deep: true });

  const hasCustomLayout = computed(() => {
    const hasCustomWidth = Object.keys(colWidths.value).length > 0;
    const hasCustomOrder =
      colOrder.value.length === options.defaultOrder.length &&
      colOrder.value.some((k, idx) => k !== options.defaultOrder[idx]);
    return hasCustomWidth || hasCustomOrder;
  });

  function resetLayout() {
    colOrder.value = [...options.defaultOrder];
    colWidths.value = {};
    try {
      localStorage.removeItem(`sct:table-layout:${options.storageKey}:v1`);
    } catch {
      /* ignore */
    }
  }

  // ---------------- 列宽拖拽（防跳变 + 防误触排序） ----------------
  let activeCleanup: (() => void) | null = null;

  function startResize(e: MouseEvent, key: string, defaultWidth: number, minWidth: number) {
    e.stopPropagation();
    e.preventDefault();
    if (activeCleanup) activeCleanup();

    const handleEl = e.currentTarget as HTMLElement | null;
    const thEl = handleEl?.closest('th');
    const measuredWidth = thEl ? Math.round(thEl.getBoundingClientRect().width) : defaultWidth;
    const startW = Math.max(minWidth, colWidths.value[key] ?? measuredWidth);
    const startX = e.clientX;
    resizingKey.value = key;

    // 起拖瞬间先锁定当前真实宽度，杜绝首次拖动时表格列宽突然跳变
    colWidths.value = { ...colWidths.value, [key]: startW };

    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const nextW = Math.max(minWidth, Math.min(800, Math.round(startW + delta)));
      colWidths.value = { ...colWidths.value, [key]: nextW };
    };

    const onUp = () => {
      cleanup();
      // 在捕获阶段仅拦截落在表头 <th> 内的 click，既杜绝误触排序又不吞掉工具栏按钮点击
      const suppressClick = (clickEvent: MouseEvent) => {
        const target = clickEvent.target as HTMLElement | null;
        if (target?.closest('th')) {
          clickEvent.stopPropagation();
          clickEvent.preventDefault();
        }
      };
      window.addEventListener('click', suppressClick, true);
      setTimeout(() => {
        window.removeEventListener('click', suppressClick, true);
      }, 220);
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      resizingKey.value = null;
      activeCleanup = null;
    };

    activeCleanup = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  onUnmounted(() => {
    if (activeCleanup) activeCleanup();
  });

  // ---------------- 列顺序拖拽 ----------------
  function reorderColumns(fromKey: string, toKey: string) {
    if (fromKey === toKey || pinnedEndSet.has(fromKey) || pinnedEndSet.has(toKey)) return;
    const next = [...colOrder.value];
    const fromIdx = next.indexOf(fromKey);
    const toIdx = next.indexOf(toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    colOrder.value = next;
  }

  const columns = computed<DataTableColumns<T>>(() => {
    const map = options.columnMap.value;
    const visibleSet = options.visibleKeys ? new Set(options.visibleKeys.value) : null;

    const orderedKeys = [
      ...colOrder.value.filter(k => !pinnedEndSet.has(k)),
      ...colOrder.value.filter(k => pinnedEndSet.has(k))
    ].filter(k => Boolean(map[k]) && (!visibleSet || visibleSet.has(k)));

    return orderedKeys.map(key => {
      const def = map[key];
      const baseWidth = def.defaultWidth ?? (typeof def.width === 'number' ? def.width : 120);
      const minW = def.minWidth ?? 60;
      const canResize = def.resizable !== false && !pinnedEndSet.has(key);
      const canReorder = def.reorderable !== false && !pinnedEndSet.has(key);
      const currentWidth = colWidths.value[key] ?? baseWidth;

      const { titleContent, defaultWidth: _dw, minWidth: _mw, resizable: _rz, reorderable: _ro, ...rest } = def;

      return {
        ...rest,
        key,
        width: currentWidth,
        resizable: false,
        title: () =>
          h(
            'div',
            {
              class: [
                'sct-th-wrap',
                canReorder ? 'sct-th-wrap--draggable' : '',
                draggingKey.value === key ? 'sct-th-wrap--dragging' : '',
                dragOverKey.value === key && draggingKey.value !== key ? 'sct-th-wrap--over' : ''
              ],
              draggable: canReorder && !resizingKey.value,
              onDragstart: (e: DragEvent) => {
                if (!canReorder || resizingKey.value) {
                  e.preventDefault();
                  return;
                }
                draggingKey.value = key;
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', key);
                }
              },
              onDragover: (e: DragEvent) => {
                if (!canReorder || !draggingKey.value || draggingKey.value === key) return;
                e.preventDefault();
                dragOverKey.value = key;
              },
              onDragleave: () => {
                if (dragOverKey.value === key) dragOverKey.value = null;
              },
              onDrop: (e: DragEvent) => {
                if (!canReorder) return;
                e.preventDefault();
                const from = draggingKey.value || e.dataTransfer?.getData('text/plain') || '';
                if (from) reorderColumns(from, key);
                draggingKey.value = null;
                dragOverKey.value = null;
              },
              onDragend: () => {
                draggingKey.value = null;
                dragOverKey.value = null;
              }
            },
            [
              h('div', { class: 'sct-th-inner' }, [titleContent()]),
              canResize
                ? h('span', {
                    class: ['sct-col-resizer', resizingKey.value === key ? 'sct-col-resizer--active' : ''],
                    title: '拖拽调整列宽',
                    onMousedown: (e: MouseEvent) => startResize(e, key, baseWidth, minW),
                    onClick: (e: MouseEvent) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }
                  })
                : null
            ]
          )
      } as DataTableColumn<T>;
    });
  });

  const scrollX = computed(() => {
    const sum = columns.value.reduce((acc, col) => acc + (typeof col.width === 'number' ? col.width : 110), 0);
    return Math.max(sum, options.minTableWidth ?? 760);
  });

  return {
    columns,
    scrollX,
    colOrder,
    colWidths,
    hasCustomLayout,
    resetLayout
  };
}
