import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactNode
} from 'react';
import {
  type BlockLayout,
  GRID_COLS,
  ROW_HEIGHT_PX,
  GAP_PX,
  calcColWidth,
  getPixelCoordinates,
  snapToGrid,
  snapSizeToGrid,
  resolveCollision
} from './useDashboardLayout.js';

interface DashboardGridContextValue {
  layout: readonly BlockLayout[];
  activeLayout: readonly BlockLayout[];
  isEditing: boolean;
  colWidth: number;
  rowHeight: number;
  gap: number;
  activeId: string | null;
  activePixels: { x: number; y: number; w: number; h: number } | null;
  dragPreview: { col: number; row: number; colSpan: number; rowSpan: number } | null;
  onStartDrag: (id: string, e: React.PointerEvent) => void;
  onStartResize: (id: string, handle: 'se' | 'e' | 's', e: React.PointerEvent) => void;
}

const DashboardGridContext = createContext<DashboardGridContextValue | null>(null);

export interface DashboardGridProps {
  layout: readonly BlockLayout[];
  isEditing: boolean;
  onLayoutChange?: (layout: BlockLayout[]) => void;
  onBlockMove?: (id: string, col: number, row: number) => void;
  onBlockResize?: (id: string, colSpan: number, rowSpan: number) => void;
  children?: ReactNode;
}

