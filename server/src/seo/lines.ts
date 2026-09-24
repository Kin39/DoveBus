import type { Db } from "../db/index.js";
import { comuneSlug, lineSlug } from "./slug.js";

/**
 * What a line page knows about its line.
 *
 * Deliberately not a timetable. The regional feed is republished on 22 days out
 * of 24, and 71.4% of line/direction pairs changed their set of departures
 * between the 20260824 edition and the 20260917 one — the autumn timetable
 * landed overnight on 9 September, taking the region from 755 routes to 955.
 * A page carrying every departure time would be wrong for most lines within
 * days of any regeneration, on a site whose whole manner is to print the age of
 * what it shows.
 *
 * So what is published is the part that answers the query people actually type
 * — "percorso linea 32 firenze", the *route* — plus three facts about the
 * service that are true of the day they name: the first departure, the last,
 * and the average gap between them.
 */

/** A reference day, and the window a line's service is described over. */
export interface LineDirection {
  readonly directionId: number;
  /** Where the bus says it is going, as printed on its front. */
  readonly headsign: string | null;
  readonly trips: number;
  /** `HH:MM` of the first departure from the first stop. */
  readonly first: string;
  readonly last: string;
  /**
   * The average gap between departures, in minutes, or `null` for a direction
   * with one run — where an average would be a division by zero dressed up as
   * a frequency.
   */
  readonly headwayMinutes: number | null;
  /**
   * The stops of the line's busiest itinerary, in order — or empty when the
   * direction has no itinerary representative enough to publish.
   *
   * Empty is a statement, not a gap: see {@link CollectOptions.minimumCoverage}.
   */
  readonly stops: readonly string[];
  /** How many distinct stop patterns the direction's runs follow that day. */
  readonly itineraries: number;
  /** What share of the day's stops the published itinerary calls at, 0-1. */
  readonly coverage: number;
}

export interface LineSummary {
  readonly routeId: string;
  readonly shortName: string;
  readonly longName: string | null;
  /** The comune most of this line's stop calls are in. Drifts; the slug does not. */
  readonly comune: string;
  readonly comuneSlug: string;
  readonly slug: string;
  /** Every comune the line touches, most-served first. */
  readonly comuni: readonly string[];
  readonly trips: number;
  /**
   * The route's length in kilometres, or `null` when the feed's shape does not
   * support a plausible one. See {@link routeLengthKm}.
   */
  readonly lengthKm: number | null;
  readonly directions: readonly LineDirection[];
}

export interface CollectOptions {
  /** The service day the numbers describe — a weekday, stated on the page. */
  readonly date: string;
  /** Minimum runs on that day for a line to be a candidate. */
  readonly minimumTrips: number;
  /**
   * How much of a direction's service its busiest itinerary must cover before
   * that itinerary is published as "the route", 0-1.
   *
   * A line's runs do not all follow one path: short workings, school journeys
   * and diversions each have their own. Publishing the union of them was the
   * first attempt and it invented journeys — 35% of directions ended up listing
   * over 25% more stops than the longest run that exists, Prato's 207 reaching
   * 255 where the longest real run calls at 59.
   *
   * Publishing the busiest real itinerary fixes that, but only says something
   * true about the line when that itinerary is representative. Measured across
   * the 200 published directions, the busiest one covers over 90% of the day's
   * stops in 44% of them and under half in 24%. At 0.75 — the value the site
   * uses — 128 of 200 directions publish a route with a median of 25 stops, and
   * the rest say plainly that the line has no single route.
   */
  readonly minimumCoverage: number;
}

/**
 * The shortest and longest route lengths worth printing, in kilometres.
 *
 * The feed's own `shape_dist_traveled` agrees with a geodesic measurement to
 * within a few percent on most shapes — 14,667 declared against 14.7 km
 * measured — but not on all of them: one shape declares 143 metres for a line
 * that plainly runs further, and another is 13% out. The length is computed
 * here rather than read from that column, and a result outside these bounds is
 * omitted rather than printed: a page that says a bus line is 140 metres long
 * is worse than a page that does not mention its length.
 */
