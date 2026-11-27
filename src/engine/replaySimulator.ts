import {
  CalendarRecord,
  HoldoutEvaluationResult,
  HoldoutProductResult,
  InventoryRecord,
  SalesRecord,
} from '../types/domain';
import { addDays } from '../utils/dateUtils';
import { forecastProduct, prepareForecastContext } from './forecaster';
import { computeSafetyBuffer } from './replenishment';

export function runHoldoutEvaluation(
  sales: SalesRecord[],
  inventory: InventoryRecord[],
  calendar: CalendarRecord[],
  globalLeadTimeDays: number
): HoldoutEvaluationResult {
  const holdoutDays = 28;
  if (sales.length === 0 || inventory.length === 0) {
    return {
      holdoutDays,
      startDate: '',
      endDate: '',
      portfolioSmartMae: 0,
      portfolioBaselineMae: 0,
      portfolioSmartWmape: 0,
      portfolioBaselineWmape: 0,
      totalSmartStockoutDays: 0,
      totalStaticStockoutDays: 0,
      totalSmartEndingStock: 0,
      totalStaticEndingStock: 0,
      productsEvaluated: 0,
      perProduct: [],
      assumptions: [],
    };
  }

  let maxDate = sales[0].date;
  for (const s of sales) {
    if (s.date > maxDate) maxDate = s.date;
  }

  const endDate = maxDate;
  const startDate = addDays(endDate, -(holdoutDays - 1));
  const holdoutDates: string[] = [];
  for (let i = 0; i < holdoutDays; i++) {
    holdoutDates.push(addDays(startDate, i));
  }

  // Index actual sales by product_id -> date -> qty
  const actualByProduct = new Map<string, Map<string, number>>();
  for (const s of sales) {
    let map = actualByProduct.get(s.product_id);
    if (!map) {
      map = new Map<string, number>();
      actualByProduct.set(s.product_id, map);
    }
    map.set(s.date, (map.get(s.date) ?? 0) + s.quantity_sold);
  }

  // Pre-build zero-leakage ForecastContext for each of the 28 holdout dates
  const ctxByDate = holdoutDates.map((d) => prepareForecastContext(sales, calendar, d));

  const perProduct: HoldoutProductResult[] = [];
  let sumActualAll = 0;
  let sumSmartAbsErrAll = 0;
  let sumBaseAbsErrAll = 0;
  let totalObsAll = 0;

  let totalSmartStockoutDays = 0;
  let totalStaticStockoutDays = 0;
  let totalSmartEndingStock = 0;
  let totalStaticEndingStock = 0;

  for (const inv of inventory) {
    const prodActualMap = actualByProduct.get(inv.product_id);
    if (!prodActualMap) continue;

    // Check if product has any sales prior to startDate or during holdout
    const hasHoldoutSales = holdoutDates.some((d) => prodActualMap.has(d));
    if (!hasHoldoutSales) continue;

    const leadTime = inv.lead_time_days ?? globalLeadTimeDays;

    // Part A: Zero-leakage Forecast Accuracy (Day-by-Day)
    let smartAbsErr = 0;
    let baseAbsErr = 0;
    let actualTotal = 0;

    // Part B: Simulated Policy Replay Initialization at t_0
    const initialForecast = forecastProduct(inv.product_id, inv.category, 7, ctxByDate[0]);
    const { buffer: initialBuffer } = computeSafetyBuffer(initialForecast, leadTime);
    const startingStock = Math.max(inv.reorder_level, Math.ceil(initialForecast.horizonDemand + initialBuffer));

    let smartStock = startingStock;
    let staticStock = startingStock;
    const smartArrivals = new Map<number, number>(); // dayIndex -> qty
    const staticArrivals = new Map<number, number>();
    let smartStockoutDays = 0;
    let staticStockoutDays = 0;
    let smartOrderCount = 0;
    let staticOrderCount = 0;

    for (let k = 0; k < holdoutDays; k++) {
      const dateStr = holdoutDates[k];
      const ctx = ctxByDate[k];
      const actual = prodActualMap.get(dateStr) ?? 0;

      // Smart prediction for dateStr using strictly data < dateStr
      const dayForecast = forecastProduct(inv.product_id, inv.category, 7, ctx);
      const smartPred = dayForecast.dailyPoints[0]?.predicted ?? 0;

      // Simple trailing 14-day average strictly < dateStr
      const trailStart = addDays(dateStr, -14);
      const prodRows = ctx.salesByProduct.get(inv.product_id) ?? [];
      const trailVals = prodRows.filter((r) => r.date >= trailStart).map((r) => r.quantity_sold);
      const baselinePred =
        trailVals.length > 0 ? trailVals.reduce((a, b) => a + b, 0) / trailVals.length : smartPred;

      smartAbsErr += Math.abs(actual - smartPred);
      baseAbsErr += Math.abs(actual - baselinePred);
      actualTotal += actual;

      // Policy Replay Step k:
      // 1. Receive scheduled arrivals
      smartStock += smartArrivals.get(k) ?? 0;
      staticStock += staticArrivals.get(k) ?? 0;

      // 2. Fulfill actual demand
      if (smartStock < actual) {
        smartStockoutDays++;
        smartStock = 0;
      } else {
        smartStock -= actual;
      }

      if (staticStock < actual) {
        staticStockoutDays++;
        staticStock = 0;
      } else {
        staticStock -= actual;
      }

      // 3. Reorder check at end of day k (only if k + leadTime < holdoutDays or still track pending)
      let smartPending = 0;
      for (const [arrIdx, qty] of smartArrivals.entries()) {
        if (arrIdx > k) smartPending += qty;
      }
      const { buffer: dayBuffer } = computeSafetyBuffer(dayForecast, leadTime);
      const smartTarget = Math.ceil(dayForecast.horizonDemand + dayBuffer);
      const smartNet = smartStock + smartPending;
      if (smartNet < smartTarget && (smartStock <= inv.reorder_level || smartNet < dayForecast.horizonDemand)) {
        const orderQty = smartTarget - smartNet;
        if (orderQty > 0) {
          const arrivalIdx = k + leadTime;
          smartArrivals.set(arrivalIdx, (smartArrivals.get(arrivalIdx) ?? 0) + orderQty);
          smartOrderCount++;
        }
      }

      let staticPending = 0;
      for (const [arrIdx, qty] of staticArrivals.entries()) {
        if (arrIdx > k) staticPending += qty;
      }
      if (staticStock + staticPending <= inv.reorder_level) {
        const fixedQty = Math.max(inv.reorder_level * 2, Math.ceil(baselinePred * 7));
        const arrivalIdx = k + leadTime;
        staticArrivals.set(arrivalIdx, (staticArrivals.get(arrivalIdx) ?? 0) + fixedQty);
        staticOrderCount++;
      }
    }

    const smartMae = smartAbsErr / holdoutDays;
    const baselineMae = baseAbsErr / holdoutDays;
    const smartWmape = actualTotal > 0 ? (smartAbsErr / actualTotal) * 100 : 0;
    const baselineWmape = actualTotal > 0 ? (baseAbsErr / actualTotal) * 100 : 0;

    sumActualAll += actualTotal;
    sumSmartAbsErrAll += smartAbsErr;
    sumBaseAbsErrAll += baseAbsErr;
    totalObsAll += holdoutDays;

    totalSmartStockoutDays += smartStockoutDays;
    totalStaticStockoutDays += staticStockoutDays;
    totalSmartEndingStock += smartStock;
    totalStaticEndingStock += staticStock;

    perProduct.push({
      product_id: inv.product_id,
      product: inv.product,
      category: inv.category,
      actualTotal: Math.round(actualTotal),
      smartMae,
      baselineMae,
      smartWmape,
      baselineWmape,
      smartStockoutDays,
      staticStockoutDays,
      smartEndingStock: Math.round(smartStock),
      staticEndingStock: Math.round(staticStock),
      smartOrderCount,
      staticOrderCount,
    });
  }

  return {
    holdoutDays,
    startDate,
    endDate,
    portfolioSmartMae: totalObsAll > 0 ? sumSmartAbsErrAll / totalObsAll : 0,
    portfolioBaselineMae: totalObsAll > 0 ? sumBaseAbsErrAll / totalObsAll : 0,
    portfolioSmartWmape: sumActualAll > 0 ? (sumSmartAbsErrAll / sumActualAll) * 100 : 0,
    portfolioBaselineWmape: sumActualAll > 0 ? (sumBaseAbsErrAll / sumActualAll) * 100 : 0,
    totalSmartStockoutDays,
    totalStaticStockoutDays,
    totalSmartEndingStock,
    totalStaticEndingStock,
    productsEvaluated: perProduct.length,
    perProduct,
    assumptions: [
      `Zero Data Leakage: Every holdout prediction for date t uses only sales and historical event observations strictly prior to t (${startDate} to ${endDate}).`,
      'Simulated Inventory Replay: Because historical daily inventory snapshots and supplier receipts are unavailable, starting stock at t₀ is initialized to 7-day forecast + safety buffer, and orders arrive after product/global lead time L.',
      'Sales-as-Demand Proxy: Historical quantity_sold is treated as unconstrained demand; simulated replay outcomes are heuristic comparisons, not proven financial savings.',
    ],
  };
}
