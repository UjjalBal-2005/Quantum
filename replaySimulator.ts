/**
 * Agent 4 — 28-Day Holdout & Replay Engine
 * ------------------------------------------------------------------
 * Part A: Forecast accuracy  (Smart Advisor vs trailing-14-day average; MAE + WMAPE)
 * Part B: Inventory policy replay (Smart Advisor policy vs Static Reorder-Level policy)
 *
 * Design rules (guide §6):
 *  - ZERO LEAKAGE: every forecast is requested with an explicit `asOf` origin. Only sales
 *    rows with date < asOf are ever handed to the forecaster (verified by assertNoLeakage).
 *  - All inventory outcomes are SIMULATED and carry a mandatory disclosure. They are never
 *    presented as proven financial savings.
 *
 * This module is deliberately decoupled: it does not import Agent 2's forecaster directly.
 * Wrap it in a `ForecastFn` (see bottom of file for an adapter example). The row types below
 * are structural subsets of the Agent 1 domain types, so domain rows can be passed as-is.
 */

// ───────────────────────── Types (structural subsets of src/types/domain.ts) ─────────────────────────

export interface ReplaySalesRow {
  date: string; // YYYY-MM-DD
  productId: string;
  category?: string;
  quantitySold: number;
  isPromotion?: boolean;
}

export interface ReplayInventoryRow {
  productId: string;
  product?: string;
  category?: string;
  reorderLevel: number;
  quantityReceived?: number; // typical replenishment size → static policy's fixed order qty
  leadTimeDays?: number;
}

export interface ReplayCalendarRow {
  date: string;
  isWeekend?: boolean;
  holiday?: string | null;
  festival?: string | null;
  promotionEvent?: string | null;
}

export interface ForecastRequest {
  productId: string;
  category?: string;
  /** Forecast origin. The forecaster may use ONLY data dated strictly before this day. */
  asOf: string;
  /** Consecutive dates starting at asOf. */
  targetDates: string[];
  /** Sales for ALL products with date < asOf (needed for category / store-wide fallbacks). */
  sales: ReplaySalesRow[];
  /** Calendar rows dated < asOf, plus (unless strictCalendar) rows for the target dates. */
  calendar: ReplayCalendarRow[];
}

/** Returns one non-negative daily demand forecast per targetDate, same order. */
export type ForecastFn = (req: ForecastRequest) => number[];

export interface ReplayOptions {
  holdoutDays?: number; // default 28
  horizonDays?: number; // smart policy order-up-to horizon H, default 7
  defaultLeadTimeDays?: number; // default 3 (used when inventory row has none)
  serviceZ?: number; // default 1.28
  baselineWindowDays?: number; // trailing-average baseline window, default 14
  sigmaWindowDays?: number; // window for σ estimation, default 28
  minSigmaObservations?: number; // below this → 20%·D̂_H fallback buffer, default 7
  /**
   * 'known-schedule' (default): calendar rows for the target dates are visible (holidays /
   * planned promos are published in advance; they hold no sales outcome).
   * 'strict': only calendar rows dated < asOf are passed.
   */
  calendarMode?: 'known-schedule' | 'strict';
  /** Static policy fixed order qty; default = inventory.quantityReceived, else reorderLevel. */
  staticOrderQty?: (inv: ReplayInventoryRow) => number;
}

export interface ErrorStats {
  mae: number;
  wmape: number | null; // null when total actual demand is 0
  n: number;
}

export interface ProductAccuracy {
  productId: string;
  product?: string;
  category?: string;
  smart: ErrorStats;
  baseline: ErrorStats;
  maeImprovementPct: number | null; // +ve = Smart better
  winner: 'smart' | 'baseline' | 'tie';
  sparseHistory: boolean;
}

export interface PolicyOutcome {
  stockoutDays: number;
  lostUnits: number;
  fillRate: number | null;
  leftoverUnits: number;
  ordersPlaced: number;
  unitsOrdered: number;
}

export interface ProductPolicy {
  productId: string;
  product?: string;
  leadTimeDays: number;
  startingStock: number;
  staticOrderQty: number;
  smart: PolicyOutcome;
  static: PolicyOutcome;
}

