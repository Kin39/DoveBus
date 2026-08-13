import type { FastifyInstance } from "fastify";
import { feedValidity, readFeedMeta } from "../../feed/meta.js";
import { toServiceDate } from "../../util/date.js";
import type { ApiContext } from "../context.js";
import { ok } from "../envelope.js";

/**
 * Liveness plus the two things that can be quietly wrong: a timetable past its
 * `feed_end_date` (this operator publishes ~20-day windows) and a realtime feed
 * that has stopped producing snapshots.
 *
 * Always 200 while the process can answer. Both failures are data problems, and
 * returning 503 for them would have a load balancer pull a working API out of
 * rotation because a public feed hiccuped — the flags are what to alert on.
 */
export function registerHealthRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get("/healthz", () => {
    const meta = readFeedMeta(ctx.db());
    const validity = meta === null ? null : feedValidity(meta, toServiceDate(new Date()));
    const realtime = ctx.realtime.status();
    const degraded =
      validity === null || validity.expired || validity.staleSchema || !realtime.healthy;

    return ok({
      status: degraded ? "degraded" : "ok",
      uptimeSeconds: Math.round((Date.now() - ctx.startedAtMs) / 1000),
      feed: meta === null ? null : { ...meta, ...validity },
      realtime: {
        healthy: realtime.healthy,
        ...realtime.live,
        pollers: { vehicles: realtime.vehicles, tripUpdates: realtime.tripUpdates },
      },
    });
  });
}
