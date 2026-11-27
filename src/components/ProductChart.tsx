import React from 'react';
import { CalendarRow, DailyForecastPoint, SalesRow } from '../types/domain';

interface ProductChartProps {
  history: SalesRow[];
  forecastPoints: DailyForecastPoint[];
  calendarByDate: Map<string, CalendarRow>;
}

export const ProductChart: React.FC<ProductChartProps> = ({
  history,
  forecastPoints,
  calendarByDate,
}) => {
  const recentHist = [...history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-28);

  if (recentHist.length === 0 && forecastPoints.length === 0) {
    return <div className="chart-empty">No historical or forecast points available.</div>;
  }

  const combinedValues = [
    ...recentHist.map((h) => h.quantity_sold),
    ...forecastPoints.map((f) => f.predicted),
  ];
  const maxVal = Math.max(5, ...combinedValues) * 1.15;

  const width = 560;
  const height = 190;
  const padLeft = 36;
  const padRight = 14;
  const padTop = 16;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const totalPts = recentHist.length + forecastPoints.length;
  const xFor = (idx: number) =>
    totalPts <= 1 ? padLeft : padLeft + (idx / (totalPts - 1)) * plotW;
  const yFor = (val: number) => padTop + plotH - (val / maxVal) * plotH;

  const histCoords = recentHist.map((h, i) => `${xFor(i).toFixed(1)},${yFor(h.quantity_sold).toFixed(1)}`);
  const fcStartIdx = recentHist.length;
  const fcCoords = forecastPoints.map(
    (f, i) => `${xFor(fcStartIdx + i).toFixed(1)},${yFor(f.predicted).toFixed(1)}`
  );

  // Connect last history point to first forecast point seamlessly
  const fcPolyline =
    recentHist.length > 0 && forecastPoints.length > 0
      ? [histCoords[histCoords.length - 1], ...fcCoords].join(' ')
      : fcCoords.join(' ');

  const splitX =
    recentHist.length > 0 && forecastPoints.length > 0
      ? (xFor(recentHist.length - 1) + xFor(recentHist.length)) / 2
      : padLeft;

  const yTicks = [0, Math.round(maxVal / 2), Math.round(maxVal)];

  return (
    <div className="chart-container">
      <div className="chart-header">
        <span>Recent Sales (28d) &amp; Upcoming Forecast ({forecastPoints.length}d)</span>
        <div className="chart-legend">
          <span className="leg-item"><i className="dot hist" /> Actual Sales</span>
          <span className="leg-item"><i className="dot fc" /> Forecast</span>
          <span className="leg-item"><i className="dot ev" /> Promo/Holiday</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="svg-chart" role="img" aria-label="Sales and Forecast Chart">
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={padLeft}
              y1={yFor(t)}
              x2={width - padRight}
              y2={yFor(t)}
              stroke="#e2e8f0"
              strokeDasharray="3 3"
            />
            <text x={padLeft - 6} y={yFor(t) + 4} textAnchor="end" fontSize="10" fill="#64748b">
              {t}
            </text>
          </g>
        ))}

        {recentHist.length > 0 && forecastPoints.length > 0 && (
          <line
            x1={splitX}
            y1={padTop}
            x2={splitX}
            y2={height - padBottom}
            stroke="#94a3b8"
            strokeDasharray="4 4"
          />
        )}

        {histCoords.length > 1 && (
          <polyline
            fill="none"
            stroke="#334155"
            strokeWidth="2"
            points={histCoords.join(' ')}
          />
        )}

        {fcPolyline && (
          <polyline
            fill="none"
            stroke="#2563eb"
            strokeWidth="2.4"
            strokeDasharray="5 3"
            points={fcPolyline}
          />
        )}

        {recentHist.map((h, i) => {
          const cal = calendarByDate.get(h.date);
          const isEv = h.is_promotion || cal?.holiday || cal?.festival || cal?.promotion_event;
          return (
            <circle
              key={`h-${h.date}`}
              cx={xFor(i)}
              cy={yFor(h.quantity_sold)}
              r={isEv ? 3.8 : 2.3}
              fill={isEv ? '#f59e0b' : '#334155'}
            >
              <title>{`${h.date}: ${h.quantity_sold} sold${isEv ? ' (Event/Promo)' : ''}`}</title>
            </circle>
          );
        })}

        {forecastPoints.map((f, i) => (
          <circle
            key={`f-${f.date}`}
            cx={xFor(fcStartIdx + i)}
            cy={yFor(f.predicted)}
            r={f.isEvent ? 4 : 2.5}
            fill={f.isEvent ? '#f59e0b' : '#2563eb'}
          >
            <title>
              {`${f.date}: ${f.predicted.toFixed(1)} forecast${f.eventName ? ` (${f.eventName})` : ''}`}
            </title>
          </circle>
        ))}

        {recentHist.length > 0 && (
          <text x={padLeft} y={height - 6} fontSize="10" fill="#64748b">
            {recentHist[0].date.slice(5)}
          </text>
        )}
        {forecastPoints.length > 0 && (
          <text x={width - padRight} y={height - 6} textAnchor="end" fontSize="10" fill="#2563eb">
            {forecastPoints[forecastPoints.length - 1].date.slice(5)}
          </text>
        )}
      </svg>
    </div>
  );
};
