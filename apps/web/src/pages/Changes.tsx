import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '@nj/lottery-data/format';
import { useApi, type ChangeEventRow } from '../api';
import { useGames } from '../data';
import { dateOnly, dateTime, ErrorBox, Loading, relativeTime } from '../components/ui';

const KINDS: Record<string, string> = {
  top_prize_claimed: 'Top prizes claimed',
  major_prize_claimed: 'Major prizes claimed',
  score_changed: 'Score changes',
  prizes_claimed: 'Other prizes',
  game_added: 'New games',
  status_changed: 'Status changes',
  structure_changed: 'Data revisions',
};

export function Changes() {
  const { data, error, loading } = useApi<{ events: ChangeEventRow[] }>('/api/changes?limit=1000');
  const { status } = useGames();
  const [kind, setKind] = useState<string>('notable');
  const events = useMemo(() => {
    const all = data?.events ?? [];
    if (kind === 'all') return all;
    if (kind === 'notable') return all.filter((e) => e.severity !== 'info');
    return all.filter((e) => e.kind === kind);
  }, [data, kind]);
  const groups = useMemo(() => {
    const m = new Map<number, ChangeEventRow[]>();
    for (const e of events) m.set(e.observed_at, [...(m.get(e.observed_at) ?? []), e]);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [events]);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading what="changes" />;
  return (
    <>
      <h2 className="page-title">Changes Since Last Update</h2>
      <p className="lede">
        Every update is compared with the previous snapshot of each game. Last checked: {status ? <><strong>{relativeTime(status.lastVerifiedAt, status.now)}</strong> ({dateTime(status.lastVerifiedAt)})</> : '…'}.
      </p>
      <div className="chips" role="group" aria-label="Change type">
        {[['notable', 'Notable'], ['all', 'All'], ...Object.entries(KINDS)].map(([k, label]) => (
          <button key={k} type="button" className={`chip ${k === kind ? 'on' : ''}`} aria-pressed={k === kind} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      {groups.length === 0 && <p className="muted">No changes recorded for this filter.</p>}
      {groups.map(([t, list]) => (
        <section key={t} className="panel">
          <h3 className="section-title">Update observed {dateOnly(t)} <span className="muted small">({list.length} changes)</span></h3>
          <ul className="event-list">
            {list.slice(0, 150).map((e) => (
              <li key={e.id} className={`event event-${e.severity}`}>
                <Link to={`/game/${e.game_id}`}>{e.game_name ?? e.game_id}</Link>
                {e.price_cents ? <span className="muted"> ({formatMoney(e.price_cents)})</span> : null}: {e.message}
              </li>
            ))}
            {list.length > 150 && <li className="muted">…and {list.length - 150} more</li>}
          </ul>
        </section>
      ))}
    </>
  );
}
