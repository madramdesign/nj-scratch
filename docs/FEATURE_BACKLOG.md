# Feature backlog

**This is the canonical feature backlog.**
- Evidence, scoring and competitor context are in [FEATURE_RESEARCH.md](FEATURE_RESEARCH.md). Implementation order is in [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md).
- IDs are permanent. Never reuse an ID; mark items `Shipped`, `Rejected` or `Deferred` instead of deleting them.
- **Status** is one of `Research`, `Ready`, `In progress`, `Shipped (<commit>)`, `Deferred`, `Rejected`.
- **Priority** is P0, P1, P2 or Experimental.
- **Score** is the weighted priority from FEATURE_RESEARCH §10, out of 10.
- Last reviewed: 2026-11-25 (after Phase 1 and the iOS app shipped).

## Rules for every feature

These apply to every item below and are not repeated in each entry.

- Every view and endpoint must work in **both** modes:
  - **API mode:** Hono routes.
  - **Static mode:** `export-static.ts` must export the data, and `apps/web/src/static.ts` must read it.
- User-facing text must follow the banned-phrase rules in `explain.ts`: no "will win", "guaranteed" or "you should buy".
- Estimates are labeled **est.**

---

## FEATURE-001 (F02): Notable-changes feed (Atom + JSON Feed)

