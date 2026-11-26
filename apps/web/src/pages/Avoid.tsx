import { useMemo } from 'react';
import { formatMoney, formatPct, formatInt } from '@nj/lottery-data/format';
import { useApi, type ChangeEventRow, type GameSummary } from '../api';
import { useGames } from '../data';
import { dateOnly, ErrorBox, Est, GameLink, Loading, ScoreBadge, Star } from '../components/ui';
import { sortGames } from '../components/RankingTable';
import { Alternatives } from '../components/Alternatives';

/** Games still on sale whose top prizes are all claimed, with when that was first seen in the data. */
function TopPrizesGone({ games }: { games: GameSummary[] }) {
  const { data } = useApi<{ events: ChangeEventRow[] }>('/api/changes?notable=1&limit=5000');
  const soldOutSeen = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data?.events ?? []) {
      if (e.kind !== 'top_prize_sold_out') continue;
      if (e.observed_at > (m.get(e.game_id) ?? 0)) m.set(e.game_id, e.observed_at);
    }
    return m;
  }, [data]);
  const gone = useMemo(() => games.filter((g) => g.topPrize.original > 0 && g.topPrize.remaining === 0).sort((a, b) => a.priceCents - b.priceCents), [games]);
  return (
    <section className="panel" aria-labelledby="gone-h">
      <h3 id="gone-h" className="section-title">Top prizes gone, still on sale</h3>
      {gone.length === 0 ? (
        <p className="muted">Every active game still has at least one top prize left.</p>
      ) : (
        <>
          <p className="muted small">
            These games are still sold, but every top prize has been claimed, so the advertised top prize can’t be won. {gone.length} of {games.length} active games.
          </p>
          <div className="table-scroll" tabIndex={0}>
            <table className="rank-table">
              <thead>
                <tr>
                  <th scope="col" className="col-game">Game</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col">Top prize</th>
                  <th scope="col" title="The first update in which no top prize was left. The last one was claimed between that update and the one before it.">First seen with none left</th>
                  <th scope="col" className="num">Tickets left <Est /></th>
                  <th scope="col" className="num">Return <Est /></th>
                </tr>
              </thead>
              <tbody>
                {gone.map((g) => (
                  <tr key={g.gameId}>
                    <td className="col-game"><span className="game-cell"><Star gameId={g.gameId} name={g.name} /><GameLink g={g} /></span></td>
                    <td className="num">{formatMoney(g.priceCents)}</td>
                    <td>{g.topPrize.label} <span className="muted small">(0 of {formatInt(g.topPrize.original)} left)</span></td>
                    <td>{soldOutSeen.has(g.gameId) ? dateOnly(soldOutSeen.get(g.gameId)) : <span className="muted">before tracking began</span>}</td>
                    <td className="num">{g.tickets.available ? formatInt(g.tickets.ticketsRemaining) : '—'}</td>
                    <td className="num">{formatPct(g.currentReturn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function Avoid() {
  const { games, loading, error } = useGames();
  const worst = useMemo(() => sortGames(games.filter((g) => g.score.score != null), 'score', 'asc').slice(0, 12), [games]);
  if (error) return <ErrorBox error={error} />;
  if (loading) return <Loading />;
  return (
    <>
      <h2 className="page-title">Tickets to Avoid</h2>
      <p className="lede">The weakest current remaining-prize profiles among active games, and the data behind each ranking.</p>
      <TopPrizesGone games={games} />
      <h3 className="section-title">Weakest profiles</h3>
      <div className="avoid-list">
        {worst.map((g) => (
          <article key={g.gameId} className="avoid-card">
            <header>
              <Star gameId={g.gameId} name={g.name} />
              <div className="pick-title">
                <GameLink g={g} />
                <span className="muted small">{formatMoney(g.priceCents)} · top prize {g.topPrize.label} · rank #{g.score.rank} of {games.length}</span>
              </div>
              <ScoreBadge score={g.score.score} label={g.score.label} />
            </header>
            {g.explanation.avoidReasons.length > 0 && (
              <ul className="reason-tags" aria-label="Reasons">
                {g.explanation.avoidReasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            <p className="why-title">Why this ranks poorly</p>
            <ul className="why-list">
              {(g.explanation.weaknesses.length ? g.explanation.weaknesses : ['Below other active games on most score components.']).map((w) => <li key={w}>{w}</li>)}
            </ul>
            <dl className="pick-stats">
              <div><dt>Top prizes left</dt><dd>{formatInt(g.topPrize.remaining)} of {formatInt(g.topPrize.original)}</dd></div>
              <div><dt>Major % left</dt><dd>{g.major.tierCount ? formatPct(g.major.pctRemaining, 0) : '—'}</dd></div>
              <div><dt>Return <Est /></dt><dd>{formatPct(g.currentReturn)}</dd></div>
              <div><dt>Expected loss <Est /></dt><dd>{formatMoney(g.expectedLossCents == null ? null : Math.round(g.expectedLossCents), { decimals: true })}</dd></div>
            </dl>
            <Alternatives game={g} compact />
          </article>
        ))}
      </div>
    </>
  );
}
