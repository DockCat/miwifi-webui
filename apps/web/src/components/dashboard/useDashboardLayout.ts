import { useState, useEffect, useCallback } from 'react';

export interface BlockLayout {
  id: string;
  col: number;      // 1-indexed column start (1..12)
  row: number;      // 1-indexed row start (1..N)
  colSpan: number;  // 1..12
  rowSpan: number;  // 1..N
  minColSpan?: number;
  minRowSpan?: number;
}

export const GRID_COLS = 12;
export const ROW_HEIGHT_PX = 72;
export const GAP_PX = 20;

export const DEFAULT_LAYOUT: readonly BlockLayout[] = [
  { id: 'gateway', col: 1, row: 1, colSpan: 4, rowSpan: 7, minColSpan: 3, minRowSpan: 4 },
  { id: 'recent_events', col: 1, row: 8, colSpan: 4, rowSpan: 4, minColSpan: 3, minRowSpan: 3 },
  { id: 'traffic_overview', col: 5, row: 1, colSpan: 4, rowSpan: 5, minColSpan: 3, minRowSpan: 4 },
  { id: 'client_types', col: 9, row: 1, colSpan: 4, rowSpan: 5, minColSpan: 3, minRowSpan: 4 },
  { id: 'wifi_clients', col: 5, row: 6, colSpan: 4, rowSpan: 3, minColSpan: 3, minRowSpan: 3 },
  { id: 'most_active_clients', col: 9, row: 6, colSpan: 4, rowSpan: 3, minColSpan: 3, minRowSpan: 3 },
  { id: 'throughput_history', col: 5, row: 9, colSpan: 8, rowSpan: 4, minColSpan: 4, minRowSpan: 3 }
];

const STORAGE_PREFIX = 'miwifi_dashboard_layout_';

function getStorage(customStorage?: Storage): Storage | null {
  if (customStorage !== undefined) return customStorage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function calcColWidth(
  containerWidth: number,
  cols = GRID_COLS,
  gap = GAP_PX
): number {
  if (containerWidth <= 0) return 80;
  return Math.max(10, (containerWidth - (cols - 1) * gap) / cols);
}

export function getPixelCoordinates(
  block: { col: number; row: number; colSpan: number; rowSpan: number },
  colWidth: number,
  rowHeight = ROW_HEIGHT_PX,
  gap = GAP_PX
): { x: number; y: number; w: number; h: number } {
  const x = (block.col - 1) * (colWidth + gap);
  const y = (block.row - 1) * (rowHeight + gap);
  const w = block.colSpan * colWidth + (block.colSpan - 1) * gap;
  const h = block.rowSpan * rowHeight + (block.rowSpan - 1) * gap;
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h)
  };
}

export function clampPosition(
  col: number,
  row: number,
  colSpan: number,
  cols = GRID_COLS
): { col: number; row: number } {
  const maxCol = Math.max(1, cols - colSpan + 1);
  const clampedCol = Math.max(1, Math.min(col, maxCol));
  const clampedRow = Math.max(1, row);
  return { col: clampedCol, row: clampedRow };
}

export function snapToGrid(
  pixelX: number,
  pixelY: number,
  colWidth: number,
  colSpan: number,
  rowHeight = ROW_HEIGHT_PX,
  gap = GAP_PX,
  cols = GRID_COLS
): { col: number; row: number } {
  const stepX = colWidth + gap;
  const stepY = rowHeight + gap;
  const rawCol = Math.round(pixelX / stepX) + 1;
  const rawRow = Math.round(pixelY / stepY) + 1;
  return clampPosition(rawCol, rawRow, colSpan, cols);
}

export function clampSize(
  block: BlockLayout,
  targetColSpan: number,
  targetRowSpan: number,
  cols = GRID_COLS
): { colSpan: number; rowSpan: number } {
  const minCol = block.minColSpan ?? 1;
  const maxCol = Math.max(minCol, cols - block.col + 1);
  const minRow = block.minRowSpan ?? 1;

  const clampedColSpan = Math.max(minCol, Math.min(targetColSpan, maxCol));
  const clampedRowSpan = Math.max(minRow, targetRowSpan);
  return { colSpan: clampedColSpan, rowSpan: clampedRowSpan };
}

export function snapSizeToGrid(
  pixelW: number,
  pixelH: number,
  colWidth: number,
  col: number,
  minColSpan = 1,
  minRowSpan = 1,
  rowHeight = ROW_HEIGHT_PX,
  gap = GAP_PX,
  cols = GRID_COLS
): { colSpan: number; rowSpan: number } {
  const stepX = colWidth + gap;
  const stepY = rowHeight + gap;
  const rawColSpan = Math.round((pixelW + gap) / stepX);
  const rawRowSpan = Math.round((pixelH + gap) / stepY);

  const maxCol = Math.max(minColSpan, cols - col + 1);
  const colSpan = Math.max(minColSpan, Math.min(rawColSpan, maxCol));
  const rowSpan = Math.max(minRowSpan, rawRowSpan);
  return { colSpan, rowSpan };
}

export function doOverlap(a: BlockLayout, b: BlockLayout): boolean {
  if (a.id === b.id) return false;
  return !(
    a.col + a.colSpan <= b.col ||
    b.col + b.colSpan <= a.col ||
    a.row + a.rowSpan <= b.row ||
    b.row + b.rowSpan <= a.row
  );
}

