import type { ForecastHorizon } from '../types/domain';

interface Props {
  horizon: ForecastHorizon;
  onHorizon: (h: ForecastHorizon) => void;
  leadTime: number;
  onLeadTime: (n: number) => void;
  onReset: () => void;
}

const HORIZONS: ForecastHorizon[] = [7, 14, 30];

export default function ControlBar({ horizon, onHorizon, leadTime, onLeadTime, onReset }: Props) {
  return (
    <header className="controls">
      <h1>Smart Stock Advisor</h1>
      <div className="control-group">
        <span className="label">Forecast for</span>
        {HORIZONS.map(h => (
          <button key={h} className={h === horizon ? 'seg on' : 'seg'} onClick={() => onHorizon(h)}>
            {h} days
          </button>
        ))}
      </div>
      <label className="control-group">
        <span className="label">Supplier lead time (days)</span>
        <input
          type="number" min={0} max={60} value={leadTime}
          onChange={e => onLeadTime(Math.max(0, Number(e.target.value) || 0))}
        />
      </label>
      <button className="ghost" onClick={onReset}>Reset to Synthetic Demo</button>
    </header>
  );
}
