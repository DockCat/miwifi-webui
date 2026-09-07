import { useState, useRef, useId, useEffect } from 'react';
import type { TimeseriesPoint } from '../../api.js';

export interface UniFiAreaChartProps {
  data: TimeseriesPoint[];
  height?: number;
  range?: '1d' | '1w' | '1m';
  responsive?: boolean;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 B/s';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

export function formatTimeLabel(iso: string, range: '1d' | '1w' | '1m'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (range === '1d') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function UniFiAreaChart({
  data,
  height = 200,
  range = '1d',
  responsive = false
}: UniFiAreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(height);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const idPrefix = useId();

  useEffect(() => {
    if (!responsive || typeof window === 'undefined' || !window.ResizeObserver || !containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        const w = entry.contentRect.width;
        if (h > 60) setMeasuredHeight(Math.round(h));
        if (w > 60) setContainerWidth(Math.round(w));
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [responsive]);

  const effectiveHeight = responsive ? measuredHeight : height;
  const width = 800; // SVG internal coordinate width
  const padding = { top: 20, right: 16, bottom: 28, left: 56 };
  const chartW = width - padding.left - padding.right;
  const chartH = Math.max(20, effectiveHeight - padding.top - padding.bottom);

  // Handle empty or small data
  const chartData =
    data.length >= 2
      ? data
      : data.length === 1
        ? [
            { ...data[0]!, timestamp: new Date(Date.now() - 3600000).toISOString() },
            data[0]!
          ]
        : [
            {
              timestamp: new Date(Date.now() - 3600000).toISOString(),
              downspeed: 0,
              upspeed: 0,
              deviceCount: 0,
              cpuLoad: 0,
              memUsed: 0
            },
            {
              timestamp: new Date().toISOString(),
              downspeed: 0,
              upspeed: 0,
              deviceCount: 0,
              cpuLoad: 0,
              memUsed: 0
            }
          ];

  const maxDown = Math.max(...chartData.map((d) => d.downspeed), 0);
  const maxUp = Math.max(...chartData.map((d) => d.upspeed), 0);
  const peak = Math.max(maxDown, maxUp, 1024); // at least 1 KB/s

  // Compute coordinate points
  const points = chartData.map((d, i) => {
    const x = padding.left + (i / (chartData.length - 1)) * chartW;
    const yDown = padding.top + chartH - (d.downspeed / peak) * chartH;
    const yUp = padding.top + chartH - (d.upspeed / peak) * chartH;
    return { x, yDown, yUp, raw: d };
  });

  // Smooth cubic bezier spline
  function generateSplinePath(
    coords: { x: number; y: number }[],
    isArea: boolean,
    baselineY: number
  ): string {
    if (coords.length < 2) return '';
    let path = `M ${coords[0]!.x},${coords[0]!.y}`;

    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[Math.max(0, i - 1)]!;
      const p1 = coords[i]!;
      const p2 = coords[i + 1]!;
      const p3 = coords[Math.min(coords.length - 1, i + 2)]!;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }

    if (isArea) {
      const lastX = coords[coords.length - 1]!.x;
      const firstX = coords[0]!.x;
      path += ` L ${lastX},${baselineY} L ${firstX},${baselineY} Z`;
    }

    return path;
  }

  const baseline = padding.top + chartH;
  const downLinePath = generateSplinePath(
    points.map((p) => ({ x: p.x, y: p.yDown })),
    false,
    baseline
  );
  const downAreaPath = generateSplinePath(
    points.map((p) => ({ x: p.x, y: p.yDown })),
    true,
    baseline
  );

  const upLinePath = generateSplinePath(
    points.map((p) => ({ x: p.x, y: p.yUp })),
    false,
    baseline
  );
  const upAreaPath = generateSplinePath(
    points.map((p) => ({ x: p.x, y: p.yUp })),
    true,
    baseline
  );

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * width;

    let closestIdx = 0;
    let minDist = Infinity;
    points.forEach((p, idx) => {
      const dist = Math.abs(p.x - svgX);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = idx;
      }
    });
    setHoverIdx(closestIdx);
  };

  const hoveredPoint = hoverIdx !== null ? points[hoverIdx] : null;

  // Horizontal grid line ticks (0%, 50%, 100%)
  const yTicks = [
    { label: formatSpeed(peak), y: padding.top },
    { label: formatSpeed(peak / 2), y: padding.top + chartH / 2 },
    { label: '0 B/s', y: baseline }
  ];

  // X ticks: adaptively spaced labels (bounded to points.length and container width)
  const xIndices =
    points.length <= 3 || containerWidth < 320
      ? [0, points.length - 1]
      : containerWidth < 500
        ? [0, Math.floor(points.length / 2), points.length - 1]
        : [
            0,
            Math.floor(points.length / 4),
            Math.floor(points.length / 2),
            Math.floor((3 * points.length) / 4),
            points.length - 1
          ];
  const xTicks = Array.from(new Set(xIndices))
    .filter((idx) => idx >= 0 && idx < points.length && points[idx] !== undefined)
    .map((idx) => ({
      x: points[idx]!.x,
      label: formatTimeLabel(chartData[idx]!.timestamp, range)
    }));

  const downGradId = `${idPrefix}-downGrad`;
  const upGradId = `${idPrefix}-upGrad`;

  return (
    <div className="unifi-area-chart-wrap" ref={containerRef}>
      <svg
        className="unifi-area-chart-svg"
        viewBox={`0 0 ${width} ${effectiveHeight}`}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={downGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#006fff" stopOpacity="0.45" />
            <stop offset="90%" stopColor="#006fff" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id={upGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
            <stop offset="90%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal Grid lines */}
        {yTicks.map((tick, i) => (
          <g key={i} className="chart-grid-line">
            <line
              x1={padding.left}
              y1={tick.y}
              x2={width - padding.right}
              y2={tick.y}
              stroke="var(--border)"
              strokeDasharray="3 3"
              opacity="0.6"
            />
            <text
              x={padding.left - 8}
              y={tick.y + 4}
              textAnchor="end"
              className="chart-axis-label"
              fill="var(--muted)"
              fontSize="10"
            >
              {tick.label}
            </text>
          </g>
        ))}

        {/* X Axis Time labels */}
        {xTicks.map((tick, i) => (
          <text
            key={i}
            x={tick.x}
            y={height - 8}
            textAnchor="middle"
            className="chart-axis-label"
            fill="var(--muted)"
            fontSize="10"
          >
            {tick.label}
          </text>
        ))}

        {/* Area & Line paths */}
        <path d={downAreaPath} fill={`url(#${downGradId})`} />
        <path
          d={downLinePath}
          fill="none"
          stroke="#006fff"
          strokeWidth="2"
          strokeLinecap="round"
        />

        <path d={upAreaPath} fill={`url(#${upGradId})`} />
        <path
          d={upLinePath}
          fill="none"
          stroke="#10b981"
          strokeWidth="1.8"
          strokeLinecap="round"
        />

        {/* Hover Crosshair & Indicators */}
        {hoveredPoint && (
          <g className="chart-hover-group">
            <line
              x1={hoveredPoint.x}
              y1={padding.top}
              x2={hoveredPoint.x}
              y2={baseline}
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.yDown}
              r="4"
              fill="#006fff"
              stroke="#fff"
              strokeWidth="2"
            />
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.yUp}
              r="3.5"
              fill="#10b981"
              stroke="#fff"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {/* Interactive Tooltip Card */}
      {hoveredPoint && (
        <div
          className="chart-tooltip"
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`
          }}
        >
          <div className="tooltip-time">
            {new Date(hoveredPoint.raw.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}
          </div>
          <div className="tooltip-row down">
            <span className="dot down" />
            <span className="name">Down:</span>
            <span className="val">{formatSpeed(hoveredPoint.raw.downspeed)}</span>
          </div>
          <div className="tooltip-row up">
            <span className="dot up" />
            <span className="name">Up:</span>
            <span className="val">{formatSpeed(hoveredPoint.raw.upspeed)}</span>
          </div>
          {hoveredPoint.raw.deviceCount !== undefined && (
            <div className="tooltip-row clients">
              <span className="name">Clients:</span>
              <span className="val">{hoveredPoint.raw.deviceCount}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
