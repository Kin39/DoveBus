import { describe, expect, test } from "vitest";
import { toVehicleJson } from "../src/api/serialize.js";
import type { RouteName } from "../src/query/routes.js";
import type { LiveVehicle } from "../src/rt/state.js";

const NOW_S = 1_786_711_240;
const NOW_MS = NOW_S * 1000;
const ROUTES: ReadonlyMap<string, RouteName> = new Map([
  ["R1", { shortName: "SI381", longName: "Arezzo-Anghiari" }],
]);

function vehicle(overrides: Partial<LiveVehicle> = {}): LiveVehicle {
  return {
    key: "vehicle:BUS1",
    tripId: null,
    routeId: "R1",
    startDate: null,
    lat: 43.5,
    lon: 11.2,
    bearing: null,
    speed: null,
    stopId: null,
    currentStopSequence: null,
    currentStatus: null,
    vehicleId: "BUS1",
    vehicleLabel: null,
    licensePlate: null,
    occupancyStatus: null,
    odometer: null,
    timestamp: NOW_S,
    receivedAt: NOW_MS,
    delaySeconds: null,
    scheduleRelationship: null,
    ...overrides,
  } as LiveVehicle;
}

describe("toVehicleJson previous fix", () => {
  test("is null when the bus has only ever been seen once", () => {
    expect(toVehicleJson(vehicle(), NOW_MS, ROUTES, null).previous).toBeNull();
  });

  test("carries the earlier position, converted to seconds", () => {
    const previous = { lat: 43.4, lon: 11.1, at: (NOW_S - 120) * 1000 };

    expect(toVehicleJson(vehicle(), NOW_MS, ROUTES, previous).previous).toEqual({
      lat: 43.4,
      lon: 11.1,
      at: NOW_S - 120,
    });
  });

  /**
   * Seen on the live feed: a trail point falls back to the server's clock for a
   * bus reporting no timestamp of its own, so the pair can straddle two clocks
   * and arrive out of order. A "previous" position stamped later than the
   * current one cannot be measured against, so it must not be sent at all.
   */
  test("withholds an earlier position that is not actually earlier", () => {
    const notEarlier = { lat: 43.4, lon: 11.1, at: (NOW_S + 6) * 1000 };

    expect(toVehicleJson(vehicle(), NOW_MS, ROUTES, notEarlier).previous).toBeNull();
  });

  test("withholds it when the bus reports no clock of its own to compare against", () => {
    const previous = { lat: 43.4, lon: 11.1, at: (NOW_S - 120) * 1000 };

    expect(
      toVehicleJson(vehicle({ timestamp: null }), NOW_MS, ROUTES, previous).previous,
    ).toBeNull();
  });
});
