import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildApi } from "../src/api/server.js";
import { openDbHandle } from "../src/db/handle.js";
import { createRealtimeService } from "../src/rt/service.js";
import { createFixtureDb, type FixtureDb } from "./helpers/fixtureDb.js";

describe("API server behaviour", () => {
  let fixtureDb: FixtureDb;
  let dbHandle: ReturnType<typeof openDbHandle>;
  let app: FastifyInstance;

  const build = (
    options: { rateLimit?: boolean; rateLimitMax?: number; trustProxy?: boolean | number } = {},
  ): FastifyInstance => {
    app = buildApi({
      dbHandle,
      realtime: createRealtimeService({ fetchFeed: async () => Promise.reject(new Error("no")) }),
      rateLimit: false,
      ...options,
    });
    return app;
  };

  beforeEach(async () => {
    fixtureDb = await createFixtureDb();
    dbHandle = openDbHandle(fixtureDb.path);
  });

  afterEach(async () => {
    await app.close();
    dbHandle.close();
    await fixtureDb.dispose();
  });

  test("allows any browser origin to read this public dataset", async () => {
    const response = await build().inject({
      method: "GET",
      url: "/api/comuni",
      headers: { origin: "https://dovebus.netlify.app" },
    });
    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  test("never leaks an internal failure to the caller", async () => {
    const instance = build();
    instance.get("/boom", () => {
      throw new Error("secret table name in stack");
    });

    const response = await instance.inject({ method: "GET", url: "/boom" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      error: { code: "internal_error", message: "unexpected server error" },
    });
  });

  test("rate limits a caller hammering the API, in the same envelope", async () => {
    const instance = build({ rateLimit: true, rateLimitMax: 2 });
    for (let attempt = 0; attempt < 2; attempt++) {
      const allowed = await instance.inject({ method: "GET", url: "/api/comuni" });
      expect(allowed.statusCode).toBe(200);
    }

    const blocked = await instance.inject({ method: "GET", url: "/api/comuni" });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ success: false, error: { code: "rate_limited" } });
  });

  test("counts a forged X-Forwarded-For as the caller it really is", async () => {
    // Measured on the running API before this was fixed: 30 SSE connections from
    // one machine were all accepted, and the rate limiter's remaining count
    // reset, when each request invented a different X-Forwarded-For. The header
    // is caller-written, so trusting it by default made every per-IP limit
    // decorative. Default build: no trustProxy option, as production has none.
    const instance = build({ rateLimit: true, rateLimitMax: 2 });
    for (let attempt = 0; attempt < 2; attempt++) {
      const allowed = await instance.inject({
        method: "GET",
        url: "/api/comuni",
        headers: { "x-forwarded-for": `10.0.0.${attempt}` },
      });
      expect(allowed.statusCode).toBe(200);
    }

    const blocked = await instance.inject({
      method: "GET",
      url: "/api/comuni",
      headers: { "x-forwarded-for": "10.0.0.99" },
    });
    expect(blocked.statusCode).toBe(429);
  });

  test("still reads the real client address when a deploy asks it to", async () => {
    // The knob has to keep working: behind Caddy, without it every request
    // shares the proxy's address and the limiter throttles the region as one.
    const instance = build({ rateLimit: true, rateLimitMax: 1, trustProxy: 1 });
    const first = await instance.inject({
      method: "GET",
      url: "/api/comuni",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    const otherCaller = await instance.inject({
      method: "GET",
      url: "/api/comuni",
      headers: { "x-forwarded-for": "10.0.0.2" },
    });
    expect([first.statusCode, otherCaller.statusCode]).toEqual([200, 200]);
  });

  test("gives the megabyte endpoint a tighter budget than the rest", async () => {
    // /api/vehicles is 448 KB for the whole region against a few for everything
    // else, so the general limit priced one caller at ~134 MB a minute.
    const instance = build({ rateLimit: true, rateLimitMax: 300 });
    const vehicles = await instance.inject({ method: "GET", url: "/api/vehicles" });
    const comuni = await instance.inject({ method: "GET", url: "/api/comuni" });

    expect(vehicles.headers["x-ratelimit-limit"]).toBe("60");
    expect(comuni.headers["x-ratelimit-limit"]).toBe("300");
  });

  test("answers even when the realtime feeds are down — the timetable is still true", async () => {
    const instance = build();
    const search = await instance.inject({
      method: "GET",
      url: "/api/search/od?comuneA=Arezzo&comuneB=Anghiari&date=20260812",
    });
    expect(search.statusCode).toBe(200);
    expect((search.json() as { data: { trips: unknown[] } }).data.trips).toHaveLength(2);

    const health = await instance.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect((health.json() as { data: { status: string } }).data.status).toBe("degraded");
  });

  test("takes the last value when a parameter is repeated", async () => {
    const response = await build().inject({ method: "GET", url: "/api/comuni?q=zzz&q=arez" });
    const body = response.json() as { data: { comuni: ReadonlyArray<{ name: string }> } };
    expect(body.data.comuni.map((comune) => comune.name)).toEqual(["Arezzo"]);
  });
});
