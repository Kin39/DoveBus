import { AGENCY_TIMEZONE } from "../config.js";

const YYYYMMDD_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const AGENCY_DATE_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: AGENCY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * GTFS service dates are plain `YYYYMMDD` strings in the agency's local day.
 *
 * Resolved in the agency's timezone rather than the process's: the server is
 * expected to run UTC, where reading the host clock would put every date-less
 * request onto yesterday's timetable for the two hours before midnight.
 */
export function toServiceDate(date: Date): string {
  const parts = AGENCY_DATE_PARTS.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}`;
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
