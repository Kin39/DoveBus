/**
 * Runs the realtime pollers against the live feeds and reports what they see.
 *
 * Phase 3 will run these pollers inside the API process; until then this is how
 * the poller is exercised on real data — cadence, coverage, the Tuscany filter,
 * the delay join, and how many live trips resolve against the imported timetable.
 *
 *   npm run poll [-- --duration=180 --report=30 --once]
 */
import { existsSync } from "node:fs";
import { LIVE_DB_PATH } from "../config.js";
import { openDatabase } from "../db/index.js";
import { formatDuration, logger } from "../logger.js";
import { createRealtimeService, type RealtimeService } from "../rt/service.js";

interface PollFlags {
  readonly durationMs: number | null;
  readonly reportMs: number;
  readonly once: boolean;
}

export function parsePollFlags(argv: readonly string[]): PollFlags {
  let durationMs: number | null = null;
  let reportMs = 30_000;
  let once = false;

  for (const arg of argv) {
    if (arg === "--once") once = true;
    else if (arg.startsWith("--duration=")) durationMs = seconds(arg, "--duration=");
    else if (arg.startsWith("--report=")) reportMs = seconds(arg, "--report=");
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { durationMs, reportMs, once };
}

function seconds(arg: string, prefix: string): number {
  const value = Number(arg.slice(prefix.length));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${prefix} needs a positive number`);
  return value * 1000;
}

/** How many live trips exist in the imported timetable — the join the live view depends on. */
function reportStaticJoin(service: RealtimeService): void {
  if (!existsSync(LIVE_DB_PATH)) {
    logger.warn("no imported timetable — skipping the trip_id join check", { db: LIVE_DB_PATH });
    return;
  }

  const db = openDatabase(LIVE_DB_PATH, { readonly: true });
  try {
    const exists = db.prepare("SELECT 1 FROM trips WHERE trip_id = ?");
    const tripIds = service.state
      .list()
      .map((vehicle) => vehicle.tripId)
      .filter((tripId): tripId is string => tripId !== null);
    const matched = tripIds.filter((tripId) => exists.get(tripId) !== undefined).length;

    logger.info("live trips joined onto the imported timetable", {
      withTripId: tripIds.length,
      matched,
      rate: tripIds.length === 0 ? "n/a" : `${((100 * matched) / tripIds.length).toFixed(1)}%`,
    });
  } finally {
    db.close();
  }
}

function report(service: RealtimeService): void {
  const status = service.status();
  logger.info("realtime state", {
    healthy: status.healthy,
    vehicles: status.live.vehicles,
    withTrip: status.live.withTrip,
    withDelay: status.live.withDelay,
    freshness: status.live.byFreshness,
    tripUpdates: status.live.tripUpdates,
  });
  for (const poller of [status.vehicles, status.tripUpdates]) {
    logger.info(`  ${poller.name}`, {
      polls: poller.polls,
      failures: poller.failures,
      headerTs: poller.lastHeaderTimestamp,
      headerAgeS:
        poller.lastHeaderTimestamp === null
          ? null
          : Math.floor(Date.now() / 1000) - poller.lastHeaderTimestamp,
      bytes: poller.lastBytes,
      fetchMs: poller.lastDurationMs,
      nextPollIn: formatDuration(poller.nextDelayMs),
      lastError: poller.lastError,
    });
  }
}

const flags = parsePollFlags(process.argv.slice(2));
const service = createRealtimeService();

if (flags.once) {
  await service.pollOnce();
  report(service);
  reportStaticJoin(service);
  process.exitCode = service.status().healthy ? 0 : 1;
} else {
  logger.info("polling live feeds — Ctrl-C to stop", {
    duration: flags.durationMs === null ? "until stopped" : formatDuration(flags.durationMs),
  });
  service.start();

  const reporter = setInterval(() => {
    report(service);
    reportStaticJoin(service);
  }, flags.reportMs);

  const shutdown = () => {
    clearInterval(reporter);
    service.stop();
    report(service);
    reportStaticJoin(service);
    logger.info("stopped");
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  if (flags.durationMs !== null) setTimeout(shutdown, flags.durationMs);
}
