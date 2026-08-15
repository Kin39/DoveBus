import type { Db } from "../db/index.js";

/** SQLite's default parameter ceiling is well above this; chunking keeps it moot. */
const LOOKUP_CHUNK = 400;

export interface TimetableMatch {
  /** Live buses carrying a `trip_id` — the only ones that can be checked. */
  readonly liveTrips: number;
  readonly matched: number;
  readonly unmatched: number;
  /** 0–1. Null when too few buses are running to read anything into it. */
  readonly unmatchedRatio: number | null;
  /** True when the loaded timetable looks like it no longer describes this feed. */
  readonly stale: boolean;
}

/**
 * How much of the live fleet the loaded timetable can still explain.
 *
 * This exists because the obvious check is impossible: the static feed is a
 * 125 MB GET with no HEAD, so an always-on process cannot ask "has this been
 * republished?" without downloading it. But it can ask a question that costs
 * nothing and answers the same thing — *are the buses out there running trips I
 * have ever heard of?*
 *
 * Measured on 2026-08-15: the operator republished the feed inside its own
 * validity window, so `feed_end_date` still read three weeks out and every
 * expiry check stayed green while one live bus in five had become untraceable.
 * This ratio went from the 3.4% Phase 0 measured as normal to 21.2%, and back to
 * 0.3% the moment the refresh job ran. It is the signal that noticed.
 */
export function timetableMatch(
  db: Db,
  tripIds: readonly string[],
  options: { readonly maxUnmatchedRatio: number; readonly minSample: number },
): TimetableMatch {
  const unique = [...new Set(tripIds)];
  let matched = 0;

  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const row = db
      .prepare<string[], { n: number }>(
        `SELECT COUNT(*) AS n FROM trips WHERE trip_id IN (${placeholders})`,
      )
      .get(...chunk);
    matched += row?.n ?? 0;
  }

  const liveTrips = unique.length;
  const unmatched = liveTrips - matched;
  // Below the sample floor the ratio is noise: at 04:00 three buses are running,
  // and one of them being extra service would read as a 33% failure.
  const unmatchedRatio = liveTrips < options.minSample ? null : unmatched / liveTrips;

  return {
    liveTrips,
    matched,
    unmatched,
    unmatchedRatio,
    stale: unmatchedRatio !== null && unmatchedRatio > options.maxUnmatchedRatio,
  };
}
