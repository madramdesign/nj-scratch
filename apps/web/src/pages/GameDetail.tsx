import { Link, useParams } from 'react-router-dom';
import { formatMoney, formatOdds, formatPct, formatInt } from '@nj/lottery-data/format';
import { useApi, type GameDetailResponse, type HistoryPoint } from '../api';
import { useSettings } from '../settings';
import { dateOnly, ErrorBox, Est, Loading, Retention, ScoreBadge, Star } from '../components/ui';
import { HistoryChart, PrizeDistributionChart, fmtMoneyCompact } from '../components/Charts';
import { SessionOdds } from '../components/SessionOdds';
import { Alternatives } from '../components/Alternatives';

function Stat({ label, value, est, sub }: { label: string; value: React.ReactNode; est?: boolean; sub?: React.ReactNode }) {
  return (
    <div className="stat">
      <dt>{label} {est && <Est />}</dt>
      <dd>{value}</dd>
      {sub && <dd className="stat-sub">{sub}</dd>}
    </div>
  );
}

function History({ id }: { id: string }) {
  const { data, error } = useApi<{ points: HistoryPoint[] }>(`/api/games/${id}/history`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading what="history" />;
  const pts = data.points;
  if (pts.length < 2) {
    return <p className="muted">History tracking has only {pts.length} snapshot for this game so far. Charts appear once the official data changes (checked every few hours).</p>;
  }
  const first = pts[0], last = pts[pts.length - 1];
  const archived = pts.filter((p) => p.source_key === 'internet-archive').length;
  return (
    <>
      <p className="muted small">
        {pts.length} snapshots from {dateOnly(first.observed_at)} to {dateOnly(last.observed_at)}.
        {archived > 0 && ` ${archived} come from Internet Archive captures of the official NJ Lottery API (backfill); the rest were collected by this app.`}
        {first.score != null && last.score != null && ` Score moved ${first.score.toFixed(0)} → ${last.score.toFixed(0)} over this period.`}
      </p>
      <div className="history-grid">
        <HistoryChart points={pts} title="Top prizes remaining" series={[{ key: 'top_remaining', name: 'Top prizes remaining' }]} fmt={(v) => formatInt(v)} yDomain={[0, 'auto']} integer />
        <HistoryChart points={pts} title={`Major prizes remaining (score threshold)`} series={[{ key: 'major_remaining', name: 'Major prizes remaining' }]} fmt={(v) => formatInt(v)} yDomain={[0, 'auto']} integer />
        <HistoryChart points={pts} title="Prize value remaining" series={[{ key: 'value_remaining_cents', name: 'Prize value remaining' }]} fmt={fmtMoneyCompact} yDomain={[0, 'auto']} />
        <HistoryChart points={pts} title="Overall score (default weights)" series={[{ key: 'score', name: 'Score' }]} fmt={(v) => v.toFixed(0)} yDomain={[0, 100]} />
        <HistoryChart
          points={pts}
          title="Estimated return vs. at launch"
          series={[{ key: 'current_return', name: 'Current (est.)' }, { key: 'original_return', name: 'At launch' }]}
          fmt={(v) => formatPct(v, 0)}
        />
      </div>
    </>
  );
}

export function GameDetailPage() {
  const { id = '' } = useParams();
  const { query } = useSettings();
  const { data, error, loading } = useApi<GameDetailResponse>(`/api/games/${id}${query}`);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading what="game" />;
  if (!data) return null;
  const g = data.game;
  const n = data.normalized;
  if (!g) {
    return (
      <div className="panel">
        <h2>{n?.name ?? `Game ${id}`}</h2>
        <p>{data.notRankedReason}</p>
        {data.issues.map((i) => <p key={i.code + i.message} className="issue">{i.severity}: {i.message}</p>)}
        <a href={data.officialUrl} target="_blank" rel="noreferrer">View on njlottery.com ↗</a>
      </div>
    );
  }
  const t = g.tickets;
  return (
    <article className="detail">
      <p className="breadcrumb"><Link to="/">← Best tickets</Link></p>
      <header className="detail-head">
        <div>
          <h2 className="page-title">
            {g.name} <Star gameId={g.gameId} name={g.name} />
          </h2>
          <p className="muted">
            Game #{g.gameNumber} · {formatMoney(g.priceCents)} ticket · Top prize {g.topPrize.label}
            {g.topPrize.kind === 'annuity' && <> (cash value {formatMoney(g.topPrize.cashCents)})</>} · Launched {dateOnly(g.launchDate)} ·{' '}
            <a href={data.officialUrl} target="_blank" rel="noreferrer">Official page ↗</a>
          </p>
        </div>
        <ScoreBadge score={g.score.score} label={g.score.label} size="lg" />
      </header>

      <section className={`recommendation rec-${g.score.label}`} aria-label="Assessment">
        <p className="rec-headline">{g.explanation.emoji} {g.explanation.headline}</p>
        <p className="muted small">
          Ranks #{g.score.rank} of all active games{g.score.rankInPrice ? ` and #${g.score.rankInPrice} of ${g.score.peersInPrice} ${formatMoney(g.priceCents)} games` : ''}. This describes the
          remaining official prize data relative to other games. It is not a prediction that a ticket will win.
        </p>
        <div className="why-cols">
          {g.explanation.strengths.length > 0 && (
            <div>
              <h4>Why this ranks highly</h4>
              <ul className="why-list">{g.explanation.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
          {g.explanation.weaknesses.length > 0 && (
            <div>
              <h4>Why this ranks poorly</h4>
              <ul className="why-list">{g.explanation.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
        </div>
        {g.warnings.length > 0 && (
          <ul className="warnings">{g.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>
        )}
      </section>

      <Alternatives game={g} />

      <section className="panel">
        <h3 className="section-title">Key numbers</h3>
        <dl className="stats-grid">
          <Stat label="Top prizes remaining" value={`${formatInt(g.topPrize.remaining)} of ${formatInt(g.topPrize.original)}`} sub={formatPct(g.topPrize.pctRemaining)} />
          <Stat label={`Major prizes (${formatMoney(g.major.thresholdCents, { compact: true })}+) remaining`} value={g.major.tierCount ? `${formatInt(g.major.remaining)} of ${formatInt(g.major.original)}` : 'none in game'} sub={g.major.tierCount ? formatPct(g.major.pctRemaining) : undefined} />
          <Stat label="All prizes remaining" value={`${formatInt(g.allPrizes.remaining)} of ${formatInt(g.allPrizes.original)}`} sub={formatPct(g.allPrizes.pctRemaining)} />
          <Stat label="Prize value remaining" value={formatMoney(g.allPrizes.valueRemainingCents, { compact: true })} sub={`of ${formatMoney(g.allPrizes.valueOriginalCents, { compact: true })} (${formatPct(g.allPrizes.valueOriginalCents ? g.allPrizes.valueRemainingCents / g.allPrizes.valueOriginalCents : null)})`} />
          <Stat label="Tickets printed" value={formatInt(g.totalTicketsPrinted)} sub="official" />
          <Stat label="Tickets remaining" est value={t.available ? `~${formatInt(t.ticketsRemaining)}` : 'Insufficient data'} sub={t.available ? `${formatPct(t.remainingFraction, 0)} of print run${t.confidence === 'low' ? ' · low confidence' : ''}` : t.reason} />
          <Stat label="Top-prize odds vs. launch" est value={<Retention value={g.topRetention} />} sub={`now ${g.topPrize.remaining ? formatOdds(g.currentOddsTopOneIn) : 'none left'} · launch ${formatOdds(g.originalOddsTopOneIn)}`} />
          <Stat label="Major-prize odds vs. launch" est value={<Retention value={g.majorRetention} />} sub={g.major.tierCount ? `now ${formatOdds(g.currentOddsMajorOneIn)}` : undefined} />
          <Stat label="Odds of any prize" est value={formatOdds(g.currentOddsAnyOneIn)} sub={`at launch ${formatOdds(g.originalOddsAnyOneIn)} (official counts)`} />
          <Stat label="Odds of winning more than cost" est value={formatOdds(g.currentOddsProfitOneIn)} sub={`at launch ${formatOdds(g.originalOddsProfitOneIn)}`} />
          <Stat label="Prize-to-ticket ratio" value={formatInt(g.prizeToTicketRatio)} sub="prize $ remaining ÷ ticket price" />
        </dl>
      </section>

      <section className="panel breakeven" aria-labelledby="be-h">
        <h3 id="be-h" className="section-title">Break-even analysis <Est /></h3>
        <dl className="stats-grid">
          <Stat label="Ticket price" value={formatMoney(g.priceCents, { decimals: true })} />
          <Stat label="Expected value" est value={formatMoney(g.currentEvCents == null ? null : Math.round(g.currentEvCents), { decimals: true })} sub={`at launch: ${formatMoney(g.originalEvCents == null ? null : Math.round(g.originalEvCents), { decimals: true })} (exact, from official counts)`} />
          <Stat label="Expected return" est value={formatPct(g.currentReturn)} sub={`${formatPct(g.currentReturn)} of the ticket price recovered on average`} />
          <Stat label="Expected loss per ticket" est value={formatMoney(g.expectedLossCents == null ? null : Math.round(g.expectedLossCents), { decimals: true })} />
        </dl>
        <p className="muted small">
          Mathematical averages over the estimated remaining tickets, not a guarantee. Free-ticket prizes are valued as another play of the same game; annuity prizes use NJ’s
          published cash value. Prizes won but not yet claimed still count as “remaining”, which can overstate EV.
        </p>
      </section>

      <SessionOdds g={g} />

      <section className="panel" aria-labelledby="pt-h">
        <h3 id="pt-h" className="section-title">Prize table</h3>
        <div className="table-scroll" tabIndex={0}>
          <table className="prize-table">
            <thead>
              <tr>
                <th scope="col">Prize</th>
                <th scope="col" className="num">Original</th>
                <th scope="col" className="num">Remaining</th>
                <th scope="col" className="num">Claimed</th>
                <th scope="col" className="num">% Remaining</th>
                <th scope="col" className="num">Value remaining</th>
                <th scope="col" className="num">Odds now <small>est.</small></th>
                <th scope="col" className="num">Odds at launch</th>
              </tr>
            </thead>
            <tbody>
              {g.tiers.map((tier) => (
                <tr key={tier.tierNumber} className={tier.isTop ? 'top-tier' : tier.isMajor ? 'major-tier' : ''}>
                  <th scope="row">
                    {tier.description}
                    {tier.isTop && <span className="tag">top</span>}
                    {!tier.isTop && tier.isMajor && <span className="tag">major</span>}
                    {tier.kind === 'annuity' && <span className="tag" title={`Cash value ${formatMoney(tier.prizeCents)}`}>annuity</span>}
                    {tier.kind === 'free_ticket' && <span className="tag">free ticket</span>}
                  </th>
                  <td className="num">{formatInt(tier.original)}</td>
                  <td className="num"><strong>{formatInt(tier.remaining)}</strong></td>
                  <td className="num">{formatInt(tier.claimedCount)}</td>
                  <td className="num">{formatPct(tier.pctRemaining)}</td>
                  <td className="num">{formatMoney(tier.valueRemainingCents, { compact: true })}</td>
                  <td className="num">{formatOdds(tier.currentOddsOneIn)}</td>
                  <td className="num">{formatOdds(tier.originalOddsOneIn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Remaining counts use NJ Lottery’s own formula: prizes of $600+ subtract claim-center claims; smaller prizes subtract paid tickets. Source: official NJ Lottery API (see the status bar for the as-of time).
        </p>
        <PrizeDistributionChart tiers={g.tiers} />
      </section>

      <section className="panel" aria-labelledby="score-h">
        <h3 id="score-h" className="section-title">Score breakdown</h3>
        <div className="table-scroll" tabIndex={0}>
          <table className="score-table">
            <thead>
              <tr><th scope="col">Component</th><th scope="col" className="num">Value</th><th scope="col" className="num">Percentile among active games</th><th scope="col" className="num">Weight</th><th scope="col" className="num">Points</th></tr>
            </thead>
            <tbody>
              {g.score.components.map((c) => (
                <tr key={c.key}>
                  <th scope="row">{c.label}</th>
                  <td className="num">{c.rawFormatted}</td>
                  <td className="num">{c.percentile == null ? 'n/a' : c.percentile.toFixed(0)}</td>
                  <td className="num">{formatPct(c.effectiveWeight, 0)}</td>
                  <td className="num">{c.contribution.toFixed(1)}</td>
                </tr>
              ))}
              <tr className="total"><th scope="row">Overall score</th><td /><td /><td /><td className="num"><strong>{g.score.score?.toFixed(1) ?? '—'}</strong></td></tr>
            </tbody>
          </table>
        </div>
        {g.score.notes.map((note) => <p key={note} className="muted small">{note}</p>)}
        {t.available && <p className="muted small">Tickets-remaining estimate: {t.note}</p>}
      </section>

      <section className="panel" aria-labelledby="hist-h">
        <h3 id="hist-h" className="section-title">History</h3>
        <History id={g.gameId} />
      </section>

      <section className="panel" aria-labelledby="chg-h">
        <h3 id="chg-h" className="section-title">Changes detected</h3>
        {data.events.length === 0 ? (
          <p className="muted">No changes recorded yet.</p>
        ) : (
          <ul className="event-list">
            {data.events.slice(0, 40).map((e) => (
              <li key={e.id} className={`event event-${e.severity}`}>
                <time>{dateOnly(e.observed_at)}</time> <span>{e.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
