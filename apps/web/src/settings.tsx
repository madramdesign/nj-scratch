import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ComponentKey } from './api';

export const DEFAULT_WEIGHTS: Record<ComponentKey, number> = {
  expectedReturn: 35,
  topPrize: 20,
  majorPrize: 20,
  profitOdds: 15,
  prizeValue: 10,
};
export const DEFAULT_MAJOR_DOLLARS = 10_000;

interface Settings {
  weights: Record<ComponentKey, number>;
  majorDollars: number;
  setWeights: (w: Record<ComponentKey, number>) => void;
  setMajorDollars: (d: number) => void;
  reset: () => void;
  /** Query string to append to API calls so the server scores with these settings. */
  query: string;
  isDefault: boolean;
}

const Ctx = createContext<Settings | null>(null);
const KEY = 'njscratch.settings.v1';

function load(): { weights: Record<ComponentKey, number>; majorDollars: number } {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s === 'object') return { weights: { ...DEFAULT_WEIGHTS, ...s.weights }, majorDollars: Number(s.majorDollars) || DEFAULT_MAJOR_DOLLARS };
  } catch {
    /* ignore corrupt settings */
  }
  return { weights: DEFAULT_WEIGHTS, majorDollars: DEFAULT_MAJOR_DOLLARS };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(load, []);
  const [weights, setWeights] = useState(initial.weights);
  const [majorDollars, setMajorDollars] = useState(initial.majorDollars);
  const [debounced, setDebounced] = useState({ weights, majorDollars });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({ weights, majorDollars }), 250);
    localStorage.setItem(KEY, JSON.stringify({ weights, majorDollars }));
    return () => clearTimeout(t);
  }, [weights, majorDollars]);
  const isDefault = majorDollars === DEFAULT_MAJOR_DOLLARS && (Object.keys(DEFAULT_WEIGHTS) as ComponentKey[]).every((k) => weights[k] === DEFAULT_WEIGHTS[k]);
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced.majorDollars !== DEFAULT_MAJOR_DOLLARS) p.set('major', String(debounced.majorDollars));
    const w = (Object.keys(DEFAULT_WEIGHTS) as ComponentKey[]).filter((k) => debounced.weights[k] !== DEFAULT_WEIGHTS[k]);
    if (w.length) p.set('w', (Object.keys(DEFAULT_WEIGHTS) as ComponentKey[]).map((k) => `${k}:${debounced.weights[k]}`).join(','));
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [debounced]);
  const value: Settings = {
    weights,
    majorDollars,
    setWeights,
    setMajorDollars,
    reset: () => {
      setWeights(DEFAULT_WEIGHTS);
      setMajorDollars(DEFAULT_MAJOR_DOLLARS);
    },
    query,
    isDefault,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSettings must be used inside SettingsProvider');
  return s;
}

/** Watchlist is stored server-side; this hook wraps it for star toggles. */
export { useWatchlist } from './watchlist';
