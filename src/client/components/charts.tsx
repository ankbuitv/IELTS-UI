/**
 * Dependency-free SVG charts. Kept deliberately small: dashboards need trends
 * and distributions, not a charting framework.
 */
import type { ReactNode } from 'react';

export interface SeriesPoint {
  label: string;
  value: number | null;
  sublabel?: string;
}

export function LineChart({
  points,
  height = 220,
  yMax,
  yMin = 0,
  yLabel,
  emptyLabel = 'Not enough data yet',
  formatValue = (value: number) => String(value),
}: {
  points: SeriesPoint[];
  height?: number;
  yMax?: number;
  yMin?: number;
  yLabel?: string;
  emptyLabel?: string;
  formatValue?: (value: number) => string;
}) {
  const usable = points.filter((point) => point.value !== null) as Array<SeriesPoint & { value: number }>;
  if (usable.length < 2) {
    return <div className="empty">{emptyLabel}</div>;
  }

  const width = 640;
  const padding = { top: 14, right: 18, bottom: 30, left: 40 };
  const max = yMax ?? Math.max(...usable.map((point) => point.value)) * 1.1;
  const min = yMin;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;

  const x = (index: number) => padding.left + index * step;
  const y = (value: number) => padding.top + innerHeight - ((value - min) / (max - min || 1)) * innerHeight;

  const path = points
    .map((point, index) => (point.value === null ? null : `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`))
    .filter(Boolean)
    .join(' ');

  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, index) => min + ((max - min) / ticks) * index);
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={yLabel ?? 'Trend chart'}>
      {tickValues.map((value) => (
        <g key={value}>
          <line className="chart__grid" x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} />
          <text className="chart__label" x={padding.left - 8} y={y(value) + 3} textAnchor="end">
            {formatValue(Number(value.toFixed(2)))}
          </text>
        </g>
      ))}
      <line className="chart__axis" x1={padding.left} x2={width - padding.right} y1={padding.top + innerHeight} y2={padding.top + innerHeight} />
      <path className="chart__line" d={path} />
      {points.map((point, index) =>
        point.value === null ? null : (
          <circle key={`${point.label}-${index}`} className="chart__point" cx={x(index)} cy={y(point.value)} r={3.4}>
            <title>{`${point.sublabel ?? point.label}: ${formatValue(point.value)}`}</title>
          </circle>
        ),
      )}
      {points.map((point, index) =>
        index % labelEvery === 0 ? (
          <text key={`label-${index}`} className="chart__label" x={x(index)} y={height - 8} textAnchor="middle">
            {point.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function BarChart({
  bars,
  height = 220,
  formatValue = (value: number) => String(value),
  yLabel,
  emptyLabel = 'No data yet',
}: {
  bars: SeriesPoint[];
  height?: number;
  formatValue?: (value: number) => string;
  yLabel?: string;
  emptyLabel?: string;
}) {
  if (bars.length === 0 || bars.every((bar) => !bar.value)) {
    return <div className="empty">{emptyLabel}</div>;
  }

  const width = Math.max(320, bars.length * 54);
  const padding = { top: 14, right: 12, bottom: 34, left: 38 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const max = Math.max(...bars.map((bar) => bar.value ?? 0)) * 1.15 || 1;
  const slot = innerWidth / bars.length;
  const barWidth = Math.min(38, slot * 0.6);

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={yLabel ?? 'Bar chart'}>
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const value = max * fraction;
        const yPos = padding.top + innerHeight - fraction * innerHeight;
        return (
          <g key={fraction}>
            <line className="chart__grid" x1={padding.left} x2={width - padding.right} y1={yPos} y2={yPos} />
            <text className="chart__label" x={padding.left - 8} y={yPos + 3} textAnchor="end">
              {formatValue(Number(value.toFixed(2)))}
            </text>
          </g>
        );
      })}
      {bars.map((bar, index) => {
        const value = bar.value ?? 0;
        const barHeight = (value / max) * innerHeight;
        const xPos = padding.left + index * slot + (slot - barWidth) / 2;
        return (
          <g key={`${bar.label}-${index}`}>
            <rect
              className="chart__bar"
              x={xPos}
              y={padding.top + innerHeight - barHeight}
              width={barWidth}
              height={Math.max(barHeight, value > 0 ? 2 : 0)}
              rx={3}
            >
              <title>{`${bar.sublabel ?? bar.label}: ${formatValue(value)}`}</title>
            </rect>
            <text className="chart__label" x={xPos + barWidth / 2} y={height - 12} textAnchor="middle">
              {bar.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function AccuracyList({
  items,
}: {
  items: Array<{ label: string; correct: number; total: number; accuracy: number | null }>;
}) {
  if (items.length === 0) return <div className="empty">No marked answers yet</div>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {items.map((item) => (
        <div key={item.label}>
          <div className="row row--between" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: '0.9rem' }}>{item.label}</span>
            <span className="muted small nowrap">
              {item.accuracy === null ? '—' : `${item.accuracy}%`} · {item.correct}/{item.total}
            </span>
          </div>
          <div className="bar">
            <div
              className="bar__fill"
              style={{
                width: `${item.accuracy ?? 0}%`,
                background: (item.accuracy ?? 0) >= 70 ? 'var(--success)' : (item.accuracy ?? 0) >= 45 ? '#c58a17' : 'var(--danger)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="legend">
      {items.map((item) => (
        <span className="legend__item" key={item.label}>
          <span className="legend__swatch" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartFrame({ title, children, hint }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="card__header">
        <div>
          <h3 className="card__title">{title}</h3>
          {hint ? <div className="card__hint">{hint}</div> : null}
        </div>
      </div>
      {children}
    </div>
  );
}
