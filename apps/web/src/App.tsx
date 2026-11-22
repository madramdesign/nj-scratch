import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { GamesProvider, useGames } from './data';
import { SettingsProvider } from './settings';
import { WatchlistProvider } from './watchlist';
import { StatusBar } from './components/StatusBar';
import { BestTickets } from './pages/BestTickets';
import { Jackpots } from './pages/Jackpots';
import { ByPrice } from './pages/ByPrice';
import { Odds } from './pages/Odds';
import { RemainingPct } from './pages/RemainingPct';
import { Avoid } from './pages/Avoid';
import { Watchlist } from './pages/Watchlist';
import { Changes } from './pages/Changes';
import { DataQuality } from './pages/DataQuality';
import { Methodology } from './pages/Methodology';
import { AllGames } from './pages/AllGames';

// The detail page carries the charting library; load it on demand.
const GameDetailPage = lazy(() => import('./pages/GameDetail').then((m) => ({ default: m.GameDetailPage })));

const NAV = [
  ['/', 'Best Tickets'],
  ['/all', 'All Games'],
  ['/jackpots', 'Jackpot Hunters'],
  ['/by-price', 'By Price'],
  ['/odds', 'Best Odds'],
  ['/remaining', 'Remaining %'],
  ['/avoid', 'Tickets to Avoid'],
  ['/watchlist', '★ Watchlist'],
  ['/changes', 'Changes'],
  ['/data', 'Data Quality'],
  ['/methodology', 'Methodology'],
] as const;

function Disclaimer() {
  const { meta } = useGames();
  return (
    <footer className="disclaimer" role="contentinfo">
      <p>
        <strong>Important:</strong>{' '}
        {meta?.disclaimer ??
          'Scratch-off tickets are gambling products and the lottery keeps a house edge. Rankings are mathematical analysis of official remaining-prize data, not predictions.'}
      </p>
      <p className="muted">
        Not affiliated with the New Jersey Lottery. Official data: <a href="https://www.njlottery.com/en-us/scratch-offs.html#tab-active" target="_blank" rel="noreferrer">njlottery.com</a>. Must be 18+ to play.
      </p>
    </footer>
  );
}

export function Shell() {
  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">🎟</span>
          <div>
            <h1>NJ Scratch-Off Tracker</h1>
            <p className="tagline">Which active NJ scratch-offs have the strongest remaining-prize profile right now?</p>
          </div>
        </div>
        <nav className="main-nav" aria-label="Views">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <StatusBar />
      <main id="main" className="content">
        <Routes>
          <Route path="/" element={<BestTickets />} />
          <Route path="/all" element={<AllGames />} />
          <Route path="/jackpots" element={<Jackpots />} />
          <Route path="/by-price" element={<ByPrice />} />
          <Route path="/odds" element={<Odds />} />
          <Route path="/remaining" element={<RemainingPct />} />
          <Route path="/avoid" element={<Avoid />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/changes" element={<Changes />} />
          <Route path="/data" element={<DataQuality />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/game/:id" element={<Suspense fallback={<p className="loading">Loading game…</p>}><GameDetailPage /></Suspense>} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
      <Disclaimer />
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <WatchlistProvider>
        <GamesProvider>
          <Shell />
        </GamesProvider>
      </WatchlistProvider>
    </SettingsProvider>
  );
}
