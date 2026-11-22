# Scoring methodology

Methodology version **1** (stored with every scoring snapshot). Code: `packages/analytics/src/{metrics,scoring,explain}.ts`.

The question being answered is **which active NJ scratch-off games have the strongest remaining-prize profile relative to their cost and to the other games available right now**. The score does *not* predict wins. Every game returns less than it costs on average.

## 1. Inputs (official)

From `GET /api/v1/instant-games/games/` (see DATA_RESEARCH.md): per tier, `prizeAmount` (cents; cash value for annuities), `winningTickets` (original), `paidTickets`, `claimedTickets` and `tierType`; per game, `ticketPrice` and `totalTicketsPrinted`.

**Remaining prizes** (NJ's own formula): `original − claimed` if prize ≥ $600, else `original − paid`. Negative results are clamped to 0 and flagged.

## 2. Exact metrics (no estimation)

| Metric | Formula |
|---|---|
| Top prize | tier(s) with the highest `prizeAmount`; remaining / original / % |
| Major prizes | tiers whose *headline* value (advertised value for annuities) ≥ threshold (default $10,000; user-selectable $1K–$1M) |
| All prizes | Σ remaining / Σ original |
| Prize value | Σ count × prizeAmount (original, remaining, % remaining) |
| Odds at launch | printed ÷ prizes (any, top, profit, per tier) |
| EV at launch | see §4, with counts = original and N = printed |
| Prize-to-ticket ratio | remaining prize value ÷ ticket price |

## 3. Estimated tickets remaining

Retail-paid tiers (< $600, ≥ 1,000 winners) contain hundreds of thousands of winners spread uniformly through the print run, so the paid share of those winners tracks the share of tickets sold and scratched:

```
soldFraction       = Σ min(paid, original) / Σ original      over retail tiers
ticketsRemaining   = printed × (1 − soldFraction)
```

**Refuses to estimate** ("Insufficient data to estimate tickets remaining") when:
- `totalTicketsPrinted` is missing,
- retail tiers have fewer than 10,000 winners in total, or
- soldFraction ≥ 97%. Near the end of a run, unredeemed prizes dominate the remaining count.

**Low confidence** is flagged when large retail tiers disagree by more than 12 percentage points.

**Bias:** some small prizes are never cashed, so soldFraction is slightly *low*, ticketsRemaining slightly *high*, and current EV slightly *low* (conservative). Unclaimed *big* prizes bias the other way (see limitations).

## 4. Expected value

Free-ticket prizes are worth another play of the same game, so EV is defined recursively:

```
EV = cashEV + p_free × EV   ⇒   EV = cashEV / (1 − p_free)
cashEV = Σ_{non-free tiers} count × prizeAmount / N
p_free = Σ_{free tiers} count / N
```

- **EV at launch** (exact): counts = original, N = printed.
- **Current EV** (estimate): counts = remaining, N = estimated tickets remaining.
- Annuity tiers use NJ's published **cash value** (`prizeAmount`), not the headline.
- Break-even: expected return = EV ÷ price; expected loss = price − EV.
- If current EV exceeds the price, the game is still shown but carries a warning. This almost always means prizes were won and not yet claimed, or the sales estimate is off.

Verified independently: a separate Python implementation of these formulas matched the API for all 65 active games on 2026-11-22.

## 5. Score components

| Key | Component | Raw value | Default weight |
|---|---|---|---:|
| `expectedReturn` | Estimated return per $1 | current EV ÷ price (capped at 100%) | **35** |
| `topPrize` | Top-prize availability vs. sales | (% top prizes left) ÷ (% tickets left) | **20** |
| `majorPrize` | Major-prize availability vs. sales | (% major prizes left) ÷ (% tickets left) | **20** |
| `profitOdds` | Chance of winning more than the ticket cost | P(cash prize > price) per remaining ticket | **15** |
| `prizeValue` | Prize value remaining vs. sales | (% prize $ left) ÷ (% tickets left) | **10** |

**Why "÷ % tickets left" (retention)?** A brand-new game has 100% of everything left. That is just the launch distribution, not an opportunity. Retention equals *original odds ÷ current odds*: 1.5× means that prize is 1.5 times as likely per ticket as at launch. This is what makes "Game B (5 of 8 $2M left) beats Game A (1 of 10 $5M left)" come out right, and it is tested (`analytics.test.ts`).

### Normalization

Each component is converted to a **percentile among the active, valid games** (0 = worst, 100 = best, ties averaged). Percentiles make components with different units comparable and are robust to outliers, such as a single game with a huge retention ratio from small counts.

```
score = Σ weight_i × percentile_i / Σ weight_i      (over components with data)
```

- **Missing components** (for example, no prizes ≥ threshold in a $1 game) are dropped and their weight is redistributed. The game page lists them.
- At least 2 components with data are required, otherwise the game is "unrated".
- **No top prizes left caps the score at 40.** Those games can never be labeled strong.
- Labels: ≥ 67 🟢 *strong*, 40–66 🟡 *average*, < 40 🔴 *weak* remaining-prize profile.

### Why these weights (and not the brief's draft)

The brief proposed 25 major / 20 top / 20 value / 15 EV / 10 price-efficiency / 10 odds. Changes:

- **EV raised to 35%.** It is the only component that summarizes the *whole* remaining distribution in dollars, and it is already price-normalized. This matches the practitioner reference (Lottery Valley: 35% payout rate).
- **"Ticket-price efficiency" removed as a separate component.** EV ÷ price *is* price efficiency, so counting both double-counts.
- **"Odds of any prize" replaced with "odds of winning more than the cost".** Most "any prize" wins are free tickets or break-even amounts. Ranking by them rewards games that mostly return your stake.
- **Prize value reduced to 10%.** Value retention overlaps heavily with EV.
- Top and major prizes stay at 20% each, so jackpot availability carries 40% in total, while EV keeps small-prize-heavy games honest.

Users can change all weights and the major threshold in the UI. Weights are normalized, so they don't need to sum to 100.

## 6. Explanations

`explain.ts` generates sentences only from computed metrics and peer medians (same price point, then all games). For example, "2 of 3 top prizes ($500,000) remain (67%), while an estimated 31% of tickets are left, so top-prize odds are about 2.1× better than at launch." Thresholds: retention ≥ 1.15 is a strength and ≤ 0.75 is a weakness; return ±2 points versus the price-point median. Tests assert that the phrases "will win", "guaranteed" and "you should buy" never appear.

## 7. Limitations

- Remaining big prizes may already be won but unclaimed, which inflates top/major retention and EV.
- Estimated values depend on the retail paid ratio and are labeled **est.** everywhere.
- Percentile scores are relative: a "strong" game in a weak field is still a negative-EV purchase.
- Scores in history charts use the default weights and the methodology version at ingest time.
