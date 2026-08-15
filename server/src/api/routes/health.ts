import type { FastifyInstance } from "fastify";
import { MAX_UNMATCHED_TRIP_RATIO, MIN_TRIP_MATCH_SAMPLE, TUSCANY_BBOX } from "../../config.js";
import { feedValidity, readFeedMeta } from "../../feed/meta.js";
import { timetableMatch } from "../../query/timetableMatch.js";
import { toServiceDate } from "../../util/date.js";
import type { ApiContext } from "../context.js";
import { ok } from "../envelope.js";

/**
 * Liveness plus the three things that can be quietly wrong: a timetable past its
 * `feed_end_date` (this operator publishes ~20-day windows), a realtime feed
 * that has stopped producing snapshots, and — the one that hid for three days —
 * a timetable that was *replaced upstream* while still inside its own declared
 * validity. Nothing here can ask the source whether it republished without
 * downloading 125 MB, so the check is turned around: what share of the buses
 * actually running are on trips this timetable has never heard of.
 *
 * Always 200 while the process can answer. Both failures are data problems, and
 * returning 503 for them would have a load balancer pull a working API out of
 * rotation because a public feed hiccuped — the flags are what to alert on.
 */
export function registerHealthRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get("/healthz", () => {
    const db = ctx.db();
    const meta = readFeedMeta(db);
    const validity = meta === null ? null : feedValidity(meta, toServiceDate(new Date()));
    const realtime = ctx.realtime.status();

    const liveTripIds = ctx.realtime.state
      .listInBbox(TUSCANY_BBOX)
      .map((vehicle) => vehicle.tripId)
      .filter((tripId): tripId is string => tripId !== null);
    const timetable = timetableMatch(db, liveTripIds, {
      maxUnmatchedRatio: MAX_UNMATCHED_TRIP_RATIO,
      minSample: MIN_TRIP_MATCH_SAMPLE,
    });

    const degraded =
      validity === null ||
      validity.expired ||
      validity.staleSchema ||
      timetable.stale ||
      !realtime.healthy;

    return ok({
      status: degraded ? "degraded" : "ok",
      uptimeSeconds: Math.round((Date.now() - ctx.startedAtMs) / 1000),
      feed: meta === null ? null : { ...meta, ...validity },
      timetable,
      realtime: {
        healthy: realtime.healthy,
        ...realtime.live,
        pollers: { vehicles: realtime.vehicles, tripUpdates: realtime.tripUpdates },
      },
    });
  });
}
