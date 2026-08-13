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
import { buildApi } from "../api/server.js";
import { API_HOST, API_PORT, LIVE_DB_PATH } from "../config.js";
import { openDbHandle } from "../db/handle.js";
import { feedValidity, readFeedMeta } from "../feed/meta.js";
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
    // Closes the listening socket and lets in-flight requests finish; open SSE
    // connections are dropped, and browsers reconnect on their own.
    void app.close().then(() => {
      dbHandle.close();
      process.exit(0);
    });
  });
}
