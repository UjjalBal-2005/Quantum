import {
  CalendarRow,
  DatasetLoadResult,
  ExcludedProduct,
  InventoryRow,
  ParseWarning,
  SalesRow,
} from '../types/domain';
import { isWeekendDate, parseIsoDate } from './dateUtils';

const SALES_ALIASES: Record<string, string> = {
  sku: 'product_id',
  item_id: 'product_id',
  product_name: 'product',
  item_name: 'product',
  quantity: 'quantity_sold',
  units_sold: 'quantity_sold',
  qty: 'quantity_sold',
  promo_flag: 'is_promotion',
  price: 'selling_price',
};

const INVENTORY_ALIASES: Record<string, string> = {
  sku: 'product_id',
  item_id: 'product_id',
  product_name: 'product',
  item_name: 'product',
  on_hand: 'current_stock',
  on_hand_qty: 'current_stock',
  stock_on_hand: 'current_stock',
  incoming_qty: 'incoming_stock',
  on_order: 'incoming_stock',
  lead_time: 'lead_time_days',
  shelf_life: 'shelf_life_days',
};

const CALENDAR_ALIASES: Record<string, string> = {
  event_type: 'event_type',
  promo_event: 'promotion_event',
  is_holiday: 'holiday',
  is_festival: 'festival',
};

function parseCsvMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const clean = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(raw: string, aliases: Record<string, string>): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
  return aliases[key] ?? key;
}

function parseBool(val: string | undefined): boolean {
  if (!val) return false;
  const v = val.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y';
}

