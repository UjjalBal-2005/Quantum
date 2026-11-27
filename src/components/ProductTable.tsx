import type { ProductRecommendation } from '../types/domain';

export type Filter = 'All' | 'Urgent' | 'Watch' | 'Excess' | 'Healthy';
const FILTERS: Filter[] = ['All', 'Urgent', 'Watch', 'Excess', 'Healthy'];

interface Props {
  rows: ProductRecommendation[];
  search: string; onSearch: (s: string) => void;
  filter: Filter; onFilter: (f: Filter) => void;
  selectedId: string | null; onSelect: (id: string) => void;
}

export default function ProductTable({ rows, search, onSearch, filter, onFilter, selectedId, onSelect }: Props) {
  return (
    <section className="table-panel">
      <div className="table-tools">
        <input
          type="search" placeholder="Search name, ID or category"
          value={search} onChange={e => onSearch(e.target.value)}
        />
        <div>
          {FILTERS.map(f => (
            <button key={f} className={f === filter ? 'seg on' : 'seg'} onClick={() => onFilter(f)}>{f}</button>
          ))}
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Stock / Incoming</th><th>Days cover</th>
              <th>Forecast</th><th>Risk</th><th>Suggested order</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="empty">No products match. Clear the search or choose "All".</td></tr>
            )}
            {rows.map(r => (
              <tr
                key={r.product_id}
                className={`row ${r.status.toLowerCase()} ${r.product_id === selectedId ? 'selected' : ''}`}
                onClick={() => onSelect(r.product_id)}
              >
                <td><b>{r.product}</b><small>{r.category} · {r.product_id}</small></td>
                <td>{r.current_stock} / {r.incoming_stock}</td>
                <td>{r.days_of_cover.toFixed(1)}</td>
                <td>{Math.round(r.forecast.horizonDemand)}</td>
                <td>
                  <span className={`badge ${r.status.toLowerCase()}`}>{r.status}</span>
                  {r.is_excess && <span className="badge excess">Excess</span>}
                  {r.perishable_spoilage_risk && <span className="badge spoil">Spoilage risk</span>}
                </td>
                <td className="num">{r.suggested_order_qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
