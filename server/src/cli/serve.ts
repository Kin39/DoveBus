/**
 * The API process.
 *
 *   npm run serve
 *
 * One process holds everything: the read-only timetable database, the two
 * realtime pollers, and the HTTP endpoints the frontend reads. Clients never
 * reach the upstream feeds, and the daily refresh job can republish the database
 * underneath a running server without a restart.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApi, closeWithGrace } from "../api/server.js";
import {
  API_HOST,
  API_PORT,
  AUTO_REFRESH,
  LIVE_DB_PATH,
  MAX_UNMATCHED_TRIP_RATIO,
  MIN_TRIP_MATCH_SAMPLE,
  SHUTDOWN_GRACE_MS,
  TIMETABLE_CHECK_MS,
  TIMETABLE_REFRESH_COOLDOWN_MS,
  TUSCANY_BBOX,
} from "../config.js";
import { openDbHandle } from "../db/handle.js";
import { feedValidity, readFeedMeta } from "../feed/meta.js";
import { createTimetableWatch } from "../feed/watch.js";
import { logger } from "../logger.js";
import { createRealtimeService } from "../rt/service.js";
import { toServiceDate } from "../util/date.js";

const dbHandle = (() => {
  try {
    return openDbHandle(LIVE_DB_PATH);
  } catch (error) {
    logger.error("cannot serve", { error: String(error) });
    process.exit(1);
  }
})();

const meta = readFeedMeta(dbHandle.db());
const validity = meta === null ? null : feedValidity(meta, toServiceDate(new Date()));
if (validity?.expired) {
  // Not fatal: stale schedules are still better than no answers, and /healthz
  // reports it. The daily refresh is what fixes it.
  logger.warn("loaded timetable is past its feed_end_date", {
    feedEndDate: meta?.feedEndDate,
    daysExpired: -(validity.daysRemaining ?? 0),
  });
}

const realtime = createRealtimeService();
realtime.start();

const app = buildApi({ dbHandle, realtime });

/**
 * Runs the refresh as a child process rather than in this one.
 *
 * The import is synchronous by design — better-sqlite3 is what makes a
 * five-million-row rebuild fast — so doing it here would block the event loop
 * for the whole two minutes and take the API down with it. A child process
 * rebuilds into a staging file and renames it over the live one; this process
 * notices the swap on its own, because `DbHandle` re-stats the file.
 */
function spawnRefresh(): Promise<void> {
  const script = resolve(dirname(fileURLToPath(import.meta.url)), "refresh.ts");
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, script], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolveRun() : reject(new Error(`refresh exited with code ${code}`)),
    );
  });
}

const watch = AUTO_REFRESH
  ? createTimetableWatch({
      db: () => dbHandle.db(),
      liveTripIds: () =>
        realtime.state
          .listInBbox(TUSCANY_BBOX)
          .map((vehicle) => vehicle.tripId)
          .filter((tripId): tripId is string => tripId !== null),
      refresh: spawnRefresh,
      // Read per check rather than captured: the refresh this watch triggers
      // swaps the database underneath it, and the new file's SHA-1 is the whole
      // signal for whether trying again could ever help.
      feedSha1: () => readFeedMeta(dbHandle.db())?.sourceSha1 ?? null,
      checkIntervalMs: TIMETABLE_CHECK_MS,
      cooldownMs: TIMETABLE_REFRESH_COOLDOWN_MS,
      maxUnmatchedRatio: MAX_UNMATCHED_TRIP_RATIO,
      minSample: MIN_TRIP_MATCH_SAMPLE,
    })
  : null;

try {
  await app.listen({ host: API_HOST, port: API_PORT });
  logger.info("api listening", {
    address: `http://${API_HOST}:${API_PORT}`,
    database: LIVE_DB_PATH,
    feed: meta ? `${meta.feedStartDate}-${meta.feedEndDate}` : null,
  });
} catch (error) {
  logger.error("api failed to start", { error: String(error) });
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info("shutting down", { signal });
    realtime.stop();
    watch?.stop();

    void closeWithGrace(app, SHUTDOWN_GRACE_MS).then((outcome) => {
      if (outcome === "forced") {
        logger.warn("shutdown grace expired — exiting with streams still open", {
          graceMs: SHUTDOWN_GRACE_MS,
        });
      }
      dbHandle.close();
      process.exit(0);
    });
  });
}
