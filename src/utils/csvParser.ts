import type { CalendarRecord, DataIssue, InventoryRecord, ParsedFile, SalesRecord } from "../types/domain";

type Schema<T> = {
  aliases: Record<string, string[]>;
  required: string[];
  parse: (row: Record<string, string>, rowNumber: number, file: string, issues: DataIssue[]) => T | undefined;
};

const norm = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, "_");
const aliases: Record<string, string[]> = {
  product_id: ["product_id", "sku", "item_id", "id"], product: ["product", "product_name", "item", "item_name"],
  category: ["category", "department", "product_category"], date: ["date", "sales_date", "day"],
  quantity_sold: ["quantity_sold", "quantity", "units_sold", "qty", "units"],
  is_promotion: ["is_promotion", "promo_flag", "promotion", "on_promotion"],
  current_stock: ["current_stock", "on_hand", "on_hand_qty", "stock", "stock_on_hand"],
  reorder_level: ["reorder_level", "reorder_point", "minimum_stock", "min_stock"],
  quantity_received: ["quantity_received", "received_qty", "qty_received"],
  stock_availability: ["stock_availability", "availability", "stock_status"],
  incoming_stock: ["incoming_stock", "incoming_qty", "on_order", "pending_stock"],
  lead_time_days: ["lead_time_days", "lead_time", "supplier_lead_days"], shelf_life_days: ["shelf_life_days", "shelf_life"],
  selling_price: ["selling_price", "price", "unit_price"], promotion_name: ["promotion_name", "promo_name"],
  day_of_week: ["day_of_week", "weekday"], is_weekend: ["is_weekend", "weekend"], holiday: ["holiday", "event_type"],
  festival: ["festival"], promotion_event: ["promotion_event", "promo_event"], event_name: ["event_name", "name"],
};

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) { if (c === '"' && input[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && input[i + 1] === "\n") i++; row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  return { headers: rows[0].map(norm), rows: rows.slice(1) };
}

function numberField(row: Record<string, string>, key: string, rowNumber: number, file: string, issues: DataIssue[], optional = false): number | undefined {
  const raw = row[key]?.trim();
  if ((raw === undefined || raw === "") && optional) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) { issues.push({ file, row: rowNumber, severity: "error", message: `“${key}” must be a non-negative number${raw ? ` (received “${raw}”)` : ""}.` }); return undefined; }
  return n;
}

const schemas: Record<string, Schema<any>> = {
  sales: { aliases, required: ["date", "product_id", "product", "category", "quantity_sold"], parse: (r, n, f, e) => {
    if (!validDate(r.date)) { e.push({ file: f, row: n, severity: "error", message: "“date” must be a valid YYYY-MM-DD date." }); return; }
    const q = numberField(r, "quantity_sold", n, f, e); if (q === undefined) return;
    const price = r.selling_price ? numberField(r, "selling_price", n, f, e, true) : undefined;
    return { date: r.date, product_id: r.product_id, product: r.product, category: r.category, quantity_sold: q, ...(price !== undefined && { selling_price: price }), ...(r.promotion_name && { promotion_name: r.promotion_name }), ...(r.is_promotion !== undefined && { is_promotion: bool(r.is_promotion) }), ...(r.stock_availability && { stock_availability: r.stock_availability }) } as SalesRecord;
  } },
  inventory: { aliases, required: ["product_id", "product", "category", "current_stock", "reorder_level", "quantity_received", "stock_availability"], parse: (r, n, f, e) => {
    const keys = ["current_stock", "reorder_level", "quantity_received"]; const values = keys.map(k => numberField(r, k, n, f, e)); if (values.some(v => v === undefined)) return;
    const optional: Record<string, number | undefined> = {}; for (const k of ["incoming_stock", "lead_time_days", "shelf_life_days"]) { const v = r[k] ? numberField(r, k, n, f, e, true) : undefined; if (v !== undefined) optional[k] = v; }
    return { product_id: r.product_id, product: r.product, category: r.category, current_stock: values[0]!, reorder_level: values[1]!, quantity_received: values[2]!, stock_availability: r.stock_availability, ...optional } as InventoryRecord;
  } },
  calendar: { aliases, required: ["date"], parse: (r, n, f, e) => {
    if (!validDate(r.date)) { e.push({ file: f, row: n, severity: "error", message: "“date” must be a valid YYYY-MM-DD date." }); return; }
    return { date: r.date, ...(r.day_of_week && { day_of_week: r.day_of_week }), ...(r.is_weekend !== undefined && { is_weekend: bool(r.is_weekend) }), ...(r.holiday && { holiday: r.holiday }), ...(r.festival && { festival: r.festival }), ...(r.promotion_event && { promotion_event: r.promotion_event }), ...(r.event_name && { event_name: r.event_name }) } as CalendarRecord;
  } },
};

function bool(value: string): boolean { return ["1", "true", "yes", "y", "promo", "promotion"].includes(value.trim().toLowerCase()); }
function validDate(value?: string): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseCsvFile<K extends keyof typeof schemas>(text: string, kind: K, filename = `${kind}.csv`): ParsedFile<K extends "sales" ? SalesRecord : K extends "inventory" ? InventoryRecord : CalendarRecord> {
  const issues: DataIssue[] = []; const { headers, rows } = parseCsv(text); const schema = schemas[kind];
  if (!headers.length) return { records: [], issues: [{ file: filename, severity: "error", message: "CSV is empty or has no header row." }] } as any;
  const mapped: Record<string, number> = {};
  for (const canonical of Object.keys(schema.aliases)) { const index = headers.findIndex(h => schema.aliases[canonical].map(norm).includes(h)); if (index >= 0) mapped[canonical] = index; }
  const missing = schema.required.filter(k => mapped[k] === undefined);
  if (missing.length) issues.push({ file: filename, severity: "error", message: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Recognized headers: ${headers.join(", ") || "none"}.` });
  if (missing.length) return { records: [], issues } as any;
  const records: unknown[] = [];
  rows.forEach((cells, index) => {
    const raw: Record<string, string> = {}; for (const [key, col] of Object.entries(mapped)) raw[key] = cells[col] ?? "";
    const eventTypeColumn = headers.indexOf("event_type");
    if (kind === "calendar" && eventTypeColumn >= 0) {
      const event = (cells[eventTypeColumn] ?? "").trim(); const lower = event.toLowerCase();
      if (event && lower.includes("promo")) raw.promotion_event = event;
      else if (event && lower.includes("festival")) raw.festival = event;
      else if (event && !raw.holiday) raw.holiday = event;
    }
    for (const key of schema.required) if (!raw[key]?.trim()) issues.push({ file: filename, row: index + 2, severity: "error", message: `Required value “${key}” is blank.` });
    if (schema.required.some(k => !raw[k]?.trim())) return;
    const record = schema.parse(raw, index + 2, filename, issues); if (record) records.push(record);
  });
  return { records, issues } as any;
}

export function validateLinks(sales: SalesRecord[], inventory: InventoryRecord[]): DataIssue[] {
  const issues: DataIssue[] = []; const salesIds = new Set(sales.map(x => x.product_id)); const inventoryIds = new Set(inventory.map(x => x.product_id));
  for (const id of inventoryIds) if (!salesIds.has(id)) issues.push({ file: "sales.csv", severity: "warning", message: `Inventory product “${id}” has no matching sales history and should be excluded or explicitly assigned a fallback.` });
  for (const id of salesIds) if (!inventoryIds.has(id)) issues.push({ file: "inventory.csv", severity: "warning", message: `Sales product “${id}” has no inventory record; it cannot receive a safe order recommendation.` });
  return issues;
}