const MIN_PLAUSIBLE_KM = 1;
const MAX_PLAUSIBLE_KM = 400;

/** Mean Earth radius, metres (IUGG). */
const EARTH_RADIUS_M = 6_371_008.8;

interface RouteRow {
  route_id: string;
  route_short_name: string;
  route_long_name: string | null;
  trips: number;
}

/**
 * Every line with real service on the reference day, with what its page needs.
 *
 * The threshold *proposes*: which of these are actually published is an
 * explicit, committed list, so that a new edition of the feed can never make a
 * page appear on its own and step around the rule that pages go out in groups.
 */
export function collectLines(db: Db, options: CollectOptions): readonly LineSummary[] {
  const principal = principalComuni(db);

  const routes = db
    .prepare(
      `SELECT r.route_id, r.route_short_name, r.route_long_name, COUNT(DISTINCT t.trip_id) AS trips
         FROM routes r
         JOIN trips t ON t.route_id = r.route_id
        WHERE r.route_short_name IS NOT NULL
          AND r.route_short_name <> ''
          AND t.service_id IN (
                SELECT service_id FROM calendar_dates WHERE date = @date AND exception_type = 1)
        GROUP BY r.route_id
       HAVING trips >= @minimumTrips
        ORDER BY trips DESC, r.route_id`,
    )
    .all({ date: options.date, minimumTrips: options.minimumTrips }) as ReadonlyArray<RouteRow>;

  return routes.flatMap((route): LineSummary[] => {
    const comuni = principal.get(route.route_id);
    // A line whose every stop is outside Tuscany has no comune to be addressed
    // by. None exists today; one would be dropped rather than published at
    // `/linea/32-/`.
    if (comuni === undefined || comuni.length === 0) return [];
    const comune = comuni[0] as string;

    const directions = collectDirections(
      db,
      route.route_id,
      options.date,
      options.minimumCoverage,
    );
    // Without a direction there is nothing on the page but a title.
    if (directions.length === 0) return [];

    return [
      {
        routeId: route.route_id,
        shortName: route.route_short_name,
        longName: route.route_long_name,
        comune,
        comuneSlug: comuneSlug(comune),
        slug: lineSlug(route.route_short_name, comune),
        comuni,
        trips: route.trips,
        lengthKm: routeLengthKm(db, route.route_id),
        directions,
      },
    ];
  });
}

/**
 * Each route's comuni, the one it calls at most often first.
 *
 * One pass over the whole feed rather than a query per route: the join is over
 * `stop_times`, which is roughly eight million rows, and asking it 946 times
 * turns a few seconds into several minutes.
 */
function principalComuni(db: Db): ReadonlyMap<string, readonly string[]> {
  const rows = db
    .prepare(
      `SELECT t.route_id, s.comune, COUNT(*) AS calls
         FROM trips t
         JOIN stop_times st ON st.trip_id = t.trip_id
         JOIN stops s ON s.stop_id = st.stop_id
        WHERE s.comune IS NOT NULL
        GROUP BY t.route_id, s.comune
        ORDER BY t.route_id, calls DESC`,
    )
    .all() as ReadonlyArray<{ route_id: string; comune: string; calls: number }>;

  const byRoute = new Map<string, string[]>();
  for (const row of rows) {
    const list = byRoute.get(row.route_id);
    if (list === undefined) byRoute.set(row.route_id, [row.comune]);
    else list.push(row.comune);
  }
  return byRoute;
}

