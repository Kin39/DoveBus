const YYYYMMDD_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** GTFS service dates are plain `YYYYMMDD` strings in the agency's local time. */
export function toServiceDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function parseServiceDate(value: string): Date | null {
  const match = YYYYMMDD_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Rejects 20260231 and friends, which Date would silently roll over.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date;
}

/** Whole days from `from` to `to`; negative when `to` is earlier. Null if unparseable. */
export function daysBetweenServiceDates(from: string, to: string): number | null {
  const start = parseServiceDate(from);
  const end = parseServiceDate(to);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}
