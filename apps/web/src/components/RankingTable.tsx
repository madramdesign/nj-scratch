import { useMemo, useState, type ReactNode } from 'react';
import { formatMoney, formatOdds, formatPct, formatInt } from '@nj/lottery-data/format';
import type { GameSummary } from '../api';
import { GameLink, Meter, Retention, ScoreBadge, Star } from './ui';

export type SortKey =
  | 'score' | 'ev' | 'evPct' | 'price' | 'topPrize' | 'topPct' | 'majorPct' | 'prizesPct' | 'valueRemaining' | 'odds' | 'profitOdds'
  | 'prizeRatio' | 'recent' | 'topRetention' | 'majorRetention' | 'topOdds' | 'majorOdds' | 'name';

export const SORTS: Record<SortKey, { label: string; get: (g: GameSummary) => number | string | null; asc?: boolean }> = {
  score: { label: 'Overall score', get: (g) => g.score.score },
  ev: { label: 'Expected value ($)', get: (g) => g.currentEvCents },
  evPct: { label: 'Expected return %', get: (g) => g.currentReturn },
  price: { label: 'Ticket price', get: (g) => g.priceCents, asc: true },
  topPrize: { label: 'Top prize', get: (g) => g.topPrize.headlineCents },
  topPct: { label: 'Top prize % remaining', get: (g) => g.topPrize.pctRemaining },
  topRetention: { label: 'Top-prize odds vs. launch', get: (g) => g.topRetention },
  majorPct: { label: 'Major prize % remaining', get: (g) => g.major.pctRemaining },
  majorRetention: { label: 'Major-prize odds vs. launch', get: (g) => g.majorRetention },
  prizesPct: { label: 'All prizes % remaining', get: (g) => g.allPrizes.pctRemaining },
  valueRemaining: { label: 'Prize value remaining', get: (g) => g.allPrizes.valueRemainingCents },
  odds: { label: 'Odds of any prize', get: (g) => g.currentOddsAnyOneIn, asc: true },
  profitOdds: { label: 'Odds of winning more than cost', get: (g) => g.currentOddsProfitOneIn, asc: true },
  topOdds: { label: 'Odds of top prize', get: (g) => g.currentOddsTopOneIn, asc: true },
  majorOdds: { label: 'Odds of major prize', get: (g) => g.currentOddsMajorOneIn, asc: true },
  prizeRatio: { label: 'Prize-to-ticket ratio', get: (g) => g.prizeToTicketRatio },
  recent: { label: 'Recently changed', get: (g) => g.lastChangeAt ?? null },
  name: { label: 'Name', get: (g) => g.name.toLowerCase(), asc: true },
};

export interface Column {
  key: string;
  header: ReactNode;
  sort?: SortKey;
  num?: boolean;
  cell: (g: GameSummary, i: number) => ReactNode;
  className?: string;
}

