import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { API_CORS_ORIGIN, MAX_SSE_CLIENTS, SSE_HEARTBEAT_MS } from "../../config.js";
import { logger } from "../../logger.js";
import { tripDetail } from "../../query/trip.js";
import type { ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { parseDate, readQuery } from "../params.js";
import type { LiveTripJson } from "../serialize.js";
import { liveTrip } from "./trip.js";

export interface StreamOptions {
  readonly corsOrigin?: string;
  readonly maxClients?: number;
  readonly heartbeatMs?: number;
}

/**
 * Live push for one run.
 *
 * Driven by the poller rather than by a timer per connection: the upstream feed
 * regenerates about every two minutes, so a client polling on its own clock
 * would mostly re-receive a position it already has. Each connection is sent a
 * snapshot on subscribe and then only when something it cares about changed.
 */
export function registerStreamRoutes(
  app: FastifyInstance,
  ctx: ApiContext,
  options: StreamOptions = {},
): void {
  const corsOrigin = options.corsOrigin ?? API_CORS_ORIGIN;
  const maxClients = options.maxClients ?? MAX_SSE_CLIENTS;
  const heartbeatMs = options.heartbeatMs ?? SSE_HEARTBEAT_MS;
  let clients = 0;

  app.get("/stream/trip/:tripId", (request: FastifyRequest, reply: FastifyReply) => {
    const { tripId } = request.params as { tripId: string };
    const date = parseDate(readQuery(request.query).date);

    // Everything that can fail is checked before the response is hijacked: after
    // that point the only way to report a problem is an event nobody is reading.
    if (!tripDetail(ctx.db(), tripId, date)) {
      throw HttpError.notFound(`unknown trip: "${tripId}"`);
    }
    if (clients >= maxClients) {
      throw HttpError.unavailable("too many live streams open — try again shortly");
    }

    clients++;
    reply.hijack();
    const socket = reply.raw;
    socket.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer by default, which turns a live stream into a
      // batch delivered when the connection ends.
      "x-accel-buffering": "no",
      "access-control-allow-origin": corsOrigin,
    });

    let lastSignature: string | null = null;
    let closed = false;

    const send = (event: string, payload: unknown): void => {
      if (closed) return;
      try {
        socket.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch (error) {
        logger.warn("live stream write failed", { tripId, error: String(error) });
        close();
      }
    };

    const push = (event: string): void => {
      const live = liveTrip(ctx, tripId, date);
      const signature = signatureOf(live);
      // A bus that has not moved and is not newly late is not news; the heartbeat
      // is what keeps the connection (and any proxy in front of it) alive.
      if (event === "update" && signature === lastSignature) return;
      lastSignature = signature;
      send(event, { tripId, date, at: Date.now(), live });
    };

    const unsubscribe = ctx.realtime.subscribe(() => push("update"));
    const heartbeat = setInterval(() => {
      if (!closed) socket.write(": keep-alive\n\n");
    }, heartbeatMs);
    heartbeat.unref?.();

    function close(): void {
      if (closed) return;
      closed = true;
      clients--;
      clearInterval(heartbeat);
      unsubscribe();
    }

    request.raw.on("close", close);
    request.raw.on("error", close);
    push("snapshot");
  });
}

/** Cheap "has anything a viewer would notice changed?" test. */
function signatureOf(live: LiveTripJson | null): string {
  if (!live) return "none";
  const { lat, lon, timestamp, delaySeconds, scheduleRelationship } = live.vehicle;
  return `${lat}|${lon}|${timestamp}|${delaySeconds}|${scheduleRelationship}|${live.trail.length}`;
}
