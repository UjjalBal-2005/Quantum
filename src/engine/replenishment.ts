import {
  ForecastHorizon,
  InventoryRow,
  ProductForecast,
  ProductRecommendation,
  ReplenishmentStatus,
} from '../types/domain';
import { ForecastContext, forecastProduct } from './forecaster';

const SERVICE_Z = 1.28; // ~90% service heuristic

export function computeSafetyBuffer(
  forecast: ProductForecast,
  leadTimeDays: number
): { buffer: number; rule: string } {
  if (forecast.stdDevAvailable && forecast.recentDailyStdDev > 0) {
    const buffer = Math.ceil(SERVICE_Z * forecast.recentDailyStdDev * Math.sqrt(leadTimeDays));
    return {
      buffer,
      rule: `ceil(1.28 × σ=${forecast.recentDailyStdDev.toFixed(1)} × √${leadTimeDays})`,
    };
  }
  const buffer = Math.ceil(0.2 * forecast.horizonDemand);
  return {
    buffer,
    rule: `Sparse fallback: ceil(20% × ${forecast.horizon}d forecast=${Math.round(forecast.horizonDemand)})`,
  };
}

/**
 * Steps stock forward day-by-day against daily predicted demand until stock reaches <= 0.
 * Beyond the forecast horizon, cycles the weekly pattern of the forecast.
 */
export function computeDaysOfCover(stock: number, forecast: ProductForecast): number {
  if (stock <= 0) return 0;
  const pts = forecast.dailyPoints;
  if (pts.length === 0) return 365;

  let remaining = stock;
  let days = 0;
  const maxDays = 365;

  while (remaining > 0 && days < maxDays) {
    const dailyDemand = pts[days % pts.length].predicted;
    if (dailyDemand <= 0) {
      return maxDays;
    }
    if (remaining <= dailyDemand) {
      days += remaining / dailyDemand;
      remaining = 0;
      break;
    }
    remaining -= dailyDemand;
    days += 1;
  }

  return Number(days.toFixed(1));
}

function buildRationale(
  inv: InventoryRow,
  leadTime: number,
  horizon: ForecastHorizon,
  forecast: ProductForecast,
  safetyBuffer: number,
  suggestedOrder: number,
  daysCover: number,
  status: ReplenishmentStatus,
  isExcess: boolean,
  spoilageRisk: boolean
): string {
  const coverStr = daysCover >= 365 ? '365+' : daysCover.toFixed(1);
  const stockPhrase = `${inv.current_stock} units on hand (${inv.incoming_stock} incoming) provide ${coverStr} days of cover`;

  let triggerPhrase = '';
  if (status === 'Urgent') {
    const reasons: string[] = [];
    if (daysCover <= leadTime) reasons.push(`shorter than the ${leadTime}-day supplier lead time`);
    if (inv.current_stock <= inv.reorder_level) reasons.push(`at/below the reorder level of ${inv.reorder_level}`);
    triggerPhrase = `Urgent: ${stockPhrase}, which is ${reasons.join(' and ')}.`;
  } else if (status === 'Watch') {
    triggerPhrase = `Watch: ${stockPhrase}, which falls short of the ${horizon}-day planning horizon (lead time ${leadTime}d, reorder level ${inv.reorder_level}).`;
  } else if (isExcess) {
    triggerPhrase = `Excess Stock: ${stockPhrase}, exceeding 2× the 14-day demand estimate (${Math.round(forecast.demand14d)} units).`;
  } else {
    triggerPhrase = `Healthy: ${stockPhrase}, covering the ${horizon}-day horizon above the reorder level of ${inv.reorder_level}.`;
  }

  const drivers: string[] = [];
  if (forecast.activeEventNotes.length > 0) {
    drivers.push(`upcoming ${forecast.activeEventNotes.slice(0, 2).join(', ')}`);
  }
  if (Math.abs(forecast.trendMultiplier - 1) >= 0.03) {
    const pct = Math.round((forecast.trendMultiplier - 1) * 100);
    drivers.push(`recent ${pct >= 0 ? '+' : ''}${pct}% trend`);
  }
  if (forecast.fallbackLevel !== 'weekday') {
    const mapLabel: Record<string, string> = {
      product_avg: 'product daily average fallback',
      category_avg: 'category average fallback (sparse history)',
      store_median: 'store-wide median fallback',
    };
    drivers.push(mapLabel[forecast.fallbackLevel] ?? forecast.fallbackLevel);
  }
  if (forecast.outlierCountDampened > 0) {
    drivers.push(`${forecast.outlierCountDampened} outlier spike dampened`);
  }

  const driverSentence =
    drivers.length > 0
      ? ` Driven by ${drivers.join(' and ')}, ${horizon}-day forecast demand is ${Math.round(forecast.horizonDemand)} units.`
      : ` ${horizon}-day forecast demand is estimated at ${Math.round(forecast.horizonDemand)} units.`;

  let actionSentence = '';
  if (suggestedOrder > 0) {
    actionSentence = ` Recommend ordering ${suggestedOrder} units (includes a ${safetyBuffer}-unit safety buffer).`;
  } else if (spoilageRisk && inv.shelf_life_days !== undefined) {
    actionSentence = ` Perishable spoilage risk: ${coverStr}d cover exceeds ${inv.shelf_life_days}d shelf life — hold orders and consider markdown.`;
  } else {
    actionSentence = ` No replenishment order needed now (net stock covers ${horizon}-day demand + ${safetyBuffer}-unit buffer).`;
  }

  return `${triggerPhrase}${driverSentence}${actionSentence}`;
}

