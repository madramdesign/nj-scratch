import { createHash } from 'node:crypto';

/**
 * Atom and JSON Feed output for notable change events (top/major prizes claimed, top prizes sold out,
 * score and profile changes, new and announced games), so people can follow updates in any feed reader.
 */
export interface FeedEvent {
  id: number;
  game_id: string;
  observed_at: number;
  kind: string;
  severity: string;
  message: string;
  tier_number?: number | null;
  game_name?: string | null;
  game_number?: string | null;
  price_cents?: number | null;
}

export interface FeedOptions {
  /** Absolute site URL ending in "/", e.g. https://example.github.io/nj-scratch/ */
  siteUrl: string;
  /** Path of this feed relative to siteUrl, e.g. "feed.xml". */
  selfPath: string;
  title?: string;
  /** Feeds are regenerated on every update; the newest entries are kept. */
  limit?: number;
}

export const FEED_LIMIT = 200;
const DEFAULT_TITLE = 'NJ Scratch-Off Tracker: notable changes';
const SUBTITLE =
  'Notable changes in the official NJ Lottery remaining-prize data. Not predictions or advice: every game returns less than it costs on average. ' +
  'Not affiliated with the NJ Lottery. 18+. If gambling is a problem, call 1-800-GAMBLER.';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const iso = (t: number) => new Date(t).toISOString();
const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** Feeds only carry events worth interrupting someone for; small-prize payouts stay on the site. */
export const isFeedEvent = (e: Pick<FeedEvent, 'severity'>) => e.severity !== 'info';

export function entryTitle(e: FeedEvent): string {
  const game = e.game_name ?? `Game ${e.game_id}`;
  if (e.game_name && e.message.includes(e.game_name)) return e.message;
  return `${game}${e.price_cents ? ` (${dollars(e.price_cents)})` : ''}: ${e.message}`;
}

/**
 * Entry id that survives rebuilding the events table (row ids don't), so feed readers never show an entry twice.
 * Built from what the event is about, not its database row.
 */
export function entryId(e: FeedEvent, siteUrl: string): string {
  const h = createHash('sha256').update(`${e.game_id}|${e.observed_at}|${e.kind}|${e.tier_number ?? ''}|${e.message}`).digest('hex').slice(0, 16);
  return `${siteUrl}#event-${h}`;
}

/** Announced games aren't on sale yet and have no game page; they are listed on the calendar page. */
const entryLink = (e: FeedEvent, siteUrl: string) => (e.kind === 'game_announced' ? `${siteUrl}calendar` : `${siteUrl}game/${e.game_id}`);

function select(events: FeedEvent[], limit: number) {
  return events.filter(isFeedEvent).sort((a, b) => b.observed_at - a.observed_at || b.id - a.id).slice(0, limit);
}

export function atomFeed(events: FeedEvent[], o: FeedOptions): string {
  const items = select(events, o.limit ?? FEED_LIMIT);
  const updated = items[0]?.observed_at ?? 0;
  const entries = items.map((e) => {
    const link = entryLink(e, o.siteUrl);
    return [
      '  <entry>',
      `    <id>${xml(entryId(e, o.siteUrl))}</id>`,
      `    <title>${xml(entryTitle(e))}</title>`,
      `    <link rel="alternate" type="text/html" href="${xml(link)}"/>`,
      `    <updated>${iso(e.observed_at)}</updated>`,
      `    <category term="${xml(e.kind)}"/>`,
      `    <summary>${xml(`${e.message} Data as of ${iso(e.observed_at).slice(0, 10)}, from njlottery.com.`)}</summary>`,
      '  </entry>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${xml(o.siteUrl + o.selfPath)}</id>`,
    `  <title>${xml(o.title ?? DEFAULT_TITLE)}</title>`,
    `  <subtitle>${xml(SUBTITLE)}</subtitle>`,
    `  <link rel="self" type="application/atom+xml" href="${xml(o.siteUrl + o.selfPath)}"/>`,
    `  <link rel="alternate" type="text/html" href="${xml(o.siteUrl + 'changes')}"/>`,
    `  <updated>${iso(updated)}</updated>`,
    '  <author><name>NJ Scratch-Off Tracker</name></author>',
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}

/** JSON Feed 1.1 (https://jsonfeed.org/version/1.1). */
export function jsonFeed(events: FeedEvent[], o: FeedOptions) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: o.title ?? DEFAULT_TITLE,
    description: SUBTITLE,
    home_page_url: `${o.siteUrl}changes`,
    feed_url: o.siteUrl + o.selfPath,
    items: select(events, o.limit ?? FEED_LIMIT).map((e) => ({
      id: entryId(e, o.siteUrl),
      url: entryLink(e, o.siteUrl),
      title: entryTitle(e),
      content_text: e.message,
      date_published: iso(e.observed_at),
      tags: [e.kind],
      _nj: { game_id: e.game_id, game_number: e.game_number ?? null, price_cents: e.price_cents ?? null, kind: e.kind, severity: e.severity },
    })),
  };
}

/** Feed file paths for the site: one for everything, one per ticket price. */
export function feedPaths(prices: number[]) {
  return {
    all: { atom: 'feed.xml', json: 'feed.json' },
    byPrice: prices.map((cents) => ({ cents, atom: `feeds/price-${cents / 100}.xml` })),
  };
}