function collectDirections(
  db: Db,
  routeId: string,
  date: string,
  minimumCoverage: number,
): readonly LineDirection[] {
  const rows = db
    .prepare(
      `SELECT t.direction_id AS direction_id,
              COUNT(*) AS trips,
              MIN(d.departure_s) AS first_s,
              MAX(d.departure_s) AS last_s,
              MIN(t.trip_headsign) AS headsign
         FROM trips t
         JOIN (SELECT trip_id, MIN(departure_s) AS departure_s
                 FROM stop_times GROUP BY trip_id) d ON d.trip_id = t.trip_id
        WHERE t.route_id = @routeId
          AND t.service_id IN (
                SELECT service_id FROM calendar_dates WHERE date = @date AND exception_type = 1)
        GROUP BY t.direction_id
        ORDER BY t.direction_id`,
    )
    .all({ routeId, date }) as ReadonlyArray<{
    direction_id: number | null;
    trips: number;
    first_s: number | null;
    last_s: number | null;
    headsign: string | null;
  }>;

  return rows.flatMap((row): LineDirection[] => {
    // A direction whose runs carry no departure time cannot be described by any
    // of the three facts the page prints.
    if (row.first_s === null || row.last_s === null) return [];

    const route = dominantItinerary(
      directionItineraries(db, routeId, row.direction_id, date),
    );
    // No itineraries at all means no runs, which the caller has already
    // excluded — but an empty direction would render as a heading over nothing.
    if (route.itineraries === 0) return [];

    return [
      {
        directionId: row.direction_id ?? 0,
        headsign: row.headsign,
        trips: row.trips,
        first: clockOf(row.first_s),
        last: clockOf(row.last_s),
        headwayMinutes:
          row.trips > 1 ? Math.round((row.last_s - row.first_s) / 60 / (row.trips - 1)) : null,
        // Below the bar the page says the line has no single route instead of
        // drawing one. The numbers travel with it so the page can say why.
        stops: route.coverage >= minimumCoverage ? collapseRepeats(route.stops) : [],
        itineraries: route.itineraries,
        coverage: Math.round(route.coverage * 100) / 100,
      },
    ];
  });
}

/** One distinct stop pattern of a direction, and how many runs follow it. */
export interface Itinerary {
  readonly stops: readonly string[];
  readonly runs: number;
}

export interface DirectionRoute {
  readonly stops: readonly string[];
  readonly itineraries: number;
  readonly coverage: number;
}

/**
 * The itinerary most of a direction's runs follow, and how well it stands for
 * the rest.
 *
 * Deliberately *not* a merge of every pattern. Merging was the first answer —
 * it fixed a real fault, the wrong terminus appearing at the top of 35% of
 * directions — and it bought a worse one, because the union of thirty
 * itineraries is a journey no vehicle makes. A published route has to be a
 * route, so this picks one that exists and reports what it leaves out.
 *
 * Ties go to the longer journey, then to the lexicographically first stop
 * sequence. The second tiebreak has no meaning; it is there so that two
 * regenerations of one feed produce the same page, and a diff of a published
 * file shows only what really changed.
 */
export function dominantItinerary(itineraries: readonly Itinerary[]): DirectionRoute {
  if (itineraries.length === 0) return { stops: [], itineraries: 0, coverage: 0 };

  const best = [...itineraries].sort(
    (a, b) =>
      b.runs - a.runs ||
      b.stops.length - a.stops.length ||
      a.stops.join("\u0000").localeCompare(b.stops.join("\u0000")),
  )[0] as Itinerary;

  const served = new Set(itineraries.flatMap((itinerary) => itinerary.stops));
  const covered = new Set(best.stops);

  return {
    stops: best.stops,
    itineraries: itineraries.length,
    coverage: served.size === 0 ? 0 : covered.size / served.size,
  };
}

/**
 * Every distinct itinerary a direction runs on the reference day.
 *
 * Restricted to that day, unlike the first version of this query, which read
 * every trip in the feed: a feed carries a season's worth of variants, and
 * merging in the ones that do not run today described a line nobody could
 * catch.
 */
