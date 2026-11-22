import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiSend } from './api';

interface WatchCtx {
  ids: Set<string>;
  toggle: (gameId: string) => Promise<void>;
  error: string | null;
}

const Ctx = createContext<WatchCtx>({ ids: new Set(), toggle: async () => {}, error: null });

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ items: Array<{ game_id: string }> }>('/api/watchlist')
      .then((d) => setIds(new Set(d.items.map((i) => i.game_id))))
      .catch(() => {});
  }, []);
  const toggle = useCallback(
    async (gameId: string) => {
      const on = ids.has(gameId);
      const next = new Set(ids);
      on ? next.delete(gameId) : next.add(gameId);
      setIds(next);
      try {
        await apiSend(on ? 'DELETE' : 'POST', `/api/watchlist/${gameId}`);
        setError(null);
      } catch (e) {
        setIds(ids);
        setError((e as Error).message);
      }
    },
    [ids],
  );
  return <Ctx.Provider value={{ ids, toggle, error }}>{children}</Ctx.Provider>;
}

export const useWatchlist = () => useContext(Ctx);
