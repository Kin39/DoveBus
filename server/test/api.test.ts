import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type ApiFixture, createApiFixture } from "./helpers/apiFixture.js";

const DATE = "20260812";

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

describe("HTTP API", () => {
  let fixture: ApiFixture;

  const get = async (url: string): Promise<{ status: number; body: Envelope }> => {
    const response = await fixture.app.inject({ method: "GET", url });
    return { status: response.statusCode, body: response.json() as Envelope };
  };

  beforeAll(async () => {
    fixture = await createApiFixture();
    await fixture.realtime.pollOnce();
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  describe("GET /healthz", () => {
    test("reports liveness, the loaded timetable and both realtime feeds", async () => {
      const { status, body } = await get("/healthz");
      expect(status).toBe(200);
      expect(body.data).toMatchObject({
        status: "ok",
        feed: { feedStartDate: "20260812", feedEndDate: "20260901", expired: expect.any(Boolean) },
        realtime: { vehicles: 2, healthy: true },
      });
    });

    test("stays 200 when the data is stale — liveness is about the process", async () => {
      // A timetable past its validity window is a data problem, not a dead
      // process: reporting it as down would take the API out of service for it.
      const { status, body } = await get("/healthz");
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe("GET /api/comuni", () => {
    test("autocompletes on a prefix", async () => {
      const { body } = await get("/api/comuni?q=arez");
      expect(body.data?.comuni).toEqual([
        { istatCode: "051002", name: "Arezzo", lat: expect.any(Number), lon: expect.any(Number) },
      ]);
    });

    test("rejects a limit that is not a number", async () => {
      const { status, body } = await get("/api/comuni?limit=lots");
      expect(status).toBe(400);
      expect(body.error?.code).toBe("bad_request");
    });
  });

  describe("GET /api/routes", () => {
    test("autocompletes a line name", async () => {
      const { body } = await get("/api/routes?q=si3");
      expect(body.data?.routes).toEqual([
        { shortName: "SI381", longName: "Arezzo - Anghiari", routeIds: ["R1"] },
      ]);
    });
  });

  describe("GET /api/search/line", () => {
    test("returns the runs of a line inside the window", async () => {
      const { body } = await get(`/api/search/line?route=SI381&date=${DATE}&from=06:00&to=07:00`);
      const trips = body.data?.trips as ReadonlyArray<Record<string, unknown>>;
      expect(trips).toHaveLength(1);
      expect(trips[0]).toMatchObject({
        tripId: "T1",
        line: "SI381",
        departureTime: "06:30:00",
        origin: { name: "AREZZO STAZIONE" },
        destination: { name: "ANGHIARI CENTRO" },
      });
      expect(body.data?.truncated).toBe(false);
    });

    test("defaults the window to the whole service day", async () => {
      const { body } = await get(`/api/search/line?route=BAAS&date=${DATE}`);
      expect(body.data?.trips).toHaveLength(1);
    });

    test("requires the line", async () => {
      const { status, body } = await get(`/api/search/line?date=${DATE}`);
      expect(status).toBe(400);
      expect(body.error?.message).toMatch(/route is required/);
    });

    test("rejects a malformed date", async () => {
      const { status } = await get("/api/search/line?route=SI381&date=12-08-2026");
      expect(status).toBe(400);
    });
  });

  describe("GET /api/search/od", () => {
    test("finds direct runs between two comuni, by name or ISTAT code", async () => {
      const { body } = await get(`/api/search/od?comuneA=Arezzo&comuneB=051001&date=${DATE}`);
      const trips = body.data?.trips as ReadonlyArray<Record<string, unknown>>;
      expect(trips.map((trip) => trip.line)).toEqual(["SI381", "BAAS"]);
      expect(body.data?.from).toEqual({ istatCode: "051002", name: "Arezzo" });
      expect(body.data?.to).toEqual({ istatCode: "051001", name: "Anghiari" });
    });

    test("404s an unknown comune, naming which one", async () => {
      const { status, body } = await get(`/api/search/od?comuneA=Bologna&comuneB=Arezzo`);
      expect(status).toBe(404);
      expect(body.error?.message).toMatch(/Bologna/);
    });

    test("requires both comuni", async () => {
      const { status } = await get("/api/search/od?comuneA=Arezzo");
      expect(status).toBe(400);
    });
  });

  describe("GET /api/vehicles", () => {
    test("returns the live fleet with its line, freshness and delay", async () => {
      const { body } = await get("/api/vehicles");
      const vehicles = body.data?.vehicles as ReadonlyArray<Record<string, unknown>>;
      expect(vehicles).toHaveLength(2);

      const tracked = vehicles.find((vehicle) => vehicle.tripId === "T1");
      expect(tracked).toMatchObject({
        line: "SI381",
        lat: 43.47,
        lon: 11.88,
        bearing: 45,
        delaySeconds: 180,
        freshness: "live",
        vehicleLabel: "1234",
      });
      expect(tracked?.ageSeconds).toBeGreaterThanOrEqual(30);
    });

    test("carries the previous fix, so a client can estimate from its first response", async () => {
      const { body } = await get("/api/vehicles");
      const vehicles = body.data?.vehicles as ReadonlyArray<Record<string, unknown>>;

      // One snapshot in, so there is no earlier position to report yet — the
      // field is present and null rather than absent, which is the contract a
      // client codes against.
      expect(vehicles.every((vehicle) => "previous" in vehicle)).toBe(true);
      expect(vehicles.every((vehicle) => vehicle.previous === null)).toBe(true);
    });

    test("keeps deadheading buses, which carry no trip", async () => {
      const { body } = await get("/api/vehicles");
      const vehicles = body.data?.vehicles as ReadonlyArray<Record<string, unknown>>;
      expect(vehicles.some((vehicle) => vehicle.tripId === null)).toBe(true);
    });

    test("filters to the viewport", async () => {
      const { body } = await get("/api/vehicles?bbox=11.5,43.0,12.0,43.6");
      const vehicles = body.data?.vehicles as ReadonlyArray<Record<string, unknown>>;
      expect(vehicles.map((vehicle) => vehicle.vehicleId)).toEqual(["BUS1"]);
    });

    test("rejects a malformed bbox", async () => {
      const { status, body } = await get("/api/vehicles?bbox=11,43,12");
      expect(status).toBe(400);
      expect(body.error?.message).toMatch(/bbox/);
    });
  });

  describe("GET /api/trip/:tripId", () => {
    test("serves the timetable, the planned route and the live position", async () => {
      const { body } = await get(`/api/trip/T1?date=${DATE}`);
      expect(body.data).toMatchObject({
        trip: { tripId: "T1", line: "SI381", runsOnDate: true },
        live: {
          vehicle: { lat: 43.47, lon: 11.88, delaySeconds: 180, freshness: "live" },
          trail: [{ lat: 43.47, lon: 11.88, at: expect.any(Number) }],
        },
      });
      expect(body.data?.stops).toHaveLength(2);
      expect(body.data?.shape).toEqual([
        [43.4634, 11.8766],
        [43.5, 11.95],
        [43.5417, 12.0556],
      ]);
    });

    test("serves the timetable with live null when the run is not out there", async () => {
      const { body } = await get(`/api/trip/T2?date=${DATE}`);
      expect(body.data?.live).toBeNull();
      expect(body.data).toMatchObject({ trip: { tripId: "T2", line: "BAAS" } });
    });

    test("404s an unknown trip", async () => {
      const { status, body } = await get("/api/trip/NOPE");
      expect(status).toBe(404);
      expect(body.error?.code).toBe("not_found");
    });
  });

  test("answers an unknown path with the same error envelope", async () => {
    const { status, body } = await get("/api/nope");
    expect(status).toBe(404);
    expect(body).toEqual({
      success: false,
      error: { code: "not_found", message: expect.any(String) },
    });
  });
});
