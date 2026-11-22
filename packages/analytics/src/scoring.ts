import type { GameMetrics } from './metrics.ts';

/**
 * Transparent composite "Remaining-Prize Score" (0–100).
 *
 * Each component is a raw metric that is converted to a PERCENTILE among the games being compared
 * (0 = worst active game, 100 = best). The overall score is the weighted average of the available
 * component percentiles. If a component is unavailable for a game (e.g. a $1 game has no $10k+ prizes),
 * its weight is redistributed proportionally across the remaining components and this is disclosed.
 */

export type ComponentKey = 'expectedReturn' | 'topPrize' | 'majorPrize' | 'profitOdds' | 'prizeValue';

export interface ComponentDef {
  key: ComponentKey;
  label: string;
  short: string;
  description: string;
  extract: (m: GameMetrics) => number | null;
  format: (v: number) => string;
}

const ratio = (v: number) => `${v.toFixed(2)}×`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export const COMPONENTS: ComponentDef[] = [
  {
    key: 'expectedReturn',
    label: 'Estimated return per $1',
    short: 'EV',
    description: 'Estimated expected value of a ticket bought now, divided by its price.',
    extract: (m) => (m.currentReturn == null ? null : Math.min(m.currentReturn, 1.0)),
    format: pct,
  },
  {
    key: 'topPrize',
    label: 'Top-prize availability vs. sales',
    short: 'Top',
    description: '% of top prizes remaining ÷ % of tickets remaining. Above 1× means top prizes are over-represented in the unsold tickets.',
    extract: (m) => m.topRetention,
    format: ratio,
  },
  {
    key: 'majorPrize',
    label: 'Major-prize availability vs. sales',
    short: 'Major',
    description: '% of major prizes (at or above the selected threshold) remaining ÷ % of tickets remaining.',
    extract: (m) => m.majorRetention,
    format: ratio,
  },
  {
    key: 'profitOdds',
    label: 'Chance of winning more than the ticket cost',
    short: 'Profit odds',
    description: 'Estimated probability that a ticket bought now wins a cash prize larger than its price.',
    extract: (m) => (m.currentOddsProfitOneIn ? 1 / m.currentOddsProfitOneIn : null),
    format: pct,
  },
  {
    key: 'prizeValue',
    label: 'Prize value remaining vs. sales',
    short: 'Value',
    description: '% of total prize money remaining ÷ % of tickets remaining.',
    extract: (m) => m.valueRetention,
    format: ratio,
  },
];

export type Weights = Record<ComponentKey, number>;

export const DEFAULT_WEIGHTS: Weights = {
  expectedReturn: 35,
  topPrize: 20,
  majorPrize: 20,
  profitOdds: 15,
  prizeValue: 10,
};

export interface ScoringOptions {
  weights?: Partial<Weights>;
  /** Cap the score of games whose top prizes are all claimed (default 40 — they can never rank "strong"). */
  noTopPrizeCap?: number | null;
}

export interface ComponentScore {
  key: ComponentKey;
  label: string;
  raw: number | null;
  rawFormatted: string;
  percentile: number | null;
  weight: number;
  effectiveWeight: number;
  contribution: number;
}

export interface GameScore {
  gameId: string;
  score: number | null;
  components: ComponentScore[];
  capped: boolean;
  rank: number | null;
  rankInPrice: number | null;
  peersInPrice: number;
  label: 'strong' | 'average' | 'weak' | 'unrated';
  notes: string[];
}

/** Percentile (0–100) of each value among `values`, averaging ties. Null-safe. */
export function percentiles(values: Array<number | null>): Array<number | null> {
  const present = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  const out: Array<number | null> = values.map(() => null);
  const n = present.length;
  if (n === 0) return out;
  if (n === 1) {
    out[present[0].i] = 50;
    return out;
  }
  present.sort((a, b) => a.v - b.v);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && present[j + 1].v === present[k].v) j++;
    const avgRank = (k + j) / 2; // 0-based
    for (let x = k; x <= j; x++) out[present[x].i] = (avgRank / (n - 1)) * 100;
    k = j + 1;
  }
  return out;
}

