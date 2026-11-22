import { Link } from 'react-router-dom';
import { useApi, type RunRow, type Status } from '../api';
import { dateTime, ErrorBox, Loading, relativeTime } from '../components/ui';

export function DataQuality() {
  const { data, error, loading } = useApi<{ status: Status; runs: RunRow[] }>('/api/updates');
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading what="update log" />;
  if (!data) return null;
  const s = data.status;
  const hours = s.dataAgeMs == null ? null : s.dataAgeMs / 3600_000;
  return (
    <>
      <h2 className="page-title">Data Quality</h2>
      {s.warnings.length > 0 && (
        <div className="callout warn" role="alert">
          {s.warnings.map((w) => <p key={w}>⚠ {w}</p>)}
        </div>
      )}
      <section className="panel">
        <dl className="stats-grid">
          <div className="stat"><dt>Data source</dt><dd><a href={s.source.page} target="_blank" rel="noreferrer">NJ Lottery (official)</a></dd><dd className="stat-sub"><code>{s.source.url}</code></dd></div>
          <div className="stat"><dt>Last successful update</dt><dd>{relativeTime(s.lastVerifiedAt, s.now)}</dd><dd className="stat-sub">{dateTime(s.lastVerifiedAt)}</dd></div>
          <div className="stat"><dt>Last attempted update</dt><dd>{relativeTime(s.lastAttempt?.at, s.now)}</dd><dd className="stat-sub">{s.lastAttempt ? `${s.lastAttempt.status} (${s.lastAttempt.trigger})` : '—'}</dd></div>
          <div className="stat"><dt>Data age</dt><dd>{hours == null ? '—' : hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} hours`}</dd><dd className="stat-sub">{s.isStale ? 'stale' : 'fresh'}</dd></div>
          <div className="stat"><dt>Prize counts as of</dt><dd>{dateTime(s.dataAsOf)}</dd><dd className="stat-sub">when NJ’s numbers last changed</dd></div>
          <div className="stat"><dt>Games retrieved</dt><dd>{s.gamesRetrieved}</dd><dd className="stat-sub">{s.activeGames} active · {s.rankedGames} ranked</dd></div>
          <div className="stat"><dt>Games with missing data</dt><dd>{s.gamesWithMissingData}</dd><dd className="stat-sub">{s.gamesInvalid} excluded as invalid</dd></div>
          <div className="stat"><dt>History stored</dt><dd>{s.history.historyPoints} snapshots</dd><dd className="stat-sub">{s.history.snapshots.toLocaleString()} game snapshots · {s.history.events.toLocaleString()} change events</dd></div>
        </dl>
        {s.lastFailure && <p className="muted small">Last failure {dateTime(s.lastFailure.at)}: {s.lastFailure.error}</p>}
      </section>

      {s.dataIssues.length > 0 && (
        <section className="panel">
          <h3 className="section-title">Data issues in active games</h3>
          <ul>
            {s.dataIssues.map((i, k) => <li key={k}>{i.severity}: {i.gameId && <Link to={`/game/${i.gameId}`}>game {i.gameId}</Link>} {i.message}</li>)}
          </ul>
        </section>
      )}

      <section className="panel">
        <h3 className="section-title">Update log</h3>
        <div className="table-scroll" tabIndex={0}>
          <table className="rank-table">
            <thead>
              <tr><th scope="col">Started</th><th scope="col">Source</th><th scope="col">Trigger</th><th scope="col">Status</th><th scope="col" className="num">Games</th><th scope="col" className="num">Active</th><th scope="col">Data as of</th><th scope="col">Error</th></tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id}>
                  <td>{dateTime(r.started_at)}</td>
                  <td>{r.source_key === 'internet-archive' ? 'Internet Archive' : 'njlottery.com'}</td>
                  <td>{r.trigger}</td>
                  <td><span className={`run-status run-${r.status}`}>{r.status === 'failed' ? '✕' : r.status === 'unchanged' ? '=' : '✓'} {r.status}</span></td>
                  <td className="num">{r.games_total ?? '—'}</td>
                  <td className="num">{r.games_active ?? '—'}</td>
                  <td>{dateTime(r.observed_at)}</td>
                  <td className="small">{r.error?.split('\n')[0] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          “unchanged” means njlottery.com was checked and returned identical data, so no new snapshot was stored. If NJ’s response format changes, updates fail loudly and the
          dashboard keeps showing the last good data with its age.
        </p>
      </section>
    </>
  );
}
