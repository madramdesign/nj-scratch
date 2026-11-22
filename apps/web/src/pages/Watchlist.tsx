import { Link } from 'react-router-dom';
import { formatMoney, formatInt } from '@nj/lottery-data/format';
import { useApi, type ChangeEventRow, type WatchItem } from '../api';
import { useSettings } from '../settings';
import { useWatchlist } from '../watchlist';
import { dateOnly, ErrorBox, GameLink, Loading, ScoreBadge, Star } from '../components/ui';

function Delta({ curr, prev }: { curr: number | null | undefined; prev: number | null | undefined }) {
  if (curr == null || prev == null) return <span className="muted">—</span>;
  const d = curr - prev;
  const dir = Math.abs(d) < 0.5 ? 'flat' : d > 0 ? 'up' : 'down';
  return <span className={`delta delta-${dir}`}>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→'} {d > 0 ? '+' : ''}{d.toFixed(1)}</span>;
}

export function Watchlist() {
  const { query } = useSettings();
  const { ids } = useWatchlist();
  const { data, error, loading } = useApi<{ items: WatchItem[]; alerts: ChangeEventRow[] }>(`/api/watchlist${query}${query ? '&' : '?'}v=${[...ids].sort().join(',')}`);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading what="watchlist" />;
  const items = data?.items ?? [];
  return (
    <>
      <h2 className="page-title">★ Watchlist</h2>
      <p className="lede">Track games with the ☆ star anywhere in the app. Your watchlist is saved in this browser. Alerts list notable changes (top or major prizes claimed, score moves of 5+ points, profile changes) detected in the official data.</p>
      {items.length === 0 ? (
        <div className="panel">No games tracked yet. Star a game from <Link to="/">Best Tickets</Link> or any table.</div>
      ) : (
        <div className="table-scroll" tabIndex={0}>
          <table className="rank-table">
            <thead>
              <tr>
                <th scope="col">Game</th>
                <th scope="col" className="num">Price</th>
                <th scope="col" className="num">Score</th>
                <th scope="col" className="num">Previous</th>
                <th scope="col" className="num">Change</th>
                <th scope="col" className="num">Top left</th>
                <th scope="col" className="num">Major left</th>
                <th scope="col">Last change</th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => {
                const g = w.game;
                return (
                  <tr key={w.game_id}>
                    <td className="col-game">
                      <span className="game-cell"><Star gameId={w.game_id} name={g?.name ?? w.game_id} />{g ? <GameLink g={g} /> : <Link to={`/game/${w.game_id}`}>Game {w.game_id} (no longer active)</Link>}</span>
                    </td>
                    <td className="num">{g ? formatMoney(g.priceCents) : '—'}</td>
                    <td className="num">{g ? <ScoreBadge score={g.score.score} label={g.score.label} /> : '—'}</td>
                    <td className="num" title={w.previousObservedAt ? `Snapshot of ${dateOnly(w.previousObservedAt)}` : 'No earlier snapshot'}>{w.previousScore?.toFixed(0) ?? '—'}</td>
                    <td className="num"><Delta curr={g?.score.score} prev={w.previousScore} /></td>
                    <td className="num">{g ? `${formatInt(g.topPrize.remaining)} / ${formatInt(g.topPrize.original)}` : '—'}</td>
                    <td className="num">{g?.major.tierCount ? `${formatInt(g.major.remaining)} / ${formatInt(g.major.original)}` : '—'}</td>
                    <td>{w.events[0] ? <><time>{dateOnly(w.events[0].observed_at)}</time>: {w.events[0].message}</> : <span className="muted">none yet</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <section className="panel" aria-labelledby="alerts-h">
        <h3 id="alerts-h" className="section-title">Alerts for tracked games</h3>
        {!data?.alerts.length ? (
          <p className="muted">No alerts yet. Alerts appear when an update detects a top or major prize claim or a significant score change.</p>
        ) : (
          <ul className="event-list">
            {data.alerts.map((e) => (
              <li key={e.id} className={`event event-${e.severity}`}>
                <time>{dateOnly(e.observed_at)}</time> <Link to={`/game/${e.game_id}`}>{e.game_name}</Link>: {e.message}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Browser/email notifications aren’t implemented yet; alerts are recorded on every update and shown here.</p>
      </section>
    </>
  );
}
