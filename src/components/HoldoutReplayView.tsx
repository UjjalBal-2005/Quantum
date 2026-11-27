import React from 'react';
import { HoldoutEvaluationResult } from '../types/domain';

interface HoldoutReplayViewProps {
  evaluation: HoldoutEvaluationResult;
}

export const HoldoutReplayView: React.FC<HoldoutReplayViewProps> = ({ evaluation }) => {
  if (evaluation.productsEvaluated === 0) {
    return (
      <div className="panel-card">
        <p>Not enough historical sales data to run the 28-day holdout evaluation.</p>
      </div>
    );
  }

  return (
    <section className="holdout-section">
      <div className="sim-disclosure-banner">
        <strong>Simulated Assumptions &amp; Zero-Leakage Notice ({evaluation.startDate} to {evaluation.endDate}):</strong>
        <ul>
          {evaluation.assumptions.map((a, idx) => (
            <li key={idx}>{a}</li>
          ))}
        </ul>
      </div>

      <div className="kpi-strip">
        <div className="kpi-card">
          <span className="kpi-label">Forecast MAE (Smart vs Simple Avg)</span>
          <strong className="kpi-value">
            {evaluation.portfolioSmartMae.toFixed(2)} vs {evaluation.portfolioBaselineMae.toFixed(2)}
          </strong>
          <small className="kpi-sub">Lower MAE = closer to actual daily sales</small>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Portfolio WMAPE (Smart vs Avg)</span>
          <strong className="kpi-value">
            {evaluation.portfolioSmartWmape.toFixed(1)}% vs{' '}
            {evaluation.portfolioBaselineWmape.toFixed(1)}%
          </strong>
          <small className="kpi-sub">Volume-weighted percentage error</small>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Simulated Stockout Days (Smart vs Static R)</span>
          <strong className="kpi-value">
            {evaluation.totalSmartStockoutDays}d vs {evaluation.totalStaticStockoutDays}d
          </strong>
          <small className="kpi-sub">Simulated across {evaluation.productsEvaluated} SKUs</small>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Simulated Ending Leftover Units</span>
          <strong className="kpi-value">
            {evaluation.totalSmartEndingStock} vs {evaluation.totalStaticEndingStock}
          </strong>
          <small className="kpi-sub">Smart Policy vs Static Reorder-Level</small>
        </div>
      </div>

      <div className="table-card">
        <div className="table-header-row">
          <h2>Per-Product 28-Day Holdout &amp; Simulated Replay Breakdown</h2>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>28d Actual</th>
                <th>Smart MAE</th>
                <th>Avg MAE</th>
                <th>Smart WMAPE</th>
                <th>Avg WMAPE</th>
                <th>Sim. Stockouts (Smart / Static)</th>
                <th>Sim. Ending Stock (Smart / Static)</th>
              </tr>
            </thead>
            <tbody>
              {evaluation.perProduct.map((row) => (
                <tr key={row.product_id}>
                  <td>
                    <div className="prod-cell">
                      <strong>{row.product}</strong>
                      <span>
                        {row.product_id} • {row.category}
                      </span>
                    </div>
                  </td>
                  <td>{row.actualTotal}</td>
                  <td className={row.smartMae <= row.baselineMae ? 'good-num' : ''}>
                    {row.smartMae.toFixed(2)}
                  </td>
                  <td>{row.baselineMae.toFixed(2)}</td>
                  <td>{row.smartWmape.toFixed(1)}%</td>
                  <td>{row.baselineWmape.toFixed(1)}%</td>
                  <td>
                    <strong>{row.smartStockoutDays}d</strong> / {row.staticStockoutDays}d
                  </td>
                  <td>
                    <strong>{row.smartEndingStock}</strong> / {row.staticEndingStock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
