import { useState } from 'react';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
  key?: string;
}

export interface UniFiDonutChartProps {
  segments: DonutSegment[];
  totalLabel: string;
  totalValue: string;
  size?: number;
  strokeWidth?: number;
}

export function UniFiDonutChart({
  segments,
  totalLabel,
  totalValue,
  size = 150,
  strokeWidth = 14
}: UniFiDonutChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const total = segments.reduce((sum, s) => sum + s.value, 0);

  let accumulatedPercent = 0;

  return (
    <div className="unifi-donut-container" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="donut-track"
          strokeWidth={strokeWidth}
        />

        {/* Empty state when total is 0 */}
        {total === 0 && (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={strokeWidth}
          />
        )}

        {/* Segments */}
        {total > 0 &&
          segments.map((seg, idx) => {
            const percent = seg.value / total;
            const strokeDasharray = `${percent * circumference} ${circumference}`;
            const strokeDashoffset = -accumulatedPercent * circumference;
            accumulatedPercent += percent;

            const isHovered = hoveredIndex === idx;

            return (
              <circle
                key={seg.key ?? seg.label}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={isHovered ? strokeWidth + 3 : strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="butt"
                className="donut-segment"
                transform={`rotate(-90 ${center} ${center})`}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{
                  transition: 'stroke-width 0.2s ease, filter 0.2s ease',
                  cursor: 'pointer',
                  filter: isHovered ? 'drop-shadow(0 0 6px rgba(0, 111, 255, 0.5))' : 'none'
                }}
              />
            );
          })}
      </svg>

      {/* Centered label */}
      <div className="donut-center-text">
        <span className="donut-value">
          {hoveredIndex !== null ? segments[hoveredIndex]?.value ?? totalValue : totalValue}
        </span>
        <span className="donut-label">
          {hoveredIndex !== null ? segments[hoveredIndex]?.label ?? totalLabel : totalLabel}
        </span>
      </div>
    </div>
  );
}