export interface ProductSeries {
  productId: string;
  dates: string[];
  actual: number[];
  smartForecast: number[];
  baselineForecast: number[];
  smartStockEnd: number[];
  staticStockEnd: number[];
}

export interface ReplayResult {
  holdout: { start: string; end: string; days: number };
  accuracy: {
    portfolio: {
      smart: ErrorStats;
      baseline: ErrorStats;
      maeImprovementPct: number | null;
      wmapeImprovementPct: number | null;
      productsWhereSmartWins: number;
      productsEvaluated: number;
    };
    perProduct: ProductAccuracy[];
  };
  policy: {
    portfolio: { smart: PolicyOutcome; static: PolicyOutcome; stockoutDaysAvoided: number; leftoverDelta: number };
    perProduct: ProductPolicy[];
  };
  series: ProductSeries[];
  excluded: { productId: string; reason: string }[];
  simulated: true;
  assumptions: string[];
  disclosure: string;
}

// ───────────────────────── Date helpers (UTC-safe, string based) ─────────────────────────

const DAY_MS = 86_400_000;
const toMs = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fromMs(toMs(iso) + n * DAY_MS);
const dateRange = (start: string, n: number) => Array.from({ length: n }, (_, i) => addDays(start, i));

// ───────────────────────── Small stats helpers ─────────────────────────

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1));
}
function errStats(actual: number[], pred: number[]): ErrorStats {
  const n = actual.length;
  if (!n) return { mae: 0, wmape: null, n: 0 };
  let abs = 0;
  let tot = 0;
  for (let i = 0; i < n; i++) {
    abs += Math.abs(actual[i] - pred[i]);
    tot += actual[i];
  }
  return { mae: abs / n, wmape: tot > 0 ? abs / tot : null, n };
}
const improvementPct = (base: number | null, smart: number | null) =>
  base === null || smart === null || base === 0 ? null : ((base - smart) / base) * 100;

// ───────────────────────── Leakage guard ─────────────────────────

/** Throws if a forecast request contains anything the forecaster must not see. */
export function assertNoLeakage(req: ForecastRequest, strictCalendar: boolean): void {
  for (const r of req.sales) {
    if (r.date >= req.asOf) throw new Error(`LEAKAGE: sales row ${r.date} >= asOf ${req.asOf}`);
  }
  const lastTarget = req.targetDates[req.targetDates.length - 1];
  const targetSet = new Set(req.targetDates);
  for (const c of req.calendar) {
    const ok = c.date < req.asOf || (!strictCalendar && targetSet.has(c.date) && c.date <= lastTarget);
    if (!ok) throw new Error(`LEAKAGE: calendar row ${c.date} not allowed for asOf ${req.asOf}`);
  }
}

// ───────────────────────── Main entry ─────────────────────────

