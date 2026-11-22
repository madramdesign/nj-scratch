import { Link } from 'react-router-dom';
import { formatPct } from '@nj/lottery-data/format';
import type { GameSummary } from '../api';
import { useWatchlist } from '../watchlist';

const LABEL_TEXT = { strong: 'Strong', average: 'Average', weak: 'Weak', unrated: 'Unrated' } as const;
const LABEL_ICON = { strong: '▲', average: '■', weak: '▼', unrated: '?' } as const;

/** Score with a text label and a shape icon, so meaning never depends on color alone. */
export function ScoreBadge({ score, label, size = 'md' }: { score: number | null; label: GameSummary['score']['label']; size?: 'md' | 'lg' }) {
  return (
    <span className={`score-badge score-${label} score-${size}`} title={`${LABEL_TEXT[label]} remaining-prize profile`}>
      <span aria-hidden="true" className="score-icon">{LABEL_ICON[label]}</span>
      <span className="score-num">{score == null ? '—' : Math.round(score)}</span>
      {size === 'lg' && <span className="score-text">{LABEL_TEXT[label]}</span>}
      <span className="sr-only"> ({LABEL_TEXT[label]})</span>
    </span>
  );
}

/** Horizontal meter for a 0–1 share. Text value is always shown next to it. */
export function Meter({ value, marker, label }: { value: number | null; marker?: number | null; label?: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <span className="meter-wrap">
      <span className="meter" role="img" aria-label={`${label ?? ''} ${formatPct(value, 0)}`.trim()}>
        <span className="meter-fill" style={{ width: `${v * 100}%` }} />
        {marker != null && <span className="meter-marker" style={{ left: `${Math.max(0, Math.min(1, marker)) * 100}%` }} title={`Tickets remaining (est.): ${formatPct(marker, 0)}`} />}
      </span>
      <span className="meter-text">{formatPct(value, 0)}</span>
    </span>
  );
}

export function Est({ title = 'Estimate computed by this app from official counts — not an official NJ Lottery figure.' }: { title?: string }) {
  return (
    <abbr className="est" title={title}>
      est.
    </abbr>
  );
}

export function Star({ gameId, name }: { gameId: string; name: string }) {
  const { ids, toggle } = useWatchlist();
  const on = ids.has(gameId);
  return (
    <button
      type="button"
      className={`star ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={on ? `Stop tracking ${name}` : `Track ${name}`}
      title={on ? 'Tracking — click to remove from watchlist' : 'Track this game'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle(gameId);
      }}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

export function GameLink({ g }: { g: Pick<GameSummary, 'gameId' | 'gameNumber' | 'name'> }) {
  return (
    <Link to={`/game/${g.gameId}`} className="game-link">
      <span className="game-name">{g.name}</span>
      <span className="game-num">#{g.gameNumber}</span>
    </Link>
  );
}

export function Retention({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">n/a</span>;
  const dir = value >= 1.15 ? 'up' : value <= 0.85 ? 'down' : 'flat';
  return (
    <span className={`retention retention-${dir}`} title="Share of these prizes remaining ÷ share of tickets remaining (est.). Above 1× = better odds than at launch.">
      {dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'} {value.toFixed(2)}×
    </span>
  );
}

export function Loading({ what = 'data' }: { what?: string }) {
  return <div className="loading" role="status">Loading {what}…</div>;
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="error-box" role="alert">
      <strong>Couldn’t load data.</strong> {error}
    </div>
  );
}

export function relativeTime(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} days ago`;
  return new Date(ts).toLocaleDateString();
}

export function dateTime(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function dateOnly(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
}
