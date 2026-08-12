import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRealtimeService } from "../src/rt/service.js";
import { encodeTripUpdates, encodeVehiclePositions } from "./helpers/rtFixture.js";

const VP_URL = "https://feed.test/vehicle-positions";
const TU_URL = "https://feed.test/trip-updates";

function bodies(headerTimestamp = 1_760_000_000): Record<string, Uint8Array> {
  return {
    [VP_URL]: encodeVehiclePositions(
      [
        { tripId: "T1", startDate: "20260812", lat: 43.1, lon: 11.1, currentStopSequence: 4 },
        { vehicleId: "BUS9", lat: 43.2, lon: 11.2 },
        { vehicleId: "GHOST", lat: 0, lon: 0 },
      ],
      headerTimestamp,
    ),
    [TU_URL]: encodeTripUpdates(
      [
        {
          tripId: "T1",
          startDate: "20260812",
          stopTimeUpdates: [{ stopSequence: 4, arrivalDelay: 180 }],
        },
      ],
      headerTimestamp,
    ),
  };
}

function service(overrides: Partial<Parameters<typeof createRealtimeService>[0]> = {}) {
  const responses = bodies();
  const calls: string[] = [];
  const fetchFeed = async (url: string) => {
    calls.push(url);
    const body = responses[url];
    if (!body) throw new Error(`unexpected URL: ${url}`);
    return { body, bytes: body.byteLength, durationMs: 3 };
  };

  return {
    calls,
    instance: createRealtimeService({
      vehicleUrl: VP_URL,
      tripUpdateUrl: TU_URL,
      fetchFeed,
      ...overrides,
    }),
  };
}

describe("createRealtimeService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("fills the shared state from both feeds", async () => {
    const { instance } = service();
    await instance.pollOnce();

    expect(instance.state.size).toBe(2); // the out-of-region ghost is filtered out
    expect(instance.state.findByTrip("T1")).toMatchObject({
      delaySeconds: 180,
      scheduleRelationship: "SCHEDULED",
    });
  });

  test("polls vehicles four times as often as trip-updates over ten minutes", async () => {
    const { calls, instance } = service();
    instance.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    instance.stop();

    const vehiclePolls = calls.filter((url) => url === VP_URL).length;
    const tripUpdatePolls = calls.filter((url) => url === TU_URL).length;
    expect(vehiclePolls).toBeGreaterThan(tripUpdatePolls);
    expect(tripUpdatePolls).toBeGreaterThan(0);
  });

  test("stops both loops", async () => {
    const { calls, instance } = service();
    instance.start();
    await vi.advanceTimersByTimeAsync(0);
    instance.stop();
    const after = calls.length;

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toHaveLength(after);
  });

  test("reports itself healthy once both feeds have been read", async () => {
    const { instance } = service();
    expect(instance.status().healthy).toBe(false);

    await instance.pollOnce();
    const status = instance.status();

    expect(status.healthy).toBe(true);
    expect(status.vehicles.polls).toBe(1);
    expect(status.tripUpdates.polls).toBe(1);
    expect(status.live.vehicles).toBe(2);
  });

  test("reports itself unhealthy when the vehicle feed goes quiet", async () => {
    let ok = true;
    const responses = bodies();
    const { instance } = service({
      fetchFeed: async (url: string) => {
        if (url === VP_URL && !ok) throw new Error("HTTP 502");
        const body = responses[url];
        if (!body) throw new Error(`unexpected URL: ${url}`);
        return { body, bytes: body.byteLength, durationMs: 3 };
      },
    });

    await instance.pollOnce();
    expect(instance.status().healthy).toBe(true);

    ok = false;
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await instance.pollOnce();

    const status = instance.status();
    expect(status.healthy).toBe(false);
    expect(status.vehicles.lastError).toContain("HTTP 502");
    // The last good picture is still served rather than blanking the map.
    expect(instance.state.size).toBe(2);
  });

  test("a failing trip-updates feed does not take live positions down with it", async () => {
    const responses = bodies();
    const { instance } = service({
      fetchFeed: async (url: string) => {
        if (url === TU_URL) throw new Error("HTTP 500");
        const body = responses[url];
        if (!body) throw new Error(`unexpected URL: ${url}`);
        return { body, bytes: body.byteLength, durationMs: 3 };
      },
    });

    await instance.pollOnce();

    expect(instance.state.size).toBe(2);
    expect(instance.state.findByTrip("T1")?.delaySeconds).toBeNull();
    expect(instance.status().healthy).toBe(false);
  });
});
