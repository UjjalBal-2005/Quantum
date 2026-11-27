import {
  CalendarRecord,
  DailyForecastPoint,
  FallbackLevel,
  ForecastHorizon,
  MlProductResult,
  ProductForecast,
  SalesRecord,
} from '../types/domain';
import { addDays, diffDays, getDayOfWeek } from '../utils/dateUtils';

export interface ForecastContext {
  asOfDate: string;
  calendarByDate: Map<string, CalendarRecord>;
  salesByProduct: Map<string, SalesRecord[]>;
  categoryDailyAvg: Map<string, number>;
  storeMedianDaily: number;
  categoryEventLift: Map<string, number>;
}

interface CleanObservation {
  date: string;
  qty: number;
  dampenedQty: number;
  wasOutlier: boolean;
  isEvent: boolean;
  dow: number;
}

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stdDev(vals: number[], avg: number): number {
  if (vals.length < 2) return 0;
  const variance = vals.reduce((acc, v) => acc + (v - avg) ** 2, 0) / vals.length;
  return Math.sqrt(variance);
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function isCalendarEvent(cal: CalendarRecord | undefined): boolean {
  if (!cal) return false;
  return Boolean(cal.holiday || cal.festival || cal.promotion_event);
}

/**
 * Builds a zero-leakage forecasting context strictly using sales < asOfDate
 * and historical event observations < asOfDate.
 * Future calendar rows (>= asOfDate) are retained only for scheduled event lookup.
 */
export function prepareForecastContext(
  sales: SalesRecord[],
  calendar: CalendarRecord[],
  asOfDate: string
): ForecastContext {
  const calendarByDate = new Map<string, CalendarRecord>();
  for (const row of calendar) {
    calendarByDate.set(row.date, row);
  }

  const salesByProduct = new Map<string, SalesRecord[]>();
  const categoryTotals = new Map<string, number[]>();
  const allRecentQtys: number[] = [];

  // 56-day window strictly prior to asOfDate: [asOfDate - 56, asOfDate - 1]
  const windowStart = addDays(asOfDate, -56);

  // Category event lift accumulators
  const catEventVals = new Map<string, number[]>();
  const catNonEventVals = new Map<string, number[]>();

  for (const row of sales) {
    if (row.date >= asOfDate) continue; // Zero-leakage guard

    let list = salesByProduct.get(row.product_id);
    if (!list) {
      list = [];
      salesByProduct.set(row.product_id, list);
    }
    list.push(row);

    const cal = calendarByDate.get(row.date);
    const isEv = Boolean(row.is_promotion) || isCalendarEvent(cal);

    if (row.date >= windowStart) {
      let catArr = categoryTotals.get(row.category);
      if (!catArr) {
        catArr = [];
        categoryTotals.set(row.category, catArr);
      }
      catArr.push(row.quantity_sold);
      allRecentQtys.push(row.quantity_sold);
    }

    if (isEv) {
      const arr = catEventVals.get(row.category) ?? [];
      arr.push(row.quantity_sold);
      catEventVals.set(row.category, arr);
    } else {
      const arr = catNonEventVals.get(row.category) ?? [];
      arr.push(row.quantity_sold);
      catNonEventVals.set(row.category, arr);
    }
  }

  const categoryDailyAvg = new Map<string, number>();
  for (const [cat, vals] of categoryTotals.entries()) {
    categoryDailyAvg.set(cat, mean(vals));
  }

  const categoryEventLift = new Map<string, number>();
  for (const [cat, evVals] of catEventVals.entries()) {
    const nonEvVals = catNonEventVals.get(cat) ?? [];
    if (evVals.length >= 2 && nonEvVals.length >= 3) {
      const base = mean(nonEvVals);
      if (base > 0) {
        categoryEventLift.set(cat, clamp(mean(evVals) / base, 0.8, 2.5));
      }
    }
  }

  const storeMedianDaily = allRecentQtys.length > 0 ? Math.max(1, median(allRecentQtys)) : 1;

  return {
    asOfDate,
    calendarByDate,
    salesByProduct,
    categoryDailyAvg,
    storeMedianDaily,
    categoryEventLift,
  };
}

function cleanProductObservations(
  rows: SalesRecord[],
  calendarByDate: Map<string, CalendarRecord>,
  asOfDate: string,
  stockoutDates?: Set<string>
): { recent56: CleanObservation[]; allClean: CleanObservation[]; stockoutDaysExcluded: number } {
  const windowStart = addDays(asOfDate, -56);
  let stockoutDaysExcluded = 0;

  const rawValid: { row: SalesRecord; isEvent: boolean }[] = [];
  for (const row of rows) {
    if (row.date >= asOfDate) continue;
    const isRowStockout =
      row.stock_availability?.trim().toLowerCase() === 'out_of_stock' ||
      row.stock_availability?.trim().toLowerCase() === 'stockout';
    if (isRowStockout || stockoutDates?.has(row.date)) {
      stockoutDaysExcluded++;
      continue;
    }
    const cal = calendarByDate.get(row.date);
    const isEvent = Boolean(row.is_promotion) || isCalendarEvent(cal);
    rawValid.push({ row, isEvent });
  }

  const recentNonEventQtys = rawValid
    .filter((x) => x.row.date >= windowStart && !x.isEvent)
    .map((x) => x.row.quantity_sold);

  const nonEvMean = mean(recentNonEventQtys);
  const nonEvStd = stdDev(recentNonEventQtys, nonEvMean);
  const outlierThreshold =
    recentNonEventQtys.length >= 5 && nonEvStd > 0 ? nonEvMean + 3 * nonEvStd : Infinity;
  const dampenedCap = nonEvMean + 2 * nonEvStd;

  const allClean: CleanObservation[] = rawValid.map(({ row, isEvent }) => {
    const isOutlier = !isEvent && row.quantity_sold > outlierThreshold;
    return {
      date: row.date,
      qty: row.quantity_sold,
      dampenedQty: isOutlier ? dampenedCap : row.quantity_sold,
      wasOutlier: isOutlier,
      isEvent,
      dow: getDayOfWeek(row.date),
    };
  });

  const recent56 = allClean.filter((o) => o.date >= windowStart);
  return { recent56, allClean, stockoutDaysExcluded };
}

/**
 * Computes daily and horizon demand forecasts for a single product.
 * Always computes 14-day demand in the background for excess-stock evaluation.
 */
export function forecastProduct(
  productId: string,
  category: string,
  horizon: ForecastHorizon,
  ctx: ForecastContext,
  stockoutDates?: Set<string>
): ProductForecast {
  const rows = ctx.salesByProduct.get(productId) ?? [];
  const { recent56, allClean, stockoutDaysExcluded } = cleanProductObservations(
    rows,
    ctx.calendarByDate,
    ctx.asOfDate,
    stockoutDates
  );

  const outlierCountDampened = recent56.filter((o) => o.wasOutlier).length;

  // Non-event observations in last 56 days for baseline & sigma
  const recentNonEvent = recent56.filter((o) => !o.isEvent);
  const baselinePool = recentNonEvent.length >= 3 ? recentNonEvent : recent56;

  // Compute recent daily std dev (sigma_p)
  const stdDevPool = baselinePool.map((o) => o.dampenedQty);
  const stdDevAvailable = stdDevPool.length >= 5;
  const recentDailyStdDev = stdDevAvailable ? stdDev(stdDevPool, mean(stdDevPool)) : 0;

  // Bounded recent trend: latest 14 days vs prior 42 days
  const last14Start = addDays(ctx.asOfDate, -14);
  const last14 = baselinePool.filter((o) => o.date >= last14Start).map((o) => o.dampenedQty);
  const prior42 = baselinePool.filter((o) => o.date < last14Start).map((o) => o.dampenedQty);

  let trendMultiplier = 1.0;
  if (last14.length >= 5 && prior42.length >= 10) {
    const avg14 = mean(last14);
    const avg42 = mean(prior42);
    if (avg42 > 0) {
      trendMultiplier = clamp(avg14 / avg42, 0.85, 1.15);
    }
  }

  // Historical event lift for this product (from allClean strictly < asOfDate)
  const prodEventQtys = allClean.filter((o) => o.isEvent).map((o) => o.qty);
  const prodNonEventQtys = allClean.filter((o) => !o.isEvent).map((o) => o.dampenedQty);
  let productEventLift: number | null = null;
  if (prodEventQtys.length >= 2 && prodNonEventQtys.length >= 3) {
    const base = mean(prodNonEventQtys);
    if (base > 0) {
      productEventLift = clamp(mean(prodEventQtys) / base, 0.8, 2.5);
    }
  }

  // Group baselinePool by day-of-week
  const byDow = new Map<number, number[]>();
  for (const obs of baselinePool) {
    const arr = byDow.get(obs.dow) ?? [];
    arr.push(obs.dampenedQty);
    byDow.set(obs.dow, arr);
  }

  const productRecentAvg = baselinePool.length > 0 ? mean(baselinePool.map((o) => o.dampenedQty)) : 0;
  const totalProductDays = allClean.length;
  const categoryAvg = ctx.categoryDailyAvg.get(category);

  const evalDays = Math.max(horizon, 14);
  const allPoints: DailyForecastPoint[] = [];
  const eventNoteSet = new Set<string>();
  let primaryFallback: FallbackLevel = 'weekday';

  for (let i = 0; i < evalDays; i++) {
    const targetDate = addDays(ctx.asOfDate, i);
    const dow = getDayOfWeek(targetDate);
    const dowVals = byDow.get(dow) ?? [];

    let baseline: number;
    let fallbackUsed: FallbackLevel;

    if (dowVals.length >= 2) {
      baseline = mean(dowVals);
      fallbackUsed = 'weekday';
    } else if (totalProductDays >= 3 && productRecentAvg > 0) {
      baseline = productRecentAvg;
      fallbackUsed = 'product_avg';
    } else if (categoryAvg !== undefined && categoryAvg > 0) {
      baseline = categoryAvg;
      fallbackUsed = 'category_avg';
    } else {
      baseline = ctx.storeMedianDaily;
      fallbackUsed = 'store_median';
    }

    if (i === 0) primaryFallback = fallbackUsed;

    const cal = ctx.calendarByDate.get(targetDate);
    const isEvent = isCalendarEvent(cal);
    let lift = 1.0;

    if (isEvent) {
      if (productEventLift !== null) {
        lift = productEventLift;
      } else {
        const catLift = ctx.categoryEventLift.get(category);
        lift = catLift !== undefined ? catLift : 1.15;
      }
      if (i < horizon) {
        const label = cal?.event_name || (cal?.holiday ? 'Holiday' : cal?.festival ? 'Festival' : 'Promotion');
        const pct = Math.round((lift - 1) * 100);
        eventNoteSet.add(`${label} (${pct >= 0 ? '+' : ''}${pct}%)`);
      }
    }

    const predicted = Math.max(0.1, baseline * lift * trendMultiplier);
    allPoints.push({
      date: targetDate,
      baseline,
      lift,
      trend: trendMultiplier,
      predicted,
      eventName: cal?.event_name,
      isEvent,
      fallbackUsed,
    });
  }

  const dailyPoints = allPoints.slice(0, horizon);
  const horizonDemand = dailyPoints.reduce((acc, p) => acc + p.predicted, 0);
  const demand14d = allPoints.slice(0, 14).reduce((acc, p) => acc + p.predicted, 0);

  return {
    product_id: productId,
    asOfDate: ctx.asOfDate,
    horizon,
    dailyPoints,
    horizonDemand,
    demand14d,
    recentDailyStdDev,
    stdDevAvailable,
    trendMultiplier,
    outlierCountDampened,
    stockoutDaysExcluded,
    fallbackLevel: primaryFallback,
    activeEventNotes: Array.from(eventNoteSet),
  };
}

/**
 * Determines the default forecast start date (1 day after the latest sales date).
 */
export function inferNextAsOfDate(sales: SalesRecord[]): string {
  if (sales.length === 0) return '2026-11-27';
  let maxDate = sales[0].date;
  for (const s of sales) {
    if (s.date > maxDate) maxDate = s.date;
  }
  return addDays(maxDate, 1);
}

export function getLatestSalesWindowDates(sales: SalesRecord[], days: number): string[] {
  if (sales.length === 0) return [];
  let maxDate = sales[0].date;
  for (const s of sales) {
    if (s.date > maxDate) maxDate = s.date;
  }
  const start = addDays(maxDate, -(days - 1));
  const dates: string[] = [];
  for (let i = 0; i <= diffDays(start, maxDate); i++) {
    dates.push(addDays(start, i));
  }
  return dates;
}

/**
 * Merges a Python scikit-learn forecast result onto a statistical baseline forecast.
 * Falls back cleanly to statistical numbers when engineUsed === 'statistical_fallback'.
 */
export function applyMlOverlay(
  statForecast: ProductForecast,
  mlResult: MlProductResult | undefined,
  horizon: ForecastHorizon
): ProductForecast {
  if (!mlResult) return statForecast;

  const mlMetadata = {
    engineUsed: mlResult.engineUsed,
    mlRiskClass: mlResult.mlRiskClass,
    mlRiskConfidence: mlResult.mlRiskConfidence,
    trainingSamples: mlResult.trainingSamples,
    topDrivers: mlResult.topDrivers.map((d) => ({ label: d.label, importance: d.importance })),
  };

  if (mlResult.engineUsed !== 'python_sklearn' || mlResult.dailyForecast.length === 0) {
    return {
      ...statForecast,
      mlMetadata,
    };
  }

  const dailyPoints: DailyForecastPoint[] = mlResult.dailyForecast.slice(0, horizon).map((pt, idx) => {
    const statPt = statForecast.dailyPoints[idx];
    return {
      date: pt.date,
      baseline: pt.predictedUnits,
      lift: 1.0,
      trend: 1.0,
      predicted: pt.predictedUnits,
      eventName: statPt?.eventName,
      isEvent: statPt?.isEvent ?? false,
      fallbackUsed: statForecast.fallbackLevel,
    };
  });

  return {
    ...statForecast,
    dailyPoints,
    horizonDemand: mlResult.horizonDemand,
    demand14d: mlResult.demand14d,
    mlMetadata,
  };
}
