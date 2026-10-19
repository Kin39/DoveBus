import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DB_VERSION } from "../src/config.js";
import { openDatabase } from "../src/db/index.js";
import { readFeedMeta } from "../src/feed/meta.js";
import { type ImportResult, importFeed } from "../src/gtfs/import.js";
import { createFixtureFeed, FIXTURE_FILES, type Fixture } from "./helpers/fixtureFeed.js";

describe("importFeed", () => {
  let fixture: Fixture;
  let result: ImportResult;
  let db: ReturnType<typeof openDatabase>;

  beforeAll(async () => {
    fixture = await createFixtureFeed();
    result = await importFeed({
      zipPath: fixture.zipPath,
      comuniGeoJsonPath: fixture.comuniPath,
      dbPath: join(fixture.dir, "gtfs.new.db"),
      source: { sha1: "abc123", etag: 'W/"v1"', bytes: 4242 },
    });
    db = openDatabase(result.dbPath, { readonly: true });
  });

  afterAll(async () => {
    db?.close();
    await rm(fixture.dir, { recursive: true, force: true });
  });

  test("imports every table with the expected row counts", () => {
    expect(result.rowCounts).toEqual({
      agency: 1,
      areas: 1,
      stops: 6,
      routes: 2,
      trips: 2,
      stop_times: 4,
      calendar: 2,
      calendar_dates: 3,
      shapes: 5,
    });
  });

  test("parses quoted stop names containing commas", () => {
    const stop = db.prepare("SELECT stop_name FROM stops WHERE stop_id = 'AR002'").get() as {
      stop_name: string;
    };
    expect(stop.stop_name).toBe("VIA DELLA CHIMERA, 87");
  });

  test("stores derived seconds for after-midnight departures", () => {
    const row = db
      .prepare(
        "SELECT departure_time, departure_s FROM stop_times WHERE trip_id = 'T2' AND stop_sequence = 1",
      )
      .get() as { departure_time: string; departure_s: number };
    expect(row.departure_time).toBe("25:10:00");
    expect(row.departure_s).toBe(25 * 3600 + 600);
  });

  test("stores normalized names for autocomplete", () => {
    const route = db
      .prepare("SELECT route_short_name_norm FROM routes WHERE route_id = 'R1'")
      .get() as { route_short_name_norm: string };
    expect(route.route_short_name_norm).toBe("SI381");
  });

  test("enriches stops with their comune, by polygon then by name", () => {
    expect(result.enrichment).toEqual({ total: 6, byPolygon: 3, byName: 1, unresolved: 2 });

    const stops = db
      .prepare("SELECT stop_id, comune, comune_istat, comune_source FROM stops ORDER BY stop_id")
      .all() as ReadonlyArray<Record<string, string | null>>;
    const byId = Object.fromEntries(stops.map((s) => [s.stop_id, s]));

    expect(byId.AR001).toMatchObject({
      comune: "Arezzo",
      comune_istat: "051002",
      comune_source: "polygon",
    });
    expect(byId.AN001).toMatchObject({ comune: "Anghiari", comune_source: "polygon" });
    expect(byId.XX001).toMatchObject({ comune: "Anghiari", comune_source: "name" });
    // Cross-border stop: no Tuscan comune is the correct answer.
    expect(byId.EM001).toMatchObject({ comune: null, comune_istat: null, comune_source: null });
    // Names a comune 100 km away — must not be claimed by it.
    expect(byId.FP001).toMatchObject({ comune: null, comune_istat: null, comune_source: null });
  });

  test("seeds the comuni table for autocomplete", () => {
    expect(result.comuniCount).toBe(2);
    const comune = db.prepare("SELECT * FROM comuni WHERE name_norm = 'AREZZO'").get() as Record<
      string,
      unknown
    >;
    expect(comune.istat_code).toBe("051002");
    expect(comune.centroid_lat).toBeCloseTo(43.45, 2);
  });

  test("records feed provenance in feed_meta", () => {
    const meta = readFeedMeta(db);
    expect(meta).toMatchObject({
      feedStartDate: "20260812",
      feedEndDate: "20260901",
      sourceSha1: "abc123",
      sourceEtag: 'W/"v1"',
      sourceBytes: 4242,
      dbVersion: DB_VERSION,
    });
    expect(Date.parse(meta?.importedAt ?? "")).not.toBeNaN();
  });

  test("records, per trip, the comuni it calls in and where", () => {
    const rows = db.prepare("SELECT * FROM trip_comuni ORDER BY trip_id, comune_istat").all();
    expect(rows).toEqual([
      {
        comune_istat: "051001",
        trip_id: "T1",
        min_seq: 2,
        max_seq: 2,
        min_dep_s: 26100,
        max_dep_s: 26100,
      },
      {
        comune_istat: "051002",
        trip_id: "T1",
        min_seq: 1,
        max_seq: 1,
        min_dep_s: 23400,
        max_dep_s: 23400,
      },
      {
        comune_istat: "051001",
        trip_id: "T2",
        min_seq: 2,
        max_seq: 2,
        min_dep_s: 93000,
        max_dep_s: 93000,
      },
      {
        comune_istat: "051002",
        trip_id: "T2",
        min_seq: 1,
        max_seq: 1,
        min_dep_s: 90600,
        max_dep_s: 90600,
      },
    ]);
  });

  test("creates the indexes the search queries depend on", () => {
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    ).map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "idx_stop_times_stop_dep",
        "idx_stop_times_trip_seq",
        "idx_shapes_pt",
        "idx_trips_route",
        "idx_calendar_dates_date",
        "idx_comuni_name_norm",
      ]),
    );
  });

  test("keeps the origin→destination self-join usable on the imported data", () => {
    // Both lines serve Arezzo -> Anghiari; the query must return one row per trip.
    const rows = db
      .prepare(
        `SELECT DISTINCT r.route_short_name AS line, sa.departure_time AS departure, t.trip_id AS trip
           FROM stop_times sa
           JOIN stop_times sb ON sa.trip_id = sb.trip_id AND sa.stop_sequence < sb.stop_sequence
           JOIN trips t ON t.trip_id = sa.trip_id
           JOIN routes r ON r.route_id = t.route_id
          WHERE sa.stop_id IN (SELECT stop_id FROM stops WHERE comune_istat = '051002')
            AND sb.stop_id IN (SELECT stop_id FROM stops WHERE comune_istat = '051001')
            AND t.service_id IN (SELECT service_id FROM calendar_dates WHERE date = '20260812' AND exception_type = 1)
          ORDER BY sa.departure_time`,
      )
      .all() as ReadonlyArray<{ line: string; trip: string }>;

    expect(rows.map((row) => row.line)).toEqual(["SI381", "BAAS"]);
    expect(new Set(rows.map((row) => row.trip)).size).toBe(2);
  });
});