export function compactLayout(
  layout: BlockLayout[],
  pinnedId?: string
): BlockLayout[] {
  // Sort items by row, then col to process top-to-bottom
  const sorted = [...layout].sort((a, b) => {
    if (a.row === b.row) return a.col - b.col;
    return a.row - b.row;
  });

  const compacted: BlockLayout[] = [];

  for (const item of sorted) {
    if (pinnedId && item.id === pinnedId) {
      compacted.push({ ...item });
      continue;
    }

    let newRow = 1;
    // Find highest row this item can rest at without overlapping items above it
    for (const placed of compacted) {
      const horizontalOverlap = !(
        item.col + item.colSpan <= placed.col ||
        placed.col + placed.colSpan <= item.col
      );
      if (horizontalOverlap) {
        newRow = Math.max(newRow, placed.row + placed.rowSpan);
      }
    }

    compacted.push({ ...item, row: newRow });
  }

  return compacted;
}

export function resolveCollision(
  layout: BlockLayout[],
  activeBlock: BlockLayout
): BlockLayout[] {
  const result = layout.map((b) => (b.id === activeBlock.id ? { ...activeBlock } : { ...b }));

  // Iteratively push down any overlapping block
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 30) {
    changed = false;
    iterations++;

    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result.length; j++) {
        if (i === j) continue;
        const b1 = result[i]!;
        const b2 = result[j]!;

        if (doOverlap(b1, b2)) {
          // If one is the active moved block, shift the other down
          if (b1.id === activeBlock.id) {
            b2.row = b1.row + b1.rowSpan;
            changed = true;
          } else if (b2.id === activeBlock.id) {
            b1.row = b2.row + b2.rowSpan;
            changed = true;
          } else {
            // Push whichever block starts later (or has higher index) down
            if (b1.row <= b2.row) {
              b2.row = b1.row + b1.rowSpan;
            } else {
              b1.row = b2.row + b2.rowSpan;
            }
            changed = true;
          }
        }
      }
    }
  }

  // Compact blocks while keeping activeBlock in its position
  return compactLayout(result, activeBlock.id);
}

export function loadSavedLayout(routerId: string, customStorage?: Storage): BlockLayout[] {
  const storage = getStorage(customStorage);
  if (!storage) return [...DEFAULT_LAYOUT];

  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${routerId}`);
    if (!raw) return [...DEFAULT_LAYOUT];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_LAYOUT];

    // Ensure all default blocks exist; merge with default if any are missing
    const loadedMap = new Map<string, BlockLayout>(
      parsed
        .filter((b): b is BlockLayout => typeof b === 'object' && b !== null && typeof b.id === 'string')
        .map((b) => [b.id, b])
    );

    return DEFAULT_LAYOUT.map((def) => {
      const saved = loadedMap.get(def.id);
      if (!saved) return def;
      return {
        ...def,
        col: typeof saved.col === 'number' ? saved.col : def.col,
        row: typeof saved.row === 'number' ? saved.row : def.row,
        colSpan: typeof saved.colSpan === 'number' ? saved.colSpan : def.colSpan,
        rowSpan: typeof saved.rowSpan === 'number' ? saved.rowSpan : def.rowSpan
      };
    });
  } catch {
    return [...DEFAULT_LAYOUT];
  }
}

export function saveLayout(
  routerId: string,
  layout: BlockLayout[],
  customStorage?: Storage
): void {
  const storage = getStorage(customStorage);
  if (!storage) return;

  try {
    storage.setItem(`${STORAGE_PREFIX}${routerId}`, JSON.stringify(layout));
  } catch {
    // Storage quota or privacy restriction fallback
  }
}

export function resetSavedLayout(routerId: string, customStorage?: Storage): void {
  const storage = getStorage(customStorage);
  if (!storage) return;

  try {
    storage.removeItem(`${STORAGE_PREFIX}${routerId}`);
  } catch {
    // Fallback
  }
}

export function useDashboardLayout(routerId: string) {
  const [layout, setLayout] = useState<BlockLayout[]>(() => loadSavedLayout(routerId));
  const [isEditing, setIsEditing] = useState(false);

  // Re-load layout if router changes
  useEffect(() => {
    setLayout(loadSavedLayout(routerId));
  }, [routerId]);

  const updateBlockPosition = useCallback(
    (id: string, targetCol: number, targetRow: number) => {
      setLayout((current) => {
        const target = current.find((b) => b.id === id);
        if (!target) return current;

        const { col, row } = clampPosition(targetCol, targetRow, target.colSpan);
        if (col === target.col && row === target.row) return current;

        const moved: BlockLayout = { ...target, col, row };
        const updated = resolveCollision(current, moved);
        saveLayout(routerId, updated);
        return updated;
      });
    },
    [routerId]
  );

  const updateBlockSize = useCallback(
    (id: string, targetColSpan: number, targetRowSpan: number) => {
      setLayout((current) => {
        const target = current.find((b) => b.id === id);
        if (!target) return current;

        const { colSpan, rowSpan } = clampSize(target, targetColSpan, targetRowSpan);
        if (colSpan === target.colSpan && rowSpan === target.rowSpan) return current;

        const resized: BlockLayout = { ...target, colSpan, rowSpan };
        const updated = resolveCollision(current, resized);
        saveLayout(routerId, updated);
        return updated;
      });
    },
    [routerId]
  );

  const commitLayout = useCallback(
    (newLayout: BlockLayout[]) => {
      setLayout(newLayout);
      saveLayout(routerId, newLayout);
    },
    [routerId]
  );

  const resetLayout = useCallback(() => {
    resetSavedLayout(routerId);
    setLayout([...DEFAULT_LAYOUT]);
  }, [routerId]);

  return {
    layout,
    setLayout,
    commitLayout,
    isEditing,
    setIsEditing,
    updateBlockPosition,
    updateBlockSize,
    resetLayout
  };
}

