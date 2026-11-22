import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiSend } from '../api';
import { useGames } from '../data';
import { dateTime, relativeTime } from './ui';

export function StatusBar() {
  const { status, reload, error } = useGames();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiSend<{ status: string; snapshots: number; events: number }>('POST', '/api/refresh');
      setMsg(r.status === 'unchanged' ? 'Checked — NJ data has not changed since the last update.' : `Updated: ${r.snapshots} game snapshots, ${r.events} changes detected.`);
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (error) return <div className="status-bar stale" role="alert">⚠ Cannot reach the API: {error}</div>;
  if (!status) return <div className="status-bar">Loading data status…</div>;
  const stale = status.isStale || status.warnings.length > 0;
  return (
    <div className={`status-bar ${stale ? 'stale' : 'fresh'}`} role="status">
      <span className="status-dot" aria-hidden="true">{stale ? '⚠' : '●'}</span>
      <span>
        <strong>{stale ? 'Check data freshness' : 'Data current'}</strong>
        {' · '}Last verified with njlottery.com: <time dateTime={status.lastVerifiedAt ? new Date(status.lastVerifiedAt).toISOString() : undefined} title={dateTime(status.lastVerifiedAt)}>{relativeTime(status.lastVerifiedAt, status.now)}</time>
        {' · '}Prize counts as of {dateTime(status.dataAsOf)}
        {' · '}{status.rankedGames} of {status.activeGames} active games ranked
      </span>
      {status.warnings.map((w) => (
        <span key={w} className="status-warning">{w}</span>
      ))}
      <span className="status-actions">
        <Link to="/data">Details</Link>
        <button type="button" className="btn small" onClick={refresh} disabled={busy} title="Fetch the latest data from njlottery.com (admin/dev)">
          {busy ? 'Refreshing…' : '↻ Refresh data'}
        </button>
      </span>
      {msg && <span className="status-msg">{msg}</span>}
    </div>
  );
}