export function runReplay(
  sales: ReplaySalesRow[],
  inventory: ReplayInventoryRow[],
  calendar: ReplayCalendarRow[],
  forecast: ForecastFn,
  opts: ReplayOptions = {},
): ReplayResult {
  const holdoutDays = opts.holdoutDays ?? 28;
  const H = opts.horizonDays ?? 7;
  const defaultL = opts.defaultLeadTimeDays ?? 3;
  const z = opts.serviceZ ?? 1.28;
  const baseWin = opts.baselineWindowDays ?? 14;
  const sigmaWin = opts.sigmaWindowDays ?? 28;
  const minSigmaObs = opts.minSigmaObservations ?? 7;
  const strictCal = (opts.calendarMode ?? 'known-schedule') === 'strict';
  const staticQtyFn = opts.staticOrderQty ?? ((inv) => (inv.quantityReceived && inv.quantityReceived > 0 ? inv.quantityReceived : Math.max(1, inv.reorderLevel)));

  if (!sales.length) throw new Error('Replay needs sales history.');
  if (!Number.isInteger(holdoutDays) || holdoutDays < 1) throw new Error('holdoutDays must be a positive integer.');

  // Holdout window = latest `holdoutDays` days of sales data.
  const sortedSales = [...sales].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const lastDate = sortedSales[sortedSales.length - 1].date;
  const firstDate = sortedSales[0].date;
  const hStart = addDays(lastDate, -(holdoutDays - 1));
  const hDates = dateRange(hStart, holdoutDays);

  // Daily demand per product (duplicate rows summed; missing day = 0 demand).
  const daily = new Map<string, Map<string, number>>();
  const catOf = new Map<string, string | undefined>();
  for (const r of sortedSales) {
    let m = daily.get(r.productId);
    if (!m) daily.set(r.productId, (m = new Map()));
    m.set(r.date, (m.get(r.date) ?? 0) + Math.max(0, r.quantitySold));
    if (r.category) catOf.set(r.productId, r.category);
  }
  const demandOn = (pid: string, d: string) => daily.get(pid)?.get(d) ?? 0;
  const trailing = (pid: string, asOf: string, n: number) => {
    const out: number[] = [];
    const oldest = Math.max(toMs(firstDate), toMs(asOf) - n * DAY_MS);
    for (let ms = oldest; ms < toMs(asOf); ms += DAY_MS) out.push(demandOn(pid, fromMs(ms)));
    return out;
  };

  // Prefix slicing: sortedSales is date-ordered, so rows < asOf are a prefix.
  const salesBefore = (asOf: string) => {
    let lo = 0;
    let hi = sortedSales.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedSales[mid].date < asOf) lo = mid + 1;
      else hi = mid;
    }
    return sortedSales.slice(0, lo);
  };
  const calBefore = (asOf: string, targets: string[]) => {
    const tset = new Set(targets);
    return calendar.filter((c) => c.date < asOf || (!strictCal && tset.has(c.date)));
  };

  // Forecast cache keyed by product|asOf (one forecaster call serves accuracy + policy review).
  const horizonLen = (L: number) => Math.max(H, L, 7);
  const cache = new Map<string, number[]>();
  const getForecast = (pid: string, asOf: string, len: number): number[] => {
    const key = `${pid}|${asOf}`;
    const hit = cache.get(key);
    if (hit && hit.length >= len) return hit;
    const targets = dateRange(asOf, Math.max(len, hit?.length ?? 0));
    const req: ForecastRequest = {
      productId: pid,
      category: catOf.get(pid),
      asOf,
      targetDates: targets,
      sales: salesBefore(asOf),
      calendar: calBefore(asOf, targets),
    };
    assertNoLeakage(req, strictCal);
    const out = forecast(req).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
    if (out.length !== targets.length) throw new Error(`Forecaster returned ${out.length} values for ${targets.length} dates (${pid}).`);
    cache.set(key, out);
    return out;
  };

  const safetyStock = (pid: string, asOf: string, L: number, dH: number) => {
    const hist = trailing(pid, asOf, sigmaWin);
    if (hist.length < minSigmaObs) return Math.ceil(0.2 * dH);
    return Math.ceil(z * stdev(hist) * Math.sqrt(L));
  };

  const excluded: { productId: string; reason: string }[] = [];
  const accuracy: ProductAccuracy[] = [];
  const policies: ProductPolicy[] = [];
  const series: ProductSeries[] = [];
  const allActual: number[] = [];
  const allSmart: number[] = [];
  const allBase: number[] = [];

  const invIds = new Set(inventory.map((i) => i.productId));
  for (const pid of daily.keys()) if (!invIds.has(pid)) excluded.push({ productId: pid, reason: 'Sales history exists but no inventory record (MISSING_INVENTORY_RECORD).' });

  for (const inv of inventory) {
    const pid = inv.productId;
    if (!daily.has(pid)) {
      excluded.push({ productId: pid, reason: 'No sales history — cannot forecast or replay.' });
      continue;
    }
    const preHoldoutObservations = new Set(
      sortedSales
        .filter((r) => r.productId === pid && r.date < hStart)
        .map((r) => r.date),
    );
    const preHoldoutPositiveObservations = new Set(
      sortedSales
        .filter((r) => r.productId === pid && r.date < hStart && r.quantitySold > 0)
        .map((r) => r.date),
    );
    const L = Math.max(1, Math.round(inv.leadTimeDays ?? defaultL));
    const len = horizonLen(L);
    const actual = hDates.map((d) => demandOn(pid, d));

    // ── Part A: one-day-ahead accuracy, origin = the day itself (history strictly < t) ──
    const smartF = hDates.map((d) => getForecast(pid, d, len)[0]);
    const baseF = hDates.map((d) => {
      const h = trailing(pid, d, baseWin);
      return mean(h);
    });
    const sS = errStats(actual, smartF);
    const bS = errStats(actual, baseF);
    allActual.push(...actual);
    allSmart.push(...smartF);
    allBase.push(...baseF);
    accuracy.push({
      productId: pid,
      product: inv.product,
      category: inv.category ?? catOf.get(pid),
      smart: sS,
      baseline: bS,
      maeImprovementPct: improvementPct(bS.mae, sS.mae),
      winner: Math.abs(sS.mae - bS.mae) < 1e-9 ? 'tie' : sS.mae < bS.mae ? 'smart' : 'baseline',
      sparseHistory: preHoldoutObservations.size < 14 || preHoldoutPositiveObservations.size < 3,
    });

    // ── Part B: policy replay ──
    const d7 = sum(getForecast(pid, hStart, len).slice(0, 7));
    const S0 = safetyStock(pid, hStart, L, d7);
    const startStock = Math.ceil(d7 + S0);
    const staticQ = Math.max(1, Math.ceil(staticQtyFn(inv)));
    const R = inv.reorderLevel;

    type Sim = { onHand: number; pipeline: { arrive: number; qty: number }[]; out: PolicyOutcome; endStock: number[] };
    const mk = (): Sim => ({
      onHand: startStock,
      pipeline: [],
      endStock: [],
      out: { stockoutDays: 0, lostUnits: 0, fillRate: null, leftoverUnits: 0, ordersPlaced: 0, unitsOrdered: 0 },
    });
    const smart = mk();
    const stat = mk();

    for (let i = 0; i < holdoutDays; i++) {
      for (const s of [smart, stat]) {
        // 1. receive orders arriving at start of day i
        s.pipeline = s.pipeline.filter((o) => {
          if (o.arrive <= i) {
            s.onHand += o.qty;
            return false;
          }
          return true;
        });
        // 2. serve demand (lost sales, no backorders)
        const dem = actual[i];
        const sold = Math.min(s.onHand, dem);
        const lost = dem - sold;
        s.onHand -= sold;
        if (lost > 0) {
          s.out.stockoutDays += 1;
          s.out.lostUnits += lost;
        }
        s.endStock.push(s.onHand);
      }

      // 3. end-of-day review (orders arriving after the window are skipped as irrelevant)
      if (i + L >= holdoutDays) continue;
      const asOf = hDates[i + 1] ?? addDays(hDates[i], 1); // history now includes day i
      const posSmart = smart.onHand + sum(smart.pipeline.map((o) => o.qty));
      const f = getForecast(pid, asOf, len);
      const dL = sum(f.slice(0, L));
      const dH = sum(f.slice(0, H));
      const S = safetyStock(pid, asOf, L, dH);
      if (posSmart <= Math.ceil(dL + S)) {
        const q = Math.max(0, Math.ceil(dH + S - posSmart));
        if (q > 0) {
          smart.pipeline.push({ arrive: i + L, qty: q });
          smart.out.ordersPlaced += 1;
          smart.out.unitsOrdered += q;
        }
      }
      const posStat = stat.onHand + sum(stat.pipeline.map((o) => o.qty));
      if (posStat <= R) {
        stat.pipeline.push({ arrive: i + L, qty: staticQ });
        stat.out.ordersPlaced += 1;
        stat.out.unitsOrdered += staticQ;
      }
    }

    const totalDemand = sum(actual);
    for (const s of [smart, stat]) {
      s.out.leftoverUnits = s.onHand;
      s.out.fillRate = totalDemand > 0 ? (totalDemand - s.out.lostUnits) / totalDemand : null;
    }
    policies.push({
      productId: pid,
      product: inv.product,
      leadTimeDays: L,
      startingStock: startStock,
      staticOrderQty: staticQ,
      smart: smart.out,
      static: stat.out,
    });
    series.push({
      productId: pid,
      dates: hDates,
      actual,
      smartForecast: smartF,
      baselineForecast: baseF,
      smartStockEnd: smart.endStock,
      staticStockEnd: stat.endStock,
    });
  }

  // ── Portfolio roll-ups ──
  const pSmart = errStats(allActual, allSmart);
  const pBase = errStats(allActual, allBase);
  const agg = (k: 'smart' | 'static'): PolicyOutcome => {
    const o: PolicyOutcome = { stockoutDays: 0, lostUnits: 0, fillRate: null, leftoverUnits: 0, ordersPlaced: 0, unitsOrdered: 0 };
    let dem = 0;
    for (const p of policies) {
      const x = p[k];
      o.stockoutDays += x.stockoutDays;
      o.lostUnits += x.lostUnits;
      o.leftoverUnits += x.leftoverUnits;
      o.ordersPlaced += x.ordersPlaced;
      o.unitsOrdered += x.unitsOrdered;
    }
    for (const s of series) dem += sum(s.actual);
    o.fillRate = dem > 0 ? (dem - o.lostUnits) / dem : null;
    return o;
  };
  const aSmart = agg('smart');
  const aStat = agg('static');

  const assumptions = [
    `Holdout = latest ${holdoutDays} days of sales (${hStart} → ${lastDate}). Strict time split: every forecast uses only sales dated before its forecast origin (enforced by a runtime leakage check).`,
    calendarModeText(strictCal),
    'Actual sales quantity is used as a proxy for true demand (no stockout history available), so holdout "actuals" may understate demand on days stock was short.',
    `Accuracy (Part A): one-day-ahead forecast for each holdout day, compared with a trailing ${baseWin}-day average of days before it. Missing sales dates are treated as 0 units.`,
    `Starting stock (both policies) is initialised at day 1 to D̂₇ + safety buffer, because historical daily inventory snapshots are unavailable.`,
    'Orders are placed at the end of day i and become available at the start of day i + lead time. Unmet demand is lost (no backorders).',
    `Smart policy: when inventory position (on hand + on order) ≤ forecast lead-time demand + safety buffer, order ⌈D̂_${H}d + safety − position⌉. Safety buffer = ⌈${z}·σ·√L⌉ using trailing ${sigmaWin}-day σ (fallback 20% × D̂_${H}d when < ${minSigmaObs} days of history).`,
    'Static policy: when inventory position ≤ reorder level, order one fixed quantity (inventory quantity_received if present, else the reorder level). Same lead time and starting stock as Smart.',
    'A stockout day = a day on which demand exceeded available units. Leftover = on-hand units at the end of the window (excludes open orders).',
  ];

  return {
    holdout: { start: hStart, end: lastDate, days: holdoutDays },
    accuracy: {
      portfolio: {
        smart: pSmart,
        baseline: pBase,
        maeImprovementPct: improvementPct(pBase.mae, pSmart.mae),
        wmapeImprovementPct: improvementPct(pBase.wmape, pSmart.wmape),
        productsWhereSmartWins: accuracy.filter((a) => a.winner === 'smart').length,
        productsEvaluated: accuracy.length,
      },
      perProduct: accuracy,
    },
    policy: {
      portfolio: { smart: aSmart, static: aStat, stockoutDaysAvoided: aStat.stockoutDays - aSmart.stockoutDays, leftoverDelta: aStat.leftoverUnits - aSmart.leftoverUnits },
      perProduct: policies,
    },
    series,
    excluded,
    simulated: true,
    assumptions,
    disclosure:
      'SIMULATED RESULTS. Inventory outcomes come from a day-by-day replay under the stated assumptions, not from recorded store inventory. They illustrate relative policy behaviour on past demand and are not proven financial savings.',
  };
}

function calendarModeText(strict: boolean) {
  return strict
    ? 'Calendar: strict mode — only calendar rows dated before the forecast origin are visible; future events on target dates are not known.'
    : 'Calendar: events scheduled for the target dates (holidays, festivals, planned promotions) are treated as known in advance; no sales outcomes from those dates are visible.';
}

/*
 * Adapter example for Agent 2 (adjust names to the real export):
 *
 *   import { forecastDemand } from './forecaster';
 *   const forecastFn: ForecastFn = (req) =>
 *     forecastDemand({ productId: req.productId, targetDates: req.targetDates,
 *                      sales: req.sales, calendar: req.calendar, asOf: req.asOf })
 *       .map(d => d.quantity);
 *
 *   const result = runReplay(sales, inventory, calendar, forecastFn, { horizonDays: horizon });
 */
