import type { DbHandle } from "../db/handle.js";
import type { Db } from "../db/index.js";
import { type RouteName, routeIndex } from "../query/routes.js";
import type { RealtimeService } from "../rt/service.js";

export interface ApiContext {
  readonly realtime: RealtimeService;
  readonly startedAtMs: number;
  /**
   * The clock a handler reads "today" from. Injected rather than called inline
   * so a test can put a fixture timetable inside its own validity window: read
   * from the wall clock, a fixture that was valid the day it was written expires
   * a few weeks later and takes the health test down with it.
   */
  now(): Date;
  /** The live database, reopened first if the refresh job published a new one. */
  db(): Db;
  /** `route_id` → line names, cached until the database is swapped underneath us. */
  routeNames(): ReadonlyMap<string, RouteName>;
  readonly generation: number;
}

/**
 * What every handler needs, resolved per request rather than captured once: the
 * database can be replaced at any moment by the daily refresh, and a handler
 * holding a stale connection would serve a timetable that no longer applies.
 */
export function createApiContext(
  dbHandle: DbHandle,
  realtime: RealtimeService,
  startedAtMs: number = Date.now(),
  now: () => Date = () => new Date(),
): ApiContext {
  let cachedRoutes: ReadonlyMap<string, RouteName> | null = null;
  let cachedGeneration = -1;

  return {
    realtime,
    startedAtMs,
    now,
    db: () => dbHandle.db(),
    routeNames(): ReadonlyMap<string, RouteName> {
      const db = dbHandle.db();
      if (cachedRoutes === null || cachedGeneration !== dbHandle.generation) {
        cachedRoutes = routeIndex(db);
        cachedGeneration = dbHandle.generation;
      }
      return cachedRoutes;
    },
    get generation(): number {
      return dbHandle.generation;
    },
  };
}
