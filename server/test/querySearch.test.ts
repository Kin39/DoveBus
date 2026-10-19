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

/**
 * Trips that make the comune→comune search earn its keep: one that calls in
 * Arezzo twice and only the second call is in the window, one whose first
 * Arezzo stop has no departure time, one that runs on a service removed that
 * day, one in the opposite direction, and one that calls in Anghiari on both
 * sides of Arezzo. Each answer below was computed by the original query, which
 * read stop_times alone; any faster query has to give exactly these back.
 */
const TRICKY_TRIPS = {
  "trips.txt": [
    "route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id,wheelchair_accessible,bikes_allowed",
    'R1,S1,T1,"Anghiari",1101,0,,SH1,,',
    'R2,S1,T2,"Anghiari",1102,0,,SH2,,',
    'R1,S1,T3,"Anghiari",1103,0,,,,',
    'R2,S2,T4,"Anghiari",1104,0,,,,',
    'R1,S1,T5,"Anghiari",1105,0,,,,',
    'R2,S1,T6,"Arezzo",1106,1,,,,',
    'R1,S1,T7,"Anghiari",1107,0,,,,',
  ].join("\n"),
  "stop_times.txt": [
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint,shape_dist_traveled,stop_headsign,pickup_type,drop_off_type",
    "T1,06:30:00,06:30:00,AR001,1,1,0,,0,0",
    "T1,07:15:00,07:15:00,AN001,2,0,28500,,0,0",
    "T2,25:10:00,25:10:00,AR002,1,1,0,,0,0",
    "T2,25:50:00,25:50:00,AN001,2,0,29100,,0,0",
    "T3,05:00:00,05:00:00,AR001,1,1,,,0,0",
    "T3,05:30:00,05:30:00,AN001,2,1,,,0,0",
    "T3,08:00:00,08:00:00,AR002,3,1,,,0,0",
    "T3,08:40:00,08:40:00,AN001,4,1,,,0,0",
    "T4,08:10:00,08:10:00,AR001,1,1,,,0,0",
    "T4,08:50:00,08:50:00,AN001,2,1,,,0,0",
    "T5,,,AR001,1,0,,,0,0",
    "T5,08:20:00,08:20:00,AR002,2,1,,,0,0",
    "T5,09:00:00,09:00:00,AN001,3,1,,,0,0",
    "T6,08:05:00,08:05:00,AN001,1,1,,,0,0",
    "T6,08:45:00,08:45:00,AR001,2,1,,,0,0",
    "T7,07:50:00,07:50:00,AN001,1,1,,,0,0",
    "T7,08:15:00,08:15:00,AR001,2,1,,,0,0",
    "T7,08:55:00,08:55:00,AN001,3,1,,,0,0",
  ].join("\n"),
};

describe("searchOd on trips that loop, skip times or do not run", () => {
  let fixture: FixtureDb;
  const MORNING = { fromSeconds: 7 * 3600, toSeconds: 9 * 3600 };
  const boardings = (trips: ReturnType<typeof searchOd>["trips"]) =>
    trips.map((trip) => [
      trip.tripId,
      trip.boarding.stopId,
      trip.boarding.sequence,
      trip.alighting.stopId,
      trip.alighting.sequence,
    ]);

  beforeAll(async () => {
    fixture = await createFixtureDb(TRICKY_TRIPS);
  });
  afterAll(async () => {
    await fixture.dispose();
  });

  test("boards at the first stop inside the window, not the trip's first call in the comune", () => {
    const result = searchOd(fixture.db, {
      comuneA: AREZZO,
      comuneB: ANGHIARI,
      date: DATE,
      ...MORNING,
    });
    expect(boardings(result.trips)).toEqual([
      ["T3", "AR002", 3, "AN001", 4],
      ["T7", "AR001", 2, "AN001", 3],
      ["T5", "AR002", 2, "AN001", 3],
    ]);
  });

  test("serves the opposite direction only with the trips that run that way", () => {
    const result = searchOd(fixture.db, {
      comuneA: ANGHIARI,
      comuneB: AREZZO,
      date: DATE,
      ...MORNING,
    });
    expect(boardings(result.trips)).toEqual([
      ["T7", "AN001", 1, "AR001", 2],
      ["T6", "AN001", 1, "AR001", 2],
    ]);
  });

  test("finds a trip that leaves a comune and comes back to it", () => {
    const result = searchOd(fixture.db, {
      comuneA: AREZZO,
      comuneB: AREZZO,
      date: DATE,
      ...ALL_DAY,
    });
    expect(boardings(result.trips)).toEqual([["T3", "AR001", 1, "AR002", 3]]);
  });

  test("leaves out a trip whose service is removed that day", () => {
    const result = searchOd(fixture.db, {
      comuneA: AREZZO,
      comuneB: ANGHIARI,
      date: DATE,
      ...ALL_DAY,
    });
    expect(result.trips.map((trip) => trip.tripId)).not.toContain("T4");
    expect(result.trips.map((trip) => trip.tripId)).toEqual(["T3", "T1", "T7", "T5", "T2"]);
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