Status: Shipped 2026-11-25 (PR #1)
Priority: P0
Category: Automation / Notifications
Score: 8.25

**Problem:**
- Notable events (top or major prize claimed, score or label change, new game, status change) appear only when the user revisits the site.
- The Watchlist page itself says notifications aren't implemented (`apps/web/src/pages/Watchlist.tsx:78`).

**Proposed solution:**
- At export time, write these files:
  - `feed.xml` (Atom) and `feed.json` (JSON Feed 1.1) holding the last ~200 events with severity ≠ `info`.
  - One feed per price point: `feeds/price-<dollars>.xml`.
- Each entry has:
  - title: `<Game name> ($price): 2 × $100,000 top prizes claimed (3 left)`
  - a link to `/game/:id`
  - `updated = observed_at`
- Add `<link rel="alternate">` in `index.html`.
- Add a "Subscribe" panel on the Changes and Watchlist pages.

**User value:**
- "Follow" with any feed reader, or turn the feed into email via services such as Blogtrottr or Feedly.
- Zero personal data.

**Competitive advantage:** No competitor offers event-level feeds. Our event data is unique.

**Dependencies:** FEATURE-022 (F27), so notable events are not crowded out by info events.

**Existing components:**
- `listEvents` (database)
- `export-static.ts`
- `ChangeEventRow`

**New components:**
- `jpmonette/feed` (MIT) dependency
- `apps/api/src/feeds.ts`
- `GET /api/feed.xml` in API mode

**Technical complexity:** Low.

**Risk:**
- Feed noise. Mitigate by excluding `info` severity and capping entries.
- Feed entry IDs must be stable: use the `change_events.id` as the GUID.

**Research:** FEATURE_RESEARCH §7 (`feed`, 1,416★, MIT) and §8 (notifications comparison).

**Implementation plan:**
1. `buildFeed(events, base)` pure function, with tests (stable IDs, escaping, cap).
2. Add the route and the export step.
3. Add the alternate link and the Subscribe UI.
4. Add a feed validation test.

---

## FEATURE-002 (F03): Push alerts via ntfy and Discord

Status: In progress. The iOS app's local notifications for starred games come first; ntfy and Discord follow.
Priority: P0
Category: Automation / Notifications
Score: 7.85

**Update (2026-11-25).** Now that there is a native iOS app (FEATURE-035), the first delivery channel is in the app:
- background app refresh fetches `api/changes-notable.json`;
- starred games' new top-prize, sold-out, major-prize and profile events become local notifications;
- tapping a notification opens the game.

This needs no server, no subscriber list and no secrets. The ntfy and Discord plan below still covers people who don't use the app.

**Problem:** Feeds still require a reader. People want a phone notification.

**Proposed solution:**
- After a `success` run, the Actions job selects the new notable events.
- It POSTs them to:
  - **ntfy.sh** topics: `<prefix>-all`, `<prefix>-price-<n>` and `<prefix>-game-<id>`.
  - Optionally a **Discord webhook**.
- The site's Watchlist shows "Subscribe in ntfy" deep links for starred games.
- It sends at most 10 messages per run, then a summary message.

**User value:** Real-time alerts for watched games with no account.

**Competitive advantage:** Only ScratchIQ offers alerts, and it is a closed app.

**Dependencies:**
- FEATURE-001 (shared event selection)
- FEATURE-022

**Existing components:**
- `change_events`
- the workflow job
- `scripts` pattern of `verify-db.ts`

**New components:**
- `packages/scraper/src/notify.ts` (CLI)
- `notifications(event_id, channel, sent_at)` table, for idempotency across re-runs and pushes to `main`
- Actions secrets: `NTFY_TOPIC_PREFIX`, `DISCORD_WEBHOOK_URL`

**Technical complexity:** Medium. The hard parts are idempotency and choosing the topic scheme.

**Risk:**
- ntfy topics are publishable by anyone who knows the name. Use an unguessable prefix and document it.
- Rate limits are unverified.
- Tone: notifications must use neutral wording; add notification text to the banned-phrase test.
- Never notify from `stale` or `failed` runs.

**Research:** FEATURE_RESEARCH §8 and §18. ntfy: 35,756★, Apache-2.0.

**Implementation plan:**
1. Migration for the `notifications` table, and extend `verify-db`.
2. `selectUnsent(db, channel)` and `formatMessage(e)`, with tests.
3. `notify` CLI with `--dry-run`.
4. Workflow step after the backup step, gated by `if: secrets present`.
5. Subscribe UI.

---

## FEATURE-003 (F10): Zombie-game radar

Status: Shipped 2026-11-25 (PR #1)
Priority: P0
Category: Data / UX (**EXISTING — IMPROVE**: the Avoid page)

Score: 7.72

**Problem:**
- Games whose top prizes are all gone are still sold, sometimes for weeks or months.
- Today they are capped at score 40 and listed on Avoid, but without "since when" or the count of tickets still for sale.

**Proposed solution:**
- On the Avoid page, add a "Top prizes gone" section showing:
  - the date the last top prize was claimed (from `top_prize_claimed` events or snapshots),
  - estimated tickets still in circulation,
  - what top prize remains reachable.
- Emit a new event kind, `top_prize_sold_out` (severity `warning`), when the top-prize remaining count reaches 0.

**User value:** Avoid buying tickets that can no longer win the advertised top prize.

**Competitive advantage:** Parity with Scratch Off Odds ("Dead Ticket Radar"), but with dates and evidence.

**Dependencies:** None. Feeds FEATURE-002.

**Existing components:**
- `Avoid.tsx`
- `explain.ts` `avoidReasons`
- `diffGame`

**New components:**
- event kind in `changes.ts`
- `rebuildChangeEvents` support

**Technical complexity:** Low.

**Risk:** Won-but-unclaimed top prizes mean "0 remaining" is reliable, but ">0" may be overstated. That is fine for this feature.

**Research:** Competitor profile (Scratch Off Odds) in FEATURE_RESEARCH §6.

**Implementation plan:**
1. Add the event kind, with tests.
2. Rebuild events.
3. Add the Avoid page section.
4. Add the export.

---

## FEATURE-004 (F01): Upcoming, ending-soon and last-day-to-claim views

Status: Shipped 2026-11-25 (PR #1)
Priority: P0
Category: Data / UX (**EXISTING — IMPROVE**: hidden capability)

Score: 7.63

**Problem:**
- `classifyStatus` already returns `upcoming` and `ended`, but:
  - upcoming games are never stored or shown,
  - ended games are stored but there is no view.
- Users don't learn about new launches, sales ending, or claim deadlines. Claim deadlines are not printed on tickets.

**Proposed solution:**
- **Upcoming:** games with a future `launchDate`, with price, top prize and launch date. The API showed 15 such games on 2026-11-25.
- **Ending:** games entering `ended` in the next 30 days, i.e. `disableDate − 365 d` within 30 days, including their current score.
- **Last day to claim:** recently ended games with their `disableDate`.
- Events:
  - `game_upcoming` when an upcoming game first appears.
  - `sales_ending` emitted once when ≤ 14 days remain.

**User value:** Plan purchases, and know when to cash old tickets.

**Competitive advantage:** Parity with the ScratchOdds app, plus claim deadlines, which nobody shows clearly.

**Dependencies:** None.

**Existing components:**
- `classifyStatus`
- `games.disable_date`
- ended snapshots

**New components:**
- `upcoming_games` table, or snapshot `upcoming` games without tiers
- `GET /api/calendar`
- `calendar.json` export
- Calendar page

**Technical complexity:** Low–medium. The `disableDate − 365 d` rule mirrors njlottery.com's own tabs, but needs a verification check against `CLOSED` (open question 4).

**Risk:** Date semantics. Show "per njlottery.com" and link to the official page.

**Research:** FEATURE_RESEARCH §8 (15 future launches; claim rule N.J.A.C. 17:20-7.12).

**Implementation plan:**
1. Persist upcoming games during ingest.
2. Add the calendar service function, with tests.
3. Add the page.
4. Add the events.

---

## FEATURE-005 (F05): "Buy N tickets" probability calculator

Status: Shipped 2026-11-25 (PR #1)
Priority: P0
Category: Analytics / Power user
Score: 7.63

**Problem:** "If I buy 5 of these, what are my chances?" is the most natural question, and the current odds ("1 in 4.4") don't answer it.

**Proposed solution:**
- On the game detail page, the user chooses N (1–20).
- Show these values, computed exactly with the hypergeometric distribution over the remaining prize pool (estimated tickets remaining, remaining winners per tier):
  - P(at least one prize)
  - P(at least one prize > the ticket price)
  - P(at least one prize ≥ $X)
  - P(net profit across the N tickets)
- P(net profit) uses an exact convolution over tiers for small N, or Monte Carlo beyond about 10 tickets.
- Also show the expected loss (N × (price − EV)).

**User value:** Concrete, honest answers, including the expected loss.

**Competitive advantage:**
- Scratch Off Odds hides its simulator behind PRO.
- No competitor shows the result next to the expected loss.

**Dependencies:** None. Its output is consumed by FEATURE-008.

**Existing components:**
- `metrics.tiers` (remaining counts)
- `tickets.ticketsRemaining`

**New components:** `packages/analytics/src/session.ts`, with log-gamma hypergeometric math. It is browser-safe.

**Technical complexity:** Low. P(net profit) is medium.

**Risk:**
- The calculation is only as good as the tickets-remaining estimate. Label it est. and hide it when the estimate is unavailable.
- Framing: "chance", never "will".

**Research:** jeffreygchase/scratch-off-lottery and ethan-leinberger/lottery-research (FEATURE_RESEARCH §7).

**Implementation plan:**
1. `pAtLeastOne(K, T, n)` and `pNetProfit(tiers, T, n, price)`.
2. Tests against brute force on small pools.
3. UI panel with an N slider.

---

## FEATURE-006 (F24): Better alternative at the same price

Status: Shipped 2026-11-25 (PR #1)
Priority: P0
Category: Recommendations (**EXISTING — IMPROVE**: `explain.ts` peer medians)

Score: 7.60

**Problem:** On a weak game's page, the user isn't told that a clearly better game exists at the same price.

**Proposed solution:**
- When another active game at the same price beats this one, show a box: "At $10, *Game Y* has a higher estimated return (68% vs 61%) and more top prizes left relative to sales."
- A game "beats" this one when it is better on score **and** EV, or when the user's top-weighted component improves by ≥ 15 percentile points.

**User value:** One-click path from a bad choice to a less bad one.

**Competitive advantage:** No competitor does contextual alternatives.

**Dependencies:** None.

**Existing components:**
- `rankInPrice`
- peers in `explain.ts`
- `RankingTable`

**New components:** `alternatives()` in analytics.

**Technical complexity:** Low.

**Risk:** Must not read as an endorsement. Use comparative wording only.

**Research:** User workflow A (FEATURE_RESEARCH §4).

**Implementation plan:**
1. Pure function with tests.
2. Detail-page box.
3. Hook into the Avoid page.

---

## FEATURE-007 (F04 + F28): Pipeline self-monitoring and anomaly alerts

Status: Shipped 2026-11-25 (PR #1)
Priority: P0
Category: Reliability / Automation
Score: 6.97 (F28: 6.35)

**Problem:**
- A failed scrape is only a `::warning::` in the Actions log.
- The 60-day scheduled-workflow disable rule could stop updates silently.
- Data anomalies (stale copies, structure revisions) surface only on the Data Quality page.

**Proposed solution:** A workflow step that, using `gh issue`:
- opens or updates a single labeled issue `pipeline-health` when any of these is true:
  - the last N runs failed,
  - there has been no `success` for more than 36 h,
  - a `structure_changed` warning appears,
  - `stale` runs exceed 3 in 24 h;
- closes the issue automatically when the condition clears;
- writes a weekly heartbeat comment.

**User value:** Keeps the data honest and fresh. This is an operator feature.

**Competitive advantage:** Indirect (trust). Competitors show stale data without warning (FEATURE_RESEARCH §6).

**Dependencies:** None.

**Existing components:**
- `update_runs`
- `DashboardService.status()` warnings
- `verify-db.ts`

**New components:**
- `packages/scraper/src/health.ts` (exit code plus a JSON summary)
- workflow step with `issues: write`

**Technical complexity:** Low.

**Risk:**
- Alert noise. Use thresholds and dedupe to one issue.
- The issue body is public, so it must hold no secrets.

**Research:** FEATURE_RESEARCH §8 (GitHub 60-day rule) and §18.

**Implementation plan:**
1. `health.ts` with tests on fixture run histories.
2. Workflow step.
3. Document it in the README.

---

## FEATURE-008 (F06): Budget & goal planner

Status: Research
Priority: P1
Category: Recommendations / Power user
Score: 7.40

**Problem:** A ranking is not a purchase plan. Users think "I have $20; I want a shot at $1,000 or more."

**Proposed solution:**
- Planner page with these inputs:
  - **Budget:** $1–$200.
  - **Goal:** best expected return, best chance of any net profit, best chance of at least one prize ≥ $X, or best chance at a top prize.
- Output:
  - the top 5 single-game plans, e.g. "2 × $10 Game Y",
  - optionally mixed baskets, using a small knapsack over price points,
  - for each plan: the goal probability, the expected loss in dollars, and a "worst likely outcome" line.
- A responsible-play footer links to limits (FEATURE-011).

**User value:** Answers the real question directly.

**Competitive advantage:**
- The ScratchOdds app has an opaque version.
- Ours is exact and shows expected loss.

**Dependencies:** FEATURE-005.

**Existing components:**
- `analyzeGames` (runs in the browser)
- settings context

**New components:**
- `analytics/planner.ts`
- Planner page

**Technical complexity:** Medium.

**Risk:**
- This optimizes a negative-EV purchase. Copy must say "least costly way to…", always show the expected loss, and never default to a large budget.

**Research:** FEATURE_RESEARCH §6 (ScratchOdds budget planner) and §15 (#3).

**Implementation plan:**
1. Single-game plans.
2. Goals.
3. Mixed baskets.
4. URL-shareable inputs (FEATURE-010).

---

## FEATURE-009 (F07): Leftover-adjusted EV (unclaimed vs. unsold model)

Status: Research
Priority: P1
Category: Analytics / Data science
Score: 7.25 (transformative; cost-penalized)

**Problem:**
- Remaining counts include prizes that were won but not yet claimed, and prizes on tickets that will never be sold.
- Every tracker, including this one, treats them as available.
- In our DB, 29% of top-tier prizes in 167 ended games were still unclaimed when sales stopped.

**Proposed solution:**
1. Track every ended game through to expiry, roughly one year.
2. Calibrate by price point and prize size:
   - **(a)** the share of "remaining at end of sales" prizes that are claimed later (won but late),
   - **(b)** the share never claimed (unsold or lost).
3. Combine with sell-through to estimate, for each active game, P(a remaining top prize is on an unsold ticket).
4. Produce an adjusted remaining count, and an adjusted EV range.

**User value:** More honest availability numbers, and fewer late-game games that are overrated.

**Competitive advantage:** **Unique.** Requires the per-game history only this project has.

**Dependencies:**
- FEATURE-016 (F25, report cards share the data)
- FEATURE-014 (F09 velocity)
- FEATURE-015 (F08 intervals)
- FEATURE-021 (F26) before it touches scoring

**Existing components:**
- ended `game_snapshots` and `prize_snapshots`
- `estimateTickets`

**New components:**
- `analytics/leftover.ts`
- `calibration` table (versioned, with sample sizes)
- methodology v2 doc

**Technical complexity:** High. Small samples need Bayesian shrinkage toward price-tier means.

**Risk:**
- Model error. Always show it as a range with "n = games".
- Ship it as an informational overlay before it affects scores.

**Research:** FEATURE_RESEARCH §8, §11 and §15. MA and FL unclaimed-prize reporting.

**Implementation plan:**
1. Descriptive stats page (FEATURE-016).
2. Calibration job that runs on each ingest.
3. Overlay on the detail page.
4. Optional score component behind `METHODOLOGY_VERSION = 2`.

---

## FEATURE-010 (F14): Shareable URL state

Status: Ready
Priority: P1
Category: UX
Score: 6.78

**Problem:** Filters, sorts, weights and the major threshold live in React state and localStorage, not in the URL. Views can't be shared or bookmarked.

**Proposed solution:**
- Sync filters, sort and weights into query parameters with `useSearchParams`.
- Precedence: URL first, then localStorage defaults.
- Add a "Copy link" button.

**User value:** Share "best $10 games with a $100k+ prize" with a friend.

**Competitive advantage:** Minor; parity.

**Dependencies:** None.

**Existing components:**
- `settings.tsx` (already builds a `query` string)
- `Filters.tsx`

**New components:** `useUrlState` hook.

**Technical complexity:** Low.

**Risk:** Static hosting uses the 404 fallback. Query strings are fine.

**Research:** Repo inspection: no `useSearchParams` anywhere.

**Implementation plan:**
1. Hook with tests.
2. Wire into AllGames and the settings context.
3. Add the Copy button.

---

## FEATURE-011 (F12): Spend limits & reality checks

Status: Ready
Priority: P1
Category: Responsible play / Personalization
Score: 7.30

**Problem:** There are no responsible-play tools beyond a disclaimer. Competitors push "win more" framing; we can be the honest alternative.

**Proposed solution:** All of this is optional and stored on the device only.
- The user sets a monthly budget.
- The planner and calculator show the share of that budget.
- When the log (FEATURE-012) passes 80% and 100% of the budget, show a calm banner.
- A "reality check" card shows the cumulative expected loss at current EV.
- Link to 1-800-GAMBLER and the NJ self-exclusion info.

**User value:** Trust, and safer use.

**Competitive advantage:** No competitor does this.

**Dependencies:** FEATURE-012 (soft). The banner works with planner input alone.

**Existing components:** settings localStorage.

**New components:** `limits` settings and a banner component.

**Technical complexity:** Low.

**Risk:** Must not feel paternalistic. Off by default, easy to dismiss.

**Research:** FEATURE_RESEARCH §8 (responsible gambling) and §15 (#5).

**Implementation plan:**
1. Settings.
2. Banner.
3. Integration with the planner and log.

---

## FEATURE-012 (F11): Personal ticket & ROI log (on-device)

Status: Research
Priority: P1
Category: Personalization
Score: 6.88

**Problem:** Users can't see whether they're up or down, or how their results compare with expectations.

**Proposed solution:**
- Quick-add entries: game (searchable), quantity, amount won, date.
- Stored in localStorage (or IndexedDB). Export and import as JSON.
- Charts:
  - spend vs. winnings over time,
  - actual result vs. expected result (Σ EV at purchase time), with a band showing normal luck.

**User value:** Self-knowledge. It also makes the house edge concrete.

**Competitive advantage:** A PRO feature elsewhere; free here, and linked to live EV.

**Dependencies:** None. It enables FEATURE-011.

**Existing components:**
- `GameSummary`
- `currentEvCents`
- Recharts

**New components:**
- `apps/web/src/log/*`
- Log page

**Technical complexity:** Medium.

**Risk:**
- Data loss if browser storage is cleared. Prompt the user to export.
- Privacy: never uploaded.

**Research:** LuckBalance, Scratch Off Odds PRO, LindsayWithAnA/mo-scratchers.

**Implementation plan:**
1. Store with a schema version.
2. Entry form.
3. Charts.
4. Export and import.

---

## FEATURE-013 (F13): Installable PWA

Status: Ready (lower value now that the native iOS app exists; still useful for Android)
Priority: P2
Category: Mobile
Score: 6.80

**Problem:** Mobile users at a store want quick access, and native apps are blocked by store policies.

**Proposed solution:**
- Use `vite-plugin-pwa` for the manifest, icons and service worker.
- Caching:
  - network-first for `api/*.json`,
  - cache-first for assets.
- Show an "offline — data as of X" banner.

**User value:** Home-screen app; works with a poor signal.

**Competitive advantage:** Parity with apps, with no store gatekeeping.

**Dependencies:** None.

**Existing components:** Vite build; `freshen()` staleness logic in `static.ts`.

**New components:** PWA config and icons.

**Technical complexity:** Low.

**Risk:** A stale service-worker cache could show old data. Use network-first and show the data timestamp prominently.

**Research:** vite-plugin-pwa (4,315★, MIT).

**Implementation plan:**
1. Plugin and manifest.
2. Caching strategy.
3. Test offline behaviour in the preview.

---

## FEATURE-014 (F09): Sell-through velocity & depletion forecast

Status: Research
Priority: P1
Category: Analytics / Forecasting
Score: 7.08

**Problem:** Snapshots show where a game is, not where it's heading.

**Proposed solution:** For each game:
- tickets sold per day: a robust slope over the last 30–90 days of `tickets_remaining_est`;
- projected date when 97% are sold, with an interval;
- projected top-prize claims by then;
- a forecast line on the history chart.

**User value:** "Sells out in about 6 weeks; top prizes are being claimed slower than sales."

**Competitive advantage:** Unique.

**Dependencies:** None. Feeds FEATURE-009.

**Existing components:**
- `scoring_snapshots`
- `gameHistory`
- `HistoryChart`

**New components:** `analytics/forecast.ts`.

**Technical complexity:** Medium. Snapshots are irregular, and backfill gaps are large.

**Risk:** Early in a game's life there are few points. Require at least 3 points spanning at least 14 days, otherwise show "not enough history".

**Research:** FEATURE_RESEARCH §11. Example: #1816 fell from 2.45M to 1.42M over 12 months.

**Implementation plan:**
1. Slope estimator (Theil–Sen), with tests.
2. Projection with an interval.
3. UI.

---

## FEATURE-015 (F08): Uncertainty ranges for EV and odds

Status: Research
Priority: P1
Category: Analytics
Score: 6.85

**Problem:** A single EV number (e.g. 64.2%) implies precision the estimate doesn't have. Only a binary "low confidence" flag exists.

**Proposed solution:**
- Compute low and high ticket estimates using:
  - the spread across retail tiers (`estimateTickets.spread`),
  - a claim-lag allowance.
- Propagate them to EV, odds and retention.
- Show the result as "61–66%".
- Scoring keeps the point estimate.

**User value:** Honest comparisons. Two games with overlapping ranges are effectively tied.

**Competitive advantage:** Unique.

**Dependencies:** None.

**Existing components:** `estimateTickets` (already computes `spread`).

**New components:** interval fields on `GameMetrics`.

**Technical complexity:** Medium.

**Risk:** UI clutter. Show ranges on detail pages and as a tooltip in tables.

**Research:** FEATURE_RESEARCH §6 ("nobody does well").

**Implementation plan:**
1. Interval math.
2. API fields.
3. UI.

---

## FEATURE-016 (F25): Ended-game report cards

Status: Research
Priority: P2
Category: Analytics / Content
Score: 6.55

**Problem:** There is no view of how games finished: final EV vs. launch EV, how long top prizes lasted, and how many were left at the end.

**Proposed solution:**
- Ended Games page, with a per-game report card.
- Aggregates by price point, e.g. "Median $10 game sold out of top prizes N days before sales ended."

**User value:** Context for judging active games.

**Competitive advantage:** Unique; it uses history only this project has.

**Dependencies:** None. Groundwork for FEATURE-009.

**Existing components:**
- 167 ended games' snapshots
- `HistoryChart`

**New components:** `endedSummary()` and the page.

**Technical complexity:** Medium.

**Risk:** Survivorship bias. Backfill covers only 9 dates.

**Research:** FEATURE_RESEARCH §11.

**Implementation plan:**
1. Summary function.
2. Export.
3. Page.

---

## FEATURE-017 (F19): After-tax EV toggle

Status: Research (tax rules must be verified)
Priority: P2
Category: Analytics
Score: 6.33

**Problem:** Large prizes are subject to federal and NJ withholding, which no tracker reflects.

**Proposed solution:**
- Settings toggle: "Show after-withholding values".
- Apply a versioned tax table per tier, using its cash value.
- Show both pre-tax and after-tax EV.
- Scoring can optionally use after-tax EV.

**User value:** More realistic value of big-prize-heavy games.

**Competitive advantage:** Unique (FEATURE_RESEARCH §6).

**Dependencies:** None.

**Existing components:** `evFrom` (a per-tier value function hook is needed).

**New components:** `analytics/tax.ts` and a tax config file with its source and date.

**Technical complexity:** Medium.

**Risk:**
- The rules may be wrong, or may change.
- Withholding is not the same as tax owed. Label it "withholding, not tax advice".
- **Open question 3** must be resolved before building.

**Research:** None yet. To do.

**Implementation plan:**
1. Verify the rules.
2. Tax table with tests.
3. Toggle.

---

## FEATURE-018 (F16): Open data export

Status: Ready
Priority: P1
Category: Data / Developer
Score: 6.90

**Problem:** The static JSON is an undocumented API. Researchers, journalists and AI assistants can't easily use the data.

**Proposed solution:**
- Publish `data/games.csv`, `data/tiers.csv` and `data/events.csv`.
- Optionally publish a nightly copy of `njscratch.db`.
- Write `docs/OPEN_DATA.md` with the schema and license notes (the data is NJ's; our derived metrics are ours).
- Add a "Browse in Datasette Lite" link.

**User value:** Transparency and reuse. It is also the cheap alternative to an MCP server.

**Competitive advantage:** No competitor publishes its data.

**Dependencies:** None.

**Existing components:**
- `export-static.ts`
- `DATA_DICTIONARY.md`

**New components:** CSV writer and the doc.

**Technical complexity:** Low.

**Risk:**
- Pages bandwidth: the DB is about 2.4 MB, which is fine.
- Raw payloads are not published.

**Research:** simonw/datasette-lite (FEATURE_RESEARCH §7).

**Implementation plan:**
1. CSV export.
2. Doc.
3. Link.

---

## FEATURE-019 (F23): Side-by-side comparison

Status: Ready
Priority: P1
Category: UX
Score: 6.67

**Problem:** Choosing between two or three games means switching between tabs.

**Proposed solution:**
- Add "Compare" checkboxes in tables.
- `/compare?ids=1816,1851,1902` shows key metrics side by side and an overlay of the history charts.

**User value:** Faster decisions.

**Competitive advantage:** Minor.

**Dependencies:** FEATURE-010 (URL state).

**Existing components:**
- game detail `Stat` components
- `HistoryChart`

**New components:** Compare page.

**Technical complexity:** Low.

**Risk:** None notable.

**Research:** Repo inspection: no compare view exists.

**Implementation plan:**
1. Page.
2. Table checkboxes.
3. Tests.

---

## FEATURE-020 (F18): Weekly "what changed" digest

Status: Research
Priority: P1
Category: Automation / Content
Score: 7.15

**Problem:** About 120 events per update bury the signal.

**Proposed solution:**
- Every Monday, generate `digest/<yyyy-ww>.json` and a Digest page containing:
  - biggest score movers,
  - top prizes claimed,
  - new and ending games,
  - median EV trend.
- The digest is also posted as one feed and ntfy item.
- It is template-based. Optional LLM phrasing comes later, behind a number-checking validator.

**User value:** A one-minute weekly catch-up.

**Competitive advantage:** No competitor offers this.

**Dependencies:** FEATURE-001.

**Existing components:**
- `change_events`
- `scoring_snapshots`

**New components:** `digest.ts` and the page.

**Technical complexity:** Medium.

**Risk:** LLM hallucination, if an LLM is added. Its output must pass a numeric diff check.

**Research:** FEATURE_RESEARCH §13.

**Implementation plan:**
1. Digest function.
2. Workflow schedule check (is today Monday?).
3. Page.
4. Feed item.

---

## FEATURE-021 (F26): Methodology-versioned re-scoring

Status: Research
Priority: P2
Category: Developer / Data integrity
Score: 5.60

**Problem:**
- `scoring_snapshots` are written once with methodology v1.
- Any methodology change, such as FEATURE-009 or FEATURE-017, would make history charts mix methodologies.

**Proposed solution:**
- `npm run rescore -- --version 2` recomputes scoring for all snapshots from stored snapshots (or `raw_payloads`) in one transaction.
- Keep v1 rows. Charts filter by version.

**User value:** Consistent history.

**Competitive advantage:** Indirect.

**Dependencies:** Needed before any scoring change.

**Existing components:**
- `loadSnapshot`
- `analyzeGames`
- `rebuildChangeEvents` pattern

**New components:** rescore CLI and a version column in queries.

**Technical complexity:** Medium.

**Risk:** Runtime grows with history size. Check `verify-db` behaviour.

**Implementation plan:**
1. CLI.
2. Query filter.
3. Tests.

---

## FEATURE-022 (F27): Scalable change-event export

Status: Shipped 2026-11-25 (PR #1)
Priority: P0
Category: Reliability
Score: 6.17

**Problem:**
- `export-static.ts` exports `/api/changes?limit=1000`.
- At about 105–129 events per update and about 2 updates per day, the hosted Changes page covers only about 4 days, and older notable events disappear.

**Proposed solution:**
- Export `changes-notable.json`: all non-info events, capped at about 2,000.
- Export `changes-<yyyy-mm>.json` monthly files for all events.
- The Changes page loads notable events by default and fetches older months on demand.

**User value:** Complete history on the hosted site.

**Competitive advantage:** None directly. Enables FEATURE-001.

**Dependencies:** None.

**Existing components:**
- `listEvents`
- `static.ts`

**New components:** Export loop.

**Technical complexity:** Low.

**Risk:** None.

**Research:** Measured on the production DB (FEATURE_RESEARCH §5).

**Implementation plan:**
1. Export files.
2. `static.ts` route.
3. Changes page "load older".

---

## FEATURE-023 (F15): Pre-rendered per-game pages + preview images

Status: Deferred to Phase 3
Priority: P2
Category: Growth / SEO
Score: 6.28

**Problem:**
- The site is an SPA with a 404 fallback, so game pages aren't crawlable.
- Shared links have no preview image.

**Proposed solution:**
- At export, write `/game/<id>/index.html` with a title, meta description and OG tags.
- Generate a per-game OG image with satori + resvg.

**Dependencies:** None.

**Existing components:**
- `export-static.ts`
- `index.html`

**New components:** Prerender step and image generator.

**Technical complexity:** Medium.

**Risk:**
- Build time: about 65 images.
- Search visibility for gambling content can attract scrutiny. Keep the disclaimers.

**Implementation plan:**
1. Static HTML shells.
2. OG images.

---

## FEATURE-024 (F17): Read-only MCP server

Status: Experimental
Priority: Experimental
Category: AI / Developer
Score: 5.65

**Problem:** AI assistants can't query the data directly.

**Proposed solution:** A stdio MCP server, `npx nj-scratch-mcp`, over a local copy of the DB, with these tools:
- `top_games(price?, by?)`
- `game(id)`
- `history(id)`
- `changes(since)`

Build it only after FEATURE-018 shows demand.

**Dependencies:** FEATURE-018.

**Existing components:** `DashboardService`.

**New components:** `apps/mcp`.

**Technical complexity:** Medium.

**Risk:** Assistants restating EV as advice. Tool descriptions must carry the disclaimer.

**Research:** myque08/savvymcp; MCP TypeScript SDK.

---

## FEATURE-025 (F29): Spanish translation

Status: Deferred
Priority: P2
Category: Accessibility
Score: 5.60

**Problem:** NJ has a large Spanish-speaking population, and all copy is English.

**Proposed solution:** An i18n layer for the UI. Generated explanations would need their templates translated.

**Dependencies:** None.

**Existing components:** None.

**New components:** i18n framework and string extraction.

**Technical complexity:** Medium, because `explain.ts` sentences are built from code.

**Risk:** Translation quality on the responsible-gambling copy.

---

## FEATURE-026 (F22): Multi-state support (NY, TX first)

Status: Deferred (Phase 5)
Priority: P2
Category: Platform

Score: 5.55

**Problem:** NJ-only limits the audience.

**Proposed solution:**
- Pluggable source adapters:
  - NY: data.ny.gov Socrata (paid, unpaid, total per tier).
  - TX: CSV with close dates.
- A printed-tickets estimate from overall odds × total prizes.
- Lower-confidence labels for these estimates.

**Dependencies:** FEATURE-015 (uncertainty), because estimates will be weaker.

**Existing components:**
- `lottery-data` normalize layer
- ingest pipeline

**New components:**
- per-state adapters
- `state` column in every table
- routing

**Technical complexity:** High.

**Risk:**
- Dilutes NJ depth.
- Per-state maintenance.
- Weaker EV without printed counts.

**Research:** FEATURE_RESEARCH §8.

---

## FEATURE-027 (F30): Privacy-friendly usage analytics

Status: Deferred
Priority: P2
Category: Product
Score: 4.60

**Problem:** We don't know which views are used.

**Proposed solution:** Cookieless page counts, e.g. GoatCounter or a similar tool.

**Risk:** Adds a third-party request, and conflicts with the privacy posture if the tool fingerprints visitors.

**Decision:** Only add it if roadmap decisions stall for lack of usage data.

---

## FEATURE-028 (F31): Web Push notifications

Status: Deferred
Priority: P2
Category: Notifications
Score: 5.78

**Reason for deferral:** It needs subscription storage, which means a server. ntfy (FEATURE-002) covers the need. Revisit if ntfy adoption is high.

---

## FEATURE-029 (F32): Email digest

Status: Deferred
Priority: P2
Category: Notifications
Score: 5.92

**Reason for deferral:** A self-managed list is a privacy burden. If email is wanted, point Buttondown's RSS-to-email at FEATURE-001.

---

## FEATURE-030 (F21): Retailer map

Status: Deferred
Priority: Experimental
Score: 4.10

**Reason for deferral:** The NJ locations API has no inventory or winner data, and "lucky retailer" framing is fallacious.

---

## FEATURE-031 (F20): Second-chance value in EV

Status: Deferred
Priority: Experimental
Score: 4.00

**Reason for deferral:** The value per entry is unpublished and small. It adds model noise.

---

## FEATURE-032 (F33): Natural-language Q&A chatbot

Status: Rejected
Score: 4.03

**Reason:** Deterministic filters answer these questions exactly. It also needs a backend or key, and carries hallucination and persuasion risk.

---

## FEATURE-033 (F34): Ticket scanning / OCR

Status: Rejected
Score: 2.98

**Reason:** The official app already checks winners. No analytic value, and there is liability.

---

## FEATURE-034 (F35): Accounts & cross-device sync

Status: Rejected (revisit only with demand)
Score: 3.55

**Reason:** Requires a server and would store personal gambling data. Export/import covers the need.

---

## FEATURE-035 (F36): Native iOS/Android apps

Status: **iOS shipped.** Built 2026-11-25 (PR #2), submitted to App Review the same day (version 1.0, build 2). Android is still rejected.
Score: 3.92 (scored before the user decided to build it)

**History:** this was originally rejected: Google Play bans odds-tracking "companion" apps, and Apple's guideline 5.3 is a review risk. The user chose to build a native SwiftUI app anyway (`apps/ios`).

Mitigations for 5.3:
- information only: no ticket sales, wagers or purchase links;
- a first-launch notice with 18+ and 1-800-GAMBLER;
- expected loss shown next to every probability;
- an 18+ age rating;
- review notes explaining all of the above.

Android stays rejected because of the Play policy; Android users have the website.

**Follow-ups:**
- the App Review outcome;
- FEATURE-002 notifications in the app (in progress);
- iPad-specific layouts, if usage warrants them.

---

## FEATURE-036 (F37): Hot/cold "game temperature" labels

Status: Rejected
Score: 4.25

**Reason:** Gambler's fallacy, and it conflicts with the project's honesty positioning.

---

## Phase 1 implementation notes (2026-11-25)

How the Phase 1 items were built, where it differs from the plans above:

- **FEATURE-022:**
  - `GET /api/changes?notable=1` and `api/changes-notable.json` (up to 5,000 non-info events).
  - The Changes page uses that file unless "All" or "Other prizes" is selected.
- **FEATURE-007:**
  - `packages/scraper/src/health.ts` and `npm run health`.
  - Workflow step "Report pipeline health" (needs `issues: write`). It opens, updates and closes one issue labeled `pipeline-health`.
  - The 60-day heartbeat was not built. `data`-branch pushes probably count as activity; this is open question 1.
- **FEATURE-003:**
  - New event kind `top_prize_sold_out` (warning).
  - Avoid page section "Top prizes gone, still on sale". The date shown is when the game was *first seen* with none left, not the claim date: snapshots can be months apart in the backfilled history.
  - `EVENTS_VERSION` and the `app_meta` table make `npm run scrape` rebuild stored events once when the event rules change.
  - The unused `game_removed` kind was removed.
- **FEATURE-004:**
  - Upcoming games are now snapshotted, with full prize tables, and produce a `game_announced` event.
  - At launch the event is `game_added` ("New game on sale"), not `status_changed`.
  - `GET /api/calendar` and `api/calendar.json` feed the "Launches & Deadlines" page.
  - The first update after deploy announces every currently known upcoming game (15 on 2026-11-25) at once.
  - Using njlottery.com's rule (sales end 365 days before `disableDate`), the soonest "sales end" date for an active game is more than a year out. That view is less useful than expected (see open question 4).
- **FEATURE-001:**
  - Hand-written Atom and JSON Feed (`apps/api/src/feeds.ts`); no dependency was added.
  - Feeds are served at `/feed.xml`, `/feed.json` and `/feeds/price-<dollars>.xml`, and exported to the Pages root using `SITE_URL` from `actions/configure-pages`.
  - Entry ids hash the event content, so they survive event rebuilds.
  - Subscribe panel on the Changes and Watchlist pages; `<link rel="alternate">` in `index.html`.
- **FEATURE-005:**
  - `packages/analytics/src/session.ts` provides exact "at least one" chances and an exact dollar-grid convolution for "win back more than you spend". Tickets are treated as independent; error is under 0.01%.
  - Panel "If you buy several tickets" on the game page, for 1–20 tickets.
- **FEATURE-006:**
  - `packages/analytics/src/alternatives.ts`. Alternatives must be at least 5 points better and have a higher estimated return, and must still have a top prize left.
  - Shown as a box on game pages and an inline line on Avoid cards.

## Known issues found during research (not features)

These are small enough to fix opportunistically.

- ~~`ChangeKind` declares `game_removed`, but it is never emitted.~~ Removed in Phase 1.
- Static-mode watchlist entries have `added_at: 0`, `score_at_add: null` and no notes (`apps/web/src/static.ts`). Store `{id, addedAt, scoreAtAdd}` in localStorage.
- Hosted Changes page truncation. This is FEATURE-022.
