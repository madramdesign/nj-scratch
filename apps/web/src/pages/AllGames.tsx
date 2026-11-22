import { useMemo, useState } from 'react';
import { useGames } from '../data';
import { ErrorBox, Loading } from '../components/ui';
import { RankingTable, type SortKey } from '../components/RankingTable';
import { applyFilters, EMPTY_FILTERS, FilterBar, type GameFilters } from '../components/Filters';
import { WeightsPanel } from '../components/WeightsPanel';

const COLS = ['rank', 'game', 'price', 'topPrize', 'topLeft', 'topPct', 'majorPct', 'prizesPct', 'ev', 'evPct', 'odds', 'value', 'ratio', 'score'];

export function AllGames() {
  const { games, loading, error } = useGames();
  const [filters, setFilters] = useState<GameFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>('score');
  const prices = useMemo(() => [...new Set(games.map((g) => g.priceCents))].sort((a, b) => a - b), [games]);
  const filtered = useMemo(() => applyFilters(games, filters), [games, filters]);
  if (error) return <ErrorBox error={error} />;
  if (loading) return <Loading />;
  return (
    <>
      <h2 className="page-title">All Active Games</h2>
      <p className="lede">Every active NJ scratch-off with full metrics. Click a column header or use Sort; click a game for its full prize table and history.</p>
      <WeightsPanel />
      <FilterBar filters={filters} setFilters={setFilters} prices={prices} sort={sort} setSort={setSort} count={filtered.length} total={games.length} />
      <RankingTable key={sort} games={filtered} columns={COLS} initialSort={sort} caption="All active games" />
    </>
  );
}
