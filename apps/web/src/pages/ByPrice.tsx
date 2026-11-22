import { useMemo } from 'react';
import { formatMoney } from '@nj/lottery-data/format';
import { PRICE_POINTS_CENTS, useGames } from '../data';
import { ErrorBox, Loading } from '../components/ui';
import { RankingTable, sortGames } from '../components/RankingTable';
import { TopPick } from './BestTickets';

export function ByPrice() {
  const { games, loading, error } = useGames();
  const groups = useMemo(() => {
    const prices = [...new Set([...PRICE_POINTS_CENTS, ...games.map((g) => g.priceCents)])].sort((a, b) => a - b);
    return prices.map((p) => ({ price: p, games: sortGames(games.filter((g) => g.priceCents === p && g.score.score != null), 'score', 'desc') }));
  }, [games]);
  if (error) return <ErrorBox error={error} />;
  if (loading) return <Loading />;
  return (
    <>
      <h2 className="page-title">Best by Ticket Price</h2>
      <p className="lede">The strongest current remaining-prize profile at each price point. Scores are relative to <em>all</em> active games; the rank shown is within the price point.</p>
      <nav className="chips" aria-label="Jump to price">
        {groups.map((g) => (
          <a key={g.price} className={`chip ${g.games.length ? '' : 'disabled'}`} href={`#price-${g.price}`}>{formatMoney(g.price)} ({g.games.length})</a>
        ))}
      </nav>
      {groups.map(({ price, games: list }) => (
        <section key={price} id={`price-${price}`} className="panel price-group" aria-labelledby={`h-${price}`}>
          <h3 id={`h-${price}`} className="section-title">{formatMoney(price)} tickets</h3>
          {list.length === 0 ? (
            <p className="muted">No active {formatMoney(price)} games right now.</p>
          ) : (
            <>
              <p className="best-label">Best current {formatMoney(price)} ticket:</p>
              <TopPick g={list[0]} place={1} />
              {list.length > 1 && (
                <details>
                  <summary>All {list.length} {formatMoney(price)} games</summary>
                  <RankingTable games={list} columns={['game', 'topPrize', 'topPct', 'majorPct', 'evPct', 'profitOdds', 'score']} caption={`${formatMoney(price)} games`} />
                </details>
              )}
            </>
          )}
        </section>
      ))}
    </>
  );
}