export function labelFor(score: number | null): GameScore['label'] {
  if (score == null) return 'unrated';
  if (score >= 67) return 'strong';
  if (score >= 40) return 'average';
  return 'weak';
}

export function scoreGames(metrics: GameMetrics[], opts: ScoringOptions = {}): Map<string, GameScore> {
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const cap = opts.noTopPrizeCap === undefined ? 40 : opts.noTopPrizeCap;
  const raws = COMPONENTS.map((c) => metrics.map((m) => c.extract(m)));
  const pcts = raws.map((r) => percentiles(r));

  const results = metrics.map((m, gi) => {
    const notes: string[] = [];
    const available = COMPONENTS.map((c, ci) => ({ c, ci, p: pcts[ci][gi] })).filter((x) => x.p != null && weights[x.c.key] > 0);
    const totalW = available.reduce((s, x) => s + weights[x.c.key], 0);
    const components: ComponentScore[] = COMPONENTS.map((c, ci) => {
      const raw = raws[ci][gi];
      const p = pcts[ci][gi];
      const eff = p != null && totalW > 0 && weights[c.key] > 0 ? weights[c.key] / totalW : 0;
      return {
        key: c.key,
        label: c.label,
        raw,
        rawFormatted: raw == null ? 'n/a' : c.format(raw),
        percentile: p,
        weight: weights[c.key],
        effectiveWeight: eff,
        contribution: p != null ? p * eff : 0,
      };
    });
    const missing = components.filter((c) => c.percentile == null && c.weight > 0);
    if (missing.length) notes.push(`Not available: ${missing.map((c) => c.label.toLowerCase()).join(', ')}; weight redistributed to the other components.`);
    // Need data for at least 2 components (regardless of weighting) and some positive weight to score at all.
    const withData = COMPONENTS.filter((_, ci) => pcts[ci][gi] != null).length;
    let score: number | null = withData >= 2 && totalW > 0 ? components.reduce((s, c) => s + c.contribution, 0) : null;
    if (score == null) notes.push(totalW > 0 ? 'Insufficient data to score this game.' : 'All weighted components are unavailable for this game.');
    let capped = false;
    if (score != null && cap != null && m.topPrize.remaining === 0 && score > cap) {
      score = cap;
      capped = true;
      notes.push(`Score capped at ${cap} because no top prizes remain.`);
    }
    return { m, score: score == null ? null : Math.round(score * 10) / 10, components, capped, notes };
  });

  const ranked = results.filter((r) => r.score != null).sort((a, b) => b.score! - a.score! || a.m.gameId.localeCompare(b.m.gameId));
  const rank = new Map(ranked.map((r, i) => [r.m.gameId, i + 1]));
  const byPrice = new Map<number, typeof ranked>();
  for (const r of ranked) byPrice.set(r.m.priceCents, [...(byPrice.get(r.m.priceCents) ?? []), r]);

  const out = new Map<string, GameScore>();
  for (const r of results) {
    const peers = byPrice.get(r.m.priceCents) ?? [];
    const idx = peers.findIndex((p) => p.m.gameId === r.m.gameId);
    out.set(r.m.gameId, {
      gameId: r.m.gameId,
      score: r.score,
      components: r.components,
      capped: r.capped,
      rank: rank.get(r.m.gameId) ?? null,
      rankInPrice: idx >= 0 ? idx + 1 : null,
      peersInPrice: peers.length,
      label: labelFor(r.score),
      notes: r.notes,
    });
  }
  return out;
}

export function normalizeWeights(w: Partial<Weights>): Weights {
  const merged = { ...DEFAULT_WEIGHTS, ...w };
  for (const k of Object.keys(merged) as ComponentKey[]) merged[k] = Math.max(0, Number(merged[k]) || 0);
  return merged;
}
