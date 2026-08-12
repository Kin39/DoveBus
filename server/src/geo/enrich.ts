import type { Db } from "../db/index.js";
import type { Comune, ComuneResolver } from "./comuni.js";

export interface EnrichmentStats {
  readonly total: number;
  readonly byPolygon: number;
  readonly byName: number;
  /** Stops outside every Tuscan comune — expected for cross-border stops. */
  readonly unresolved: number;
}

export function seedComuni(db: Db, comuni: readonly Comune[]): number {
  const insert = db.prepare(
    "INSERT INTO comuni (istat_code, name, name_norm, centroid_lat, centroid_lon) VALUES (?, ?, ?, ?, ?)",
  );
  const insertAll = db.transaction((rows: readonly Comune[]) => {
    for (const comune of rows) {
      insert.run(
        comune.istatCode,
        comune.name,
        comune.nameNorm,
        comune.centroidLat,
        comune.centroidLon,
      );
    }
  });
  insertAll(comuni);
  return comuni.length;
}

/**
 * Fills `stops.comune` / `comune_istat` / `comune_source` for every stop.
 *
 * Runs once at import so the comune→comune search is a plain indexed lookup
 * instead of 29k point-in-polygon tests per query.
 */
export function enrichStops(db: Db, resolve: ComuneResolver): EnrichmentStats {
  const stops = db
    .prepare("SELECT stop_id, stop_name, stop_lat, stop_lon FROM stops")
    .all() as ReadonlyArray<{
    stop_id: string;
    stop_name: string | null;
    stop_lat: number | null;
    stop_lon: number | null;
  }>;

  const update = db.prepare(
    "UPDATE stops SET comune = ?, comune_istat = ?, comune_source = ? WHERE stop_id = ?",
  );

  let byPolygon = 0;
  let byName = 0;

  const applyAll = db.transaction(() => {
    for (const stop of stops) {
      const match = resolve({
        lat: stop.stop_lat,
        lon: stop.stop_lon,
        name: stop.stop_name ?? "",
      });
      if (!match) continue;
      if (match.source === "polygon") byPolygon++;
      else byName++;
      update.run(match.name, match.istatCode, match.source, stop.stop_id);
    }
  });
  applyAll();

  return {
    total: stops.length,
    byPolygon,
    byName,
    unresolved: stops.length - byPolygon - byName,
  };
}
