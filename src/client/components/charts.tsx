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

export type ChartTone = 'brand' | 'violet' | 'emerald' | 'amber' | 'blue';

/**
 * Axis values people can read: whole steps such as 0, 3, 6, 9 for a band axis or 0, 25, 50, 75, 100
 * for a percentage, instead of 0, 2.25, 4.5, 6.75, 9. Without a fixed top the axis is rounded up to
 * the next tick so the highest gridline is never above the data it describes. `integersOnly`
 * keeps every tick a whole number, for counts.
 */
export function niceScale(min: number, max: number, target = 4, fixedTop = false, integersOnly = false): { max: number; ticks: number[] } {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return { max: min + 1, ticks: [min, min + 1] };
  const raw = span / target;
  const exponent = Math.floor(Math.log10(raw));
  const candidates: number[] = [];
  for (let k = exponent - 1; k <= exponent + 1; k += 1) for (const base of [1, 2, 2.5, 3, 5, 10]) candidates.push(base * 10 ** k);
  const feasible = candidates
    .filter((candidate) => candidate >= raw * 0.8 - 1e-9 && (!integersOnly || (Number.isInteger(candidate) && candidate >= 1)))
    .sort((a, b) => a - b);
  const even = (candidate: number) => Math.abs(span / candidate - Math.round(span / candidate)) < 1e-9;
  const step = (fixedTop ? feasible.find(even) : undefined) ?? feasible[0] ?? raw;
  const top = fixedTop ? max : Math.ceil((max - min) / step - 1e-9) * step + min;
  const ticks: number[] = [];
  for (let value = min; value <= top + 1e-9; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  return { max: top, ticks };
}

export function LineChart({
  points,
  height = 220,
  yMax,
  yMin = 0,
  yLabel,
  emptyLabel = 'Not enough data yet',
  formatValue = (value: number) => String(value),
  tone,
}: {
  points: SeriesPoint[];
  height?: number;
  yMax?: number;
  yMin?: number;
  yLabel?: string;
  emptyLabel?: string;
  formatValue?: (value: number) => string;
  tone?: ChartTone;
}) {
  const usable = points.filter((point) => point.value !== null) as Array<SeriesPoint & { value: number }>;
  if (usable.length < 2) {
    return <div className="empty">{emptyLabel}</div>;
  }

  const width = 640;
  const padding = { top: 14, right: 18, bottom: 30, left: 40 };
  const min = yMin;
  const scale = niceScale(min, yMax ?? Math.max(...usable.map((point) => point.value)) * 1.1, 4, yMax !== undefined);
  const max = scale.max;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;

  const x = (index: number) => padding.left + index * step;
  const y = (value: number) => padding.top + innerHeight - ((value - min) / (max - min || 1)) * innerHeight;

  // A gap (no score for that attempt) ends the line; the next point starts a new
  // segment with "M". Starting every later point with "L" after a leading gap
  // produced an invalid path ("Expected moveto") and a console error.
  const path = points
    .reduce<{ parts: string[]; open: boolean }>(
      (acc, point, index) =>
        point.value === null
          ? { parts: acc.parts, open: false }
          : { parts: [...acc.parts, `${acc.open ? 'L' : 'M'} ${x(index)} ${y(point.value)}`], open: true },
      { parts: [], open: false },
    )
    .parts.join(' ');

  const tickValues = scale.ticks;
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <svg className={`chart${tone ? ` chart--${tone}` : ''}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={yLabel ?? 'Trend chart'}>
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
  tone,
}: {
  bars: SeriesPoint[];
  height?: number;
  formatValue?: (value: number) => string;
  yLabel?: string;
  emptyLabel?: string;
  tone?: ChartTone;
}) {
  if (bars.length === 0 || bars.every((bar) => !bar.value)) {
    return <div className="empty">{emptyLabel}</div>;
  }

  const width = Math.max(320, bars.length * 54);
  const padding = { top: 14, right: 12, bottom: 34, left: 38 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  // Counts (attempts per day, students) never get a 2.5 gridline.
  const wholeNumbers = bars.every((bar) => Number.isInteger(bar.value ?? 0));
  const scale = niceScale(0, Math.max(...bars.map((bar) => bar.value ?? 0)) * 1.05 || 1, 4, false, wholeNumbers);
  const max = scale.max;
  const slot = innerWidth / bars.length;
  const barWidth = Math.min(38, slot * 0.6);

  return (
    <svg className={`chart${tone ? ` chart--${tone}` : ''}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={yLabel ?? 'Bar chart'}>
      {scale.ticks.map((value) => {
        const yPos = padding.top + innerHeight - (value / max) * innerHeight;
        return (
          <g key={value}>
            <line className="chart__grid" x1={padding.left} x2={width - padding.right} y1={yPos} y2={yPos} />
            <text className="chart__label" x={padding.left - 8} y={yPos + 3} textAnchor="end">
              {formatValue(value)}
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
  items: Array<{ label: string; correct: number; total: number; accuracy: number | null; tone?: ChartTone }>;
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
          <div className={`bar${item.tone ? ` bar--tone-${item.tone}` : ''}`}>
            <div
              className="bar__fill"
              style={{
                width: `${item.accuracy ?? 0}%`,
                background: (item.accuracy ?? 0) >= 70 ? 'var(--success)' : (item.accuracy ?? 0) >= 45 ? 'var(--warning)' : 'var(--danger)',
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
