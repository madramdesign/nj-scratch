import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatInt } from '@nj/lottery-data/format';
import type { HistoryPoint, TierAnalysis } from '../api';

/**
 * Chart colors follow the dataviz reference palette (categorical slots 1–2; one axis per chart;
 * legend for ≥2 series; text in ink tokens, never series color). Defined as CSS vars in styles.css.
 */
const S1 = 'var(--series-1)';
const S2 = 'var(--series-2)';
const TRACK = 'var(--track)';
const axis = { stroke: 'var(--axis)', tick: { fill: 'var(--text-muted)', fontSize: 12 }, tickLine: false };

function shortDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

function TooltipBox({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-title">{typeof label === 'number' ? new Date(label).toLocaleDateString(undefined, { dateStyle: 'medium' }) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="tt-row">
          <span className="tt-swatch" style={{ background: p.color }} />
          <span>{p.name}</span>
          <strong>{fmt ? fmt(p.value, p.dataKey) : p.value}</strong>
        </div>
      ))}
    </div>
  );
}

/** Prize distribution: remaining vs. claimed per tier, as share of original (horizontal 100% bars). */
export function PrizeDistributionChart({ tiers }: { tiers: TierAnalysis[] }) {
  const data = tiers.map((t) => ({
    name: t.description,
    remaining: t.original ? (t.remaining / t.original) * 100 : 0,
    claimed: t.original ? ((t.original - t.remaining) / t.original) * 100 : 0,
    rem: t.remaining,
    orig: t.original,
  }));
  return (
    <figure className="chart" aria-label="Share of each prize tier remaining vs. claimed">
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34 + 60)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" domain={[0, 100]} unit="%" {...axis} />
          <YAxis type="category" dataKey="name" width={130} {...axis} interval={0} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            content={(p: any) => (
              <TooltipBox {...p} fmt={(v: number, k: string) => {
                const d = p.payload?.[0]?.payload;
                return k === 'remaining' ? `${v.toFixed(1)}% (${formatInt(d?.rem)} of ${formatInt(d?.orig)})` : `${v.toFixed(1)}%`;
              }} />
            )}
          />
          <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />
          <Bar dataKey="remaining" name="Remaining" stackId="a" fill={S1} radius={[4, 0, 0, 4]} stroke="var(--surface)" strokeWidth={1} />
          <Bar dataKey="claimed" name="Claimed / paid" stackId="a" fill={TRACK} radius={[0, 4, 4, 0]} stroke="var(--surface)" strokeWidth={1} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

export function HistoryChart({
  points, series, title, fmt, yDomain, integer,
}: {
  points: HistoryPoint[];
  series: Array<{ key: keyof HistoryPoint | ((p: HistoryPoint) => number | null); name: string }>;
  title: string;
  fmt: (v: number) => string;
  yDomain?: [number | 'auto', number | 'auto'];
  integer?: boolean;
}) {
  const data = points.map((p) => {
    const row: Record<string, number | null> = { t: p.observed_at };
    series.forEach((s, i) => (row[`s${i}`] = typeof s.key === 'function' ? s.key(p) : (p[s.key] as number | null)));
    return row;
  });
  const colors = [S1, S2];
  return (
    <figure className="chart history-chart">
      <figcaption>{title}</figcaption>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={shortDate} {...axis} />
          <YAxis {...axis} width={56} tickFormatter={(v) => fmt(v)} domain={yDomain ?? ['auto', 'auto']} allowDecimals={!integer} />
          <Tooltip content={(p: any) => <TooltipBox {...p} fmt={(v: number) => fmt(v)} />} cursor={{ stroke: 'var(--axis)' }} />
          {series.length > 1 && <Legend wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12 }} />}
          {series.map((s, i) => (
            <Line key={i} dataKey={`s${i}`} name={s.name} stroke={colors[i]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: colors[i] }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

export const fmtMoneyCompact = (v: number) => formatMoney(v, { compact: true });
