import { useMemo, useState } from 'react';
import { formatMoney } from '@nj/lottery-data/format';
import { useGames } from '../data';
import { ErrorBox, Loading } from '../components/ui';
import { RankingTable } from '../components/RankingTable';

const MINIMUMS = [100_000, 250_000, 500_000, 1_000_000];

export function Jackpots() {
  const { games, loading, error } = useGames();
  const [min, setMin] = useState(100_000);
  const list = useMemo(() => games.filter((g) => g.topPrize.headlineCents >= min * 100), [games, min]);
  if (error) return <ErrorBox error={error} />;
  if (loading) return <Loading />;
  return (
    <>
      <h2 className="page-title">Jackpot Hunters</h2>
      <p className="lede">
        Games with large top prizes. A big jackpot alone isn’t a reason to rank a game highly. What matters is how many top prizes are <em>still unclaimed</em> compared with
        how many tickets are left. The bar marker shows the estimated share of tickets remaining: a bar past the marker means top prizes are over-represented in the unsold tickets.
      </p>
      <div className="chips" role="group" aria-label="Minimum top prize">
        {MINIMUMS.map((m) => (
          <button key={m} type="button" className={`chip ${m === min ? 'on' : ''}`} aria-pressed={m === min} onClick={() => setMin(m)}>
            {formatMoney(m * 100, { compact: true })}+ top prize
          </button>
        ))}
      </div>
      <RankingTable games={list} columns={['game', 'price', 'topPrize', 'topLeft', 'topPct', 'topRetention', 'jackpotValue', 'topOdds', 'score']} initialSort="topRetention" caption="Jackpot games" />
      <p className="muted small">
        Annuity top prizes (marked *) are shown at their advertised value; all expected-value math uses NJ Lottery’s published cash value. A top prize can be won and not yet
        claimed, so “remaining” may include prizes that are already in someone’s hands.
      </p>
    </>
  );
}
