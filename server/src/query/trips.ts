import type { Db } from "../db/index.js";

export interface TripEndpoint {
  readonly stopId: string;
  readonly name: string;
  readonly comune: string | null;
}

export interface TripEndpoints {
  readonly origin: TripEndpoint;
  readonly destination: TripEndpoint;
  readonly departureTime: string | null;
  readonly departureSeconds: number | null;
  readonly arrivalTime: string | null;
  readonly arrivalSeconds: number | null;
}

/**
 * Where each run starts and ends — what a trip list has to show before anyone
 * can choose between "06:30 Arezzo → Anghiari" and the next one.
 *
 * Read for an already-bounded set of trips (a search page, never the whole
 * 208k-trip table) in one statement, then reduced in memory: the alternative is
 * a correlated MIN/MAX subquery per row, which reads the same rows anyway.
 */
export function tripEndpoints(
  db: Db,
  tripIds: readonly string[],
): ReadonlyMap<string, TripEndpoints> {
  if (tripIds.length === 0) return new Map();

  const placeholders = tripIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT st.trip_id, st.stop_sequence, st.arrival_time, st.arrival_s,
              st.departure_time, st.departure_s, s.stop_id, s.stop_name, s.comune
         FROM stop_times st
         JOIN stops s ON s.stop_id = st.stop_id
        WHERE st.trip_id IN (${placeholders})
        ORDER BY st.trip_id, st.stop_sequence`,
    )
    .all(...tripIds) as ReadonlyArray<{
    trip_id: string;
    stop_sequence: number;
    arrival_time: string | null;
    arrival_s: number | null;
    departure_time: string | null;
    departure_s: number | null;
    stop_id: string;
    stop_name: string | null;
    comune: string | null;
  }>;

  const byTrip = new Map<string, TripEndpoints>();
  for (const row of rows) {
    const stop: TripEndpoint = {
      stopId: row.stop_id,
      name: row.stop_name ?? "",
      comune: row.comune,
    };
    const existing = byTrip.get(row.trip_id);

    // Rows arrive in stop_sequence order, so the first is the origin and every
    // later one replaces the destination.
    byTrip.set(
      row.trip_id,
      existing
        ? {
            ...existing,
            destination: stop,
            arrivalTime: row.arrival_time,
            arrivalSeconds: row.arrival_s,
          }
        : {
            origin: stop,
            destination: stop,
            departureTime: row.departure_time,
            departureSeconds: row.departure_s,
            arrivalTime: row.arrival_time,
            arrivalSeconds: row.arrival_s,
          },
    );
  }
  return byTrip;
}
