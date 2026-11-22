import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMetrics, GameScore, Explanation, TierAnalysis, ComponentKey } from '@nj/analytics';
import type { DataIssue, NormalizedGame } from '@nj/lottery-data/types';
import { IS_STATIC, staticGet, staticSend } from './static';

export type GameSummary = Omit<GameMetrics, 'tiers'> & {
  score: GameScore;
  explanation: Explanation;
  lastChangeAt?: number | null;
  recentChanges?: number;
};
export type GameDetail = GameMetrics & { score: GameScore; explanation: Explanation };
export type { TierAnalysis, ComponentKey };

export interface Status {
  now: number;
  source: { name: string; url: string; page: string };
  dataAsOf: number | null;
  dataSource: string | null;
  lastVerifiedAt: number | null;
  lastSuccessfulCheck: { at: number; status: string } | null;
  lastAttempt: { at: number; status: string; error: string | null; trigger: string } | null;
  lastFailure: { at: number; error: string | null } | null;
  dataAgeMs: number | null;
  isStale: boolean;
  gamesRetrieved: number;
  activeGames: number;
  rankedGames: number;
  gamesWithMissingData: number;
  gamesInvalid: number;
  dataIssues: Array<DataIssue & { gameId?: string }>;
  warnings: string[];
  history: { games: number; snapshots: number; runs: number; events: number; historyFirst: number | null; historyLast: number | null; historyPoints: number };
}

export interface Meta {
  components: Array<{ key: ComponentKey; label: string; short: string; description: string; defaultWeight: number }>;
  majorThresholdsCents: number[];
  defaultMajorThresholdCents: number;
  disclaimer: string;
}

export interface ChangeEventRow {
  id: number;
  run_id: number;
  game_id: string;
  observed_at: number;
  kind: string;
  severity: 'info' | 'notable' | 'warning';
  message: string;
  tier_number: number | null;
  delta: number | null;
  game_name?: string;
  game_number?: string;
  price_cents?: number;
}

export interface HistoryPoint {
  observed_at: number;
  score: number | null;
  rank: number | null;
  label: string | null;
  current_ev_cents: number | null;
  current_return: number | null;
  original_return: number | null;
  top_remaining: number;
  top_original: number;
  major_remaining: number;
  major_original: number;
  prizes_remaining: number;
  value_remaining_cents: number;
  tickets_remaining_est: number | null;
  source_key: string;
}

export interface GameDetailResponse {
  game: GameDetail | null;
  normalized: NormalizedGame | null;
  ranked: boolean;
  notRankedReason: string | null;
  issues: DataIssue[];
  events: ChangeEventRow[];
  officialUrl: string;
}

export interface RunRow {
  id: number;
  source_key: string;
  source_name: string;
  trigger: string;
  started_at: number;
  finished_at: number | null;
  observed_at: number;
  status: string;
  http_status: number | null;
  games_total: number | null;
  games_active: number | null;
  games_rankable: number | null;
  games_invalid: number | null;
  error: string | null;
  duration_ms: number | null;
  issueCount: number;
}

export interface WatchItem {
  game_id: string;
  added_at: number;
  score_at_add: number | null;
  note: string | null;
  game: GameSummary | null;
  previousScore: number | null;
  previousObservedAt: number | null;
  events: ChangeEventRow[];
}

export async function apiGet<T>(path: string): Promise<T> {
  if (IS_STATIC) return staticGet(path) as Promise<T>;
  const res = await fetch(path);
  const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export async function apiSend<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (IS_STATIC) return staticSend(method, path) as Promise<T>;
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

/** Tiny fetch hook: refetches when `path` changes, exposes reload(). */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    apiGet<T>(path)
      .then((d) => {
        if (id === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => id === seq.current && setError(e.message))
      .finally(() => id === seq.current && setLoading(false));
  }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}
