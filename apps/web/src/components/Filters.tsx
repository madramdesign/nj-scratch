import { formatMoney } from '@nj/lottery-data/format';
import type { GameSummary } from '../api';
import { SORTS, type SortKey } from './RankingTable';

export interface GameFilters {
  search: string;
  prices: number[]; // cents; empty = all
  maxPrice: number | null; // dollars
  minTopPct: number; // 0–100
  minMajorPct: number;
  minScore: number;
  minReturn: number; // 0–100 (%)
  minValueRemaining: number; // dollars
  minTopPrize: number; // dollars
  profile: 'all' | 'strong' | 'average' | 'weak';
  hideNoTop: boolean;
}

export const EMPTY_FILTERS: GameFilters = {
  search: '', prices: [], maxPrice: null, minTopPct: 0, minMajorPct: 0, minScore: 0, minReturn: 0, minValueRemaining: 0, minTopPrize: 0, profile: 'all', hideNoTop: false,
};

export function applyFilters(games: GameSummary[], f: GameFilters): GameSummary[] {
  const q = f.search.trim().toLowerCase().replace(/^#/, '');
  return games.filter((g) => {
    if (q && !g.name.toLowerCase().includes(q) && !g.gameNumber.includes(q) && !g.gameId.includes(q)) return false;
    if (f.prices.length && !f.prices.includes(g.priceCents)) return false;
    if (f.maxPrice != null && g.priceCents > f.maxPrice * 100) return false;
    if (f.minTopPct > 0 && (g.topPrize.pctRemaining ?? 0) * 100 < f.minTopPct) return false;
    if (f.minMajorPct > 0 && (g.major.pctRemaining == null || g.major.pctRemaining * 100 < f.minMajorPct)) return false;
    if (f.minScore > 0 && (g.score.score ?? -1) < f.minScore) return false;
    if (f.minReturn > 0 && (g.currentReturn == null || g.currentReturn * 100 < f.minReturn)) return false;
    if (f.minValueRemaining > 0 && g.allPrizes.valueRemainingCents < f.minValueRemaining * 100) return false;
    if (f.minTopPrize > 0 && g.topPrize.headlineCents < f.minTopPrize * 100) return false;
    if (f.profile !== 'all' && g.score.label !== f.profile) return false;
    if (f.hideNoTop && g.topPrize.remaining === 0) return false;
    return true;
  });
}

export function activeFilterCount(f: GameFilters): number {
  return (Object.keys(EMPTY_FILTERS) as Array<keyof GameFilters>).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(EMPTY_FILTERS[k])).length;
}

function NumberField({ label, value, onChange, step = 1, min = 0, max, suffix }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input type="number" inputMode="decimal" min={min} max={max} step={step} value={value ?? ''} placeholder="any"
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
        {suffix && <small>{suffix}</small>}
      </span>
    </label>
  );
}

export function FilterBar({
  filters, setFilters, prices, sort, setSort, showSort = true, count, total,
}: {
  filters: GameFilters; setFilters: (f: GameFilters) => void; prices: number[]; sort?: SortKey; setSort?: (s: SortKey) => void; showSort?: boolean; count: number; total: number;
}) {
  const set = <K extends keyof GameFilters>(k: K, v: GameFilters[K]) => setFilters({ ...filters, [k]: v });
  const n = activeFilterCount(filters);
  return (
    <section className="filters" aria-label="Filters">
      <div className="filter-row">
        <label className="field search">
          <span className="sr-only">Search by name or game number</span>
          <input type="search" placeholder="Search name or game #" value={filters.search} onChange={(e) => set('search', e.target.value)} />
        </label>
        <div className="chips" role="group" aria-label="Ticket price">
          {prices.map((p) => {
            const on = filters.prices.includes(p);
            return (
              <button key={p} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on}
                onClick={() => set('prices', on ? filters.prices.filter((x) => x !== p) : [...filters.prices, p])}>
                {formatMoney(p)}
              </button>
            );
          })}
        </div>
        {showSort && sort && setSort && (
          <label className="field inline">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {(Object.keys(SORTS) as SortKey[]).map((k) => <option key={k} value={k}>{SORTS[k].label}</option>)}
            </select>
          </label>
        )}
      </div>
      <details className="more-filters">
        <summary>More filters{n ? ` (${n} active)` : ''}</summary>
        <div className="filter-grid">
          <NumberField label="Min top prize % left" value={filters.minTopPct || null} onChange={(v) => set('minTopPct', v ?? 0)} max={100} suffix="%" />
          <NumberField label="Min major prize % left" value={filters.minMajorPct || null} onChange={(v) => set('minMajorPct', v ?? 0)} max={100} suffix="%" />
          <NumberField label="Min overall score" value={filters.minScore || null} onChange={(v) => set('minScore', v ?? 0)} max={100} />
          <NumberField label="Min est. return" value={filters.minReturn || null} onChange={(v) => set('minReturn', v ?? 0)} max={100} suffix="%" />
          <NumberField label="Min prize value left" value={filters.minValueRemaining || null} onChange={(v) => set('minValueRemaining', v ?? 0)} step={100000} suffix="$" />
          <NumberField label="Min top prize" value={filters.minTopPrize || null} onChange={(v) => set('minTopPrize', v ?? 0)} step={1000} suffix="$" />
          <NumberField label="Max ticket price" value={filters.maxPrice} onChange={(v) => set('maxPrice', v)} suffix="$" />
          <label className="field">
            <span>Profile</span>
            <select value={filters.profile} onChange={(e) => set('profile', e.target.value as GameFilters['profile'])}>
              <option value="all">All</option>
              <option value="strong">Strong (best)</option>
              <option value="average">Average</option>
              <option value="weak">Weak (worst)</option>
            </select>
          </label>
          <label className="field check">
            <input type="checkbox" checked={filters.hideNoTop} onChange={(e) => set('hideNoTop', e.target.checked)} />
            <span>Hide games with no top prizes left</span>
          </label>
        </div>
      </details>
      <p className="filter-count" aria-live="polite">
        Showing {count} of {total} active games
        {n > 0 && (
          <button type="button" className="link-btn" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
        )}
      </p>
    </section>
  );
}
