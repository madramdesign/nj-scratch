import { useState } from 'react';
import { useGames } from '../data';
import { ErrorBox, Loading } from '../components/ui';
import { RankingTable, type SortKey } from '../components/RankingTable';

const MODES: Array<{ key: SortKey; label: string }> = [
  { key: 'prizesPct', label: 'All prizes % remaining' },
  { key: 'topPct', label: 'Top prize % remaining' },
  { key: 'majorPct', label: 'Major prize % remaining' },
];

export function RemainingPct() {
  const { games, loading, error } = useGames();
  const [mode, setMode] = useState<SortKey>('topPct');
  if (error) return <ErrorBox error={error} />;
  if (loading) return <Loading />;
  return (
    <>
      <h2 className="page-title">Best Remaining Prize Percentage</h2>
      <p className="lede">
        Raw percentages favor brand-new games, where almost everything is still unclaimed. Compare each bar with its marker, the estimated share of tickets still unsold. A
        bar that extends past the marker means those prizes are being claimed more slowly than tickets are selling.
      </p>
      <div className="tabs" role="tablist" aria-label="Percentage type">
        {MODES.map((m) => (
          <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} className={`tab ${mode === m.key ? 'on' : ''}`} onClick={() => setMode(m.key)}>{m.label}</button>
        ))}
      </div>
      <RankingTable key={mode} games={games} columns={['game', 'price', 'prizesPct', 'topLeft', 'topPct', 'majorLeft', 'majorPct', 'topRetention', 'score']} initialSort={mode} caption="Remaining percentage ranking" />
    </>
  );
}
