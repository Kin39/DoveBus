import { beforeEach, describe, expect, test } from "vitest";
import { decodeTripUpdates, decodeVehiclePositions } from "../src/rt/decode.js";
import { LiveState, vehicleKey } from "../src/rt/state.js";
import {
  encodeTripUpdates,
  encodeVehiclePositions,
  type TripUpdateFixture,
  type VehicleFixture,
} from "./helpers/rtFixture.js";

const NOW = 1_760_000_000_000;
const NOW_S = NOW / 1000;

function vehicles(fixtures: readonly VehicleFixture[]) {
  return decodeVehiclePositions(encodeVehiclePositions(fixtures));
}

function tripUpdates(fixtures: readonly TripUpdateFixture[]) {
  return decodeTripUpdates(encodeTripUpdates(fixtures));
}

describe("vehicleKey", () => {
  test("keys a running bus on its trip and service date", () => {
    expect(vehicleKey({ tripId: "60732-4", startDate: "20260812", vehicleId: "BUS1" })).toBe(
      "trip:60732-4|20260812",
    );
  });

  test("falls back to the vehicle id for a bus with no trip assigned", () => {
    expect(vehicleKey({ tripId: null, startDate: null, vehicleId: "BUS1" })).toBe("vehicle:BUS1");
  });

  test("refuses to key an entity that identifies nothing", () => {
    expect(vehicleKey({ tripId: null, startDate: null, vehicleId: null })).toBeNull();
  });
});

