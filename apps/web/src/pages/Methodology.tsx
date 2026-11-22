import { useGames } from '../data';

export function Methodology() {
  const { meta } = useGames();
  return (
    <article className="prose">
      <h2 className="page-title">How the rankings work</h2>
      <p>
        Everything starts from the official NJ Lottery instant-games data: for each prize tier, the number of prizes printed, paid and claimed, plus the total number of tickets
        printed. The app never invents numbers. Where something must be estimated, it is marked <abbr className="est">est.</abbr> and explained.
      </p>

      <h3>Official numbers</h3>
      <ul>
        <li><strong>Prizes remaining</strong> uses NJ Lottery’s own formula: for prizes of $600 or more, printed minus claimed; for smaller prizes, printed minus paid.</li>
        <li><strong>Odds at launch</strong> and <strong>EV at launch</strong> are exact: tickets printed ÷ prizes printed, and total prize value ÷ tickets printed.</li>
      </ul>

      <h3>Estimates</h3>
      <ul>
        <li>
          <strong>Tickets remaining.</strong> Small prizes (under $600) number in the hundreds of thousands and are spread evenly through the print run, so the share already paid is
          a good proxy for the share of tickets sold. Remaining tickets = printed × (1 − paid share). Small prizes that are never cashed make this estimate slightly <em>high</em>,
          so current EV comes out slightly <em>low</em> (conservative). If there are too few small prizes, or more than 97% are paid, the app shows “Insufficient data” instead of a number.
        </li>
        <li><strong>Current EV</strong> = (value of remaining prizes) ÷ (estimated remaining tickets). Free-ticket prizes are valued as another play of the same game; annuity prizes use NJ’s published cash value.</li>
        <li><strong>Odds vs. launch</strong> (shown as ×) = share of those prizes remaining ÷ share of tickets remaining. 1.5× means those prizes are 1.5 times as likely per ticket as when the game launched.</li>
      </ul>

      <h3>The score (0–100)</h3>
      <p>Each component is turned into a percentile among all active games (0 = worst, 100 = best), then combined as a weighted average. You can change the weights on the Best Tickets page.</p>
      <table className="score-table">
        <thead><tr><th scope="col">Component</th><th scope="col" className="num">Default weight</th><th scope="col">What it measures</th></tr></thead>
        <tbody>
          {meta?.components.map((c) => (
            <tr key={c.key}><th scope="row">{c.label}</th><td className="num">{c.defaultWeight}%</td><td>{c.description}</td></tr>
          ))}
        </tbody>
      </table>
      <ul>
        <li>If a component doesn’t apply (for example, a $1 game has no $10,000+ prizes), its weight is spread across the others, and the game page says so.</li>
        <li>Games with <strong>no top prizes left</strong> are capped at 40, so they can never be labeled “strong”.</li>
        <li>Labels: 67+ = 🟢 strong, 40–66 = 🟡 average, below 40 = 🔴 weak remaining-prize profile.</li>
        <li>The raw “% of top prizes remaining” is shown but not scored directly, because it rewards brand-new games just for being new.</li>
      </ul>

      <h3>What this can’t tell you</h3>
      <ul>
        <li>Which tickets are still in which stores. Remaining prizes may sit in unsold inventory that never reaches shelves.</li>
        <li>Whether a “remaining” prize has already been won but not claimed. Winners have up to a year to claim.</li>
        <li>Anything about your next ticket. Every game returns less than it costs on average; the lottery keeps the house edge.</li>
      </ul>
      <p className="muted small">The full methodology is in <code>docs/SCORING_METHODOLOGY.md</code> in the project repository.</p>
    </article>
  );
}
