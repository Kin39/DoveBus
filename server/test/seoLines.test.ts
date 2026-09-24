import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  collectLines,
  dominantItinerary,
  type LineSummary,
  routeLengthKm,
} from "../src/seo/lines.js";
import { createFixtureDb, type FixtureDb } from "./helpers/fixtureDb.js";

/** A day the fixture's `calendar_dates` activates service on. */
const SERVICE_DAY = "20260812";

let fixture: FixtureDb;

beforeAll(async () => {
  fixture = await createFixtureDb();
});

afterAll(async () => {
  await fixture.dispose();
});

function lines(minimumTrips: number): readonly LineSummary[] {
  return collectLines(fixture.db, { date: SERVICE_DAY, minimumTrips, minimumCoverage: 0.75 });
}

describe("collectLines", () => {
  test("describes a line with the facts its page prints", () => {
    const si381 = lines(1).find((line) => line.shortName === "SI381");
    expect(si381).toBeDefined();
    expect(si381?.longName).toBe("Arezzo - Anghiari");
    expect(si381?.trips).toBe(1);
    // The fixture's SI381 calls at Arezzo twice and Anghiari once, so Arezzo is
    // the comune its address is built on.
    expect(si381?.comune).toBe("Arezzo");
    expect(si381?.slug).toBe("si381-arezzo");
    expect(si381?.comuneSlug).toBe("arezzo");
  });

  test("lists every comune the line touches, most-served first", () => {
    const si381 = lines(1).find((line) => line.shortName === "SI381");
    expect(si381?.comuni).toEqual(["Arezzo", "Anghiari"]);
  });

  test("the threshold selects, and selects nothing when nothing reaches it", () => {
    expect(lines(1).length).toBeGreaterThan(0);
    expect(lines(1000)).toEqual([]);
  });

  test("a direction carries its headsign, its first and last run, and its stops", () => {
    const si381 = lines(1).find((line) => line.shortName === "SI381");
    const direction = si381?.directions[0];
    expect(direction?.headsign).toBe("Anghiari");
    expect(direction?.trips).toBe(1);
    expect(direction?.first).toBe("06:30");
    expect(direction?.last).toBe("06:30");
    expect(direction?.stops).toEqual(["AREZZO STAZIONE", "ANGHIARI CENTRO"]);
    expect(direction?.itineraries).toBe(1);
    expect(direction?.coverage).toBe(1);
  });

  test("a direction with no representative route publishes no stop list", () => {
    // Measured on the real feed: for 24% of published directions the busiest
    // itinerary covers under half the stops the direction serves that day.
    // Prato's 207 runs 24 different routes in one direction, the busiest of
    // them touching 42 of 252 stops. There is no "the route of the 207", and a
    // list drawn anyway would be a journey no bus makes.
    const sparse = collectLines(fixture.db, {
      date: SERVICE_DAY,
      minimumTrips: 1,
      minimumCoverage: 1.1,
    });
    for (const line of sparse) {
      for (const direction of line.directions) expect(direction.stops).toEqual([]);
    }
  });

  test("one run in a direction has no frequency, rather than a made-up one", () => {
    // (last - first) / (trips - 1) is a division by zero. A page saying "one
    // every 0 minutes" would be worse than a page saying nothing about it.
    const si381 = lines(1).find((line) => line.shortName === "SI381");
    expect(si381?.directions[0]?.headwayMinutes).toBeNull();
  });

  test("a run after midnight belongs to its service day and reads as a clock", () => {
    // The fixture's BAAS departs at 25:10, which is 01:10 the following morning
    // and still part of the 12 August service day. "25:10" is a GTFS internal,
    // not something to print on a page.
    const baas = lines(1).find((line) => line.shortName === "BAAS");
    expect(baas?.directions[0]?.first).toBe("01:10");
  });

  test("orders the lines by how much service they run", () => {
    const all = lines(1);
    const counts = all.map((line) => line.trips);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  test("every line it returns has an address that is not a bare comune", () => {
    // A line whose name slugs to nothing would produce "/linea/-arezzo/".
    for (const line of lines(1)) {
      expect(line.slug).not.toMatch(/^-/);
      expect(line.slug.length).toBeGreaterThan(line.comuneSlug.length + 1);
    }
  });
});

describe("dominantItinerary", () => {
  test("one itinerary is its own answer", () => {
    expect(dominantItinerary([{ stops: ["a", "b", "c"], runs: 4 }])).toEqual({
      stops: ["a", "b", "c"],
      itineraries: 1,
      coverage: 1,
    });
  });

  test("picks the route most runs actually follow, not the longest", () => {
    // The previous version merged every itinerary into one list, which fixed the
    // order and invented a journey: 35% of published directions listed over 25%
    // more stops than the longest real run, and Prato's 207 published 255 stops
    // where the longest run calls at 59. A published route has to be a route.
    const result = dominantItinerary([
      { stops: ["a", "b", "c", "d", "e"], runs: 2 },
      { stops: ["a", "b", "c"], runs: 40 },
    ]);
    expect(result.stops).toEqual(["a", "b", "c"]);
    expect(result.itineraries).toBe(2);
  });

  test("breaks a tie on runs by taking the longer journey", () => {
    const result = dominantItinerary([
      { stops: ["a", "b"], runs: 5 },
      { stops: ["a", "b", "c"], runs: 5 },
    ]);
    expect(result.stops).toEqual(["a", "b", "c"]);
  });

  test("is deterministic when runs and length both tie", () => {
    // Otherwise the published page changes between two regenerations of the
    // same feed, which is a diff nobody can review.
    const patterns = [
      { stops: ["b", "c"], runs: 3 },
      { stops: ["a", "d"], runs: 3 },
    ];
    const first = dominantItinerary(patterns);
    const second = dominantItinerary([...patterns].reverse());
    expect(first.stops).toEqual(second.stops);
  });

  test("reports how much of the direction's service its route covers", () => {
    // 3 of the 5 stops the direction serves that day.
    const result = dominantItinerary([
      { stops: ["a", "b", "c"], runs: 40 },
      { stops: ["a", "d", "e"], runs: 2 },
    ]);
    expect(result.coverage).toBeCloseTo(3 / 5);
  });

  test("always returns one of the itineraries it was given, never a blend", () => {
    // The guarantee the previous implementation broke. It merged the patterns,
    // so the list it produced was a sequence no vehicle followed — 255 stops on
    // a line whose longest real run calls at 59. Whatever else changes here,
    // the published route has to be a route somebody drives.
    const itineraries = [
      { stops: ["a", "b", "c", "d"], runs: 3 },
      { stops: ["a", "x", "d"], runs: 9 },
      { stops: ["b", "c"], runs: 9 },
      { stops: ["q"], runs: 1 },
    ];
    const chosen = dominantItinerary(itineraries).stops;
    const shapes = itineraries.map((itinerary) => itinerary.stops.join(">"));
    expect(shapes).toContain(chosen.join(">"));
  });

  test("no itineraries, no route", () => {
    expect(dominantItinerary([])).toEqual({ stops: [], itineraries: 0, coverage: 0 });
  });
});

describe("collapseRepeats via a real direction", () => {
  test("a circular route keeps a stop it genuinely calls at twice", () => {
    // Pistoia's lines run FS - … - FS. The route is the route.
    const result = dominantItinerary([{ stops: ["fs", "a", "b", "fs"], runs: 9 }]);
    expect(result.stops).toEqual(["fs", "a", "b", "fs"]);
  });
});

describe("routeLengthKm", () => {
  test("omits a length the shape does not plausibly support", () => {
    // The real feed has a shape declaring 143 metres for a line that plainly
    // runs further, and that is the case worth pinning. The fixture feed has no
    // such shape and is opened read-only, so the two tables this function reads
    // are stood up in memory rather than bending a fixture a dozen other suites
    // assert row counts against.
    const db = shapeOnlyDb([
      [1, 43.4634, 11.8766],
      // ~90 m north: a shape, but not a bus line.
      [2, 43.4642, 11.8766],
    ]);
    expect(routeLengthKm(db, "R-STUB")).toBeNull();
    db.close();
  });

  test("omits a length too long to be a Tuscan bus line", () => {
    // The ceiling matters as much as the floor: a shape with one corrupt
    // coordinate measures thousands of kilometres, and would print as a fact.
    const db = shapeOnlyDb([
      [1, 43.4634, 11.8766],
      [2, 43.4634, 91.8766],
    ]);
    expect(routeLengthKm(db, "R-STUB")).toBeNull();
    db.close();
  });

  test("measures rather than trusting the feed's own column", () => {
    // R1's shape runs Arezzo → Anghiari over three points. The feed declares
    // 28,500 for it, which is a road distance; the geometry is shorter. The two
    // disagree by design, and this returns the measured one, so a wrong column
    // cannot put a wrong number on a page.
    const km = routeLengthKm(fixture.db, "R1");
    expect(km).not.toBeNull();
    expect(km).toBeGreaterThan(1);
    expect(km).toBeLessThan(30);
  });

  test("a route with no shape has no length, and that is not an error", () => {
    expect(routeLengthKm(fixture.db, "does-not-exist")).toBeNull();
  });
});

/**
 * The two tables {@link routeLengthKm} reads, and nothing else.
 *
 * Small enough to state the case being tested in the test that needs it: a
 * shape of a given geometry, and one trip pointing at it.
 */
function shapeOnlyDb(points: ReadonlyArray<readonly [number, number, number]>) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE trips (trip_id TEXT, route_id TEXT, shape_id TEXT);
    CREATE TABLE shapes (shape_id TEXT, shape_pt_sequence INTEGER, shape_pt_lat REAL, shape_pt_lon REAL);
  `);
  const insert = db.prepare(
    "INSERT INTO shapes (shape_id, shape_pt_sequence, shape_pt_lat, shape_pt_lon) VALUES (?, ?, ?, ?)",
  );
  for (const [sequence, lat, lon] of points) insert.run("SH-STUB", sequence, lat, lon);
  db.prepare("INSERT INTO trips (trip_id, route_id, shape_id) VALUES (?, ?, ?)").run(
    "T-STUB",
    "R-STUB",
    "SH-STUB",
  );
  return db;
}