describe("LiveState", () => {
  let state: LiveState;

  beforeEach(() => {
    state = new LiveState();
  });

  test("stores the positions from a snapshot", () => {
    const applied = state.applyVehicles(
      vehicles([
        { tripId: "T1", startDate: "20260812", lat: 43.1, lon: 11.1, timestamp: NOW_S - 20 },
        { vehicleId: "BUS9", lat: 43.2, lon: 11.2, timestamp: NOW_S - 10 },
      ]),
      NOW,
    );

    expect(applied).toMatchObject({ tracked: 2, added: 2, dropped: 0 });
    expect(state.size).toBe(2);
    expect(state.get("trip:T1|20260812")?.lat).toBeCloseTo(43.1, 4);
    expect(state.get("vehicle:BUS9")?.vehicleId).toBe("BUS9");
  });

  test("replaces a vehicle's position on the next snapshot", () => {
    state.applyVehicles(
      vehicles([{ tripId: "T1", startDate: "20260812", lat: 43.1, lon: 11.1 }]),
      NOW,
    );
    const applied = state.applyVehicles(
      vehicles([{ tripId: "T1", startDate: "20260812", lat: 43.5, lon: 11.5 }]),
      NOW + 30_000,
    );

    expect(applied).toMatchObject({ added: 0, updated: 1 });
    expect(state.size).toBe(1);
    expect(state.get("trip:T1|20260812")?.lat).toBeCloseTo(43.5, 4);
  });

  test("counts entities it cannot key rather than storing them anonymously", () => {
    const applied = state.applyVehicles(vehicles([{ lat: 43.1, lon: 11.1 }]), NOW);

    expect(applied).toMatchObject({ tracked: 0, dropped: 1 });
    expect(state.size).toBe(0);
  });

  test("builds a trail from consecutive snapshots", () => {
    state.applyVehicles(
      vehicles([{ tripId: "T1", startDate: "20260812", lat: 43.1, lon: 11.1, timestamp: NOW_S }]),
      NOW,
    );
    state.applyVehicles(
      vehicles([
        { tripId: "T1", startDate: "20260812", lat: 43.2, lon: 11.2, timestamp: NOW_S + 30 },
      ]),
      NOW + 30_000,
    );

    const trail = state.trail("trip:T1|20260812");
    expect(trail).toHaveLength(2);
    expect(trail[0]?.at).toBe(NOW * 1);
    expect(trail[1]?.lat).toBeCloseTo(43.2, 4);
  });

  test("dates trail points by the bus clock when it reports one", () => {
    state.applyVehicles(
      vehicles([{ tripId: "T1", startDate: "20260812", timestamp: NOW_S - 45 }]),
      NOW,
    );

    expect(state.trail("trip:T1|20260812")[0]?.at).toBe(NOW - 45_000);
  });

  test("joins the delay from trip-updates onto the running vehicle", () => {
    state.applyVehicles(
      vehicles([{ tripId: "T1", startDate: "20260812", currentStopSequence: 5 }]),
      NOW,
    );
    const applied = state.applyTripUpdates(
      tripUpdates([
        {
          tripId: "T1",
          startDate: "20260812",
          stopTimeUpdates: [
            { stopSequence: 3, arrivalDelay: 30 },
            { stopSequence: 5, arrivalDelay: 240 },
            { stopSequence: 9, arrivalDelay: 300 },
          ],
        },
      ]),
      NOW,
    );

    expect(applied).toMatchObject({ updates: 1, matched: 1 });
    // The delay that matters is the one at the stop the bus is heading to, not the first.
    expect(state.get("trip:T1|20260812")).toMatchObject({
      delaySeconds: 240,
      scheduleRelationship: "SCHEDULED",
    });
  });

  test("matches a trip-update that omits the service date", () => {
    state.applyVehicles(vehicles([{ tripId: "T1", startDate: "20260812" }]), NOW);
    state.applyTripUpdates(tripUpdates([{ tripId: "T1", delay: 60 }]), NOW);

    expect(state.get("trip:T1|20260812")?.delaySeconds).toBe(60);
  });

  test("carries a cancellation through to the vehicle", () => {
    state.applyVehicles(vehicles([{ tripId: "T1", startDate: "20260812" }]), NOW);
    state.applyTripUpdates(
      tripUpdates([{ tripId: "T1", startDate: "20260812", scheduleRelationship: 3 }]),
      NOW,
    );

    expect(state.get("trip:T1|20260812")?.scheduleRelationship).toBe("CANCELED");
  });

  test("applies a delay that arrived before the bus did", () => {
    state.applyTripUpdates(tripUpdates([{ tripId: "T1", startDate: "20260812", delay: 90 }]), NOW);
    state.applyVehicles(vehicles([{ tripId: "T1", startDate: "20260812" }]), NOW + 1_000);

    expect(state.get("trip:T1|20260812")?.delaySeconds).toBe(90);
  });

  test("keeps a vehicle's delay when the next snapshot moves it", () => {
    state.applyVehicles(vehicles([{ tripId: "T1", startDate: "20260812", lat: 43.1 }]), NOW);
    state.applyTripUpdates(tripUpdates([{ tripId: "T1", delay: 120 }]), NOW);
    state.applyVehicles(
      vehicles([{ tripId: "T1", startDate: "20260812", lat: 43.2 }]),
      NOW + 30_000,
    );

    expect(state.get("trip:T1|20260812")?.delaySeconds).toBe(120);
  });

  test("drops vehicles that stopped reporting — their run has ended", () => {
    state.applyVehicles(
      vehicles([
        { tripId: "T1", startDate: "20260812" },
        { tripId: "T2", startDate: "20260812" },
      ]),
      NOW,
    );
    state.applyVehicles(vehicles([{ tripId: "T1", startDate: "20260812" }]), NOW + 11 * 60_000);

    expect(state.size).toBe(1);
    expect(state.get("trip:T2|20260812")).toBeNull();
    expect(state.trail("trip:T2|20260812")).toEqual([]);
  });

  test("stops finding an expired run by trip id", () => {
    state.applyVehicles(vehicles([{ tripId: "T1", startDate: "20260812" }]), NOW);
    state.applyVehicles(vehicles([{ tripId: "T2", startDate: "20260812" }]), NOW + 11 * 60_000);

    expect(state.findByTrip("T1")).toBeNull();
    expect(state.findByTrip("T2")).not.toBeNull();
  });

  test("keeps yesterday's expiry from unindexing today's run of the same trip", () => {
    state.applyVehicles(vehicles([{ tripId: "T1", startDate: "20260811" }]), NOW);
    // The same trip_id runs again the next day while the old entry is still around.
    state.applyVehicles(vehicles([{ tripId: "T1", startDate: "20260812" }]), NOW + 11 * 60_000);

    expect(state.findByTrip("T1")?.startDate).toBe("20260812");
  });

  test("keeps a vehicle that is merely absent from one snapshot", () => {
    state.applyVehicles(
      vehicles([
        { tripId: "T1", startDate: "20260812" },
        { tripId: "T2", startDate: "20260812" },
      ]),
      NOW,
    );
    state.applyVehicles(vehicles([{ tripId: "T1", startDate: "20260812" }]), NOW + 60_000);

    expect(state.size).toBe(2);
  });

  test("shows a bus taking up a run once, not twice", () => {
    state.applyVehicles(vehicles([{ vehicleId: "BUS9", lat: 43.1, lon: 11.1 }]), NOW);
    // The same physical bus, two minutes later, now assigned to a trip.
    state.applyVehicles(
      vehicles([{ vehicleId: "BUS9", tripId: "T1", startDate: "20260812", lat: 43.2, lon: 11.2 }]),
      NOW + 120_000,
    );

    expect(state.size).toBe(1);
    expect(state.get("vehicle:BUS9")).toBeNull();
    expect(state.get("trip:T1|20260812")?.vehicleId).toBe("BUS9");
  });

  test("shows a bus finishing a run once, not twice", () => {
    state.applyVehicles(
      vehicles([{ vehicleId: "BUS9", tripId: "T1", startDate: "20260812" }]),
      NOW,
    );
    state.applyVehicles(vehicles([{ vehicleId: "BUS9" }]), NOW + 120_000);

    expect(state.size).toBe(1);
    expect(state.get("trip:T1|20260812")).toBeNull();
    expect(state.findByTrip("T1")).toBeNull();
  });

  test("starts a fresh trail when a bus takes up a run", () => {
    state.applyVehicles(vehicles([{ vehicleId: "BUS9", lat: 43.1, lon: 11.1 }]), NOW);
    state.applyVehicles(
      vehicles([{ vehicleId: "BUS9", tripId: "T1", startDate: "20260812", lat: 43.2, lon: 11.2 }]),
      NOW + 120_000,
    );

    // The approach to the terminus is not part of the run the rider selected.
    expect(state.trail("vehicle:BUS9")).toEqual([]);
    expect(state.trail("trip:T1|20260812")).toHaveLength(1);
  });

  test("does not blink out a relief bus that shares a trip id", () => {
    // Two buses reporting the same run: the second one owns the trip key.
    state.applyVehicles(
      vehicles([
        { vehicleId: "BUS_A", tripId: "T1", startDate: "20260812", lat: 43.1, lon: 11.1 },
        { vehicleId: "BUS_B", tripId: "T1", startDate: "20260812", lat: 43.2, lon: 11.2 },
      ]),
      NOW,
    );
    // BUS_A drops the trip. Reclaiming the trip key here would delete BUS_B's position.
    state.applyVehicles(
      vehicles([
        { vehicleId: "BUS_A", lat: 43.15, lon: 11.15 },
        { vehicleId: "BUS_B", tripId: "T1", startDate: "20260812", lat: 43.25, lon: 11.25 },
      ]),
      NOW + 30_000,
    );

    expect(state.get("trip:T1|20260812")?.vehicleId).toBe("BUS_B");
    expect(state.get("vehicle:BUS_A")).not.toBeNull();
  });

  test("does not expire anything on a read", () => {
    state.applyVehicles(
      vehicles([{ tripId: "T1", startDate: "20260812", lat: 43.75, lon: 11.25 }]),
      NOW,
    );

    // Long past the TTL: a GET must not be what deletes state.
    expect(state.listInBbox({ minLat: 43, maxLat: 44, minLon: 11, maxLon: 12 })).toHaveLength(1);
    expect(state.size).toBe(1);
  });

  test("lists only the vehicles inside a viewport", () => {
    state.applyVehicles(
      vehicles([
        { tripId: "T1", startDate: "20260812", lat: 43.75, lon: 11.25 },
        { tripId: "T2", startDate: "20260812", lat: 43.32, lon: 11.33 },
      ]),
      NOW,
    );

    const inViewport = state.listInBbox({ minLat: 43.7, maxLat: 43.8, minLon: 11.2, maxLon: 11.3 });
    expect(inViewport.map((vehicle) => vehicle.tripId)).toEqual(["T1"]);
  });

  test("reports freshness alongside the position", () => {
    state.applyVehicles(
      vehicles([{ tripId: "T1", startDate: "20260812", timestamp: NOW_S - 200 }]),
      NOW,
    );

    expect(state.describe("trip:T1|20260812", NOW)).toMatchObject({
      freshness: { ageSeconds: 200, bucket: "delayed" },
    });
  });

  test("serves a full live view of one trip: position, freshness and trail", () => {
    state.applyVehicles(
      vehicles([
        { tripId: "T1", startDate: "20260812", lat: 43.1, lon: 11.1, timestamp: NOW_S - 10 },
      ]),
      NOW,
    );
    state.applyTripUpdates(tripUpdates([{ tripId: "T1", delay: 45 }]), NOW);

    const view = state.describe("trip:T1|20260812", NOW);
    expect(view?.vehicle.delaySeconds).toBe(45);
    expect(view?.freshness.bucket).toBe("live");
    expect(view?.trail).toHaveLength(1);
  });

  test("finds a bus by trip id when the caller does not know the service date", () => {
    state.applyVehicles(vehicles([{ tripId: "T1", startDate: "20260812" }]), NOW);

    expect(state.findByTrip("T1")?.startDate).toBe("20260812");
    expect(state.findByTrip("T1", "20260812")?.tripId).toBe("T1");
    expect(state.findByTrip("T1", "20260811")).toBeNull();
    expect(state.findByTrip("nope")).toBeNull();
  });

  test("reports what it holds, for the health endpoint", () => {
    state.applyVehicles(
      vehicles([
        { tripId: "T1", startDate: "20260812", timestamp: NOW_S - 10 },
        { vehicleId: "BUS9", timestamp: NOW_S - 600 },
        { lat: 0, lon: 0 },
      ]),
      NOW,
    );
    state.applyTripUpdates(tripUpdates([{ tripId: "T1", delay: 30 }]), NOW);

    expect(state.stats(NOW)).toMatchObject({
      vehicles: 2,
      withTrip: 1,
      withDelay: 1,
      byFreshness: { live: 1, recent: 0, delayed: 0, stale: 1 },
      lastVehicleUpdateMs: NOW,
      lastTripUpdateMs: NOW,
    });
  });

  test("forgets trip-updates for runs that are long over", () => {
    state.applyTripUpdates(tripUpdates([{ tripId: "T1", delay: 30 }]), NOW);
    state.applyTripUpdates(tripUpdates([{ tripId: "T2", delay: 30 }]), NOW + 11 * 60_000);

    expect(state.stats(NOW + 11 * 60_000).tripUpdates).toBe(1);
  });
});
