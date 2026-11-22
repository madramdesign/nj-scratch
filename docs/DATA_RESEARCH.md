# NJ Lottery scratch-off data research

Research date: 2026-11-21/22. Everything below was verified by direct inspection unless marked *unverified*.

## 1. Official source

**Page:** https://www.njlottery.com/en-us/scratch-offs.html#tab-active

The visible page is an Adobe AEM site rendered client-side with Backbone.js. The HTML contains **no** prize data. The tabs (Active / Ended / Expired) are populated by `/etc/designs/portal/instantgames.<version>.js`, which calls a Backbone collection defined in `/etc/designs/portal/home.<version>.js`:

```js
portalGGA.models.InstantGames = Backbone.Collection.extend({
  url: '/api/v1/instant-games/games/',
  parse: function (response) { return response && response.games }
});
// fetched with: this.instantGames.fetch({ cache: false, data: { size: 1000 } })
```

### Endpoint

| | |
|---|---|
| URL | `GET https://www.njlottery.com/api/v1/instant-games/games/?size=1000` |
| Auth | None (public, same endpoint the public website uses) |
| Format | JSON, ~570 KB, one page containing **all** games (304 on 2026-11-22) |
| Caching | `cache-control: public,max-age=300` via Varnish/Fastly CDN |
| robots.txt | `Allow: /` |
| Single game | `GET /api/v1/instant-games/games/<gameId>` (same shape, one game) |

Other `/api/v1/*` endpoints referenced in site JS (draw games, locations, second chance, and so on) are not needed.

### How the site classifies games (`instantgames.js`)

| Tab | Rule |
|---|---|
| Active | `launchDate <= now < disableDate − 365 days` |
| Ended | `disableDate − 365 days <= now < disableDate` (no longer sold, prizes still claimable) |
| Expired | `disableDate <= now` |

The app uses exactly these windows. `validationStatus` is *not* the same thing: many `ACTIVE`-status games are in the Ended tab.

### How the site computes "prizes remaining"

From the page template and the game-detail prize chart:

```js
if (prizeTier.prizeAmount >= 60000) remaining = winningTickets - claimedTickets;
else                                remaining = winningTickets - paidTickets;
```

Prizes of $600 and up must be claimed at claim centers, so NJ counts those claims. Smaller prizes are paid by retailers. **The app uses the same formula**, so its remaining counts match njlottery.com exactly.

## 2. Fields

Game:

| Field | Type | Meaning |
|---|---|---|
| `gameId` | string | Game number without leading zeros ("1851"; displayed as #01851) |
| `gameName` | string | |
| `validationStatus` | string | ACTIVE / DISABLED / CLOSED / NOT_ACTIVE (internal status, see above) |
| `ticketPrice` | int, **cents** | 200 = $2 |
| `launchDate`, `startDistributionDate`, `endDistributionDate`, `disableDate` | epoch ms | |
| `totalTicketsPrinted` | int | Size of the print run. Enables exact launch odds and EV |
| `prizeTiers` | array or null | null for most expired games |

Prize tier:

| Field | Meaning |
|---|---|
| `tierNumber` | Tier id within the game (1 = smallest) |
| `originalTierNumber` | Index in the full win-combination table (informational) |
| `prizeAmount` | **cents**. For annuity tiers this is the **cash value** (for example, "$1,000,000*" has `prizeAmount` 60230000, which is $602,300) |
| `prizeDescription` | Display text ("$500", "FREE $5 TICKET", "$1,000,000*", "$10,000 A MONTH/LIF") |
| `tierType` | 1 = cash, 2 = free ticket, 16 = annuity / prize paid over time |
| `winningTickets` | Prizes printed in this tier (original quantity) |
| `paidTickets` | Prizes paid so far |
| `claimedTickets` | Prizes claimed at claim centers (meaningful for $600+) |

Observed on 2026-11-22: 65 active games, 669 active tiers (594 cash, 61 free-ticket, 14 annuity). Every active game has `totalTicketsPrinted`. The sum of tier winners divided by tickets printed matches the advertised overall odds (for example, #1851: 7,403,550 / 1,666,729 ≈ 1 in 4.44), so **the tier list is complete**, not just the top tiers.

The game page states: *"New Jersey allocates approximately 63% of the gross receipts, net of free tickets, to prizes."* Computed launch returns range from 60% to 74%, which is consistent with that figure once free tickets are included.

## 3. Update frequency

NJ does not document it. The CDN caches responses for 5 minutes. Comparing archived captures shows claim counts change between days. *Unverified:* the exact time of day NJ refreshes the counts. The app polls every 6 hours by default. Identical responses are recorded as `unchanged` runs, so no duplicate snapshots are stored.

## 4. Historical data

- **NJ Lottery:** no historical or archived per-game prize data is published. Ended and expired games remain in the same API with their final counts, but there is no time series. There is no NJ dataset on data.nj.gov (catalog searched: annual reports only).
- **Internet Archive:** the Wayback Machine holds **real captures of the official API response** (`/api/v1/instant-games/games/?size=1000&_=…`). There are 9 distinct days between 2024-11-14 and 2026-02-23. These are verbatim copies of NJ's own JSON, so they are official data delivered by a different transport. `npm run backfill` imports them, validates them exactly like live data, and labels their source as `internet-archive` in the database and UI.
- From now on the app builds its own history: each changed response creates a new immutable snapshot.

## 5. Limitations

- Remaining counts include prizes **won but not yet claimed**. Winners have one year after a game ends to claim, so remaining big prizes can overstate what is really available.
- Remaining counts say nothing about **where** unsold tickets are. Some of the print run is never distributed.
- `totalTicketsPrinted` is the print run, not tickets sold. Tickets sold is **estimated** (see SCORING_METHODOLOGY.md).
- Some prize descriptions can't be parsed to a number ("$10,000 A MONTH/LIF"). The cash value is still used for math.
- The free-ticket prize value equals the ticket price. It is valued as a replay of the same game.

## 6. Third-party sources (not used as data)

| Source | Notes |
|---|---|
| Lottery Valley (lotteryvalley.com/new-jersey) | Publishes its methodology. It estimates unsold tickets from claim pace, uses advertised (not cash) values, and builds a composite of 35% payout-rate percentile, 25% odds-to-win-more, 25% top-prize availability and 15% overall odds, redistributing missing weights. It excludes games with no top prizes. This was the most useful methodological reference. |
| LotteryCalc (lotterycalc.com/new-jersey) | Claims daily EV rankings from official data. Methodology not published. |
| Lottery.net, NJ101.5 articles | Top-prizes-remaining lists only. |
| NJ Lottery app | Has a "Scratch-Off Prizes Remaining" feature (same data). |

## 7. Recommended architecture (adopted)

1. Poll the official JSON endpoint (not the HTML) at most every few hours with an identifying User-Agent, timeouts and bounded retries.
2. Validate strictly. On any structural surprise, record a failed run and keep serving the last good data with a visible staleness warning.
3. Store each distinct response (gzip) plus normalized, append-only per-game and per-tier snapshots.
4. Compute analytics on read from the latest snapshot. Store default-weight scores per snapshot for history charts.
5. Backfill from Internet Archive captures of the same endpoint.
