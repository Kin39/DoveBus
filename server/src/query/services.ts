import type { Db } from "../db/index.js";
import { parseServiceDate } from "../util/date.js";

/**
 * Which services run on a given date.
 *
 * `calendar_dates` comes first deliberately: this operator's `calendar` weekday
 * columns are all zero (verified on the live feed — 513 of 513 services activate
 * through `calendar_dates`), so a resolver keyed on weekdays returns an empty set
 * and both search modes answer "no runs". The weekday branch is still applied,
 * because a future feed may use it and a resolver that only reads exceptions
 * would then be just as wrong in the other direction.
 *
 * All parameters are named: this fragment is embedded as a subquery by the search
 * queries, and mixing named and positional binding across an embed is a trap.
 */
export const ACTIVE_SERVICES_SQL = `
  SELECT service_id FROM calendar_dates WHERE date = @date AND exception_type = 1
  UNION
  SELECT service_id FROM calendar
   WHERE @date BETWEEN start_date AND end_date
     AND (CASE @weekday
            WHEN 0 THEN sunday WHEN 1 THEN monday WHEN 2 THEN tuesday
            WHEN 3 THEN wednesday WHEN 4 THEN thursday WHEN 5 THEN friday
            ELSE saturday
          END) = 1
  EXCEPT
  SELECT service_id FROM calendar_dates WHERE date = @date AND exception_type = 2
`;

export interface ServiceDateParams {
  readonly date: string;
  /** 0 = Sunday, matching `Date#getUTCDay` and the CASE above. */
  readonly weekday: number;
}

/**
 * Binding parameters for `ACTIVE_SERVICES_SQL`.
 *
 * Throws rather than returning an empty set for a malformed date: "no buses run
 * that day" and "you sent a date I cannot read" must not look the same to a caller.
 */
export function serviceDateParams(date: string): ServiceDateParams {
  const parsed = parseServiceDate(date);
  if (!parsed) throw new Error(`invalid service date: ${date} (expected YYYYMMDD)`);
  return { date, weekday: parsed.getUTCDay() };
}

export function activeServiceIds(db: Db, date: string): ReadonlySet<string> {
  const rows = db.prepare(ACTIVE_SERVICES_SQL).all(serviceDateParams(date)) as ReadonlyArray<{
    service_id: string;
  }>;
  return new Set(rows.map((row) => row.service_id));
}
