import type { FastifyInstance } from "fastify";
import { buildApi } from "../../src/api/server.js";
import { openDbHandle } from "../../src/db/handle.js";
import { createRealtimeService, type RealtimeService } from "../../src/rt/service.js";
import { createFixtureDb, type FixtureDb } from "./fixtureDb.js";
import { encodeTripUpdates, encodeVehiclePositions, type VehicleFixture } from "./rtFixture.js";

export const VP_URL = "https://feed.test/vehicle-positions";
export const TU_URL = "https://feed.test/trip-updates";

/**
 * A day inside the fixture timetable's validity window (2026-08-12 → 2026-09-01).
 *
 * The API's clock is pinned here because `/healthz` compares that window with
 * "today". Read from the wall clock, the suite passed until 1 September 2026 and
 * failed from the 2nd, with no code having changed: the fixture had simply
 * expired. A test that is right on the day it was written and wrong three weeks
 * later is testing the calendar.
 */
export const FIXTURE_TODAY = new Date("2026-08-20T10:00:00Z");

/** Recent enough to land in the "live" freshness bucket whenever the suite runs. */
export const vehicleTimestamp = (): number => Math.floor(Date.now() / 1000) - 30;

export interface ApiFixture {
  readonly app: FastifyInstance;
  readonly realtime: RealtimeService;
  readonly fixtureDb: FixtureDb;
  /** Replaces what the fake vehicle-positions feed will serve on the next poll. */
  setVehicles(vehicles: readonly VehicleFixture[], headerTimestamp?: number): void;
  dispose(): Promise<void>;
}

/**
 * The API wired to a real fixture database and a real realtime service whose only
 * fake is the HTTP fetch — so the tests exercise decoding, live state and the
 * query layer exactly as production does.
 */
export interface ApiFixtureOptions {
  /** `*` unless a test is checking what a whitelist does. */
  readonly corsOrigin?: string;
  /** The API's clock. {@link FIXTURE_TODAY} unless a test needs the timetable expired. */
  readonly now?: () => Date;
}

export async function createApiFixture(options: ApiFixtureOptions = {}): Promise<ApiFixture> {
  const fixtureDb = await createFixtureDb();
  const bodies: Record<string, Uint8Array> = {
    [VP_URL]: encodeVehiclePositions([
      {
        tripId: "T1",
        routeId: "R1",
        startDate: "20260812",
        lat: 43.47,
        lon: 11.88,
        bearing: 45,
        currentStopSequence: 1,
        vehicleId: "BUS1",
        vehicleLabel: "1234",
        timestamp: vehicleTimestamp(),
      },
      // Deadheading: no trip, still a bus on the map.
      { vehicleId: "BUS9", lat: 43.9, lon: 11.1, timestamp: vehicleTimestamp() },
    ]),
    [TU_URL]: encodeTripUpdates([
      {
        tripId: "T1",
        startDate: "20260812",
        stopTimeUpdates: [{ stopSequence: 1, arrivalDelay: 180 }],
      },
    ]),
  };

  const realtime = createRealtimeService({
    vehicleUrl: VP_URL,
    tripUpdateUrl: TU_URL,
    fetchFeed: async (url: string) => {
      const body = bodies[url];
      if (!body) throw new Error(`unexpected URL: ${url}`);
      return { body, bytes: body.byteLength, durationMs: 1 };
    },
  });

  const dbHandle = openDbHandle(fixtureDb.path);
  // Two streams per caller keeps the cap test quick; production allows ten.
  const app = buildApi({
    dbHandle,
    realtime,
    rateLimit: false,
    maxStreamsPerIp: 2,
    now: options.now ?? (() => FIXTURE_TODAY),
    ...(options.corsOrigin === undefined ? {} : { corsOrigin: options.corsOrigin }),
  });

  return {
    app,
    realtime,
    fixtureDb,
    setVehicles(vehicles: readonly VehicleFixture[], headerTimestamp = 1_760_000_100): void {
      bodies[VP_URL] = encodeVehiclePositions(vehicles, headerTimestamp);
    },
    async dispose(): Promise<void> {
      realtime.stop();
      await app.close();
      dbHandle.close();
      await fixtureDb.dispose();
    },
  };
}
