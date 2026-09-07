/**
 * Tests for Customizable Dashboard Grid layout engine, constraints, and persistence.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  DEFAULT_LAYOUT,
  clampPosition,
  clampSize,
  resolveCollision,
  loadSavedLayout,
  saveLayout,
  resetSavedLayout,
  calcColWidth,
  getPixelCoordinates,
  snapToGrid,
  snapSizeToGrid,
  compactLayout,
  GRID_COLS,
  ROW_HEIGHT_PX,
  GAP_PX,
  type BlockLayout
} from '../src/components/dashboard/useDashboardLayout.js';
import { DashboardGrid, DashboardBlock } from '../src/components/dashboard/DashboardGrid.js';

// In-memory localStorage mock for node test runner
const storageMap = new Map<string, string>();
const mockStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => storageMap.set(key, val),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear()
};

describe('Dashboard Layout Engine', () => {
  beforeEach(() => {
    storageMap.clear();
  });

  it('DEFAULT_LAYOUT contains all 7 core operational blocks', () => {
    const expectedBlocks = [
      'gateway',
      'recent_events',
      'traffic_overview',
      'client_types',
      'wifi_clients',
      'most_active_clients',
      'throughput_history'
    ];
    assert.equal(DEFAULT_LAYOUT.length, 7);
    for (const id of expectedBlocks) {
      const found = DEFAULT_LAYOUT.find((b) => b.id === id);
      assert.ok(found, `Block ${id} should exist in default layout`);
      assert.ok(found.col >= 1 && found.col <= 12, `col out of range for ${id}`);
      assert.ok(found.colSpan >= 1 && found.colSpan <= 12, `colSpan out of range for ${id}`);
      assert.ok(
        found.col + found.colSpan - 1 <= 12,
        `Block ${id} exceeds 12-column boundary`
      );
      assert.ok(found.row >= 1, `row must be >= 1 for ${id}`);
      assert.ok(found.rowSpan >= 1, `rowSpan must be >= 1 for ${id}`);
    }
  });

  it('clampPosition constrains block within 12-column boundaries', () => {
    // colSpan is 4 -> maximum valid col is 13 - 4 = 9
    assert.deepEqual(clampPosition(0, 1, 4), { col: 1, row: 1 });
    assert.deepEqual(clampPosition(5, 3, 4), { col: 5, row: 3 });
    assert.deepEqual(clampPosition(10, 2, 4), { col: 9, row: 2 });
    assert.deepEqual(clampPosition(15, -2, 4), { col: 9, row: 1 });
  });

  it('clampSize constrains width and height to valid minimums and grid width', () => {
    const block: BlockLayout = {
      id: 'test',
      col: 5,
      row: 2,
      colSpan: 4,
      rowSpan: 4,
      minColSpan: 3,
      minRowSpan: 2
    };

    // col = 5 -> maximum colSpan is 13 - 5 = 8
    assert.deepEqual(clampSize(block, 1, 1), { colSpan: 3, rowSpan: 2 });
    assert.deepEqual(clampSize(block, 6, 5), { colSpan: 6, rowSpan: 5 });
    assert.deepEqual(clampSize(block, 12, 10), { colSpan: 8, rowSpan: 10 });
  });

  it('resolveCollision shifts overlapping blocks down without breaking horizontal placement', () => {
    const layout: BlockLayout[] = [
      { id: 'a', col: 1, row: 1, colSpan: 6, rowSpan: 4 },
      { id: 'b', col: 1, row: 5, colSpan: 6, rowSpan: 3 }
    ];

    // Move 'b' to (col: 1, row: 1) where 'a' currently sits
    const moved: BlockLayout = { id: 'b', col: 1, row: 1, colSpan: 6, rowSpan: 3 };
    const resolved = resolveCollision(layout, moved);

    const blockA = resolved.find((b) => b.id === 'a')!;
    const blockB = resolved.find((b) => b.id === 'b')!;

    assert.equal(blockB.row, 1, 'Moved block takes target row');
    assert.ok(
      blockA.row >= blockB.row + blockB.rowSpan,
      `Displaced block A (row ${blockA.row}) should sit below B (row ${blockB.row} + ${blockB.rowSpan})`
    );
  });

  it('saves, loads, and resets layout using storage', () => {
    const routerId = 'router-test-123';

    // 1. Initial load falls back to default layout
    const initial = loadSavedLayout(routerId, mockStorage as unknown as Storage);
    assert.deepEqual(initial, DEFAULT_LAYOUT);

    // 2. Modify and save
    const customized = DEFAULT_LAYOUT.map((b) =>
      b.id === 'throughput_history' ? { ...b, row: 1, col: 1, colSpan: 12 } : b
    );
    saveLayout(routerId, customized, mockStorage as unknown as Storage);

    // 3. Load restored
    const loaded = loadSavedLayout(routerId, mockStorage as unknown as Storage);
    const chartBlock = loaded.find((b) => b.id === 'throughput_history')!;
    assert.equal(chartBlock.row, 1);
    assert.equal(chartBlock.col, 1);
    assert.equal(chartBlock.colSpan, 12);

    // 4. Reset layout
    resetSavedLayout(routerId, mockStorage as unknown as Storage);
    const afterReset = loadSavedLayout(routerId, mockStorage as unknown as Storage);
    assert.deepEqual(afterReset, DEFAULT_LAYOUT);
  });

  it('renders DashboardGrid and DashboardBlock in normal mode without edit handles', () => {
    const layout: BlockLayout[] = [
      { id: 'test-card', col: 1, row: 1, colSpan: 6, rowSpan: 4 }
    ];
    const markup = renderToStaticMarkup(
      createElement(
        DashboardGrid,
        { layout, isEditing: false, onLayoutChange: () => undefined },
        createElement(
          DashboardBlock,
          { id: 'test-card', title: 'Test Block' },
          createElement('div', null, 'Block Content')
        )
      )
    );

    assert.ok(markup.includes('dashboard-grid'));
    assert.ok(markup.includes('dashboard-block'));
    assert.ok(markup.includes('Test Block'));
    assert.ok(markup.includes('Block Content'));
    // Normal mode: no drag handles or resize handles rendered
    assert.ok(!markup.includes('drag-handle'));
    assert.ok(!markup.includes('resize-handle'));
  });

  it('renders DashboardGrid and DashboardBlock in edit mode with drag and resize handles', () => {
    const layout: BlockLayout[] = [
      { id: 'test-card', col: 1, row: 1, colSpan: 6, rowSpan: 4 }
    ];
    const markup = renderToStaticMarkup(
      createElement(
        DashboardGrid,
        { layout, isEditing: true, onLayoutChange: () => undefined },
        createElement(
          DashboardBlock,
          { id: 'test-card', title: 'Test Block' },
          createElement('div', null, 'Block Content')
        )
      )
    );

    assert.ok(markup.includes('is-editing'));
    assert.ok(markup.includes('drag-handle'));
    assert.ok(markup.includes('resize-handle-se'));
    assert.ok(markup.includes('resize-handle-e'));
    assert.ok(markup.includes('resize-handle-s'));
  });

  it('computes column width and pixel coordinates accurately', () => {
    // 1200px container width, 12 cols, 20px gap -> 11 gaps = 220px -> available = 980px -> colWidth = 980 / 12 = 81.666px
    const colWidth = calcColWidth(1200, GRID_COLS, GAP_PX);
    assert.ok(Math.abs(colWidth - 81.666) < 0.1, `Unexpected colWidth ${colWidth}`);

    // Block at col 1, row 1, colSpan 4, rowSpan 2
    const coords = getPixelCoordinates(
      { col: 1, row: 1, colSpan: 4, rowSpan: 2 },
      colWidth,
      ROW_HEIGHT_PX,
      GAP_PX
    );
    assert.equal(coords.x, 0);
    assert.equal(coords.y, 0);
    // w = 4 * 81.666 + 3 * 20 = 326.66 + 60 = 387px
    assert.ok(Math.abs(coords.w - 387) <= 1, `Unexpected width ${coords.w}`);
    // h = 2 * 72 + 1 * 20 = 164px
    assert.equal(coords.h, 164);
  });

  it('snaps pixel positions and sizes back to valid grid coordinates', () => {
    const colWidth = 80;
    // pixelX = 0 -> col 1
    assert.deepEqual(
      snapToGrid(0, 0, colWidth, 4, ROW_HEIGHT_PX, GAP_PX, GRID_COLS),
      { col: 1, row: 1 }
    );
    // pixelX = 100 -> 100 / 100 = 1 -> col 2
    assert.deepEqual(
      snapToGrid(100, 92, colWidth, 4, ROW_HEIGHT_PX, GAP_PX, GRID_COLS),
      { col: 2, row: 2 }
    );
    // pixelX large -> clamped to cols - colSpan + 1 = 12 - 4 + 1 = 9
    assert.deepEqual(
      snapToGrid(2000, 0, colWidth, 4, ROW_HEIGHT_PX, GAP_PX, GRID_COLS),
      { col: 9, row: 1 }
    );

    // Size snap: pixelW = 280 -> (280 + 20) / (80 + 20) = 3 cols
    const size = snapSizeToGrid(
      280,
      164,
      colWidth,
      1,
      1,
      1,
      ROW_HEIGHT_PX,
      GAP_PX,
      GRID_COLS
    );
    assert.equal(size.colSpan, 3);
    assert.equal(size.rowSpan, 2);
  });

  it('compactLayout floats free blocks upward into empty rows', () => {
    const layout: BlockLayout[] = [
      { id: 'top', col: 1, row: 1, colSpan: 4, rowSpan: 2 },
      // 'bottom' has a gap: sitting at row 6 instead of row 3
      { id: 'bottom', col: 1, row: 6, colSpan: 4, rowSpan: 2 },
      // 'other' sits in column 5 with no block above it at row 5
      { id: 'other', col: 5, row: 5, colSpan: 4, rowSpan: 3 }
    ];

    const compacted = compactLayout(layout);
    const top = compacted.find((b) => b.id === 'top')!;
    const bottom = compacted.find((b) => b.id === 'bottom')!;
    const other = compacted.find((b) => b.id === 'other')!;

    assert.equal(top.row, 1);
    // 'bottom' floats up to row 3 right under 'top' (row 1 + 2 = 3)
    assert.equal(bottom.row, 3);
    // 'other' has nothing above it in col 5..8, so it floats up to row 1
    assert.equal(other.row, 1);
  });

  it('renders blocks with CSS 3D transforms (translate3d)', () => {
    const layout: BlockLayout[] = [
      { id: 'card-1', col: 1, row: 1, colSpan: 4, rowSpan: 2 }
    ];
    const markup = renderToStaticMarkup(
      createElement(
        DashboardGrid,
        { layout, isEditing: false },
        createElement(DashboardBlock, { id: 'card-1' }, 'Card Content')
      )
    );

    assert.ok(markup.includes('translate3d'), 'Block should render with translate3d positioning');
  });
});
