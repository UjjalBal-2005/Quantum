import React, { useMemo, useState } from 'react';
import { HoldoutReplayView } from './components/HoldoutReplayView';
import { ProductInspector } from './components/ProductInspector';
import { TopControlBar } from './components/TopControlBar';
import { loadSyntheticDataset } from './data/syntheticLoader';
import { inferNextAsOfDate, prepareForecastContext } from './engine/forecaster';
import { evaluateProductReplenishment, sortRecommendations } from './engine/replenishment';
import { runHoldoutEvaluation } from './engine/replaySimulator';
import { CalendarRow, DatasetLoadResult, ForecastHorizon, SalesRow } from './types/domain';
import { parseCsvDatasets } from './utils/csvParser';

type RiskFilter = 'All' | 'Urgent' | 'Watch' | 'Excess' | 'Healthy';

export const App: React.FC = () => {
  const [dataset, setDataset] = useState<DatasetLoadResult>(() => loadSyntheticDataset());
  const [horizon, setHorizon] = useState<ForecastHorizon>(7);
  const [globalLeadTime, setGlobalLeadTime] = useState<number>(3);
  const [showSafetyBuffer, setShowSafetyBuffer] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'advisor' | 'holdout'>('advisor');

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState<boolean>(false);

  const handleUploadCsvs = (salesText: string, invText: string, calText: string, label: string) => {
    const parsed = parseCsvDatasets(salesText, invText, calText, label);
    setDataset(parsed);
    setSelectedId(null);
    setRiskFilter('All');
  };

  const handleResetDemo = () => {
    setDataset(loadSyntheticDataset());
    setSelectedId(null);
    setRiskFilter('All');
    setSearchQuery('');
  };

  const calendarByDate = useMemo(() => {
    const map = new Map<string, CalendarRow>();
    for (const c of dataset.calendar) map.set(c.date, c);
    return map;
  }, [dataset.calendar]);

  const salesByProduct = useMemo(() => {
    const map = new Map<string, SalesRow[]>();
    for (const s of dataset.sales) {
      const list = map.get(s.product_id) ?? [];
      list.push(s);
      map.set(s.product_id, list);
    }
    return map;
  }, [dataset.sales]);

  const recommendations = useMemo(() => {
    if (dataset.inventory.length === 0) return [];
    const asOfDate = inferNextAsOfDate(dataset.sales);
    const ctx = prepareForecastContext(dataset.sales, dataset.calendar, asOfDate);
    const items = dataset.inventory.map((inv) =>
      evaluateProductReplenishment(inv, horizon, globalLeadTime, ctx)
    );
    return sortRecommendations(items);
  }, [dataset.inventory, dataset.sales, dataset.calendar, horizon, globalLeadTime]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return recommendations.filter((item) => {
      if (riskFilter === 'Urgent' && item.status !== 'Urgent') return false;
      if (riskFilter === 'Watch' && item.status !== 'Watch') return false;
      if (riskFilter === 'Healthy' && item.status !== 'Healthy') return false;
      if (riskFilter === 'Excess' && !item.is_excess) return false;

      if (!q) return true;
      return (
        item.product.toLowerCase().includes(q) ||
        item.product_id.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [recommendations, riskFilter, searchQuery]);

  const selectedItem = useMemo(() => {
    if (selectedId) {
      const found = recommendations.find((r) => r.product_id === selectedId);
      if (found) return found;
    }
    return filteredItems[0] ?? recommendations[0] ?? null;
  }, [selectedId, recommendations, filteredItems]);

  const kpis = useMemo(() => {
    let totalDemand = 0;
    let urgentCount = 0;
    let actionCount = 0;
    let excessCount = 0;
    let imminentStockoutCount = 0;

    for (const r of recommendations) {
      totalDemand += r.forecast.horizonDemand;
      if (r.status === 'Urgent') {
        urgentCount++;
        actionCount++;
      } else if (r.status === 'Watch') {
        actionCount++;
      }
      if (r.is_excess) excessCount++;
      if (r.days_of_cover <= r.lead_time_days) imminentStockoutCount++;
    }
    return {
      totalDemand: Math.round(totalDemand),
      urgentCount,
      actionCount,
      excessCount,
      imminentStockoutCount,
    };
  }, [recommendations]);

  const holdoutEvaluation = useMemo(() => {
    if (activeTab !== 'holdout') return null;
    return runHoldoutEvaluation(
      dataset.sales,
      dataset.inventory,
      dataset.calendar,
      globalLeadTime
    );
  }, [activeTab, dataset.sales, dataset.inventory, dataset.calendar, globalLeadTime]);

  return (
    <div className="app-shell">
      <TopControlBar
        horizon={horizon}
        onHorizonChange={setHorizon}
        globalLeadTime={globalLeadTime}
        onGlobalLeadTimeChange={setGlobalLeadTime}
        showSafetyBuffer={showSafetyBuffer}
        onToggleSafetyBuffer={() => setShowSafetyBuffer((v) => !v)}
        sourceLabel={dataset.sourceLabel}
        onUploadCsvs={handleUploadCsvs}
        onResetDemo={handleResetDemo}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <main className="main-content">
        {dataset.errors.length > 0 && (
          <div className="validation-error-banner">
            <strong>CSV Validation Errors:</strong>
            <ul>
              {dataset.errors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {activeTab === 'advisor' ? (
          <>
            {kpis.urgentCount > 0 && (
              <div className="urgent-banner" role="alert">
                <div>
                  <strong>Stockout Risk Alert:</strong> {kpis.urgentCount} SKU
                  {kpis.urgentCount > 1 ? 's' : ''} require urgent replenishment (
                  {kpis.imminentStockoutCount} with projected cover ≤ supplier lead time).
                </div>
                <button
                  type="button"
                  className="btn-urgent-filter"
                  onClick={() => setRiskFilter(riskFilter === 'Urgent' ? 'All' : 'Urgent')}
                >
                  {riskFilter === 'Urgent' ? 'Show All SKUs' : 'Filter Urgent Only'}
                </button>
              </div>
            )}

            <section className="kpi-strip">
              <div className="kpi-card">
                <span className="kpi-label">Upcoming {horizon}d Total Demand</span>
                <strong className="kpi-value">{kpis.totalDemand.toLocaleString()} units</strong>
                <small className="kpi-sub">Across {recommendations.length} active SKUs</small>
              </div>
              <div className="kpi-card urgent">
                <span className="kpi-label">Urgent Replenishment</span>
                <strong className="kpi-value">{kpis.urgentCount}</strong>
                <small className="kpi-sub">Cover ≤ lead time or ≤ reorder level</small>
              </div>
              <div className="kpi-card">
                <span className="kpi-label">Total Needing Action</span>
                <strong className="kpi-value">{kpis.actionCount}</strong>
                <small className="kpi-sub">Urgent + Watch within {horizon}d horizon</small>
              </div>
              <div className="kpi-card excess">
                <span className="kpi-label">Excess Stock SKUs</span>
                <strong className="kpi-value">{kpis.excessCount}</strong>
                <small className="kpi-sub">Stock &gt; 2× 14d forecast</small>
              </div>
            </section>

            <section className="split-workspace">
              <div className="table-card">
                <div className="table-toolbar">
                  <input
                    type="search"
                    placeholder="Search product, SKU, or category..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="search-input"
                  />
                  <div className="filter-pills">
                    {(['All', 'Urgent', 'Watch', 'Excess', 'Healthy'] as RiskFilter[]).map((f) => (
                      <button
                        key={f}
                        type="button"
                        className={`pill-btn ${riskFilter === f ? 'active' : ''}`}
                        onClick={() => setRiskFilter(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product &amp; Category</th>
                        <th>Stock / In</th>
                        <th>Cover</th>
                        <th>{horizon}d Forecast</th>
                        {showSafetyBuffer && <th>Buffer</th>}
                        <th>Risk Badges</th>
                        <th>Suggested Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.length === 0 ? (
                        <tr>
                          <td colSpan={showSafetyBuffer ? 7 : 6} className="empty-row">
                            No products match your current filter.
                          </td>
                        </tr>
                      ) : (
                        filteredItems.map((item) => {
                          const isSelected = selectedItem?.product_id === item.product_id;
                          return (
                            <tr
                              key={item.product_id}
                              className={isSelected ? 'selected-row' : ''}
                              onClick={() => setSelectedId(item.product_id)}
                            >
                              <td>
                                <div className="prod-cell">
                                  <strong>{item.product}</strong>
                                  <span>
                                    {item.product_id} • {item.category}
                                    {item.shelf_life_days ? ` • ${item.shelf_life_days}d shelf` : ''}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <strong>{item.current_stock}</strong>
                                {item.incoming_stock > 0 && (
                                  <span className="incoming-tag"> +{item.incoming_stock}</span>
                                )}
                              </td>
                              <td>{item.days_of_cover >= 365 ? '365+d' : `${item.days_of_cover}d`}</td>
                              <td>{Math.round(item.forecast.horizonDemand)}</td>
                              {showSafetyBuffer && <td>+{item.safety_buffer}</td>}
                              <td>
                                <div className="badge-stack">
                                  <span className={`badge badge-${item.status.toLowerCase()}`}>
                                    {item.status}
                                  </span>
                                  {item.is_excess && <span className="badge badge-excess">Excess</span>}
                                  {item.perishable_spoilage_risk && (
                                    <span className="badge badge-spoilage">Spoilage Risk</span>
                                  )}
                                </div>
                              </td>
                              <td>
                                <strong className={item.suggested_order_qty > 0 ? 'order-qty' : 'zero-qty'}>
                                  {item.suggested_order_qty > 0 ? `${item.suggested_order_qty} units` : '—'}
                                </strong>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <ProductInspector
                item={selectedItem}
                productHistory={
                  selectedItem ? salesByProduct.get(selectedItem.product_id) ?? [] : []
                }
                calendarByDate={calendarByDate}
              />
            </section>

            {(dataset.excludedProducts.length > 0 || dataset.warnings.length > 0) && (
              <section className="warnings-drawer">
                <button
                  type="button"
                  className="warnings-toggle"
                  onClick={() => setShowWarnings((v) => !v)}
                >
                  <span>
                    Excluded Products &amp; Data Hygiene ({dataset.excludedProducts.length} excluded,{' '}
                    {dataset.warnings.length} warnings)
                  </span>
                  <span>{showWarnings ? 'Hide' : 'Show'}</span>
                </button>
                {showWarnings && (
                  <div className="warnings-body">
                    {dataset.excludedProducts.map((ex, i) => (
                      <div key={`ex-${i}`} className="warning-item">
                        <span className="badge badge-watch">{ex.reason}</span>{' '}
                        <strong>{ex.product ?? ex.product_id}</strong> ({ex.product_id}): {ex.details}
                      </div>
                    ))}
                    {dataset.warnings.slice(0, 20).map((w, i) => (
                      <div key={`w-${i}`} className="warning-item">
                        <strong>[{w.file}{w.row ? ` row ${w.row}` : ''}]</strong> {w.message}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        ) : (
          holdoutEvaluation && <HoldoutReplayView evaluation={holdoutEvaluation} />
        )}
      </main>
    </div>
  );
};

export default App;
