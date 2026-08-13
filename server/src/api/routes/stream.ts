import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  API_CORS_ORIGIN,
  MAX_SSE_CLIENTS,
  MAX_SSE_CLIENTS_PER_IP,
  SSE_HEARTBEAT_MS,
} from "../../config.js";
import { logger } from "../../logger.js";
import { tripExists } from "../../query/trip.js";
import type { ApiContext } from "../context.js";
import { HttpError } from "../errors.js";
import { parseDate, readQuery } from "../params.js";
import type { LiveTripJson } from "../serialize.js";
import { liveTrip } from "./trip.js";

export interface StreamOptions {
  readonly corsOrigin?: string;
  readonly maxClients?: number;
  readonly maxClientsPerIp?: number;
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
  const settings = {
    corsOrigin: options.corsOrigin ?? API_CORS_ORIGIN,
    maxClients: options.maxClients ?? MAX_SSE_CLIENTS,
    maxClientsPerIp: options.maxClientsPerIp ?? MAX_SSE_CLIENTS_PER_IP,
    heartbeatMs: options.heartbeatMs ?? SSE_HEARTBEAT_MS,
  };
  const openStreams = new StreamCounter(settings.maxClients, settings.maxClientsPerIp);

  app.get("/stream/trip/:tripId", (request: FastifyRequest, reply: FastifyReply) => {
    const { tripId } = request.params as { tripId: string };
    const date = parseDate(readQuery(request.query).date);

    // Everything that can fail is checked before the response is hijacked: after
    // that point the only way to report a problem is an event nobody is reading.
    if (!tripExists(ctx.db(), tripId)) {
      throw HttpError.notFound(`unknown trip: "${tripId}"`);
    }
    const release = openStreams.take(request.ip);
    stream(ctx, { tripId, date, request, reply, release, ...settings });
  });
}

interface StreamContext {
  readonly tripId: string;
  readonly date: string;
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly release: () => void;
  readonly corsOrigin: string;
  readonly heartbeatMs: number;
}

/** One open connection: headers, first snapshot, poller subscription, teardown. */
function stream(ctx: ApiContext, connection: StreamContext): void {
  const { tripId, date, request, reply } = connection;
  reply.hijack();
  const socket = reply.raw;
  socket.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Nginx and friends buffer by default, which turns a live stream into a
    // batch delivered when the connection ends.
    "x-accel-buffering": "no",
    "access-control-allow-origin": connection.corsOrigin,
  });

  let lastSignature: string | null = null;
  let closed = false;

  function close(): void {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    connection.release();
  }

  const push = (event: string): void => {
    if (closed) return;
    const live = liveTrip(ctx, tripId, date);
    const signature = signatureOf(live);
    // A bus that has not moved and is not newly late is not news; the heartbeat
    // is what keeps the connection (and any proxy in front of it) alive.
    if (event === "update" && signature === lastSignature) return;
    lastSignature = signature;

    try {
      socket.write(
        `event: ${event}\ndata: ${JSON.stringify({ tripId, date, at: Date.now(), live })}\n\n`,
      );
    } catch (error) {
      logger.warn("live stream write failed", { tripId, error: String(error) });
      close();
    }
  };

  const unsubscribe = ctx.realtime.subscribe(() => push("update"));
  const heartbeat = setInterval(() => {
    if (!closed) socket.write(": keep-alive\n\n");
  }, connection.heartbeatMs);
  heartbeat.unref?.();

  request.raw.on("close", close);
  request.raw.on("error", close);
  push("snapshot");
}

/**
 * Open-connection budget.
 *
 * A stream is a socket held for as long as a rider watches their bus, so the
 * process needs a ceiling — and a per-caller one as well, or a single client can
 * take every slot and the cap becomes the outage it was meant to prevent.
 */
class StreamCounter {
  readonly #max: number;
  readonly #maxPerIp: number;
  readonly #byIp = new Map<string, number>();
  #total = 0;

  constructor(max: number, maxPerIp: number) {
    this.#max = max;
    this.#maxPerIp = maxPerIp;
  }

  /** Reserves a slot, returning the function that gives it back. Throws when full. */
  take(ip: string): () => void {
    const forIp = this.#byIp.get(ip) ?? 0;
    if (this.#total >= this.#max || forIp >= this.#maxPerIp) {
      throw HttpError.unavailable("too many live streams open — try again shortly");
    }

    this.#total++;
    this.#byIp.set(ip, forIp + 1);
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.#total--;
      const remaining = (this.#byIp.get(ip) ?? 1) - 1;
      // Deleting at zero keeps this map bounded by *concurrent* callers rather
      // than by every address that ever connected.
      if (remaining <= 0) this.#byIp.delete(ip);
      else this.#byIp.set(ip, remaining);
    };
  }
}

/** Cheap "has anything a viewer would notice changed?" test. */
function signatureOf(live: LiveTripJson | null): string {
  if (!live) return "none";
  const { lat, lon, timestamp, delaySeconds, scheduleRelationship } = live.vehicle;
  return `${lat}|${lon}|${timestamp}|${delaySeconds}|${scheduleRelationship}|${live.trail.length}`;
}
