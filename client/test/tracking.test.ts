import { describe, expect, test } from "vitest";
import type { Vehicle } from "../src/api/types.js";
import { type Tracked, trackSnapshot } from "../src/map/tracking.js";

/** A bus with only the fields the tracker reads; the rest is filler. */
function vehicle(key: string, lon: number, lat: number, at: number | null): Vehicle {
  return {
    key,
    tripId: key,
    routeId: "1",
    line: "40",
    startDate: "20260823",
    lat,
    lon,
    bearing: null,
    speed: null,
    stopId: null,
    stopSequence: null,
    status: null,
    vehicleId: null,
    vehicleLabel: null,
    occupancy: null,
    timestamp: at,
    ageSeconds: null,
    freshness: "recent",
    delaySeconds: null,
    scheduleRelationship: null,
    cancelled: false,
    previous: null,
  };
}

function withPrevious(base: Vehicle, lon: number, lat: number, at: number): Vehicle {
  return { ...base, previous: { lon, lat, at } };
}

const EMPTY: ReadonlyMap<string, Tracked> = new Map();

describe("trackSnapshot", () => {
  test("takes the earlier fix the API sends rather than waiting to observe one", () => {
    const bus = withPrevious(vehicle("a", 11.2, 43.7, 1000), 11.1, 43.6, 940);
    const next = trackSnapshot(EMPTY, [bus], null);

    expect(next.get("a")?.latest).toEqual({ lon: 11.2, lat: 43.7, at: 1000 });
    expect(next.get("a")?.previous).toEqual({ lon: 11.1, lat: 43.6, at: 940 });
  });

  test("carries the last fix into `previous` when the bus reports a new one", () => {
    const first = trackSnapshot(EMPTY, [vehicle("a", 11.2, 43.7, 1000)], null);
    const next = trackSnapshot(first, [vehicle("a", 11.25, 43.72, 1120)], null);

    expect(next.get("a")?.latest).toEqual({ lon: 11.25, lat: 43.72, at: 1120 });
    expect(next.get("a")?.previous).toEqual({ lon: 11.2, lat: 43.7, at: 1000 });
  });

  test("holds both fixes still while the bus repeats a timestamp", () => {
    const first = trackSnapshot(EMPTY, [vehicle("a", 11.2, 43.7, 1000)], null);
    const moved = trackSnapshot(first, [vehicle("a", 11.25, 43.72, 1120)], null);
    // The publisher re-sends the same fix for a whole cycle; the pair must not
    // collapse to two copies of it, or the speed measured between them is zero.
    const repeat = trackSnapshot(moved, [vehicle("a", 11.25, 43.72, 1120)], null);

    expect(repeat.get("a")?.previous).toEqual({ lon: 11.2, lat: 43.7, at: 1000 });
  });

  test("a bus with no clock of its own is placed, never extrapolated", () => {
    const next = trackSnapshot(EMPTY, [vehicle("a", 11.2, 43.7, null)], null);
    expect(next.get("a")?.latest.at).toBe(0);
  });

  test("drops a bus the snapshot no longer mentions", () => {
    const first = trackSnapshot(EMPTY, [vehicle("a", 11.2, 43.7, 1000)], null);
    expect(trackSnapshot(first, [], null).has("a")).toBe(false);
  });

  test("keeps the followed bus when the snapshot leaves it out", () => {
    // The measured failure: at zoom 16 the viewport query is ~1.4 km wide while
    // the followed bus's marker runs up to ~1.9 km ahead of its last fix, so the
    // bus falls outside its own request and the answer comes back without it.
    const first = trackSnapshot(EMPTY, [vehicle("followed", 11.2, 43.7, 1000)], "followed");
    const next = trackSnapshot(first, [], "followed");

    expect(next.get("followed")?.latest).toEqual({ lon: 11.2, lat: 43.7, at: 1000 });
  });

  test("prefers the snapshot's own copy of the followed bus over the kept one", () => {
    const first = trackSnapshot(EMPTY, [vehicle("followed", 11.2, 43.7, 1000)], "followed");
    const next = trackSnapshot(first, [vehicle("followed", 11.3, 43.75, 1120)], "followed");

    expect(next.get("followed")?.latest).toEqual({ lon: 11.3, lat: 43.75, at: 1120 });
    expect(next.get("followed")?.previous).toEqual({ lon: 11.2, lat: 43.7, at: 1000 });
  });

  test("lets the bus go once it stops being the followed one", () => {
    const first = trackSnapshot(EMPTY, [vehicle("followed", 11.2, 43.7, 1000)], "followed");
    expect(trackSnapshot(first, [], null).has("followed")).toBe(false);
  });

  test("keeps nothing for a followed key that was never tracked", () => {
    expect(trackSnapshot(EMPTY, [], "never-seen").size).toBe(0);
  });

  test("leaves the map it was given untouched", () => {
    const first = trackSnapshot(EMPTY, [vehicle("a", 11.2, 43.7, 1000)], null);
    trackSnapshot(first, [vehicle("b", 11.4, 43.9, 1000)], null);

    expect([...first.keys()]).toEqual(["a"]);
  });
});
