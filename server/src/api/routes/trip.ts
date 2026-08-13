import type { FastifyInstance } from "fastify";
import { tripDetail } from "../../query/trip.js";
import type { LiveVehicle } from "../../rt/state.js";
import { toServiceDate } from "../../util/date.js";
import type { ApiContext } from "../context.js";
import { ok } from "../envelope.js";
import { HttpError } from "../errors.js";
import { parseDate, readQuery } from "../params.js";
import { type LiveTripJson, toLiveTripJson } from "../serialize.js";

/** Everything about one run: its timetable, its planned line, and where the bus is now. */
export function registerTripRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get("/trip/:tripId", (request) => {
    const { tripId } = request.params as { tripId: string };
    const date = parseDate(readQuery(request.query).date);

    const detail = tripDetail(ctx.db(), tripId, date);
    if (!detail) throw HttpError.notFound(`unknown trip: "${tripId}"`);

    return ok({ ...detail, live: liveTrip(ctx, tripId, date) });
  });
}

/**
 * The live half of a trip view, or null when no bus is currently running it.
 *
 * Matched on `(trip_id, start_date)` first. For today the match falls back to the
 * trip id alone: the two feeds do not always agree on the service date (a run
 * that left at 25:10 still belongs to yesterday), and refusing to show the bus a
 * rider is standing in front of because of a date label would be absurd. For any
 * other date only the exact key counts — tomorrow's run is not today's bus.
 */
export function liveTrip(ctx: ApiContext, tripId: string, date: string): LiveTripJson | null {
  const state = ctx.realtime.state;
  const exact = state.findByTrip(tripId, date);
  const vehicle: LiveVehicle | null =
    exact ?? (date === toServiceDate(new Date()) ? state.findByTrip(tripId) : null);
  if (!vehicle) return null;

  const now = Date.now();
  const view = state.describe(vehicle.key, now);
  return view === null ? null : toLiveTripJson(view, now, ctx.routeNames());
}