function parseOptionalNum(val: string | undefined): number | undefined {
  if (val === undefined || val.trim() === '') return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeDateString(raw: string): string | null {
  const trimmed = raw.trim();
  if (parseIsoDate(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getUTCFullYear();
  const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const d = String(parsed.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseCsvDatasets(
  salesCsv: string,
  inventoryCsv: string,
  calendarCsv: string,
  sourceLabel: string
): DatasetLoadResult {
  const warnings: ParseWarning[] = [];
  const errors: string[] = [];
  const excludedProducts: ExcludedProduct[] = [];

  // 1. Parse Sales
  const salesMatrix = parseCsvMatrix(salesCsv);
  const sales: SalesRow[] = [];
  if (salesMatrix.length < 2) {
    errors.push('Sales CSV is empty or missing data rows.');
  } else {
    const headers = salesMatrix[0].map((h) => normalizeHeader(h, SALES_ALIASES));
    const req = ['date', 'product_id', 'product', 'category', 'quantity_sold'];
    const missing = req.filter((c) => !headers.includes(c));
    if (missing.length > 0) {
      errors.push(`Sales CSV missing required columns: ${missing.join(', ')}`);
    } else {
      const idx = (col: string) => headers.indexOf(col);
      for (let r = 1; r < salesMatrix.length; r++) {
        const line = salesMatrix[r];
        const rawDate = line[idx('date')] ?? '';
        const date = normalizeDateString(rawDate);
        const product_id = (line[idx('product_id')] ?? '').trim();
        const product = (line[idx('product')] ?? '').trim();
        const category = (line[idx('category')] ?? '').trim() || 'Uncategorized';
        const qty = Number(line[idx('quantity_sold')]);

        if (!date || !product_id || !Number.isFinite(qty) || qty < 0) {
          warnings.push({
            file: 'sales',
            row: r + 1,
            message: `Skipped invalid sales row (date="${rawDate}", product_id="${product_id}", qty="${line[idx('quantity_sold')] ?? ''}").`,
          });
          continue;
        }

        sales.push({
          date,
          product_id,
          product: product || product_id,
          category,
          quantity_sold: qty,
          selling_price: idx('selling_price') >= 0 ? parseOptionalNum(line[idx('selling_price')]) : undefined,
          promotion_name: idx('promotion_name') >= 0 ? line[idx('promotion_name')] || undefined : undefined,
          is_promotion: idx('is_promotion') >= 0 ? parseBool(line[idx('is_promotion')]) : false,
        });
      }
    }
  }

  // 2. Parse Inventory
  const invMatrix = parseCsvMatrix(inventoryCsv);
  const inventory: InventoryRow[] = [];
  if (invMatrix.length < 2) {
    errors.push('Inventory CSV is empty or missing data rows.');
  } else {
    const headers = invMatrix[0].map((h) => normalizeHeader(h, INVENTORY_ALIASES));
    const req = [
      'product_id',
      'product',
      'category',
      'current_stock',
      'reorder_level',
      'quantity_received',
      'stock_availability',
    ];
    const missing = req.filter((c) => !headers.includes(c));
    if (missing.length > 0) {
      errors.push(`Inventory CSV missing required columns: ${missing.join(', ')}`);
    } else {
      const idx = (col: string) => headers.indexOf(col);
      const seenIds = new Set<string>();
      for (let r = 1; r < invMatrix.length; r++) {
        const line = invMatrix[r];
        const product_id = (line[idx('product_id')] ?? '').trim();
        const product = (line[idx('product')] ?? '').trim();
        const category = (line[idx('category')] ?? '').trim() || 'Uncategorized';
        const current_stock = Number(line[idx('current_stock')]);
        const reorder_level = Number(line[idx('reorder_level')]);
        const quantity_received = parseOptionalNum(line[idx('quantity_received')]) ?? 0;
        const stock_availability = (line[idx('stock_availability')] ?? 'in_stock').trim().toLowerCase();
        const incoming_stock = idx('incoming_stock') >= 0 ? parseOptionalNum(line[idx('incoming_stock')]) ?? 0 : 0;
        const lead_time_days = idx('lead_time_days') >= 0 ? parseOptionalNum(line[idx('lead_time_days')]) : undefined;
        const shelf_life_days = idx('shelf_life_days') >= 0 ? parseOptionalNum(line[idx('shelf_life_days')]) : undefined;

        if (!product_id || !Number.isFinite(current_stock) || current_stock < 0 || !Number.isFinite(reorder_level)) {
          warnings.push({
            file: 'inventory',
            row: r + 1,
            message: `Skipped invalid inventory row (product_id="${product_id}").`,
          });
          continue;
        }

        if (seenIds.has(product_id)) {
          warnings.push({
            file: 'inventory',
            row: r + 1,
            message: `Duplicate product_id "${product_id}" in inventory CSV; keeping first row.`,
          });
          continue;
        }
        seenIds.add(product_id);

        inventory.push({
          product_id,
          product: product || product_id,
          category,
          current_stock,
          reorder_level: Math.max(0, reorder_level),
          quantity_received: Math.max(0, quantity_received),
          stock_availability,
          incoming_stock: Math.max(0, incoming_stock),
          lead_time_days: lead_time_days !== undefined && lead_time_days > 0 ? Math.round(lead_time_days) : undefined,
          shelf_life_days: shelf_life_days !== undefined && shelf_life_days > 0 ? Math.round(shelf_life_days) : undefined,
        });
      }
    }
  }

  // 3. Parse Calendar
  const calMatrix = parseCsvMatrix(calendarCsv);
  const calendar: CalendarRow[] = [];
  if (calMatrix.length < 2) {
    warnings.push({
      file: 'calendar',
      message: 'Calendar CSV is empty; proceeding with normal weekday/weekend assumptions.',
    });
  } else {
    const headers = calMatrix[0].map((h) => normalizeHeader(h, CALENDAR_ALIASES));
    if (!headers.includes('date')) {
      errors.push('Calendar CSV missing required column: date');
    } else {
      const idx = (col: string) => headers.indexOf(col);
      for (let r = 1; r < calMatrix.length; r++) {
        const line = calMatrix[r];
        const rawDate = line[idx('date')] ?? '';
        const date = normalizeDateString(rawDate);
        if (!date) {
          warnings.push({
            file: 'calendar',
            row: r + 1,
            message: `Skipped calendar row with invalid date "${rawDate}".`,
          });
          continue;
        }

        const eventType = idx('event_type') >= 0 ? (line[idx('event_type')] ?? '').trim().toLowerCase() : '';
        const holiday = (idx('holiday') >= 0 && parseBool(line[idx('holiday')])) || eventType === 'holiday';
        const festival = (idx('festival') >= 0 && parseBool(line[idx('festival')])) || eventType === 'festival';
        const promotion_event =
          (idx('promotion_event') >= 0 && parseBool(line[idx('promotion_event')])) ||
          eventType === 'promotion' ||
          eventType === 'promotion_event';

        calendar.push({
          date,
          day_of_week: idx('day_of_week') >= 0 ? line[idx('day_of_week')] || undefined : undefined,
          is_weekend: idx('is_weekend') >= 0 ? parseBool(line[idx('is_weekend')]) : isWeekendDate(date),
          holiday,
          festival,
          promotion_event,
          event_name: idx('event_name') >= 0 ? line[idx('event_name')] || undefined : undefined,
        });
      }
    }
  }

  // 4. Cross-file product linkage checks
  const invIds = new Set(inventory.map((i) => i.product_id));
  const salesByProduct = new Map<string, SalesRow>();
  for (const s of sales) {
    if (!salesByProduct.has(s.product_id)) salesByProduct.set(s.product_id, s);
  }

  for (const [pid, sample] of salesByProduct.entries()) {
    if (!invIds.has(pid)) {
      excludedProducts.push({
        product_id: pid,
        product: sample.product,
        source: 'sales',
        reason: 'MISSING_INVENTORY_RECORD',
        details: 'Present in Sales CSV but missing from Inventory CSV; excluded from replenishment queue.',
      });
    }
  }

  for (const inv of inventory) {
    if (!salesByProduct.has(inv.product_id)) {
      excludedProducts.push({
        product_id: inv.product_id,
        product: inv.product,
        source: 'inventory',
        reason: 'NO_SALES_HISTORY',
        details: 'Present in Inventory CSV with 0 sales rows; fallback category/store velocity will be used if retained.',
      });
    }
  }

  return {
    sales,
    inventory,
    calendar,
    excludedProducts,
    warnings,
    errors,
    sourceLabel,
  };
}
