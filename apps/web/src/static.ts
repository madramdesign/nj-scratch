/**
 * Static-hosting adapter (GitHub Pages). Serves the same response shapes as the API from
 * pre-exported JSON files under `${BASE_URL}api/`. Custom weights / major threshold are
 * re-scored in the browser with the same analytics package the server uses. The watchlist
 * lives in localStorage because there is no server to store it.
 */
import { analyzeGames, type AnalyzedGame } from '@nj/analytics';
import type { NormalizedGame } from '@nj/lottery-data/types';
import type { ChangeEventRow, GameSummary, HistoryPoint } from './api';

export const IS_STATIC = import.meta.env.VITE_STATIC === '1';
const BASE = `${import.meta.env.BASE_URL}api/`;
const WATCH_KEY = 'njscratch.watchlist.v1';

const cache = new Map<string, Promise<any>>();
function file<T>(name: string): Promise<T> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(BASE + name).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? 'Not found' : `HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p as Promise<T>;
}

function summarize(a: AnalyzedGame): GameSummary {
  const { tiers, ...m } = a.metrics;
  return { ...m, score: a.score, explanation: a.explanation };
}

/** Analyze with custom options in the browser; returns null when defaults apply (use exported files). */
async function analyzeCustom(params: URLSearchParams): Promise<AnalyzedGame[] | null> {
  const major = params.get('major');
  const w = params.get('w');
  if (!major && !w) return null;
  const weights: Record<string, number> = {};
  for (const part of (w ?? '').split(',')) {
    const [k, v] = part.split(':');
    if (k && v != null && Number.isFinite(Number(v))) weights[k] = Math.max(0, Math.min(100, Number(v)));
  }
  const normalized = await file<NormalizedGame[]>('normalized.json');
  return analyzeGames(normalized, { majorThresholdCents: major ? Math.round(Number(major) * 100) : undefined, weights });
}

function watchIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(WATCH_KEY) ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

const STALE_AFTER_MS = 36 * 3600_000;

/** Exported status reflects export time; recompute age/staleness against the viewer's clock. */
function freshen<T extends Record<string, any>>(status: T): T {
  const now = Date.now();
  const age = status.lastVerifiedAt ? now - status.lastVerifiedAt : null;
  const stale = age == null || age > STALE_AFTER_MS;
  const warnings = (status.warnings as string[]).filter((w) => !/may be stale/.test(w));
  if (stale && age != null) warnings.unshift(`Data was last verified against njlottery.com ${Math.round(age / 3600_000)} hours ago and may be stale.`);
  return { ...status, now, dataAgeMs: age, isStale: stale, warnings };
}

export async function staticGet(path: string): Promise<any> {
  const url = new URL(path, 'http://x');
  const p = url.pathname.replace(/^\/api\//, '');
  const params = url.searchParams;

  if (p === 'games') {
    const raw = await file<{ status: Record<string, any>; games: GameSummary[] }>('games.json');
    const base = { ...raw, status: freshen(raw.status) };
    const custom = await analyzeCustom(params);
    if (!custom) return base;
    const recent = new Map(base.games.map((g) => [g.gameId, g]));
    return {
      ...base,
      games: custom.map((a) => ({ ...summarize(a), lastChangeAt: recent.get(a.metrics.gameId)?.lastChangeAt ?? null, recentChanges: recent.get(a.metrics.gameId)?.recentChanges ?? 0 })),
    };
  }
  const hist = /^games\/0*(\d+)\/history$/.exec(p);
  if (hist) return file(`games/${hist[1]}/history.json`).catch(() => ({ gameId: hist[1], points: [] }));
  const one = /^games\/0*(\d+)$/.exec(p);
  if (one) {
    const base = await file<any>(`games/${one[1]}.json`).catch(() => {
      throw new Error(`Game ${one[1]} is not among the currently active games.`);
    });
    const custom = await analyzeCustom(params);
    const a = custom?.find((x) => x.metrics.gameId === one[1]);
    return a ? { ...base, game: { ...a.metrics, score: a.score, explanation: a.explanation } } : base;
  }
  if (p === 'meta') return file('meta.json');
  if (p === 'status') return freshen(await file<Record<string, any>>('status.json'));
  if (p === 'updates') {
    const u = await file<{ status: Record<string, any> }>('updates.json');
    return { ...u, status: freshen(u.status) };
  }
  if (p === 'changes') return file('changes.json');
  if (p === 'watchlist') {
    const ids = watchIds();
    const { games } = await staticGet(`/api/games${url.search}`);
    const items = await Promise.all(
      ids.map(async (id) => {
        const [h, d] = await Promise.all([
          file<{ points: HistoryPoint[] }>(`games/${id}/history.json`).catch(() => ({ points: [] as HistoryPoint[] })),
          file<{ events: ChangeEventRow[] }>(`games/${id}.json`).catch(() => ({ events: [] as ChangeEventRow[] })),
        ]);
        const prev = h.points.length >= 2 ? h.points[h.points.length - 2] : null;
        return {
          game_id: id,
          added_at: 0,
          score_at_add: null,
          note: null,
          game: (games as GameSummary[]).find((g) => g.gameId === id) ?? null,
          previousScore: prev?.score ?? null,
          previousObservedAt: prev?.observed_at ?? null,
          events: d.events.slice(0, 10),
        };
      }),
    );
    const alerts = items
      .flatMap((i) => i.events)
      .filter((e) => e.severity !== 'info')
      .sort((a, b) => b.observed_at - a.observed_at)
      .slice(0, 50);
    return { items, alerts };
  }
  throw new Error(`Not available in the hosted version: ${path}`);
}

export async function staticSend(method: 'POST' | 'DELETE', path: string): Promise<any> {
  const m = /^\/api\/watchlist\/0*(\d+)$/.exec(path);
  if (m) {
    const ids = new Set(watchIds());
    if (method === 'POST') ids.add(m[1]);
    else ids.delete(m[1]);
    localStorage.setItem(WATCH_KEY, JSON.stringify([...ids]));
    return { ok: true };
  }
  if (path === '/api/refresh') throw new Error('Data refreshes automatically every 6 hours in the hosted version.');
  throw new Error(`Not available in the hosted version: ${path}`);
}
