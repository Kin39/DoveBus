import type { Db } from "../db/index.js";
import { normalizeName } from "../geo/normalize.js";

/** Autocomplete is a keystroke away from being a table scan — always bounded. */
export const DEFAULT_COMUNE_LIMIT = 20;

export interface ComuneMatch {
  readonly istatCode: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

export interface ComuneSearchOptions {
  readonly q?: string;
  readonly limit?: number;
}

/**
 * Comune autocomplete for the origin→destination search.
 *
 * Matches the normalized name (uppercase, accent-stripped, alphanumerics only)
 * so "Colle di Val d'Elsa", "colle di val delsa" and "COLLEDIVALDELSA" all find
 * the same place. Prefix matches rank above matches in the middle of a name:
 * someone typing "san" wants San Giovanni before Borgo San Lorenzo.
 */
export function searchComuni(db: Db, options: ComuneSearchOptions): readonly ComuneMatch[] {
  const limit = options.limit ?? DEFAULT_COMUNE_LIMIT;
  const query = normalizeName(options.q ?? "");

  const rows = query
    ? (db
        .prepare(
          `SELECT istat_code, name, centroid_lat, centroid_lon
             FROM comuni
            WHERE name_norm LIKE @prefix ESCAPE '\\' OR name_norm LIKE @anywhere ESCAPE '\\'
            ORDER BY (name_norm LIKE @prefix ESCAPE '\\') DESC, name
            LIMIT @limit`,
        )
        .all({
          prefix: `${escapeLike(query)}%`,
          anywhere: `%${escapeLike(query)}%`,
          limit,
        }) as Rows)
    : (db
        .prepare(
          `SELECT istat_code, name, centroid_lat, centroid_lon
             FROM comuni ORDER BY name LIMIT @limit`,
        )
        .all({ limit }) as Rows);

  return rows.map((row) => ({
    istatCode: row.istat_code,
    name: row.name,
    lat: row.centroid_lat,
    lon: row.centroid_lon,
  }));
}

type Rows = ReadonlyArray<{
  istat_code: string;
  name: string;
  centroid_lat: number;
  centroid_lon: number;
}>;

/** Normalized names cannot contain `%` or `_`, but the escape keeps that true by construction. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
