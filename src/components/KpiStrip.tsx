import type { ProductRecommendation } from '../types/domain';

export default function KpiStrip({ recs }: { recs: ProductRecommendation[] }) {
  const demand = Math.round(recs.reduce((s, r) => s + r.forecast.horizonDemand, 0));
  const urgent = recs.filter(r => r.status === 'Urgent').length;
  const watch = recs.filter(r => r.status === 'Watch').length;
  const excess = recs.filter(r => r.is_excess).length;

  const items = [
    { value: demand, label: 'Units expected to sell' },
    { value: urgent, label: 'Urgent to reorder' },
    { value: urgent + watch, label: 'Products needing action' },
    { value: excess, label: 'Excess stock' },
  ];
  return (
    <section className="kpis">
      {items.map(k => (
        <div key={k.label} className="kpi">
          <strong>{k.value}</strong>
          <span>{k.label}</span>
        </div>
      ))}
    </section>
  );
}