export function evaluateProductReplenishment(
  inv: InventoryRow,
  horizon: ForecastHorizon,
  globalLeadTimeDays: number,
  ctx: ForecastContext
): ProductRecommendation {
  const leadTimeDays = inv.lead_time_days ?? globalLeadTimeDays;
  const leadTimeSource = inv.lead_time_days !== undefined ? 'product' : 'global_default';

  const forecast = forecastProduct(inv.product_id, inv.category, horizon, ctx);
  const { buffer: safetyBuffer, rule: safetyBufferRule } = computeSafetyBuffer(forecast, leadTimeDays);

  const netStock = inv.current_stock + inv.incoming_stock;
  const suggestedOrderQty = Math.max(0, Math.ceil(forecast.horizonDemand + safetyBuffer - netStock));

  const daysOfCover = computeDaysOfCover(inv.current_stock, forecast);
  const netDaysOfCover = computeDaysOfCover(netStock, forecast);

  let status: ReplenishmentStatus = 'Healthy';
  if (inv.current_stock <= inv.reorder_level || daysOfCover <= leadTimeDays) {
    status = 'Urgent';
  } else if (daysOfCover < horizon) {
    status = 'Watch';
  }

  const isExcess = inv.current_stock > 2 * forecast.demand14d;
  const perishableSpoilageRisk =
    inv.shelf_life_days !== undefined && daysOfCover > inv.shelf_life_days;

  const rationale = buildRationale(
    inv,
    leadTimeDays,
    horizon,
    forecast,
    safetyBuffer,
    suggestedOrderQty,
    daysOfCover,
    status,
    isExcess,
    perishableSpoilageRisk
  );

  return {
    product_id: inv.product_id,
    product: inv.product,
    category: inv.category,
    current_stock: inv.current_stock,
    incoming_stock: inv.incoming_stock,
    net_stock: netStock,
    reorder_level: inv.reorder_level,
    lead_time_days: leadTimeDays,
    lead_time_source: leadTimeSource,
    shelf_life_days: inv.shelf_life_days,
    forecast,
    safety_buffer: safetyBuffer,
    safety_buffer_rule: safetyBufferRule,
    suggested_order_qty: suggestedOrderQty,
    days_of_cover: daysOfCover,
    net_days_of_cover: netDaysOfCover,
    status,
    is_excess: isExcess,
    perishable_spoilage_risk: perishableSpoilageRisk,
    missing_inventory_warning: false,
    rationale,
  };
}

const STATUS_PRIORITY: Record<ReplenishmentStatus, number> = {
  Urgent: 0,
  Watch: 1,
  Healthy: 2,
};

export function sortRecommendations(items: ProductRecommendation[]): ProductRecommendation[] {
  return [...items].sort((a, b) => {
    const pDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (pDiff !== 0) return pDiff;
    if (b.suggested_order_qty !== a.suggested_order_qty) {
      return b.suggested_order_qty - a.suggested_order_qty;
    }
    return a.days_of_cover - b.days_of_cover;
  });
}
