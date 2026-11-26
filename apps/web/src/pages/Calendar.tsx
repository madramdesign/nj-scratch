import { Link } from 'react-router-dom';
import { formatInt, formatMoney, formatOdds, formatPct } from '@nj/lottery-data/format';
import { useApi, type Calendar as CalendarData } from '../api';
import { dateOnly, ErrorBox, Loading } from '../components/ui';

const official = (id: string) => `https://www.njlottery.com/en-us/scratch-offs/${id.padStart(5, '0')}.html`;
const inDays = (d: number) => (d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${formatInt(d)} days`);

export function CalendarPage() {
  const { data, error, loading } = useApi<CalendarData & { now: number }>('/api/calendar');
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading what="calendar" />;
  if (!data) return null;
  const ending = data.salesEnding.slice(0, 10);
  const deadlines = data.claimDeadlines.filter((g) => g.daysLeft >= 0).slice(0, 20);
  return (
    <>
      <h2 className="page-title">Launches & Deadlines</h2>
      <p className="lede">
        New games NJ has announced, the games that stop selling next, and the last day to claim prizes on games that are no longer sold. Dates follow the same rules as
        njlottery.com: sales stop one year before a game’s closing date, and prizes can be claimed until that date. Claim deadlines aren’t printed on tickets, so check
        old tickets before then.
      </p>

      <section className="panel" aria-labelledby="up-h">
        <h3 id="up-h" className="section-title">Coming soon</h3>
        {data.upcoming.length === 0 ? (
          <p className="muted">No announced games with a future launch date in the latest data.</p>
        ) : (
          <div className="table-scroll" tabIndex={0}>
            <table className="rank-table">
              <thead>
                <tr>
                  <th scope="col" className="col-game">Game</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col">Launches</th>
                  <th scope="col">Top prize</th>
                  <th scope="col" className="num" title="Expected return per $1 at launch, from the official print run (exact).">Return at launch</th>
                  <th scope="col" className="num">Odds (any prize)</th>
                </tr>
              </thead>
              <tbody>
                {data.upcoming.map((g) => (
                  <tr key={g.gameId}>
                    <td className="col-game">
                      <a className="game-link" href={official(g.gameId)} target="_blank" rel="noreferrer">
                        <span className="game-name">{g.name}</span>
                        <span className="game-num">#{g.gameNumber} ↗</span>
                      </a>
                    </td>
                    <td className="num">{formatMoney(g.priceCents)}</td>
                    <td><time>{dateOnly(g.launchDate)}</time> <span className="muted small">({inDays(Math.ceil((g.launchDate - data.now) / 86_400_000))})</span></td>
                    <td>{formatInt(g.topPrizeOriginal)} × {g.topPrizeLabel}</td>
                    <td className="num">{formatPct(g.launchReturn)}</td>
                    <td className="num">{formatOdds(g.oddsAnyOneIn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="end-h">
        <h3 id="end-h" className="section-title">Next to stop selling</h3>
        <div className="table-scroll" tabIndex={0}>
          <table className="rank-table">
            <thead>
              <tr>
                <th scope="col" className="col-game">Game</th>
                <th scope="col" className="num">Price</th>
                <th scope="col">Sales end</th>
                <th scope="col" className="num">Top prizes left</th>
              </tr>
            </thead>
            <tbody>
              {ending.map((g) => (
                <tr key={g.gameId}>
                  <td className="col-game">
                    <Link to={`/game/${g.gameId}`} className="game-link"><span className="game-name">{g.name}</span><span className="game-num">#{g.gameNumber}</span></Link>
                  </td>
                  <td className="num">{formatMoney(g.priceCents)}</td>
                  <td><time>{dateOnly(g.salesEndDate)}</time> <span className="muted small">({inDays(g.daysLeft)})</span></td>
                  <td className="num">{formatInt(g.topPrizeRemaining)} of {formatInt(g.topPrizeOriginal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="claim-h">
        <h3 id="claim-h" className="section-title">Last day to claim prizes</h3>
        <p className="muted small">
          Games that are no longer sold. “Not yet claimed” counts include prizes that were never sold, so they don’t mean a winning ticket is out there.
        </p>
        {deadlines.length === 0 ? (
          <p className="muted">No ended games with an upcoming claim deadline in the latest data.</p>
        ) : (
          <div className="table-scroll" tabIndex={0}>
            <table className="rank-table">
              <thead>
                <tr>
                  <th scope="col" className="col-game">Game</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col">Sales ended</th>
                  <th scope="col">Last day to claim</th>
                  <th scope="col" className="num">Top prizes not yet claimed</th>
                </tr>
              </thead>
              <tbody>
                {deadlines.map((g) => (
                  <tr key={g.gameId}>
                    <td className="col-game">
                      <a className="game-link" href={official(g.gameId)} target="_blank" rel="noreferrer">
                        <span className="game-name">{g.name}</span>
                        <span className="game-num">#{g.gameNumber} ↗</span>
                      </a>
                    </td>
                    <td className="num">{formatMoney(g.priceCents)}</td>
                    <td>{dateOnly(g.salesEndedOn)}</td>
                    <td><time>{dateOnly(g.lastDayToClaim)}</time> <span className="muted small">({inDays(g.daysLeft)})</span></td>
                    <td className="num">{formatInt(g.topPrizeRemaining)} of {formatInt(g.topPrizeOriginal)} ({g.topPrizeLabel})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
