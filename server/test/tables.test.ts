import { describe, expect, test } from "vitest";
import {
  buildRowMapper,
  insertStatementFor,
  specForFile,
  TABLE_SPECS,
  type TableSpec,
} from "../src/gtfs/tables.js";

/** Spec lookup that fails the test loudly instead of asserting non-null. */
function requireSpec(file: string): TableSpec {
  const spec = specForFile(file);
  if (!spec) throw new Error(`no table spec for ${file}`);
  return spec;
}

describe("TABLE_SPECS", () => {
  test("covers every file of the consolidated feed that we import", () => {
    expect(TABLE_SPECS.map((spec) => spec.file)).toEqual([
      "agency.txt",
      "area.txt",
      "stops.txt",
      "routes.txt",
      "trips.txt",
      "stop_times.txt",
      "calendar.txt",
      "calendar_dates.txt",
      "shapes.txt",
    ]);
  });

  test("marks the optional files as not required", () => {
    expect(specForFile("area.txt")?.required).toBe(false);
    expect(specForFile("stop_times.txt")?.required).toBe(true);
  });
});

describe("insertStatementFor", () => {
  test("lists source columns then derived columns with matching placeholders", () => {
    const sql = insertStatementFor(requireSpec("calendar_dates.txt"));
    expect(sql).toBe(
      "INSERT INTO calendar_dates (service_id, date, exception_type) VALUES (?, ?, ?)",
    );
  });

  test("includes derived columns", () => {
    const sql = insertStatementFor(requireSpec("routes.txt"));
    expect(sql).toContain("route_short_name_norm");
    const placeholders = sql.slice(sql.indexOf("VALUES")).split("?").length - 1;
    const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").length;
    expect(placeholders).toBe(columns);
  });
});

describe("buildRowMapper", () => {
  test("maps values by header position, not by file order", () => {
    const spec = requireSpec("calendar_dates.txt");
    const map = buildRowMapper(spec, ["exception_type", "service_id", "date"]);
    expect(map(["2", "S1", "20260812"])).toEqual(["S1", "20260812", 2]);
  });

  test("coerces empty strings to null and numbers to numbers", () => {
    const spec = requireSpec("stops.txt");
    const header = ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type"];
    const map = buildRowMapper(spec, header);
    const values = map(["134489", "VIA DELLA CHIMERA", "43.47246", "11.874257", ""]);
    const byColumn = Object.fromEntries(
      [...spec.columns, ...spec.derived].map((column, index) => [column.db, values[index]]),
    );
    expect(byColumn.stop_id).toBe("134489");
    expect(byColumn.stop_lat).toBeCloseTo(43.47246, 5);
    expect(byColumn.location_type).toBeNull();
    expect(byColumn.stop_name_norm).toBe("VIADELLACHIMERA");
  });

  test("yields null for columns the file does not carry", () => {
    const spec = requireSpec("trips.txt");
    const map = buildRowMapper(spec, ["route_id", "service_id", "trip_id"]);
    const values = map(["280", "150", "10000-1"]);
    const byColumn = Object.fromEntries(
      [...spec.columns, ...spec.derived].map((column, index) => [column.db, values[index]]),
    );
    expect(byColumn.trip_id).toBe("10000-1");
    expect(byColumn.shape_id).toBeNull();
    expect(byColumn.direction_id).toBeNull();
  });

  test("derives seconds-since-midnight for stop times, past 24h included", () => {
    const spec = requireSpec("stop_times.txt");
    const header = ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"];
    const map = buildRowMapper(spec, header);
    const values = map(["10000-1", "25:10:00", "25:11:30", "155319", "1"]);
    const byColumn = Object.fromEntries(
      [...spec.columns, ...spec.derived].map((column, index) => [column.db, values[index]]),
    );
    expect(byColumn.arrival_s).toBe(25 * 3600 + 600);
    expect(byColumn.departure_s).toBe(25 * 3600 + 690);
    expect(byColumn.stop_sequence).toBe(1);
  });

  test("throws when a required column is absent from the file header", () => {
    const spec = requireSpec("stops.txt");
    expect(() => buildRowMapper(spec, ["stop_name", "stop_lat"])).toThrow(/stop_id/);
  });

  test("tolerates rows shorter than the header", () => {
    const spec = requireSpec("calendar_dates.txt");
    const map = buildRowMapper(spec, ["service_id", "date", "exception_type"]);
    expect(map(["S1", "20260812"])).toEqual(["S1", "20260812", null]);
  });
});
