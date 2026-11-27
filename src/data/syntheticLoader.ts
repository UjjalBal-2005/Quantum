import salesCsv from "../../data/synthetic-sales.csv?raw";
import inventoryCsv from "../../data/synthetic-inventory.csv?raw";
import calendarCsv from "../../data/synthetic-calendar.csv?raw";
import { parseCsvFile, validateLinks } from "../utils/csvParser";
import type { RetailDataset } from "../types/domain";

/** Deterministic, bundled demo data. CSV parsing runs locally in the browser. */
export function loadSyntheticDataset(): { dataset: RetailDataset; issues: ReturnType<typeof validateLinks> } {
  const sales = parseCsvFile(salesCsv, "sales", "synthetic-sales.csv");
  const inventory = parseCsvFile(inventoryCsv, "inventory", "synthetic-inventory.csv");
  const calendar = parseCsvFile(calendarCsv, "calendar", "synthetic-calendar.csv");
  return {
    dataset: { sales: sales.records, inventory: inventory.records, calendar: calendar.records },
    issues: [...sales.issues, ...inventory.issues, ...calendar.issues, ...validateLinks(sales.records, inventory.records)],
  };
}
