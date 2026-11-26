import { samePriceAlternatives } from '@nj/analytics';
import { formatMoney } from '@nj/lottery-data/format';
import type { GameSummary } from '../api';
import { useGames } from '../data';
import { GameLink, ScoreBadge } from './ui';

/** Other games at the same price that beat this one on both score and estimated return. */
export function Alternatives({ game, compact = false }: { game: Pick<GameSummary, 'gameId'>; compact?: boolean }) {
  const { games } = useGames();
  const target = games.find((g) => g.gameId === game.gameId);
  if (!target) return null;
  const alts = samePriceAlternatives(target, games);
  if (!alts.length) return null;
  if (compact) {
    return (
      <p className="small alt-inline">
        Same price, stronger profile: {alts.map((a, i) => <span key={a.game.gameId}>{i > 0 && ', '}<GameLink g={a.game} /></span>)}
      </p>
    );
  }
  return (
    <section className="panel alternatives" aria-labelledby="alt-h">
      <h3 id="alt-h" className="section-title">Other {formatMoney(target.priceCents)} games with a stronger profile</h3>
      <ul className="alt-list">
        {alts.map((a) => (
          <li key={a.game.gameId}>
            <ScoreBadge score={a.game.score.score} label={a.game.score.label} /> <GameLink g={a.game} />
            <span className="muted small"> {a.reasons.join('; ')}.</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Compared on current official data at the same ticket price. Every game still returns less than it costs on average.</p>
    </section>
  );
}
