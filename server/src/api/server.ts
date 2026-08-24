import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { API_CORS_ORIGIN, RATE_LIMIT_PER_MINUTE, TRUST_PROXY } from "../config.js";
import type { DbHandle } from "../db/handle.js";
import { logger } from "../logger.js";
import type { RealtimeService } from "../rt/service.js";
import { createApiContext } from "./context.js";
import { parseAllowedOrigins } from "./cors.js";
import { fail } from "./envelope.js";
import { HttpError } from "./errors.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { registerTripRoutes } from "./routes/trip.js";
import { registerVehicleRoutes } from "./routes/vehicles.js";

export interface ApiOptions {
  readonly dbHandle: DbHandle;
  readonly realtime: RealtimeService;
  /** Comma-separated origins, or `*`. */
  readonly corsOrigin?: string;
  /** Off in tests, where hundreds of requests come from one address in seconds. */
  readonly rateLimit?: boolean;
  readonly rateLimitMax?: number;
  /** Off when the process is exposed without a reverse proxy in front of it. */
  readonly trustProxy?: boolean | number;
  readonly maxStreamsPerIp?: number;
  readonly startedAtMs?: number;
}

/**
 * The read-only public API.
 *
 * Every endpoint answers from this process's own state — the SQLite timetable and
 * the poller's in-memory live picture — so no client request can ever reach the
 * upstream feeds, however many clients there are.
 */
export function buildApi(options: ApiOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    // See TRUST_PROXY: on behind a reverse proxy, off when exposed directly.
    trustProxy: options.trustProxy ?? TRUST_PROXY,
  });
  const ctx = createApiContext(options.dbHandle, options.realtime, options.startedAtMs);
  // Parsed here and in the SSE route from the same module, because the stream
  // writes its own headers and the two answers must be the same one.
  const allowedOrigins = parseAllowedOrigins(options.corsOrigin ?? API_CORS_ORIGIN);

  app.register(cors, {
    // A literal `*` rather than reflecting the caller's origin: the response is
    // identical for everyone, so it stays cacheable by any proxy in front of us.
    // A whitelist is reflected per request instead, which the plugin does itself.
    origin: allowedOrigins === "*" ? "*" : [...allowedOrigins],
    methods: ["GET"],
  });

  if (options.rateLimit !== false) {
    app.register(rateLimit, {
      max: options.rateLimitMax ?? RATE_LIMIT_PER_MINUTE,
      timeWindow: "1 minute",
      // The plugin throws whatever this returns, so returning our own error type
      // routes it through the one handler and keeps the envelope consistent.
      errorResponseBuilder: () =>
        new HttpError(429, "rate_limited", "too many requests — slow down and try again shortly"),
    });
  }

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send(fail(error.code, error.message));
      return;
    }
    // Fastify's own rejections (an unparseable query string, a bad route param)
    // are the caller's fault and safe to echo; anything else is ours and is not.
    const status = statusCodeOf(error);
    if (status < 500) {
      reply.code(status).send(fail("bad_request", messageOf(error)));
      return;
    }
    logger.error("request failed", {
      method: request.method,
      url: request.url,
      error: String(error),
    });
    reply.code(500).send(fail("internal_error", "unexpected server error"));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(fail("not_found", `no such endpoint: ${request.method} ${request.url}`));
  });

  app.register(
    async (api) => {
      registerCatalogRoutes(api, ctx);
      registerSearchRoutes(api, ctx);
      registerVehicleRoutes(api, ctx);
      registerTripRoutes(api, ctx);
      registerStreamRoutes(api, ctx, {
        corsOrigin: options.corsOrigin ?? API_CORS_ORIGIN,
        ...(options.maxStreamsPerIp === undefined
          ? {}
          : { maxClientsPerIp: options.maxStreamsPerIp }),
      });
    },
    { prefix: "/api" },
  );

  // Deliberately unprefixed: monitoring watches /healthz, not /api/healthz.
  registerHealthRoutes(app, ctx);

  return app;
}

/**
 * Shuts the API down within a bounded time.
 *
 * A graceful close waits for every open connection, and a live stream is held
 * for as long as someone is watching a bus — so a restart with viewers connected
 * waits for the viewers, which in practice means until systemd gives up and
 * sends SIGKILL. Browsers reconnect to an SSE endpoint on their own, so leaving
 * the stragglers behind costs a client nothing and makes a restart deterministic.
 */
export async function closeWithGrace(
  app: FastifyInstance,
  graceMs: number,
): Promise<"closed" | "forced"> {
  return await Promise.race([
    app.close().then(() => "closed" as const),
    new Promise<"forced">((resolve) => {
      const timer = setTimeout(() => resolve("forced"), graceMs);
      timer.unref?.();
    }),
  ]);
}

/** Fastify attaches a status to its own validation errors; anything else is a 500. */
function statusCodeOf(error: unknown): number {
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : 500;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "bad request";
}
