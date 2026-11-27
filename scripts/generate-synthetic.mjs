import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const anchor = new Date("2026-11-27T00:00:00Z");
const products = [
  ["D001", "Whole Milk 1L", "Dairy", 32, .28, 7], ["D002", "Greek Yogurt", "Dairy", 18, .20, 14],
  ["B001", "Sourdough Loaf", "Bakery", 15, .18, 2], ["B002", "Croissants 4-pack", "Bakery", 12, .17, 3],
  ["P001", "Bananas", "Produce", 28, .30, 5], ["P002", "Baby Spinach", "Produce", 12, .18, 4],
  ["M001", "Chicken Breast 500g", "Meat", 14, .17, 4], ["F001", "Orange Juice 1L", "Beverages", 10, .12, 30],
  ["F002", "Sparkling Water 6-pack", "Beverages", 8, .10, 180], ["G001", "Pasta 500g", "Pantry", 5, .08, 365],
  ["G002", "Tomato Sauce", "Pantry", 7, .09, 365], ["H001", "Dish Soap", "Household", 3, .06, 365],
];
const iso = d => d.toISOString().slice(0, 10);
const shift = n => new Date(anchor.getTime() + n * 86400000);
const csv = rows => rows.map(row => row.map(v => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; }).join(",")).join("\r\n") + "\r\n";
function save(name, rows) { const path = join(root, "data", name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, csv(rows), "utf8"); }

const sales = [["date", "product_id", "product", "category", "quantity_sold", "selling_price", "promotion_name", "is_promotion", "stock_availability"]];
for (let offset = 120; offset >= 1; offset--) {
  const d = shift(-offset); const weekday = d.getUTCDay();
  products.forEach(([sku, name, category, base, weekendLift], i) => {
    if (sku === "G002" && offset % 17 !== 0) return; // sparse fallback example
    const promo = ["2026-11-09", "2026-11-22", "2026-11-30", "2026-12-09"].includes(iso(d)) || ([63, 62].includes(offset) && [0, 4, 7].includes(i));
    let quantity = Math.round(base * (1 + (weekday === 0 || weekday === 6 ? weekendLift : 0)) * (promo ? 1.35 : 1));
    if (sku === "P001" && offset === 34) quantity *= 6; // deliberate outlier
    if (iso(d) === "2026-10-10") quantity = Math.round(quantity * 1.25);
    sales.push([iso(d), sku, name, category, quantity, (1.2 + i * .43).toFixed(2), promo ? "Weekly Special" : "", promo, "in_stock"]);
  });
}
save("synthetic-sales.csv", sales);

const inv = [["product_id", "product", "category", "current_stock", "reorder_level", "quantity_received", "stock_availability", "incoming_stock", "lead_time_days", "shelf_life_days"]];
const overrides = { D001: [3, 12, 0], B001: [22, 10, 0], P001: [180, 20, 0], P002: [140, 12, 0] };
for (const [sku, name, category, base, , shelf] of products) {
  const [stock, reorder, incoming] = overrides[sku] ?? [Math.max(12, base * 5), Math.max(8, base * 2), 0];
  inv.push([sku, name, category, stock, reorder, 0, "in_stock", incoming, "", shelf]);
}
save("synthetic-inventory.csv", inv);

const calendar = [["date", "day_of_week", "is_weekend", "holiday", "festival", "promotion_event", "event_name"]];
for (let offset = 120; offset >= -30; offset--) {
  const d = shift(-offset); const date = iso(d); const holiday = { "2026-10-10": "Harvest Festival", "2026-12-05": "Winter Market" }[date] ?? "";
  const promo = ["2026-11-09", "2026-11-22", "2026-11-30", "2026-12-09"].includes(date);
  calendar.push([date, d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }), d.getUTCDay() === 0 || d.getUTCDay() === 6, holiday, holiday, promo ? "Storewide Promotion" : "", holiday || (promo ? "Weekly Special" : "")]);
}
save("synthetic-calendar.csv", calendar);
console.log(`Generated deterministic CSVs: ${sales.length - 1} sales rows, ${inv.length - 1} inventory rows, ${calendar.length - 1} calendar rows.`);
