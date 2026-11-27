import { useMemo, useState } from 'react';
import './App.css';
import type { ForecastHorizon, ProductRecommendation } from './types/domain';
import { getRecommendations } from './advisor';
import ControlBar from './components/ControlBar';
import KpiStrip from './components/KpiStrip';
import UrgentBanner from './components/UrgentBanner';
import ProductTable, { type Filter } from './components/ProductTable';

// Queue order: Urgent, then Watch, then the rest. Ties: bigger order first, then shorter cover.
const rank = (r: ProductRecommendation) => (r.status === 'Urgent' ? 0 : r.status === 'Watch' ? 1 : 2);

export default function App() {
  const [horizon, setHorizon] = useState<ForecastHorizon>(7);
  const [leadTime, setLeadTime] = useState(3);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const recs = useMemo(() => getRecommendations(horizon, leadTime), [horizon, leadTime]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recs
      .filter(r => !q || `${r.product} ${r.product_id} ${r.category}`.toLowerCase().includes(q))
      .filter(r => filter === 'All' || (filter === 'Excess' ? r.is_excess : r.status === filter))
      .sort((a, b) =>
        rank(a) - rank(b) ||
        b.suggested_order_qty - a.suggested_order_qty ||
        a.days_of_cover - b.days_of_cover);
  }, [recs, search, filter]);

  const atRisk = recs.filter(r => r.days_of_cover <= r.lead_time_days);
  const selected = recs.find(r => r.product_id === selectedId) ?? null;

  const reset = () => { setHorizon(7); setLeadTime(3); setSearch(''); setFilter('All'); setSelectedId(null); };

  return (
    <div className="app">
      <ControlBar horizon={horizon} onHorizon={setHorizon} leadTime={leadTime} onLeadTime={setLeadTime} onReset={reset} />
      <UrgentBanner atRisk={atRisk} onShow={() => setFilter('Urgent')} />
      <KpiStrip recs={recs} />
      <main className="workspace">
        <ProductTable
          rows={rows} search={search} onSearch={setSearch}
          filter={filter} onFilter={setFilter}
          selectedId={selectedId} onSelect={setSelectedId}
        />
        <aside className="inspector">
          {selected ? (
            <>
              <h2>{selected.product}</h2>
              <p>{selected.rationale}</p>
              <p className="note">Estimates only. Past sales are used as a stand-in for demand.</p>
            </>
          ) : (
            <p className="empty">Select a product to see why it is recommended.</p>
          )}
        </aside>
      </main>
    </div>
  );
}
