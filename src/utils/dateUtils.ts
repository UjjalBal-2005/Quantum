/**
 * Timezone-safe YYYY-MM-DD date utilities using UTC calendar arithmetic.
 */

export function parseIsoDate(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

export function formatIsoDate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr: string, days: number): string {
  const dt = parseIsoDate(dateStr);
  if (!dt) return dateStr;
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatIsoDate(dt);
}

export function diffDays(a: string, b: string): number {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function getDayOfWeek(dateStr: string): number {
  const dt = parseIsoDate(dateStr);
  return dt ? dt.getUTCDay() : 0; // 0 = Sun ... 6 = Sat
}

export function isWeekendDate(dateStr: string): boolean {
  const dow = getDayOfWeek(dateStr);
  return dow === 0 || dow === 6;
}