export const COLUMNS: Record<string, Column> = {
  rank: { key: 'rank', header: '#', sort: 'score', num: true, cell: (g) => (g.score.rank ? `#${g.score.rank}` : '—'), className: 'col-rank' },
  game: { key: 'game', header: 'Game', sort: 'name', cell: (g) => (<span className="game-cell"><Star gameId={g.gameId} name={g.name} /><GameLink g={g} /></span>), className: 'col-game' },
  price: { key: 'price', header: 'Price', sort: 'price', num: true, cell: (g) => formatMoney(g.priceCents) },
  topPrize: { key: 'topPrize', header: 'Top prize', sort: 'topPrize', num: true, cell: (g) => <span title={g.topPrize.kind === 'annuity' ? `Annuity; cash value ${formatMoney(g.topPrize.cashCents)}` : undefined}>{g.topPrize.label}</span> },
  topLeft: { key: 'topLeft', header: 'Top left', sort: 'topPct', num: true, cell: (g) => `${formatInt(g.topPrize.remaining)} / ${formatInt(g.topPrize.original)}` },
  topPct: { key: 'topPct', header: 'Top % left', sort: 'topPct', cell: (g) => <Meter value={g.topPrize.pctRemaining} marker={g.tickets.available ? g.tickets.remainingFraction : null} label="Top prizes remaining" /> },
  topRetention: { key: 'topRetention', header: 'Top odds vs. launch', sort: 'topRetention', num: true, cell: (g) => <Retention value={g.topRetention} /> },
  majorPct: { key: 'majorPct', header: 'Major % left', sort: 'majorPct', cell: (g) => (g.major.tierCount ? <Meter value={g.major.pctRemaining} marker={g.tickets.available ? g.tickets.remainingFraction : null} label="Major prizes remaining" /> : <span className="muted" title="No prizes at or above the major-prize threshold">none</span>) },
  majorLeft: { key: 'majorLeft', header: 'Major left', sort: 'majorPct', num: true, cell: (g) => (g.major.tierCount ? `${formatInt(g.major.remaining)} / ${formatInt(g.major.original)}` : '—') },
  prizesPct: { key: 'prizesPct', header: 'All prizes % left', sort: 'prizesPct', cell: (g) => <Meter value={g.allPrizes.pctRemaining} label="All prizes remaining" /> },
  ev: { key: 'ev', header: <>EV <small>est.</small></>, sort: 'ev', num: true, cell: (g) => formatMoney(g.currentEvCents == null ? null : Math.round(g.currentEvCents), { decimals: true }) },
  evPct: { key: 'evPct', header: <>Return <small>est.</small></>, sort: 'evPct', num: true, cell: (g) => formatPct(g.currentReturn) },
  value: { key: 'value', header: 'Prize $ left', sort: 'valueRemaining', num: true, cell: (g) => formatMoney(g.allPrizes.valueRemainingCents, { compact: true }) },
  odds: { key: 'odds', header: <>Any prize <small>est.</small></>, sort: 'odds', num: true, cell: (g) => formatOdds(g.currentOddsAnyOneIn) },
  profitOdds: { key: 'profitOdds', header: <>Win &gt; cost <small>est.</small></>, sort: 'profitOdds', num: true, cell: (g) => formatOdds(g.currentOddsProfitOneIn) },
  topOdds: { key: 'topOdds', header: <>Top prize odds <small>est.</small></>, sort: 'topOdds', num: true, cell: (g) => (g.topPrize.remaining === 0 ? <span className="muted">none left</span> : formatOdds(g.currentOddsTopOneIn)) },
  majorOdds: { key: 'majorOdds', header: <>Major odds <small>est.</small></>, sort: 'majorOdds', num: true, cell: (g) => (g.major.tierCount ? formatOdds(g.currentOddsMajorOneIn) : '—') },
  ratio: { key: 'ratio', header: 'Prize ÷ price', sort: 'prizeRatio', num: true, cell: (g) => formatInt(g.prizeToTicketRatio) },
  jackpotValue: { key: 'jackpotValue', header: 'Top prize $ left', num: true, cell: (g) => formatMoney(g.topPrize.remaining * g.topPrize.headlineCents, { compact: true }) },
  score: { key: 'score', header: 'Score', sort: 'score', num: true, cell: (g) => <ScoreBadge score={g.score.score} label={g.score.label} /> },
  why: { key: 'why', header: 'Why', cell: (g) => <span className="why">{(g.score.label === 'weak' ? g.explanation.weaknesses : g.explanation.strengths)[0] ?? ''}</span>, className: 'col-why' },
};

export function sortGames(games: GameSummary[], key: SortKey, dir: 'asc' | 'desc'): GameSummary[] {
  const get = SORTS[key].get;
  return [...games].sort((a, b) => {
    const va = get(a), vb = get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulls always last
    if (vb == null) return -1;
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return dir === 'asc' ? c : -c;
  });
}

export function RankingTable({
  games, columns, initialSort = 'score', initialDir, caption, emptyText = 'No games match these filters.',
}: { games: GameSummary[]; columns: string[]; initialSort?: SortKey; initialDir?: 'asc' | 'desc'; caption?: string; emptyText?: string }) {
  const [sort, setSort] = useState<SortKey>(initialSort);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir ?? (SORTS[initialSort].asc ? 'asc' : 'desc'));
  const sorted = useMemo(() => sortGames(games, sort, dir), [games, sort, dir]);
  const cols = columns.map((c) => COLUMNS[c]).filter(Boolean);
  const onSort = (k: SortKey) => {
    if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(k);
      setDir(SORTS[k].asc ? 'asc' : 'desc');
    }
  };
  return (
    <div className="table-scroll" tabIndex={0} aria-label={caption ?? 'Ranking table'}>
      <table className="rank-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={`${c.num ? 'num' : ''} ${c.className ?? ''}`} aria-sort={c.sort === sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} scope="col">
                {c.sort ? (
                  <button type="button" className="th-sort" onClick={() => onSort(c.sort!)}>
                    {c.header}
                    <span aria-hidden="true" className="sort-ind">{c.sort === sort ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="empty">{emptyText}</td>
            </tr>
          )}
          {sorted.map((g, i) => (
            <tr key={g.gameId} data-testid="game-row">
              {cols.map((c) => (
                <td key={c.key} className={`${c.num ? 'num' : ''} ${c.className ?? ''}`}>{c.cell(g, i)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
