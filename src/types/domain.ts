export type ForecastHorizon = 7 | 14 | 30;

export interface SalesRow {
  date: string; // YYYY-MM-DD
  product_id: string;
  product: string;
  category: string;
  quantity_sold: number;
  selling_price?: number;
  promotion_name?: string;
  is_promotion: boolean;
}

export interface InventoryRow {
  product_id: string;
  product: string;
  category: string;
  current_stock: number;
  reorder_level: number;
  quantity_received: number;
  stock_availability: string;
  incoming_stock: number;
  lead_time_days?: number;
  shelf_life_days?: number;
}

export interface CalendarRow {
  date: string; // YYYY-MM-DD
  day_of_week?: string;
  is_weekend: boolean;
  holiday: boolean;
  festival: boolean;
  promotion_event: boolean;
  event_name?: string;
}

export interface ExcludedProduct {
  product_id: string;
  product?: string;
  source: 'sales' | 'inventory';
  reason: string;
  details: string;
}

export interface ParseWarning {
  file: 'sales' | 'inventory' | 'calendar';
  row?: number;
  message: string;
}

export interface DatasetLoadResult {
  sales: SalesRow[];
  inventory: InventoryRow[];
  calendar: CalendarRow[];
  excludedProducts: ExcludedProduct[];
  warnings: ParseWarning[];
  errors: string[];
  sourceLabel: string;
}

export type FallbackLevel = 'weekday' | 'product_avg' | 'category_avg' | 'store_median';

export interface DailyForecastPoint {
  date: string;
  baseline: number; // B_{p,t}
  lift: number; // L_{p,t}
  trend: number; // T_p
  predicted: number; // D_hat_{p,t}
  eventName?: string;
  isEvent: boolean;
  fallbackUsed: FallbackLevel;
}

export interface ProductForecast {
  product_id: string;
  asOfDate: string;
  horizon: ForecastHorizon;
  dailyPoints: DailyForecastPoint[];
  horizonDemand: number; // D_hat_{p,H}
  demand14d: number; // D_hat_{p,14}
  recentDailyStdDev: number; // sigma_p
  stdDevAvailable: boolean;
  trendMultiplier: number; // T_p
  outlierCountDampened: number;
  stockoutDaysExcluded: number;
  fallbackLevel: FallbackLevel;
  activeEventNotes: string[];
}

export type ReplenishmentStatus = 'Urgent' | 'Watch' | 'Healthy';

export interface ProductRecommendation {
  product_id: string;
  product: string;
  category: string;
  current_stock: number; // I_avail
  incoming_stock: number; // I_in
  net_stock: number; // I_net
  reorder_level: number; // R
  lead_time_days: number; // L
  lead_time_source: 'product' | 'global_default';
  shelf_life_days?: number;
  forecast: ProductForecast;
  safety_buffer: number; // S_p
  safety_buffer_rule: string;
  suggested_order_qty: number; // Q_p
  days_of_cover: number; // C_p
  net_days_of_cover: number;
  status: ReplenishmentStatus;
  is_excess: boolean;
  perishable_spoilage_risk: boolean;
  missing_inventory_warning: boolean;
  rationale: string;
}

export interface HoldoutProductResult {
  product_id: string;
  product: string;
  category: string;
  actualTotal: number;
  smartMae: number;
  baselineMae: number;
  smartWmape: number;
  baselineWmape: number;
  smartStockoutDays: number;
  staticStockoutDays: number;
  smartEndingStock: number;
  staticEndingStock: number;
  smartOrderCount: number;
  staticOrderCount: number;
}

export interface HoldoutEvaluationResult {
  holdoutDays: number;
  startDate: string;
  endDate: string;
  portfolioSmartMae: number;
  portfolioBaselineMae: number;
  portfolioSmartWmape: number;
  portfolioBaselineWmape: number;
  totalSmartStockoutDays: number;
  totalStaticStockoutDays: number;
  totalSmartEndingStock: number;
  totalStaticEndingStock: number;
  productsEvaluated: number;
  perProduct: HoldoutProductResult[];
  assumptions: string[];
}
