import { formatMoney } from '@nj/lottery-data/format';
import { useGames } from '../data';

const BASE = import.meta.env.BASE_URL;

/** Links to the notable-changes feeds (all games, or one ticket price) for any feed reader. */
export function Subscribe() {
  const { games } = useGames();
  const prices = [...new Set(games.map((g) => g.priceCents))].sort((a, b) => a - b);
  return (
    <section className="panel subscribe" aria-labelledby="sub-h">
      <h3 id="sub-h" className="section-title">Follow changes in a feed reader</h3>
      <p className="muted small">
        Get notable changes (top and major prizes claimed, top prizes sold out, new and announced games, big score moves) in any feed reader, or turn a feed into email
        with a feed-to-email service. Feeds update with the data and carry no tracking.
      </p>
      <p>
        <a href={`${BASE}feed.xml`}>All games (Atom)</a> · <a href={`${BASE}feed.json`}>All games (JSON Feed)</a>
      </p>
      {prices.length > 0 && (
        <p className="small">
          By ticket price:{' '}
          {prices.map((p, i) => (
            <span key={p}>
              {i > 0 && ' · '}
              <a href={`${BASE}feeds/price-${p / 100}.xml`}>{formatMoney(p)}</a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
