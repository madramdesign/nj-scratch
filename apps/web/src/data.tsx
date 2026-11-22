import { createContext, useContext, type ReactNode } from 'react';
import { useApi, type GameSummary, type Meta, type Status } from './api';
import { useSettings } from './settings';

interface GamesCtx {
  games: GameSummary[];
  status: Status | null;
  meta: Meta | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const Ctx = createContext<GamesCtx | null>(null);

export function GamesProvider({ children }: { children: ReactNode }) {
  const { query } = useSettings();
  const games = useApi<{ status: Status; games: GameSummary[] }>(`/api/games${query}`);
  const meta = useApi<Meta>('/api/meta');
  return (
    <Ctx.Provider
      value={{
        games: games.data?.games ?? [],
        status: games.data?.status ?? null,
        meta: meta.data,
        loading: games.loading && !games.data,
        error: games.error,
        reload: games.reload,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useGames(): GamesCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useGames must be used inside GamesProvider');
  return c;
}

export const PRICE_POINTS_CENTS = [100, 200, 300, 500, 1000, 2000, 2500, 3000, 5000, 10000];
