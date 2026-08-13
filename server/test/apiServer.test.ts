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

  const build = (options: { rateLimit?: boolean; rateLimitMax?: number } = {}): FastifyInstance => {
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
