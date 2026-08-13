import type { Db } from "../db/index.js";
import { normalizeName } from "../geo/normalize.js";
import { ACTIVE_SERVICES_SQL, serviceDateParams } from "./services.js";

export const DEFAULT_OD_TRIP_LIMIT = 200;

export interface OdSearchOptions {
  readonly comuneA: string;
  readonly comuneB: string;
  readonly date: string;
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly limit?: number;
}

export interface OdStop {
  readonly stopId: string;
  readonly name: string;
  readonly sequence: number;
}

export interface OdTrip {
  readonly tripId: string;
  readonly routeId: string;
  readonly line: string;
  readonly headsign: string | null;
  readonly directionId: number | null;
  readonly departureSeconds: number | null;
  readonly boarding: OdStop & { readonly departureTime: string | null };
  readonly alighting: OdStop & { readonly arrivalTime: string | null };
}

export interface OdSearchResult {
  readonly trips: readonly OdTrip[];
  /** More runs matched than were returned — never let a partial list look complete. */
  readonly truncated: boolean;
}

export interface ComuneRef {
  readonly istatCode: string;
  readonly name: string;
}

/** Accepts either an ISTAT code or a comune name in any spelling. */
export function resolveComune(db: Db, value: string): ComuneRef | null {
  const row = db
    .prepare(
      `SELECT istat_code, name FROM comuni WHERE istat_code = @raw OR name_norm = @norm LIMIT 1`,
    )
    .get({ raw: value.trim(), norm: normalizeName(value) }) as
    | { istat_code: string; name: string }
    | undefined;
  return row ? { istatCode: row.istat_code, name: row.name } : null;
}

/**
 * Mode 2: direct runs from one comune to another.
 *
 * The plan's self-join is correct but multiplies: a run calling at eleven stops
 * in Arezzo and eight in Anghiari produces eighty-eight rows for one bus, and on
 * the live feed a single day of Arezzo→Anghiari blew past five thousand rows
 * before grouping — the whole afternoon fell off the end of the cap.
 *
 * So the collapse happens in SQL instead of after it. Each side is reduced to one
 * stop per trip first — the earliest boarding inside the window, then the first
 * alighting after it — which is the journey a rider would actually make, and
 * makes the result exactly one row per run.
 *
 * The calendar filter is not optional: without it the brief measured 736 rows
 * where 34 real runs exist, because every date's copy of every trip matches.
 */
export function searchOd(db: Db, options: OdSearchOptions): OdSearchResult {
  const limit = options.limit ?? DEFAULT_OD_TRIP_LIMIT;

  const rows = db
    .prepare(
      `WITH boarding AS (
         SELECT st.trip_id, MIN(st.stop_sequence) AS seq
           FROM stop_times st
           JOIN trips t ON t.trip_id = st.trip_id
          WHERE st.stop_id IN (SELECT stop_id FROM stops WHERE comune_istat = @comuneA)
            AND st.departure_s BETWEEN @from AND @to
            AND t.service_id IN (${ACTIVE_SERVICES_SQL})
          GROUP BY st.trip_id
       ),
       alighting AS (
         SELECT st.trip_id, MIN(st.stop_sequence) AS seq
           FROM stop_times st
           JOIN boarding ON boarding.trip_id = st.trip_id
          WHERE st.stop_id IN (SELECT stop_id FROM stops WHERE comune_istat = @comuneB)
            AND st.stop_sequence > boarding.seq
          GROUP BY st.trip_id
       )
       SELECT t.trip_id, t.route_id, r.route_short_name, t.trip_headsign, t.direction_id,
              sa.stop_id AS from_stop_id, sa.stop_sequence AS from_seq,
              sa.departure_time AS from_time, sa.departure_s AS from_s, a.stop_name AS from_name,
              sb.stop_id AS to_stop_id, sb.stop_sequence AS to_seq,
              sb.arrival_time AS to_time, sb.arrival_s AS to_s, b.stop_name AS to_name
         FROM alighting
         JOIN boarding ON boarding.trip_id = alighting.trip_id
         JOIN trips t ON t.trip_id = alighting.trip_id
         JOIN routes r ON r.route_id = t.route_id
         JOIN stop_times sa ON sa.trip_id = t.trip_id AND sa.stop_sequence = boarding.seq
         JOIN stop_times sb ON sb.trip_id = t.trip_id AND sb.stop_sequence = alighting.seq
         JOIN stops a ON a.stop_id = sa.stop_id
         JOIN stops b ON b.stop_id = sb.stop_id
        ORDER BY sa.departure_s, t.trip_id
        LIMIT @limit`,
    )
    .all({
      ...serviceDateParams(options.date),
      comuneA: options.comuneA,
      comuneB: options.comuneB,
      from: options.fromSeconds,
      to: options.toSeconds,
      // One row past the limit is how truncation is detected without a COUNT(*).
      limit: limit + 1,
    }) as ReadonlyArray<OdRow>;

  const truncated = rows.length > limit;
  return {
    trips: (truncated ? rows.slice(0, limit) : rows).map(toOdTrip),
    truncated,
  };
}

interface OdRow {
  readonly trip_id: string;
  readonly route_id: string;
  readonly route_short_name: string | null;
  readonly trip_headsign: string | null;
  readonly direction_id: number | null;
  readonly from_stop_id: string;
  readonly from_seq: number;
  readonly from_time: string | null;
  readonly from_s: number | null;
  readonly from_name: string | null;
  readonly to_stop_id: string;
  readonly to_seq: number;
  readonly to_time: string | null;
  readonly to_s: number | null;
  readonly to_name: string | null;
}

function toOdTrip(row: OdRow): OdTrip {
  return {
    tripId: row.trip_id,
    routeId: row.route_id,
    line: row.route_short_name ?? "",
    headsign: row.trip_headsign,
    directionId: row.direction_id,
    departureSeconds: row.from_s,
    boarding: {
      stopId: row.from_stop_id,
      name: row.from_name ?? "",
      sequence: row.from_seq,
      departureTime: row.from_time,
    },
    alighting: {
      stopId: row.to_stop_id,
      name: row.to_name ?? "",
      sequence: row.to_seq,
      arrivalTime: row.to_time,
    },
  };
}
