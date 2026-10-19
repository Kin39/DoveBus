import type { Db } from "../db/index.js";

/**
 * Fills `trip_comuni` from `stop_times` and the comune each stop was enriched
 * with. Must run after `enrichStops` (it reads `stops.comune_istat`) and after
 * the indexes exist, so the scan walks `stop_times` in trip order.
 *
 * Stops no comune was found for are left out, exactly as the search leaves them
 * out: it matches on `stops.comune_istat = ?`, which a NULL never equals.
 */
export function buildTripComuni(db: Db): number {
  const result = db
    .prepare(
      `INSERT INTO trip_comuni (comune_istat, trip_id, min_seq, max_seq, min_dep_s, max_dep_s)
       SELECT s.comune_istat, st.trip_id,
              MIN(st.stop_sequence), MAX(st.stop_sequence),
              MIN(st.departure_s), MAX(st.departure_s)
         FROM stop_times st
         JOIN stops s ON s.stop_id = st.stop_id
        WHERE s.comune_istat IS NOT NULL
        GROUP BY st.trip_id, s.comune_istat`,
    )
    .run();
  return result.changes;
}
