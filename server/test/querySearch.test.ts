import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { searchLine } from "../src/query/searchLine.js";
import { resolveComune, searchOd } from "../src/query/searchOd.js";
import { createFixtureDb, type FixtureDb } from "./helpers/fixtureDb.js";

const DATE = "20260812";
const AREZZO = "051002";
const ANGHIARI = "051001";
const ALL_DAY = { fromSeconds: 0, toSeconds: 27 * 3600 };

describe("searchLine", () => {
  let fixture: FixtureDb;

  beforeAll(async () => {
    fixture = await createFixtureDb();
  });
  afterAll(async () => {
    await fixture.dispose();
  });

  test("returns the day's runs of a line with their origin and destination", () => {
    const result = searchLine(fixture.db, { route: "SI381", date: DATE, ...ALL_DAY });

    expect(result.trips).toEqual([
      {
        tripId: "T1",
        routeId: "R1",
        line: "SI381",
        headsign: "Anghiari",
        directionId: 0,
        departureTime: "06:30:00",
        departureSeconds: 6 * 3600 + 1800,
        arrivalTime: "07:15:00",
        arrivalSeconds: 7 * 3600 + 900,
        origin: { stopId: "AR001", name: "AREZZO STAZIONE", comune: "Arezzo" },
        destination: { stopId: "AN001", name: "ANGHIARI CENTRO", comune: "Anghiari" },
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  test("matches the line name regardless of case, accents and spacing", () => {
    expect(searchLine(fixture.db, { route: " si 381", date: DATE, ...ALL_DAY }).trips).toHaveLength(
      1,
    );
  });

  test("keeps after-midnight departures in the service day", () => {
    // 25:10 belongs to the 12th's service day, not to the 13th's morning.
    const trips = searchLine(fixture.db, {
      route: "BAAS",
      date: DATE,
      fromSeconds: 25 * 3600,
      toSeconds: 26 * 3600,
    }).trips;
    expect(trips.map((trip) => trip.departureTime)).toEqual(["25:10:00"]);
  });

  test("excludes runs departing outside the window", () => {
    expect(
      searchLine(fixture.db, {
        route: "SI381",
        date: DATE,
        fromSeconds: 8 * 3600,
        toSeconds: 9 * 3600,
      }).trips,
    ).toEqual([]);
  });

  test("excludes runs whose service does not operate on the date", () => {
    expect(searchLine(fixture.db, { route: "SI381", date: "20260820", ...ALL_DAY }).trips).toEqual(
      [],
    );
  });

  test("returns nothing for an unknown line", () => {
    expect(searchLine(fixture.db, { route: "NOPE", date: DATE, ...ALL_DAY }).trips).toEqual([]);
  });

  test("flags a truncated result rather than silently dropping runs", () => {
    const result = searchLine(fixture.db, { route: "SI381", date: DATE, ...ALL_DAY, limit: 0 });
    expect(result.trips).toEqual([]);
    expect(result.truncated).toBe(true);
  });
});

describe("searchOd", () => {
  let fixture: FixtureDb;

  beforeAll(async () => {
    fixture = await createFixtureDb();
  });
  afterAll(async () => {
    await fixture.dispose();
  });

  test("finds the direct runs between two comuni, one row per trip", () => {
    const result = searchOd(fixture.db, {
      comuneA: AREZZO,
      comuneB: ANGHIARI,
      date: DATE,
      ...ALL_DAY,
    });

    expect(result.trips.map((trip) => trip.line)).toEqual(["SI381", "BAAS"]);
    expect(result.trips[0]).toMatchObject({
      tripId: "T1",
      boarding: { stopId: "AR001", name: "AREZZO STAZIONE", departureTime: "06:30:00" },
      alighting: { stopId: "AN001", name: "ANGHIARI CENTRO", arrivalTime: "07:15:00" },
    });
  });

  test("orders by departure, so the after-midnight run comes last", () => {
    const result = searchOd(fixture.db, {
      comuneA: AREZZO,
      comuneB: ANGHIARI,
      date: DATE,
      ...ALL_DAY,
    });
    expect(result.trips.map((trip) => trip.departureSeconds)).toEqual([
      6 * 3600 + 1800,
      25 * 3600 + 600,
    ]);
  });

  test("respects direction: the reverse journey is not served", () => {
    const result = searchOd(fixture.db, {
      comuneA: ANGHIARI,
      comuneB: AREZZO,
      date: DATE,
      ...ALL_DAY,
    });
    expect(result.trips).toEqual([]);
  });

  test("honours the departure window", () => {
    const result = searchOd(fixture.db, {
      comuneA: AREZZO,
      comuneB: ANGHIARI,
      date: DATE,
      fromSeconds: 6 * 3600,
      toSeconds: 7 * 3600,
    });
    expect(result.trips.map((trip) => trip.tripId)).toEqual(["T1"]);
  });

  test("returns one row per run, not one per pair of shared stops", () => {
    // Both fixture trips call at one Arezzo stop and one Anghiari stop, but the
    // live feed pairs eleven against eight for the same comuni: the collapse has
    // to happen in the query, not after it.
    const result = searchOd(fixture.db, {
      comuneA: AREZZO,
      comuneB: ANGHIARI,
      date: DATE,
      ...ALL_DAY,
    });
    expect(result.trips).toHaveLength(new Set(result.trips.map((trip) => trip.tripId)).size);
  });

  test("flags a truncated result rather than silently dropping runs", () => {
    const result = searchOd(fixture.db, {
      comuneA: AREZZO,
      comuneB: ANGHIARI,
      date: DATE,
      ...ALL_DAY,
      limit: 1,
    });
    expect(result.truncated).toBe(true);
    expect(result.trips).toHaveLength(1);
  });
});

describe("resolveComune", () => {
  let fixture: FixtureDb;

  beforeAll(async () => {
    fixture = await createFixtureDb();
  });
  afterAll(async () => {
    await fixture.dispose();
  });

  test("accepts an ISTAT code", () => {
    expect(resolveComune(fixture.db, "051002")).toEqual({ istatCode: "051002", name: "Arezzo" });
  });

  test("accepts a name, normalized", () => {
    expect(resolveComune(fixture.db, " anghiari ")).toEqual({
      istatCode: "051001",
      name: "Anghiari",
    });
  });

  test("returns null for an unknown comune", () => {
    expect(resolveComune(fixture.db, "Bologna")).toBeNull();
  });
});
