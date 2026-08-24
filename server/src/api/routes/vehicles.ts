import type { FastifyInstance } from "fastify";
import { VEHICLES_RATE_LIMIT_PER_MINUTE } from "../../config.js";
import type { ApiContext } from "../context.js";
import { ok } from "../envelope.js";
import { parseBbox, readQuery } from "../params.js";
import { toVehicleJson } from "../serialize.js";

/** What the map draws: the live fleet in the viewport, never the upstream feed. */
export function registerVehicleRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get(
    "/vehicles",
    {
      // Its own, tighter budget: see VEHICLES_RATE_LIMIT_PER_MINUTE. Every other
      // endpoint answers in bytes; this one answers in hundreds of kilobytes.
      config: {
        rateLimit: { max: VEHICLES_RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" },
      },
    },
    (request) => {
      const query = readQuery(request.query);
      const bbox = parseBbox(query.bbox);
      const now = Date.now();
      const routes = ctx.routeNames();

      const state = ctx.realtime.state;
      const vehicles = state
        .listInBbox(bbox)
        .map((vehicle) => toVehicleJson(vehicle, now, routes, state.previousFix(vehicle.key)));

      // The whole region is ~1100 buses, so this is a complete answer rather than
      // a page — but say so explicitly instead of leaving the client to assume it.
      return ok({ bbox, count: vehicles.length, vehicles });
    },
  );
}
