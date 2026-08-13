import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { tripDetail } from "../src/query/trip.js";
import { createFixtureDb, type FixtureDb } from "./helpers/fixtureDb.js";

const DATE = "20260812";

describe("tripDetail", () => {
  let fixture: FixtureDb;

  beforeAll(async () => {
    fixture = await createFixtureDb();
  });
  afterAll(async () => {
    await fixture.dispose();
  });

  test("returns the trip with its line and headsign", () => {
    const detail = tripDetail(fixture.db, "T1", DATE);
    expect(detail?.trip).toEqual({
      tripId: "T1",
      routeId: "R1",
      line: "SI381",
      routeLongName: "Arezzo - Anghiari",
      headsign: "Anghiari",
      directionId: 0,
      serviceId: "S1",
      shapeId: "SH1",
      date: DATE,
      runsOnDate: true,
    });
  });

  test("returns the timetable in stop order, with comuni and coordinates", () => {
    const detail = tripDetail(fixture.db, "T1", DATE);
    expect(detail?.stops).toEqual([
      {
        sequence: 1,
        stopId: "AR001",
        name: "AREZZO STAZIONE",
        comune: "Arezzo",
        lat: 43.4634,
        lon: 11.8766,
        arrivalTime: "06:30:00",
        arrivalSeconds: 6 * 3600 + 1800,
        departureTime: "06:30:00",
        departureSeconds: 6 * 3600 + 1800,
      },
      {
        sequence: 2,
        stopId: "AN001",
        name: "ANGHIARI CENTRO",
        comune: "Anghiari",
        lat: 43.5417,
        lon: 12.0556,
        arrivalTime: "07:15:00",
        arrivalSeconds: 7 * 3600 + 900,
        departureTime: "07:15:00",
        departureSeconds: 7 * 3600 + 900,
      },
    ]);
  });

  test("returns the planned route as an ordered polyline", () => {
    const detail = tripDetail(fixture.db, "T1", DATE);
    expect(detail?.shape).toEqual([
      [43.4634, 11.8766],
      [43.5, 11.95],
      [43.5417, 12.0556],
    ]);
  });

  test("reports a date the trip does not run on without hiding the timetable", () => {
    const detail = tripDetail(fixture.db, "T1", "20260820");
    expect(detail?.trip.runsOnDate).toBe(false);
    expect(detail?.stops).toHaveLength(2);
  });

  test("returns null for an unknown trip", () => {
    expect(tripDetail(fixture.db, "NOPE", DATE)).toBeNull();
  });
});
