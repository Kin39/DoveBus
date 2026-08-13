import type { Db } from "../db/index.js";
import { normalizeName } from "../geo/normalize.js";

export const DEFAULT_ROUTE_LIMIT = 20;

export interface RouteMatch {
  readonly shortName: string;
  readonly longName: string | null;
  /** A line name can be served by several `route_id`s — search resolves through all of them. */
  readonly routeIds: readonly string[];
}

export interface RouteSearchOptions {
  readonly q?: string;
  readonly limit?: number;
}

export interface RouteName {
  readonly shortName: string | null;
  readonly longName: string | null;
}

/**
 * Line autocomplete.
 *
 * Grouped by line name rather than by `route_id`: riders know "SI381", not the
 * two or three route ids the feed happens to split it across, and mode-1 search
 * resolves a name back to every route it covers.
 */
export function searchRoutes(db: Db, options: RouteSearchOptions): readonly RouteMatch[] {
  const limit = options.limit ?? DEFAULT_ROUTE_LIMIT;
  const query = normalizeName(options.q ?? "");

  const rows = (
    query
      ? db
          .prepare(
            `SELECT route_short_name, route_short_name_norm,
                    MIN(route_long_name) AS route_long_name,
                    GROUP_CONCAT(route_id) AS route_ids
               FROM routes
              WHERE route_short_name_norm LIKE @prefix ESCAPE '\\'
                 OR route_short_name_norm LIKE @anywhere ESCAPE '\\'
              GROUP BY route_short_name_norm
              ORDER BY (route_short_name_norm LIKE @prefix ESCAPE '\\') DESC, route_short_name
              LIMIT @limit`,
          )
          .all({ prefix: `${escapeLike(query)}%`, anywhere: `%${escapeLike(query)}%`, limit })
      : db
          .prepare(
            `SELECT route_short_name, route_short_name_norm,
                    MIN(route_long_name) AS route_long_name,
                    GROUP_CONCAT(route_id) AS route_ids
               FROM routes
              GROUP BY route_short_name_norm
              ORDER BY route_short_name
              LIMIT @limit`,
          )
          .all({ limit })
  ) as ReadonlyArray<{
    route_short_name: string | null;
    route_long_name: string | null;
    route_ids: string;
  }>;

  return rows.map((row) => ({
    shortName: row.route_short_name ?? "",
    longName: row.route_long_name,
    routeIds: row.route_ids.split(","),
  }));
}

/**
 * Every route's names, for labelling live vehicles.
 *
 * The realtime feed carries `route_id` only, and the map needs the line number on
 * ~1000 markers per request: one small table read beats a join per vehicle.
 */
export function routeIndex(db: Db): ReadonlyMap<string, RouteName> {
  const rows = db
    .prepare("SELECT route_id, route_short_name, route_long_name FROM routes")
    .all() as ReadonlyArray<{
    route_id: string;
    route_short_name: string | null;
    route_long_name: string | null;
  }>;

  return new Map(
    rows.map((row) => [
      row.route_id,
      { shortName: row.route_short_name, longName: row.route_long_name },
    ]),
  );
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
