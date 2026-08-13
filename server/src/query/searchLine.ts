import type { Db } from "../db/index.js";
import { normalizeName } from "../geo/normalize.js";
import { ACTIVE_SERVICES_SQL, serviceDateParams } from "./services.js";
import { tripEndpoints } from "./trips.js";

/** A day of one line is tens of runs; this cap is a guard, not a page size. */
export const DEFAULT_LINE_TRIP_LIMIT = 200;

export interface LineSearchOptions {
  readonly route: string;
  readonly date: string;
  /** Seconds since service midnight — GTFS runs past 24:00, so this is not a clock time. */
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly limit?: number;
}

export interface LineTrip {
  readonly tripId: string;
  readonly routeId: string;
  readonly line: string;
  readonly headsign: string | null;
  readonly directionId: number | null;
  readonly departureTime: string | null;
  readonly departureSeconds: number | null;
  readonly arrivalTime: string | null;
  readonly arrivalSeconds: number | null;
  readonly origin: {
    readonly stopId: string;
    readonly name: string;
    readonly comune: string | null;
  };
  readonly destination: {
    readonly stopId: string;
    readonly name: string;
    readonly comune: string | null;
  };
}

export interface LineSearchResult {
  readonly trips: readonly LineTrip[];
  /** More runs matched than were returned — the UI must say so rather than imply completeness. */
  readonly truncated: boolean;
}

/**
 * Mode 1: the runs of a known line departing inside a time window.
 *
 * Departure is the departure from the run's *first* stop, which is what a
 * timetable means by "the 06:30", and it is compared in seconds-since-service-
 * midnight so a 25:10 run sorts after the 23:50 one instead of before everything.
 */
export function searchLine(db: Db, options: LineSearchOptions): LineSearchResult {
  const limit = options.limit ?? DEFAULT_LINE_TRIP_LIMIT;
  const rows = db
    .prepare(
      `SELECT t.trip_id, t.route_id, r.route_short_name, t.trip_headsign, t.direction_id
         FROM trips t
         JOIN routes r ON r.route_id = t.route_id
         JOIN stop_times st
           ON st.trip_id = t.trip_id
          AND st.stop_sequence = (SELECT MIN(stop_sequence) FROM stop_times WHERE trip_id = t.trip_id)
        WHERE r.route_short_name_norm = @route
          AND t.service_id IN (${ACTIVE_SERVICES_SQL})
          AND st.departure_s BETWEEN @from AND @to
        ORDER BY st.departure_s, t.trip_id
        LIMIT @limit`,
    )
    .all({
      ...serviceDateParams(options.date),
      route: normalizeName(options.route),
      from: options.fromSeconds,
      to: options.toSeconds,
      // One row past the limit is how truncation is detected without a COUNT(*).
      limit: limit + 1,
    }) as ReadonlyArray<{
    trip_id: string;
    route_id: string;
    route_short_name: string | null;
    trip_headsign: string | null;
    direction_id: number | null;
  }>;

  const truncated = rows.length > limit;
  const kept = truncated ? rows.slice(0, limit) : rows;
  const endpoints = tripEndpoints(
    db,
    kept.map((row) => row.trip_id),
  );

  const trips = kept.flatMap((row): LineTrip[] => {
    const ends = endpoints.get(row.trip_id);
    // A trip with no stop_times cannot be shown or tracked; the feed has none,
    // but silently rendering an empty run would be worse than omitting it.
    if (!ends) return [];
    return [
      {
        tripId: row.trip_id,
        routeId: row.route_id,
        line: row.route_short_name ?? "",
        headsign: row.trip_headsign,
        directionId: row.direction_id,
        departureTime: ends.departureTime,
        departureSeconds: ends.departureSeconds,
        arrivalTime: ends.arrivalTime,
        arrivalSeconds: ends.arrivalSeconds,
        origin: ends.origin,
        destination: ends.destination,
      },
    ];
  });

  return { trips, truncated };
}