export function DashboardGrid({
  layout,
  isEditing,
  onLayoutChange,
  onBlockMove,
  onBlockResize,
  children
}: DashboardGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() => {
    if (typeof window !== 'undefined' && window.innerWidth > 0) {
      return Math.max(320, window.innerWidth - 260);
    }
    return 1200;
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activePixels, setActivePixels] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ col: number; row: number; colSpan: number; rowSpan: number } | null>(null);
  const [liveLayout, setLiveLayout] = useState<BlockLayout[] | null>(null);

  const dragPreviewRef = useRef<{ col: number; row: number; colSpan: number; rowSpan: number } | null>(null);
  const liveLayoutRef = useRef<BlockLayout[] | null>(null);

  // Measure container width dynamically via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) {
        setContainerWidth(rect.width);
      }
    };

    measure();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (w > 0) setContainerWidth(w);
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
  }, []);

  const colWidth = calcColWidth(containerWidth, GRID_COLS, GAP_PX);

  // Active drag/resize interaction tracking
  const interactionRef = useRef<{
    action: 'drag' | 'resize';
    handle?: 'se' | 'e' | 's';
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    initPixel: { x: number; y: number; w: number; h: number };
    block: BlockLayout;
  } | null>(null);

  const activeLayout = liveLayout ?? layout;

  const onStartDrag = useCallback(
    (id: string, e: React.PointerEvent) => {
      if (!isEditing) return;
      const block = layout.find((b) => b.id === id);
      if (!block) return;

      e.preventDefault();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Fallback
      }

      const initPixel = getPixelCoordinates(block, colWidth, ROW_HEIGHT_PX, GAP_PX);

      interactionRef.current = {
        action: 'drag',
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        initPixel,
        block
      };

      const initialPreview = {
        col: block.col,
        row: block.row,
        colSpan: block.colSpan,
        rowSpan: block.rowSpan
      };
      dragPreviewRef.current = initialPreview;
      liveLayoutRef.current = [...layout];

      setActiveId(id);
      setActivePixels({ ...initPixel });
      setDragPreview(initialPreview);
      setLiveLayout([...layout]);
    },
    [isEditing, layout, colWidth]
  );

  const onStartResize = useCallback(
    (id: string, handle: 'se' | 'e' | 's', e: React.PointerEvent) => {
      if (!isEditing) return;
      const block = layout.find((b) => b.id === id);
      if (!block) return;

      e.preventDefault();
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Fallback
      }

      const initPixel = getPixelCoordinates(block, colWidth, ROW_HEIGHT_PX, GAP_PX);

      interactionRef.current = {
        action: 'resize',
        handle,
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        initPixel,
        block
      };

      const initialPreview = {
        col: block.col,
        row: block.row,
        colSpan: block.colSpan,
        rowSpan: block.rowSpan
      };
      dragPreviewRef.current = initialPreview;
      liveLayoutRef.current = [...layout];

      setActiveId(id);
      setActivePixels({ ...initPixel });
      setDragPreview(initialPreview);
      setLiveLayout([...layout]);
    },
    [isEditing, layout, colWidth]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent | PointerEvent) => {
    const inter = interactionRef.current;
    if (!inter) return;

    const deltaX = e.clientX - inter.startX;
    const deltaY = e.clientY - inter.startY;

    if (inter.action === 'drag') {
      const currentX = Math.max(0, inter.initPixel.x + deltaX);
      const currentY = Math.max(0, inter.initPixel.y + deltaY);

      setActivePixels({
        x: currentX,
        y: currentY,
        w: inter.initPixel.w,
        h: inter.initPixel.h
      });

      const { col, row } = snapToGrid(
        currentX,
        currentY,
        colWidth,
        inter.block.colSpan,
        ROW_HEIGHT_PX,
        GAP_PX,
        GRID_COLS
      );

      const nextPreview = {
        col,
        row,
        colSpan: inter.block.colSpan,
        rowSpan: inter.block.rowSpan
      };
      dragPreviewRef.current = nextPreview;
      setDragPreview((prev) => {
        if (prev && prev.col === col && prev.row === row) return prev;
        return nextPreview;
      });

      // Dynamically resolve collisions in real-time
      const candidate: BlockLayout = {
        ...inter.block,
        col,
        row
      };
      const resolved = resolveCollision(layout as BlockLayout[], candidate);
      liveLayoutRef.current = resolved;
      setLiveLayout(resolved);
    } else if (inter.action === 'resize') {
      let currentW = inter.initPixel.w;
      let currentH = inter.initPixel.h;

      if (inter.handle === 'se' || inter.handle === 'e') {
        currentW = Math.max(colWidth, inter.initPixel.w + deltaX);
      }
      if (inter.handle === 'se' || inter.handle === 's') {
        currentH = Math.max(ROW_HEIGHT_PX, inter.initPixel.h + deltaY);
      }

      setActivePixels({
        x: inter.initPixel.x,
        y: inter.initPixel.y,
        w: currentW,
        h: currentH
      });

      const { colSpan, rowSpan } = snapSizeToGrid(
        currentW,
        currentH,
        colWidth,
        inter.block.col,
        inter.block.minColSpan ?? 1,
        inter.block.minRowSpan ?? 1,
        ROW_HEIGHT_PX,
        GAP_PX,
        GRID_COLS
      );

      const nextPreview = {
        col: inter.block.col,
        row: inter.block.row,
        colSpan,
        rowSpan
      };
      dragPreviewRef.current = nextPreview;
      setDragPreview((prev) => {
        if (prev && prev.colSpan === colSpan && prev.rowSpan === rowSpan) return prev;
        return nextPreview;
      });

      // Dynamically resolve collisions in real-time
      const candidate: BlockLayout = {
        ...inter.block,
        colSpan,
        rowSpan
      };
      const resolved = resolveCollision(layout as BlockLayout[], candidate);
      liveLayoutRef.current = resolved;
      setLiveLayout(resolved);
    }
  }, [colWidth, layout]);

  const handlePointerUp = useCallback((e: React.PointerEvent | PointerEvent) => {
    const inter = interactionRef.current;
    if (!inter) return;

    try {
      if (e.target && 'releasePointerCapture' in e.target) {
        (e.target as HTMLElement).releasePointerCapture((e as PointerEvent).pointerId);
      }
    } catch {
      // Fallback
    }

    const preview = dragPreviewRef.current;
    const resolved = liveLayoutRef.current;

    if (preview && resolved) {
      if (inter.action === 'drag') {
        if (onLayoutChange) {
          onLayoutChange(resolved);
        } else if (onBlockMove) {
          onBlockMove(inter.id, preview.col, preview.row);
        }
      } else if (inter.action === 'resize') {
        if (onLayoutChange) {
          onLayoutChange(resolved);
        } else if (onBlockResize) {
          onBlockResize(inter.id, preview.colSpan, preview.rowSpan);
        }
      }
    }

    interactionRef.current = null;
    dragPreviewRef.current = null;
    liveLayoutRef.current = null;
    setActiveId(null);
    setActivePixels(null);
    setDragPreview(null);
    setLiveLayout(null);
  }, [onLayoutChange, onBlockMove, onBlockResize]);

  // Global window pointer listeners for guaranteed capture with zero delay
  useEffect(() => {
    const onWinMove = (e: PointerEvent) => {
      if (!interactionRef.current) return;
      handlePointerMove(e);
    };
    const onWinUp = (e: PointerEvent) => {
      if (!interactionRef.current) return;
      handlePointerUp(e);
    };

    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinUp);

    return () => {
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  // Compute container height dynamically from all blocks
  const maxRow = activeLayout.reduce((acc, b) => Math.max(acc, b.row + b.rowSpan - 1), 1);
  const previewMaxRow = dragPreview ? Math.max(maxRow, dragPreview.row + dragPreview.rowSpan - 1) : maxRow;
  const containerHeight = previewMaxRow * (ROW_HEIGHT_PX + GAP_PX);

  // Compute ghost placeholder pixel dimensions
  const ghostPixels = dragPreview
    ? getPixelCoordinates(dragPreview, colWidth, ROW_HEIGHT_PX, GAP_PX)
    : null;

  return (
    <DashboardGridContext.Provider
      value={{
        layout,
        activeLayout,
        isEditing,
        colWidth,
        rowHeight: ROW_HEIGHT_PX,
        gap: GAP_PX,
        activeId,
        activePixels,
        dragPreview,
        onStartDrag,
        onStartResize
      }}
    >
      <div
        ref={containerRef}
        className={`dashboard-grid ${isEditing ? 'is-editing' : ''}`}
        style={{ height: `${containerHeight}px` }}
        onPointerMove={activeId ? handlePointerMove : undefined}
        onPointerUp={activeId ? handlePointerUp : undefined}
        onPointerCancel={activeId ? handlePointerUp : undefined}
      >
        {/* Ghost placeholder during active drag or resize */}
        {isEditing && activeId && ghostPixels && (
          <div
            className="dashboard-ghost-placeholder"
            style={{
              transform: `translate3d(${ghostPixels.x}px, ${ghostPixels.y}px, 0)`,
              width: `${ghostPixels.w}px`,
              height: `${ghostPixels.h}px`
            }}
          />
        )}
        {children}
      </div>
    </DashboardGridContext.Provider>
  );
}

export interface DashboardBlockProps {
  id: string;
  title?: ReactNode;
  headerAction?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function DashboardBlock({
  id,
  title,
  headerAction,
  children,
  className = ''
}: DashboardBlockProps) {
  const ctx = useContext(DashboardGridContext);
  const isEditing = ctx?.isEditing ?? false;
  const isActive = ctx?.activeId === id;

  const currentLayout = ctx?.activeLayout.find((b) => b.id === id) ??
    ctx?.layout.find((b) => b.id === id);

  let blockStyle: React.CSSProperties = {};

  if (ctx && currentLayout) {
    if (isActive && ctx.activePixels) {
      blockStyle = {
        transform: `translate3d(${ctx.activePixels.x}px, ${ctx.activePixels.y}px, 0)`,
        width: `${ctx.activePixels.w}px`,
        height: `${ctx.activePixels.h}px`
      };
    } else {
      const px = getPixelCoordinates(currentLayout, ctx.colWidth, ctx.rowHeight, ctx.gap);
      blockStyle = {
        transform: `translate3d(${px.x}px, ${px.y}px, 0)`,
        width: `${px.w}px`,
        height: `${px.h}px`
      };
    }
  }

  const handleDragDown = (e: React.PointerEvent) => {
    ctx?.onStartDrag(id, e);
  };

  return (
    <div
      className={`dashboard-block ${isEditing ? 'is-editing' : ''} ${
        isActive ? 'is-dragging' : ''
      } ${className}`}
      style={blockStyle}
      data-block-id={id}
    >
      <section className="card dashboard-card-inner">
        {/* Header with drag handle and title */}
        {(title !== undefined || isEditing || headerAction) && (
          <div
            className="dashboard-block-header"
            onPointerDown={isEditing ? handleDragDown : undefined}
          >
            {isEditing && (
              <div
                className="drag-handle"
                onPointerDown={handleDragDown}
                title="Drag to reposition block"
                role="button"
                aria-label="Drag block"
                tabIndex={0}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="5" cy="4" r="1.5" />
                  <circle cx="11" cy="4" r="1.5" />
                  <circle cx="5" cy="8" r="1.5" />
                  <circle cx="11" cy="8" r="1.5" />
                  <circle cx="5" cy="12" r="1.5" />
                  <circle cx="11" cy="12" r="1.5" />
                </svg>
              </div>
            )}
            {title !== undefined && <h2 className="card-title block-title">{title}</h2>}
            {headerAction && <div className="block-header-action">{headerAction}</div>}
          </div>
        )}

        {/* Card content */}
        <div className="dashboard-block-content">{children}</div>

        {/* Multi-handle resizing in edit mode */}
        {isEditing && (
          <>
            {/* Bottom-right corner handle (width + height) */}
            <div
              className="resize-handle resize-handle-se"
              onPointerDown={(e) => ctx?.onStartResize(id, 'se', e)}
              title="Drag to resize block width and height"
              role="button"
              aria-label="Resize block"
              tabIndex={0}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path
                  d="M14 14H12V12H14V14ZM14 10H12V8H14V10ZM10 14H8V12H10V14ZM14 6H12V4H14V6ZM6 14H4V12H6V14Z"
                  opacity="0.6"
                />
              </svg>
            </div>

            {/* Right edge handle (width) */}
            <div
              className="resize-handle resize-handle-e"
              onPointerDown={(e) => ctx?.onStartResize(id, 'e', e)}
              title="Drag to resize block width"
              role="button"
              aria-label="Resize block width"
              tabIndex={0}
            />

            {/* Bottom edge handle (height) */}
            <div
              className="resize-handle resize-handle-s"
              onPointerDown={(e) => ctx?.onStartResize(id, 's', e)}
              title="Drag to resize block height"
              role="button"
              aria-label="Resize block height"
              tabIndex={0}
            />
          </>
        )}
      </section>
    </div>
  );
}

