import { useMemo, useState } from 'react';
import { sessionOdds } from '@nj/analytics';
import { formatMoney, formatPct } from '@nj/lottery-data/format';
import type { GameDetail } from '../api';
import { Est } from './ui';

const COUNTS = [1, 2, 3, 5, 10, 20];

/** Chance as a percentage, with "1 in X" for small chances so tiny numbers stay readable. */
function chance(p: number) {
  if (p <= 0) return '0%';
  if (p >= 0.995) return '>99%';
  if (p < 0.01) return `${p < 0.0001 ? '<0.01%' : formatPct(p, 2)} (about 1 in ${Math.round(1 / p).toLocaleString('en-US')})`;
  return formatPct(p, 0);
}

/** "If you buy N tickets": exact chances from the remaining prize pool, next to the expected loss. */
export function SessionOdds({ g }: { g: GameDetail }) {
  const [n, setN] = useState(1);
  const t = g.tickets;
  const r = useMemo(
    () =>
      t.available
        ? sessionOdds({ priceCents: g.priceCents, ticketsRemaining: t.ticketsRemaining, evCents: g.currentEvCents, tiers: g.tiers.map((x) => ({ prizeCents: x.prizeCents, remaining: x.remaining, kind: x.kind })) }, n)
        : null,
    [g, t, n],
  );
  return (
    <section className="panel" aria-labelledby="session-h">
      <h3 id="session-h" className="section-title">If you buy several tickets <Est /></h3>
      {!t.available || !r ? (
        <p className="muted">Not available: {t.available ? 'not enough tickets remaining.' : t.reason}</p>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Number of tickets">
            {COUNTS.map((c) => (
              <button key={c} type="button" className={`chip ${c === n ? 'on' : ''}`} aria-pressed={c === n} onClick={() => setN(c)}>
                {c} ticket{c > 1 ? 's' : ''}
              </button>
            ))}
          </div>
          <dl className="stats-grid">
            <div className="stat"><dt>You spend</dt><dd>{formatMoney(r.costCents, { decimals: true })}</dd></div>
            <div className="stat"><dt>Expected loss</dt><dd>{r.expectedLossCents == null ? '—' : formatMoney(Math.round(r.expectedLossCents), { decimals: true })}</dd><dd className="stat-sub">average over many plays</dd></div>
            <div className="stat"><dt>Win back more than you spend</dt><dd>{chance(r.pNetProfit)}</dd></div>
            <div className="stat"><dt>Win back at least what you spend</dt><dd>{chance(r.pBreakEvenOrBetter)}</dd></div>
            <div className="stat"><dt>At least one prize of any size</dt><dd>{chance(r.pAnyPrize)}</dd><dd className="stat-sub">includes free tickets</dd></div>
            <div className="stat"><dt>Every ticket loses</dt><dd>{chance(r.pAllLose)}</dd></div>
            {r.thresholds.map((th) => (
              <div className="stat" key={th.minCents}><dt>At least one prize of {th.label}</dt><dd>{chance(th.probability)}</dd></div>
            ))}
          </dl>
          <p className="muted small">
            Computed from the official remaining prize counts and the estimated {t.ticketsRemaining.toLocaleString('en-US')} tickets left. A free ticket counts as getting the
            ticket price back. Prizes won but not yet claimed still count as remaining, so these chances can be slightly high. Buying more tickets raises the chance of
            some prize, and the expected loss rises with every ticket.
          </p>
        </>
      )}
    </section>
  );
}
