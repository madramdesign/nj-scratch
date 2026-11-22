/** Formatting helpers shared by API and web. Pure functions, no Node APIs. */

export function formatMoney(cents: number | null | undefined, opts: { compact?: boolean; decimals?: boolean } = {}): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const dollars = cents / 100;
  if (opts.compact && Math.abs(dollars) >= 1000) {
    const units: Array<[number, string]> = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [v, s] of units) {
      if (Math.abs(dollars) >= v) {
        const n = dollars / v;
        return `$${n >= 100 || Number.isInteger(n) ? n.toFixed(0) : n.toFixed(n >= 10 ? 1 : 2).replace(/\.?0+$/, '')}${s}`;
      }
    }
  }
  const showCents = opts.decimals ?? !Number.isInteger(dollars);
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: showCents ? 2 : 0, maximumFractionDigits: showCents ? 2 : 0 });
}

export function formatPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatOdds(oneIn: number | null | undefined): string {
  if (oneIn == null || !Number.isFinite(oneIn) || oneIn <= 0) return '—';
  if (oneIn >= 1000) return `1 in ${Math.round(oneIn).toLocaleString('en-US')}`;
  return `1 in ${oneIn.toFixed(2)}`;
}

export function formatInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}
