import { Link } from 'react-router-dom';
import { formatMoney } from '@nj/lottery-data/format';
import type { ComponentKey } from '../api';
import { useGames } from '../data';
import { useSettings } from '../settings';

const THRESHOLDS = [1_000, 10_000, 25_000, 50_000, 100_000, 500_000, 1_000_000];

export function WeightsPanel() {
  const { meta } = useGames();
  const { weights, setWeights, majorDollars, setMajorDollars, reset, isDefault } = useSettings();
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  return (
    <details className="panel weights-panel">
      <summary>
        <strong>Scoring weights</strong> {isDefault ? <span className="muted">(defaults)</span> : <span className="pill">customized</span>}
      </summary>
      <p className="muted small">
        Each component is converted to a percentile among active games (0 = worst, 100 = best). The score is the weighted average; weights are normalized so they don’t need
        to add to 100. <Link to="/methodology">How scoring works</Link>
      </p>
      <div className="weights-grid">
        {meta?.components.map((c) => (
          <label key={c.key} className="weight-row">
            <span className="weight-label">
              {c.label}
              <small className="muted">{c.description}</small>
            </span>
            <input type="range" min={0} max={60} step={5} value={weights[c.key as ComponentKey]} aria-label={`${c.label} weight`}
              onChange={(e) => setWeights({ ...weights, [c.key]: Number(e.target.value) })} />
            <span className="weight-val">{total ? Math.round((weights[c.key as ComponentKey] / total) * 100) : 0}%</span>
          </label>
        ))}
        <label className="weight-row">
          <span className="weight-label">
            Major-prize threshold
            <small className="muted">Prizes at or above this amount count as “major”.</small>
          </span>
          <select value={majorDollars} onChange={(e) => setMajorDollars(Number(e.target.value))} aria-label="Major prize threshold">
            {THRESHOLDS.map((t) => <option key={t} value={t}>{formatMoney(t * 100, { compact: true })}+</option>)}
          </select>
          <span />
        </label>
      </div>
      {!isDefault && <button type="button" className="btn small" onClick={reset}>Reset to defaults</button>}
    </details>
  );
}
