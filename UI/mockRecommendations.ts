import type { ProductRecommendation, ProductForecast, ReplenishmentStatus } from '../types/domain';

function forecast(id: string, demand: number): ProductForecast {
  return {
    product_id: id, asOfDate: '2026-11-27', horizon: 7, dailyPoints: [],
    horizonDemand: demand, demand14d: demand * 2, recentDailyStdDev: 3,
    stdDevAvailable: true, trendMultiplier: 1, outlierCountDampened: 0,
    stockoutDaysExcluded: 0, fallbackLevel: 'weekday', activeEventNotes: [],
  };
}

interface Opts { shelf?: number; excess?: boolean; spoil?: boolean; text: string }

function rec(
  id: string, product: string, category: string,
  stock: number, incoming: number, reorder: number,
  demand: number, cover: number, status: ReplenishmentStatus,
  order: number, o: Opts
): ProductRecommendation {
  return {
    product_id: id, product, category,
    current_stock: stock, incoming_stock: incoming, net_stock: stock + incoming,
    reorder_level: reorder, lead_time_days: 3, lead_time_source: 'global_default',
    shelf_life_days: o.shelf, forecast: forecast(id, demand),
    safety_buffer: 5, safety_buffer_rule: 'ceil(1.28 x daily std dev x sqrt(lead time))',
    suggested_order_qty: order, days_of_cover: cover, net_days_of_cover: cover + incoming / (demand / 7),
    status, is_excess: !!o.excess, perishable_spoilage_risk: !!o.spoil,
    missing_inventory_warning: false, rationale: o.text,
  };
}

export const MOCK_RECS: ProductRecommendation[] = [
  rec('P01', 'Fresh Milk 1L', 'Dairy', 12, 0, 15, 48, 1.8, 'Urgent', 44,
    { shelf: 5, text: 'Urgent: 12 units give 1.8 days of cover, shorter than the 3-day lead time. Order 44 units.' }),
  rec('P02', 'Brown Bread', 'Bakery', 20, 0, 18, 60, 2.3, 'Urgent', 50,
    { shelf: 3, text: 'Urgent: 2.3 days of cover is below the 3-day lead time. Weekend demand lifts the forecast.' }),
  rec('P03', 'Basmati Rice 5kg', 'Pantry', 40, 20, 25, 56, 5, 'Watch', 12,
    { text: 'Watch: stock lasts 5 days, less than the 7-day horizon. A small top-up is suggested.' }),
  rec('P04', 'Cola 2L', 'Beverages', 90, 0, 30, 49, 12.8, 'Healthy', 0,
    { text: 'Healthy: 12.8 days of cover and stock is above the reorder level.' }),
  rec('P05', 'Yogurt Cup', 'Dairy', 150, 0, 20, 35, 30, 'Healthy', 0,
    { shelf: 7, excess: true, spoil: true, text: 'Excess: 30 days of cover is far beyond the 7-day shelf life. Do not reorder.' }),
  rec('P06', 'Detergent 1kg', 'Household', 200, 0, 20, 28, 49, 'Healthy', 0,
    { excess: true, text: 'Excess: stock is more than twice the 14-day forecast. No order needed.' }),
];
