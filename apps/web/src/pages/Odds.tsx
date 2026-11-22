import { useState } from 'react';
import { useGames } from '../data';
import { ErrorBox, Loading } from '../components/ui';
import { RankingTable, type SortKey } from '../components/RankingTable';

const MODES: Array<{ key: SortKey; label: string }> = [
  { key: 'odds', label: 'Any prize' },
  { key: 'profitOdds', label: 'Win more than cost' },
  { key: 'majorOdds', label: 'Major prize' },
  { key: 'topOdds', label: 'Top prize' },
];

export function Odds() {
  const { games, loading, error } = useGames();
  const [mode, setMode] = useState<SortKey>('odds');
  if (error) return <ErrorBox error={error} />;
  if (loading) return <Loading />;
  return (
    <>
      <h2 className="page-title">Best Odds</h2>
      <div className="callout" role="note">
        <strong>“Winning a prize” is not the same as making money.</strong> Most prizes on the “any prize” list are free tickets or amounts equal to or less than the ticket price.
        Check <em>Win more than cost</em> for the odds of an actual profit on a single ticket. All current odds are estimates based on the estimated number of tickets remaining.
      </div>
      <div className="tabs" role="tablist" aria-label="Odds type">
        {MODES.map((m) => (
          <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} className={`tab ${mode === m.key ? 'on' : ''}`} onClick={() => setMode(m.key)}>{m.label}</button>
        ))}
      </div>
      <RankingTable key={mode} games={games} columns={['game', 'price', 'odds', 'profitOdds', 'majorOdds', 'topOdds', 'evPct', 'score']} initialSort={mode} caption="Odds ranking" />
    </>
  );
}
