# GitHub & existing-project research

Searched 2026-11-21 with `gh search repos` ("scratch off lottery", "scratchoff", "scratch-off expected value", "nj lottery", "lottery scratcher", "instant games lottery scraper") plus repo metadata and README checks.

**Summary:** no NJ scratch-off tracker exists on GitHub. The ecosystem is small: every repo has ≤ 4 stars and most are single-state hobby projects. Nothing was reusable as a dependency. No code was copied; a few ideas were adopted.

| Repository | ★ | Last push | License | State / stack | Takeaways |
|---|---:|---|---|---|---|
| [astrowonk/nc_scratchers](https://github.com/astrowonk/nc_scratchers) | 0 | 2026-10-31 | GPL-3.0 | NC; Python Dash plus DB builder, deployed | Most mature. Ranks by expected value and plans time-series plots. Confirms the "snapshot DB + dashboard" architecture. |
| [jimmayu/mo-scratchoff-ev](https://github.com/jimmayu/mo-scratchoff-ev) | 0 | 2026-05-16 | MIT | MO; static HTML report via CI | EV ratio = remaining prize value / (remaining tickets × price). Same core idea as our current EV. |
| [jeffreygchase/scratch-off-lottery](https://github.com/jeffreygchase/scratch-off-lottery) | 1 | 2025-12-20 | none | NC; Java | Hypergeometric "buy N tickets" probabilities. Possible future feature. |
| [Jay55Martinez/Mass_Lotto_Database_MySQL](https://github.com/Jay55Martinez/Mass_Lotto_Database_MySQL) | 1 | 2025-11-17 | none | MA; C#, MySQL, official API | Separate tier and history tables. Validated our normalized schema. |
| [Railikebread/scratchsmart](https://github.com/Railikebread/scratchsmart) | 1 | 2025-05-26 | none | NY; Spring + React | Mostly a plan. |
| [ThatOrJohn/lottery-texas-scratchoffs](https://github.com/ThatOrJohn/lottery-texas-scratchoffs) | 1 | 2025-04-30 | none | TX; GitHub Action into Neo4j | Daily-snapshot pattern for building history the source doesn't keep. |
| [davidKolesar/LotteryTicketDataScraper](https://github.com/davidKolesar/LotteryTicketDataScraper) | 1 | 2019-02-11 | none | PA; Java | Claimed and remaining per tier. Stale. |
| [Protovision/calottery-scratchers](https://github.com/Protovision/calottery-scratchers) | 3 | 2021-08-15 | MIT | CA; Node | Average-payout calculator. Stale. |
| [iyulaev/scratcherCalc](https://github.com/iyulaev/scratcherCalc) | 4 | 2012-05-07 | none | CA; Android | EV plus "jackpot likelihood". Stale. |
| [screwtape9/scratcher](https://github.com/screwtape9/scratcher) | 1 | 2025-05-10 | MIT | GA; CLI | Claimed-percentage only. |

## What we learned and changed

1. **Everyone divides remaining prize value by remaining tickets.** No project documents *how* it gets remaining tickets. We made the estimator explicit, tested, and able to refuse ("Insufficient data") instead of fabricating a value.
2. **No project handles annuity or free-ticket tiers** (based on their READMEs). NJ has both. We use NJ's published cash value for annuities and value free tickets as a replay (EV / (1 − p_free)).
3. **History must be self-collected.** The Texas and NC projects snapshot on a schedule. We do the same, and we also backfill from Internet Archive captures of NJ's own API, which no project we found does.
4. **Raw "% of top prizes left" is misleading.** It rewards new games. Lottery Valley (a non-GitHub reference) compares against tickets remaining. We score *retention* (% left ÷ % tickets left) and still display raw percentages.
