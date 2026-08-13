import type { Db } from "../db/index.js";
import { roundCoordinate } from "../geo/coordinates.js";
import { activeServiceIds } from "./services.js";

export interface TripInfo {
  readonly tripId: string;
  readonly routeId: string;
  readonly line: string;
  readonly routeLongName: string | null;
  readonly headsign: string | null;
  readonly directionId: number | null;
  readonly serviceId: string;
  readonly shapeId: string | null;
  readonly date: string;
  /** False when the requested date is not one this run operates on. */
  readonly runsOnDate: boolean;
}

export interface TripStop {
  readonly sequence: number;
  readonly stopId: string;
  readonly name: string;
  readonly comune: string | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly arrivalTime: string | null;
  readonly arrivalSeconds: number | null;
  readonly departureTime: string | null;
  readonly departureSeconds: number | null;
}

/** `[lat, lon]` pairs, in shape order — the line the bus is planned to follow. */
export type ShapePoint = readonly [lat: number, lon: number];

export interface TripDetail {
  readonly trip: TripInfo;
  readonly stops: readonly TripStop[];
  readonly shape: readonly ShapePoint[];
}

/**
 * Everything static about one run: its timetable and its planned route line.
 *
 * A date that the trip does not run on is reported, not refused — a user
 * following a link to yesterday's run should see the timetable and be told it
 * does not operate today, rather than get a bare 404.
 */
export function tripDetail(db: Db, tripId: string, date: string): TripDetail | null {
  const row = db
    .prepare(
      `SELECT t.trip_id, t.route_id, t.service_id, t.trip_headsign, t.direction_id, t.shape_id,
              r.route_short_name, r.route_long_name
         FROM trips t
         JOIN routes r ON r.route_id = t.route_id
        WHERE t.trip_id = ?`,
    )
    .get(tripId) as
    | {
        trip_id: string;
        route_id: string;
        service_id: string;
        trip_headsign: string | null;
        direction_id: number | null;
        shape_id: string | null;
        route_short_name: string | null;
        route_long_name: string | null;
      }
    | undefined;
  if (!row) return null;

  return {
    trip: {
      tripId: row.trip_id,
      routeId: row.route_id,
      line: row.route_short_name ?? "",
      routeLongName: row.route_long_name,
      headsign: row.trip_headsign,
      directionId: row.direction_id,
      serviceId: row.service_id,
      shapeId: row.shape_id,
      date,
      runsOnDate: activeServiceIds(db, date).has(row.service_id),
    },
    stops: tripStops(db, tripId),
    shape: row.shape_id ? tripShape(db, row.shape_id) : [],
  };
}

/** Existence alone, for callers that must reject an unknown trip before doing work. */
export function tripExists(db: Db, tripId: string): boolean {
  return db.prepare("SELECT 1 FROM trips WHERE trip_id = ?").get(tripId) !== undefined;
}

export function tripStops(db: Db, tripId: string): readonly TripStop[] {
  const rows = db
    .prepare(
      `SELECT st.stop_sequence, st.stop_id, st.arrival_time, st.arrival_s,
              st.departure_time, st.departure_s, s.stop_name, s.comune, s.stop_lat, s.stop_lon
         FROM stop_times st
         JOIN stops s ON s.stop_id = st.stop_id
        WHERE st.trip_id = ?
        ORDER BY st.stop_sequence`,
    )
    .all(tripId) as ReadonlyArray<{
    stop_sequence: number;
    stop_id: string;
    arrival_time: string | null;
    arrival_s: number | null;
    departure_time: string | null;
    departure_s: number | null;
    stop_name: string | null;
    comune: string | null;
    stop_lat: number | null;
    stop_lon: number | null;
  }>;

  return rows.map((stop) => ({
    sequence: stop.stop_sequence,
    stopId: stop.stop_id,
    name: stop.stop_name ?? "",
    comune: stop.comune,
    lat: stop.stop_lat,
    lon: stop.stop_lon,
    arrivalTime: stop.arrival_time,
    arrivalSeconds: stop.arrival_s,
    departureTime: stop.departure_time,
    departureSeconds: stop.departure_s,
  }));
}

export function tripShape(db: Db, shapeId: string): readonly ShapePoint[] {
  const rows = db
    .prepare(
      `SELECT shape_pt_lat, shape_pt_lon FROM shapes
        WHERE shape_id = ? ORDER BY shape_pt_sequence`,
    )
    .all(shapeId) as ReadonlyArray<{ shape_pt_lat: number; shape_pt_lon: number }>;

  return rows.map(
    (point) => [roundCoordinate(point.shape_pt_lat), roundCoordinate(point.shape_pt_lon)] as const,
  );
}
