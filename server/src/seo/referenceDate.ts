import { parseServiceDate } from "../util/date.js";

/**
 * Which service day the line pages describe, and where an edition's service
 * really ends.
 *
 * The pages print "N corse in un giorno feriale" unconditionally, so the day
 * the numbers come from has to be one: a Saturday or a holiday would publish a
 * false sentence, and fewer lines would clear the trip floor. By hand that was
 * a person choosing a Thursday. Unattended it has to be decided from the feed.
 */

/** Services active on one day of the edition (`calendar_dates` adds). */
export interface DayService {
  readonly date: string;
  readonly services: number;
}

/**
 * Tuesday to Thursday: midweek, where service is the plain weekday timetable.
 * Monday and Friday carry their own variants often enough to be left out.
 */
const REFERENCE_WEEKDAYS: ReadonlySet<number> = new Set([2, 3, 4]);

/**
 * How close to an ordinary weekday the reference day must be.
 *
 * Measured on the 20261031 edition, full weekdays run 586–702 services against
 * a median of 613, and a Sunday 227. Comparing with the median rather than a
 * holiday list also catches the days no national list knows about — a patron
 * saint's day is a holiday in one comune and a weekday everywhere else.
 */
const MIN_SHARE_OF_MEDIAN = 0.95;

/**
 * The share of a weekday below which a day no longer counts as service.
 *
 * The 20261031 edition declares 20261120 but carries 3 services a day from the
 * 18th: half a percent of a weekday. A Sunday is over a third. A fifth sits
 * well clear of both.
 */
const FULL_SERVICE_SHARE = 0.2;

function weekdayOf(date: string): number {
  const parsed = parseServiceDate(date);
  if (parsed === null) throw new Error(`not a YYYYMMDD service date: ${date}`);
  return parsed.getUTCDay();
}

/** Median services over the edition's Monday-to-Friday days; 0 if it has none. */
export function weekdayMedian(days: readonly DayService[]): number {
  const counts = days
    .filter((day) => {
      const weekday = weekdayOf(day.date);
      return weekday >= 1 && weekday <= 5;
    })
    .map((day) => day.services)
    .sort((a, b) => a - b);
  if (counts.length === 0) return 0;
  return counts[Math.floor(counts.length / 2)] as number;
}

/**
 * The first full Tuesday-to-Thursday on or after `today`.
 *
 * Throws rather than falling back to a weaker day: a page stating weekday
 * numbers from a holiday is the failure this exists to prevent, and stopping
 * the refresh until a person looks costs nothing while the committed data is
 * still in date.
 */
export function chooseReferenceDate(days: readonly DayService[], today: string): string {
  weekdayOf(today);
  const floor = weekdayMedian(days) * MIN_SHARE_OF_MEDIAN;
  const chosen = [...days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .find(
      (day) =>
        day.date >= today && REFERENCE_WEEKDAYS.has(weekdayOf(day.date)) && day.services >= floor,
    );
  if (chosen === undefined) {
    throw new Error(
      `no full Tuesday to Thursday on or after ${today} in this edition ` +
        `(needs at least ${Math.ceil(floor)} services) — pass --date=YYYYMMDD after checking the feed`,
    );
  }
  return chosen.date;
}

/** The last day still carrying real service, or `null` if none does. */
export function lastFullServiceDate(days: readonly DayService[]): string | null {
  const floor = weekdayMedian(days) * FULL_SERVICE_SHARE;
  const served = days.filter((day) => day.services > 0 && day.services >= floor);
  if (served.length === 0) return null;
  return served.map((day) => day.date).sort((a, b) => b.localeCompare(a))[0] as string;
}