function directionItineraries(
  db: Db,
  routeId: string,
  directionId: number | null,
  date: string,
): readonly Itinerary[] {
  const rows = db
    .prepare(
      `SELECT t.trip_id AS trip_id, st.stop_id AS stop_id, s.stop_name AS name
         FROM trips t
         JOIN stop_times st ON st.trip_id = t.trip_id
         JOIN stops s ON s.stop_id = st.stop_id
        WHERE t.route_id = @routeId
          AND (@directionId IS NULL OR t.direction_id = @directionId)
          AND t.service_id IN (
                SELECT service_id FROM calendar_dates WHERE date = @date AND exception_type = 1)
        ORDER BY t.trip_id, st.stop_sequence`,
    )
    .all({ routeId, directionId, date }) as ReadonlyArray<{
    trip_id: string;
    stop_id: string;
    name: string | null;
  }>;

  // Keyed on `stop_id`, because two stops across the region share a name often
  // enough that keying on the name would fuse them.
  const names = new Map<string, string>();
  const byTrip = new Map<string, string[]>();
  for (const row of rows) {
    if (row.name === null || row.name === "") continue;
    names.set(row.stop_id, row.name);
    const trip = byTrip.get(row.trip_id);
    if (trip === undefined) byTrip.set(row.trip_id, [row.stop_id]);
    else trip.push(row.stop_id);
  }

  const counted = new Map<string, { stops: string[]; runs: number }>();
  for (const stops of byTrip.values()) {
    const key = stops.join("\u0000");
    const seen = counted.get(key);
    if (seen === undefined) counted.set(key, { stops, runs: 1 });
    else counted.set(key, { stops: seen.stops, runs: seen.runs + 1 });
  }

  return [...counted.values()].map((entry) => ({
    runs: entry.runs,
    stops: entry.stops.flatMap((stopId) => {
      const name = names.get(stopId);
      return name === undefined ? [] : [name];
    }),
  }));
}

/**
 * The length of a route's longest shape, in kilometres, measured rather than read.
 *
 * The longest shape, because a route's runs share several: short workings have
 * their own, and the line's length is the length of the full journey.
 */
export function routeLengthKm(db: Db, routeId: string): number | null {
  const shape = db
    .prepare(
      `SELECT t.shape_id AS shape_id, COUNT(*) AS points
         FROM trips t JOIN shapes sh ON sh.shape_id = t.shape_id
        WHERE t.route_id = @routeId AND t.shape_id IS NOT NULL
        GROUP BY t.shape_id
        ORDER BY points DESC
        LIMIT 1`,
    )
    .get({ routeId }) as { shape_id: string; points: number } | undefined;
  if (shape === undefined) return null;

  const points = db
    .prepare(
      `SELECT shape_pt_lat AS lat, shape_pt_lon AS lon
         FROM shapes WHERE shape_id = @shapeId ORDER BY shape_pt_sequence`,
    )
    .all({ shapeId: shape.shape_id }) as ReadonlyArray<{ lat: number; lon: number }>;

  let metres = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1] as { lat: number; lon: number };
    const to = points[index] as { lat: number; lon: number };
    metres += haversine(from.lat, from.lon, to.lat, to.lon);
  }

  const km = metres / 1000;
  if (km < MIN_PLAUSIBLE_KM || km > MAX_PLAUSIBLE_KM) return null;
  return Math.round(km * 10) / 10;
}

/** Great-circle metres between two WGS84 points. */
function haversine(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const radians = Math.PI / 180;
  const deltaLat = (toLat - fromLat) * radians;
  const deltaLon = (toLon - fromLon) * radians;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat * radians) * Math.cos(toLat * radians) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Seconds since service midnight as a wall clock.
 *
 * GTFS runs past 24:00 — a 25:10 departure is 01:10 the next morning, still
 * part of the previous service day — so the hours wrap rather than printing a
 * "25:10" no timetable outside this file uses.
 */
function clockOf(seconds: number): string {
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Collapses a name repeated immediately, keeping one that recurs later.
 *
 * The feed gives the two poles of a terminus separate ids under one name —
 * `ANTELLA_` and `ANTELLA` — and a list printing it twice in a row reads as a
 * mistake, because it is indistinguishable from one. A name that comes back
 * further along the route is a different matter: Pistoia's lines genuinely run
 * FS to FS, and that second call is a real one.
 */
function collapseRepeats(stops: readonly string[]): readonly string[] {
  return stops.filter((stop, index) => index === 0 || stop !== stops[index - 1]);
}