describe("importFeed failure handling", () => {
  test("refuses a feed missing a required file", async () => {
    const fixture = await createFixtureFeed({ "stop_times.txt": null });
    await expect(
      importFeed({
        zipPath: fixture.zipPath,
        comuniGeoJsonPath: fixture.comuniPath,
        dbPath: join(fixture.dir, "gtfs.new.db"),
        source: { sha1: "x", etag: null, bytes: null },
      }),
    ).rejects.toThrow(/missing required file stop_times.txt/);
    await rm(fixture.dir, { recursive: true, force: true });
  });

  test("tolerates a feed without the optional area file", async () => {
    const fixture = await createFixtureFeed({ "area.txt": null });
    const result = await importFeed({
      zipPath: fixture.zipPath,
      comuniGeoJsonPath: fixture.comuniPath,
      dbPath: join(fixture.dir, "gtfs.new.db"),
      source: { sha1: "x", etag: null, bytes: null },
    });
    expect(result.rowCounts.areas).toBe(0);
    expect(result.rowCounts.stops).toBe(6);
    await rm(fixture.dir, { recursive: true, force: true });
  });

  test("fails loudly, naming the file and row, when the feed violates the schema", async () => {
    const duplicated = [
      FIXTURE_FILES["stops.txt"],
      "AR001,AR0001,AREZZO STAZIONE DUPLICATA,43.4634,11.8766,,,0,,,,,,AR",
    ].join("\n");
    const fixture = await createFixtureFeed({ "stops.txt": duplicated });

    await expect(
      importFeed({
        zipPath: fixture.zipPath,
        comuniGeoJsonPath: fixture.comuniPath,
        dbPath: join(fixture.dir, "gtfs.new.db"),
        source: { sha1: "x", etag: null, bytes: null },
      }),
    ).rejects.toThrow(/import of stops.txt failed after 6 rows/);
    await rm(fixture.dir, { recursive: true, force: true });
  });

  test("reports progress per table", async () => {
    const fixture = await createFixtureFeed();
    const events: string[] = [];
    await importFeed({
      zipPath: fixture.zipPath,
      comuniGeoJsonPath: fixture.comuniPath,
      dbPath: join(fixture.dir, "gtfs.new.db"),
      source: { sha1: "x", etag: null, bytes: null },
      onProgress: (event) =>
        events.push(`${event.kind}:${"table" in event ? event.table : event.message}`),
    });
    expect(events).toContain("table-start:stop_times");
    expect(events).toContain("table-done:shapes");
    expect(events).toContain("step:indexes");
    await rm(fixture.dir, { recursive: true, force: true });
  });
});
