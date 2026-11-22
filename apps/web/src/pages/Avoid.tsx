import { useMemo } from 'react';
import { formatMoney, formatPct, formatInt } from '@nj/lottery-data/format';
import { useGames } from '../data';
import { ErrorBox, Est, GameLink, Loading, ScoreBadge, Star } from '../components/ui';
import { sortGames } from '../components/RankingTable';

export function Avoid() {
  const { games, loading, error } = useGames();
  const worst = useMemo(() => sortGames(games.filter((g) => g.score.score != null), 'score', 'asc').slice(0, 12), [games]);
  if (error) return <ErrorBox error={error} />;
  if (loading) return <Loading />;
  return (
    <>
      <h2 className="page-title">Tickets to Avoid</h2>
      <p className="lede">The weakest current remaining-prize profiles among active games, and the data behind each ranking.</p>
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
          </article>
        ))}
      </div>
    </>
  );
}
