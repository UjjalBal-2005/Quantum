import { runReplay, addDays, ForecastFn, ReplaySalesRow, ReplayInventoryRow, ReplayCalendarRow } from './replaySimulator';

// deterministic PRNG
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

const END = '2026-11-26', DAYS = 120;
const start = addDays(END, -(DAYS - 1));
const prods = Array.from({ length: 12 }, (_, i) => ({ id: `P${i + 1}`, base: 8 + i * 3, cat: i % 2 ? 'dairy' : 'pantry' }));
const sales: ReplaySalesRow[] = [], cal: ReplayCalendarRow[] = [];
for (let d = 0; d < DAYS + 30; d++) {
  const date = addDays(start, d), wk = [0, 6].includes(new Date(date).getUTCDay());
  cal.push({ date, isWeekend: wk, festival: d === 100 || d === 125 ? 'Fest' : null });
  if (d >= DAYS) continue;
  for (const p of prods) {
    if (p.id === 'P12' && d < 112) continue; // sparse-history product
    let q = p.base * (wk ? 1.4 : 1) * (d === 100 ? 1.6 : 1) * (0.85 + 0.3 * rnd());
    if (p.id === 'P3' && d === 90) q *= 6; // outlier
    sales.push({ date, productId: p.id, category: p.cat, quantitySold: Math.round(q) });
  }
}
const inv: ReplayInventoryRow[] = prods.map((p) => ({ productId: p.id, product: p.id, category: p.cat, reorderLevel: p.base * 3, quantityReceived: p.base * 7, leadTimeDays: 3 }));
inv.push({ productId: 'GHOST', reorderLevel: 5 }); // no sales → excluded

// reference forecaster for testing only (day-of-week mean of last 8 weeks)
let maxSalesDate = '', calls = 0;
const ref: ForecastFn = (req) => {
  calls++;
  for (const r of req.sales) if (r.date > maxSalesDate) maxSalesDate = r.date;
  const mine = req.sales.filter((r) => r.productId === req.productId && r.date >= addDays(req.asOf, -56));
  const all = mine.length ? mine.reduce((s, r) => s + r.quantitySold, 0) / 56 : 5;
  return req.targetDates.map((t) => {
    const dow = new Date(t).getUTCDay();
    const same = mine.filter((r) => new Date(r.date).getUTCDay() === dow);
    return same.length >= 2 ? same.reduce((s, r) => s + r.quantitySold, 0) / same.length : all;
  });
};

const r1 = runReplay(sales, inv, cal, ref);
const r2 = runReplay(sales, inv, cal, ref);
const ok = (c: boolean, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };

ok(JSON.stringify(r1) === JSON.stringify(r2), 'deterministic');
ok(r1.holdout.days === 28 && r1.holdout.end === END, `holdout ${r1.holdout.start} → ${r1.holdout.end}`);
ok(r1.excluded.some((e) => e.productId === 'GHOST'), 'product without sales is excluded with reason');
ok(maxSalesDate < END, `forecaster never saw sales up to the last day (max seen ${maxSalesDate})`);
ok(r1.policy.perProduct.length === 12, '12 products replayed (incl. sparse P12)');
ok(r1.accuracy.perProduct.find((p) => p.productId === 'P12')!.sparseHistory, 'P12 flagged sparse');
ok(r1.simulated && r1.disclosure.includes('SIMULATED'), 'simulation disclosure present');

// leakage: a forecaster that tries to peek must be impossible — verify guard trips on bad requests
import { assertNoLeakage } from './replaySimulator';
let tripped = false;
try { assertNoLeakage({ productId: 'x', asOf: '2026-01-10', targetDates: ['2026-01-10'], sales: [{ date: '2026-01-10', productId: 'x', quantitySold: 1 }], calendar: [] }, false); } catch { tripped = true; }
ok(tripped, 'leakage guard rejects sales dated >= asOf');

const a = r1.accuracy.portfolio, p = r1.policy.portfolio;
console.log('\nForecast MAE  smart', a.smart.mae.toFixed(2), 'vs avg', a.baseline.mae.toFixed(2), `(${a.maeImprovementPct?.toFixed(1)}% better)`);
console.log('WMAPE         smart', (a.smart.wmape! * 100).toFixed(1) + '%', 'vs avg', (a.baseline.wmape! * 100).toFixed(1) + '%');
console.log('Stockout days smart', p.smart.stockoutDays, 'vs static', p.static.stockoutDays);
console.log('Leftover      smart', p.smart.leftoverUnits, 'vs static', p.static.leftoverUnits);
console.log('Fill rate     smart', (p.smart.fillRate! * 100).toFixed(1) + '%', 'vs static', (p.static.fillRate! * 100).toFixed(1) + '%');
console.log('forecaster calls:', calls / 2);
