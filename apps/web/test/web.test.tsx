import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import { RankingTable, sortGames } from '../src/components/RankingTable';
import { applyFilters, EMPTY_FILTERS } from '../src/components/Filters';
import { analyzed, meta, mockFetch, status, summaries } from './fixtures';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

const last = <T,>(xs: T[]) => xs[xs.length - 1];

beforeEach(() => {
  localStorage.clear();
  const detail = analyzed.find((a) => a.metrics.gameId === '1908')!;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      mockFetch({
        '/api/games/1908/history': { points: [] },
        '/api/games/1908': {
          game: { ...detail.metrics, score: detail.score, explanation: detail.explanation },
          normalized: null,
          ranked: true,
          notRankedReason: null,
          issues: [],
          events: [],
          officialUrl: 'https://www.njlottery.com/en-us/scratch-offs/01908.html',
        },
        '/api/games': { status, games: summaries },
        '/api/meta': meta,
        '/api/watchlist': { items: [], alerts: [] },
      }),
    ),
  );
});

describe('filtering and sorting logic', () => {
  it('filters by price, minimum top-prize %, profile, search and max price', () => {
    expect(applyFilters(summaries, { ...EMPTY_FILTERS, prices: [2000] }).every((g) => g.priceCents === 2000)).toBe(true);
    const withTop = applyFilters(summaries, { ...EMPTY_FILTERS, minTopPct: 60 });
    expect(withTop.length).toBeGreaterThan(0);
    expect(withTop.every((g) => (g.topPrize.pctRemaining ?? 0) >= 0.6)).toBe(true);
    expect(applyFilters(summaries, { ...EMPTY_FILTERS, profile: 'weak' }).every((g) => g.score.label === 'weak')).toBe(true);
    expect(applyFilters(summaries, { ...EMPTY_FILTERS, search: '#01908' }).map((g) => g.gameId)).toEqual(['1908']);
    expect(applyFilters(summaries, { ...EMPTY_FILTERS, hideNoTop: true }).some((g) => g.topPrize.remaining === 0)).toBe(false);
    expect(applyFilters(summaries, { ...EMPTY_FILTERS, maxPrice: 5 }).every((g) => g.priceCents <= 500)).toBe(true);
  });

  it('sorts descending by score and keeps nulls last in both directions', () => {
    expect(sortGames(summaries, 'score', 'desc')[0].score.rank).toBe(1);
    const withNull = [{ ...summaries[0], currentReturn: null }, ...summaries.slice(1)];
    expect(last(sortGames(withNull, 'evPct', 'desc')).currentReturn).toBeNull();
    expect(last(sortGames(withNull, 'evPct', 'asc')).currentReturn).toBeNull();
  });
});

describe('RankingTable', () => {
  it('re-sorts when a column header is clicked', async () => {
    render(
      <MemoryRouter>
        <RankingTable games={summaries} columns={['rank', 'game', 'price', 'score']} />
      </MemoryRouter>,
    );
    const firstRow = () => screen.getAllByTestId('game-row')[0];
    expect(firstRow()).toHaveTextContent(summaries.find((g) => g.score.rank === 1)!.name);
    await userEvent.click(screen.getByRole('button', { name: /Price/ }));
    const cheapest = Math.min(...summaries.map((g) => g.priceCents));
    expect(within(firstRow()).getByText(`$${cheapest / 100}`)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('wraps tables in a horizontally scrollable region for mobile', () => {
    const { container } = render(
      <MemoryRouter>
        <RankingTable games={summaries.slice(0, 3)} columns={['game', 'score']} />
      </MemoryRouter>,
    );
    expect(container.querySelector('.table-scroll > table')).not.toBeNull();
  });
});

describe('Best Tickets page', () => {
  it('answers “what are the best tickets right now” on the first screen', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Best Current Tickets' })).toBeInTheDocument();
    expect(screen.getByText('Active games')).toBeInTheDocument();
    expect(screen.getAllByText(/why it ranks highly/)).toHaveLength(3);
    const top = summaries.find((g) => g.score.rank === 1)!;
    expect(screen.getAllByText(top.name).length).toBeGreaterThan(0);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(/gambling/);
  });

  it('shows scores with a text label, not color alone', async () => {
    renderAt('/');
    await screen.findByRole('heading', { name: 'Best Current Tickets' });
    expect(screen.getAllByText(/\(Strong\)/).length).toBeGreaterThan(0);
  });

  it('flags stale data prominently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        mockFetch({
          '/api/games': { status: { ...status, isStale: true, warnings: ['Data was last verified 60 hours ago and may be stale.'] }, games: summaries },
          '/api/meta': meta,
          '/api/watchlist': { items: [], alerts: [] },
        }),
      ),
    );
    renderAt('/');
    expect(await screen.findByText(/may be stale/)).toBeInTheDocument();
    expect(screen.getByText('Check data freshness')).toBeInTheDocument();
  });
});

describe('All Games filters UI', () => {
  it('filters the table when a price chip is pressed', async () => {
    renderAt('/all');
    await screen.findByRole('heading', { name: 'All Active Games' });
    await userEvent.click(screen.getByRole('button', { name: '$30' }));
    const n = summaries.filter((g) => g.priceCents === 3000).length;
    await waitFor(() => expect(screen.getAllByTestId('game-row')).toHaveLength(n));
    expect(screen.getByText(`Showing ${n} of 65 active games`)).toBeInTheDocument();
  });
});

describe('Game detail page', () => {
  it('shows recommendation, prize table, break-even and score breakdown', async () => {
    renderAt('/game/1908');
    expect(await screen.findByRole('heading', { name: /\$5,000,000 Fortune/ })).toBeInTheDocument();
    expect(document.querySelector('.rec-headline')).toHaveTextContent(/remaining-prize profile/);
    expect(document.querySelectorAll('.prize-table tbody tr').length).toBeGreaterThan(3);
    expect(screen.getByText('Expected loss per ticket')).toBeInTheDocument();
    expect(screen.getByText('Score breakdown')).toBeInTheDocument();
    expect(screen.getAllByText('$5,000,000*').length).toBeGreaterThan(0);
    expect(screen.getByText(/not a prediction/)).toBeInTheDocument();
  });
});
