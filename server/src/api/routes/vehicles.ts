import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../context.js";
import { ok } from "../envelope.js";
import { parseBbox, readQuery } from "../params.js";
import { toVehicleJson } from "../serialize.js";

/** What the map draws: the live fleet in the viewport, never the upstream feed. */
export function registerVehicleRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get("/vehicles", (request) => {
    const query = readQuery(request.query);
    const bbox = parseBbox(query.bbox);
    const now = Date.now();
    const routes = ctx.routeNames();

    const vehicles = ctx.realtime.state
      .listInBbox(bbox)
      .map((vehicle) => toVehicleJson(vehicle, now, routes));

    // The whole region is ~1100 buses, so this is a complete answer rather than a
    // page — but say so explicitly instead of leaving the client to assume it.
    return ok({ bbox, count: vehicles.length, vehicles });
  });
}
