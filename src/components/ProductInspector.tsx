import React from 'react';
import { CalendarRow, ProductRecommendation, SalesRow } from '../types/domain';
import { ProductChart } from './ProductChart';

interface ProductInspectorProps {
  item: ProductRecommendation | null;
  productHistory: SalesRow[];
  calendarByDate: Map<string, CalendarRow>;
}

export const ProductInspector: React.FC<ProductInspectorProps> = ({
  item,
  productHistory,
  calendarByDate,
}) => {
  if (!item) {
    return (
      <aside className="inspector-card empty">
        <p>Select a product from the queue to inspect its forecast math, cover, and rationale.</p>
      </aside>
    );
  }

  const f = item.forecast;

  return (
    <aside className="inspector-card">
      <div className="inspector-header">
        <div>
          <span className="sku-code">{item.product_id}</span>
          <h2>{item.product}</h2>
          <span className="cat-pill">{item.category}</span>
          {item.shelf_life_days !== undefined && (
            <span className="cat-pill">Shelf Life: {item.shelf_life_days}d</span>
          )}
        </div>
        <div className="inspector-badges">
          <span className={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span>
          {item.is_excess && <span className="badge badge-excess">Excess</span>}
        </div>
      </div>

      {item.perishable_spoilage_risk && (
        <div className="spoilage-alert">
          <strong>Perishable Spoilage Risk:</strong> Projected cover ({item.days_of_cover}d) exceeds
          shelf life ({item.shelf_life_days}d). Pause replenishment and prioritize markdown/rotation.
        </div>
      )}

      <div className="rationale-box">
        <div className="rationale-label">Plain-Language Recommendation</div>
        <p>{item.rationale}</p>
        <div className="methodology-note">
          <strong>Transparent Heuristic:</strong> Estimates are based on recent comparable-weekday
          sales, bounded trend, and scheduled events — not calibrated stockout probabilities.
          Historical sales are used as a proxy for demand.
        </div>
      </div>

      <ProductChart
        history={productHistory}
        forecastPoints={f.dailyPoints}
        calendarByDate={calendarByDate}
      />

      <div className="math-card">
        <h3>Transparent Math Breakdown</h3>
        <div className="math-grid">
          <div className="math-item">
            <span>{f.horizon}d Forecast Demand (D̂)</span>
            <strong>{Math.round(f.horizonDemand)} units</strong>
          </div>
          <div className="math-item">
            <span>Safety Buffer (S)</span>
            <strong>+{item.safety_buffer} units</strong>
            <small>{item.safety_buffer_rule}</small>
          </div>
          <div className="math-item">
            <span>Current / Incoming Stock</span>
            <strong>
              {item.current_stock} / +{item.incoming_stock} (Net: {item.net_stock})
            </strong>
          </div>
          <div className="math-item">
            <span>Reorder Level (R) &amp; Lead Time (L)</span>
            <strong>
              R = {item.reorder_level} • L = {item.lead_time_days}d (
              {item.lead_time_source === 'product' ? 'SKU' : 'Global'})
            </strong>
          </div>
          <div className="math-item">
            <span>Projected Cover (Avail / Net)</span>
            <strong>
              {item.days_of_cover >= 365 ? '365+' : item.days_of_cover}d /{' '}
              {item.net_days_of_cover >= 365 ? '365+' : item.net_days_of_cover}d
            </strong>
          </div>
          <div className="math-item highlight">
            <span>Suggested Order: max(0, ⌈D̂ + S − Net⌉)</span>
            <strong>{item.suggested_order_qty} units</strong>
          </div>
        </div>

        <div className="model-signals">
          <span>Trend (T): {f.trendMultiplier.toFixed(2)}×</span>
          <span>Baseline Source: {f.fallbackLevel.replace('_', ' ')}</span>
          {f.outlierCountDampened > 0 && (
            <span>Outliers Dampened: {f.outlierCountDampened}</span>
          )}
          {f.activeEventNotes.length > 0 && (
            <span>Events: {f.activeEventNotes.join(', ')}</span>
          )}
        </div>
      </div>
    </aside>
  );
};
