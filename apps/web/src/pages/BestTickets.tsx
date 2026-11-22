import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, formatPct, formatInt } from '@nj/lottery-data/format';
import type { GameSummary } from '../api';
import { useGames } from '../data';
import { ErrorBox, Est, GameLink, Loading, ScoreBadge, Star, relativeTime, dateTime } from '../components/ui';
import { RankingTable, sortGames, type SortKey } from '../components/RankingTable';
import { WeightsPanel } from '../components/WeightsPanel';

const VIEWS: Array<{ key: SortKey; label: string; columns: string[]; blurb: string }> = [
  { key: 'score', label: 'Overall score', columns: ['rank', 'game', 'price', 'topPrize', 'topPct', 'majorPct', 'evPct', 'score'], blurb: 'Composite of estimated return, top/major prize availability vs. sales, profit odds and prize value left.' },
  { key: 'evPct', label: 'Best expected value', columns: ['game', 'price', 'ev', 'evPct', 'profitOdds', 'score'], blurb: 'Estimated expected return per $1 for a ticket bought now. Every game returns less than it costs on average.' },
  { key: 'topRetention', label: 'Jackpot availability', columns: ['game', 'price', 'topPrize', 'topLeft', 'topPct', 'topRetention', 'score'], blurb: 'Top prizes left compared with the share of tickets left. ↑ means top prizes are over-represented in unsold tickets.' },
  { key: 'majorRetention', label: 'Major-prize availability', columns: ['game', 'price', 'majorLeft', 'majorPct', 'majorRetention', 'score'], blurb: 'Prizes at or above the major threshold, compared with the share of tickets left.' },
  { key: 'evPct', label: 'Value per dollar', columns: ['game', 'price', 'evPct', 'value', 'ratio', 'score'], blurb: 'Estimated return per dollar alongside total prize money left and prize-to-ticket ratio.' },
];

function SummaryCard({ icon, label, value, sub, to }: { icon: string; label: string; value: React.ReactNode; sub?: React.ReactNode; to?: string }) {
  const inner = (
    <>
      <span className="card-icon" aria-hidden="true">{icon}</span>
      <span className="card-label">{label}</span>
      <span className="card-value">{value}</span>
      {sub && <span className="card-sub">{sub}</span>}
    </>
  );
  return to ? <Link to={to} className="summary-card">{inner}</Link> : <div className="summary-card">{inner}</div>;
}

export function TopPick({ g, place }: { g: GameSummary; place: number }) {
  return (
    <article className="top-pick">
      <header>
        <span className="place">#{place}</span>
        <div className="pick-title">
          <GameLink g={g} />
          <span className="muted small">{formatMoney(g.priceCents)} ticket · top prize {g.topPrize.label}</span>
        </div>
        <Star gameId={g.gameId} name={g.name} />
        <ScoreBadge score={g.score.score} label={g.score.label} />
      </header>
      <dl className="pick-stats">
        <div><dt>Top prizes left</dt><dd>{formatInt(g.topPrize.remaining)} of {formatInt(g.topPrize.original)}</dd></div>
        <div><dt>Major % left</dt><dd>{g.major.tierCount ? formatPct(g.major.pctRemaining, 0) : '—'}</dd></div>
        <div><dt>Return <Est /></dt><dd>{formatPct(g.currentReturn)}</dd></div>
        <div><dt>Tickets left <Est /></dt><dd>{g.tickets.available ? formatPct(g.tickets.remainingFraction, 0) : '—'}</dd></div>
      </dl>
      <p className="why-title">{g.explanation.emoji} {g.explanation.headline}: why it ranks highly</p>
      <ul className="why-list">
        {g.explanation.strengths.slice(0, 3).map((s) => <li key={s}>{s}</li>)}
      </ul>
    </article>
  );
}

export function BestTickets() {
  const { games, status, loading, error } = useGames();
  const [view, setView] = useState(0);
  const v = VIEWS[view];
  const ranked = useMemo(() => games.filter((g) => g.score.score != null), [games]);
  const top3 = useMemo(() => sortGames(ranked, 'score', 'desc').slice(0, 3), [ranked]);
  if (error) return <ErrorBox error={error} />;
  if (loading) return <Loading what="active games" />;
  if (!games.length) return <div className="panel">No data loaded yet. Use <strong>Refresh data</strong> above to fetch the official NJ Lottery data.</div>;

  const bestEv = sortGames(ranked, 'evPct', 'desc')[0];
  const bestTop = sortGames(ranked.filter((g) => g.topPrize.remaining > 0 && g.topPrize.headlineCents >= 10_000_000), 'topRetention', 'desc')[0];
  const bestScore = top3[0];

  return (
    <>
      <h2 className="page-title">Best Current Tickets</h2>
      <div className="summary-cards">
        <SummaryCard icon="🎟" label="Active games" value={games.length} sub={`${ranked.length} ranked`} to="/all" />
        <SummaryCard icon="💰" label="Best est. return" value={formatPct(bestEv?.currentReturn)} sub={bestEv && <>{bestEv.name} · {formatMoney(bestEv.priceCents)}</>} to={bestEv && `/game/${bestEv.gameId}`} />
        <SummaryCard icon="🏆" label="Best jackpot availability ($100K+)" value={bestTop ? `${formatInt(bestTop.topPrize.remaining)}/${formatInt(bestTop.topPrize.original)} left` : '—'}
          sub={bestTop && <>{bestTop.name} · odds {bestTop.topRetention?.toFixed(1)}× launch</>} to={bestTop && `/game/${bestTop.gameId}`} />
        <SummaryCard icon="📈" label="Best overall score" value={bestScore?.score.score?.toFixed(0) ?? '—'} sub={bestScore && <>{bestScore.name} · {formatMoney(bestScore.priceCents)}</>} to={bestScore && `/game/${bestScore.gameId}`} />
        <SummaryCard icon="🔄" label="Last data update" value={relativeTime(status?.lastVerifiedAt, status?.now)} sub={<>counts as of {dateTime(status?.dataAsOf)}</>} to="/data" />
      </div>

      <section aria-labelledby="picks-h">
        <h3 id="picks-h" className="section-title">Currently ranking highest</h3>
        <div className="top-picks">{top3.map((g, i) => <TopPick key={g.gameId} g={g} place={i + 1} />)}</div>
      </section>

      <WeightsPanel />

      <section aria-labelledby="rank-h" className="panel">
        <div className="section-head">
          <h3 id="rank-h" className="section-title">Rankings</h3>
          <div className="tabs" role="tablist" aria-label="Rank by">
            {VIEWS.map((x, i) => (
              <button key={x.label} role="tab" aria-selected={i === view} className={`tab ${i === view ? 'on' : ''}`} onClick={() => setView(i)} type="button">{x.label}</button>
            ))}
          </div>
        </div>
        <p className="muted small">{v.blurb}</p>
        <RankingTable key={v.label} games={ranked} columns={v.columns} initialSort={v.key} caption={`Ranked by ${v.label}`} />
        <p className="small"><Link to="/all">Filter and sort all games →</Link></p>
      </section>
    </>
  );
}
