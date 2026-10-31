import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildLineData, serializeLineData, servicesByDate } from "../src/seo/data.js";
import { createFixtureDb, type FixtureDb } from "./helpers/fixtureDb.js";

let fixture: FixtureDb;

beforeAll(async () => {
  fixture = await createFixtureDb();
});

afterAll(async () => {
  await fixture.dispose();
});

const OPTIONS = { date: "20260812", minimumTrips: 1, minimumCoverage: 0.75 };
const NOW = new Date("2026-10-31T12:00:00.000Z");

describe("servicesByDate", () => {
  test("counts only added services, day by day", () => {
    // The fixture adds S1 on the 12th and 13th and removes S2 on the 12th.
    expect(servicesByDate(fixture.db)).toEqual([
      { date: "20260812", services: 1 },
      { date: "20260813", services: 1 },
    ]);
  });
});

describe("buildLineData", () => {
  test("carries the feed it came from, the day and the thresholds", () => {
    const payload = buildLineData(fixture.db, OPTIONS, NOW);
    expect(payload.referenceDate).toBe("20260812");
    expect(payload.minimumTrips).toBe(1);
    expect(payload.minimumCoverage).toBe(0.75);
    expect(payload.generatedAt).toBe("2026-10-31T12:00:00.000Z");
    expect(payload.feed.sha1).toMatch(/\S/);
    expect(payload.lines.length).toBeGreaterThan(0);
  });

  test("keeps the key order lines.json has always had, so diffs stay readable", () => {
    const payload = buildLineData(fixture.db, OPTIONS, NOW);
    expect(Object.keys(payload)).toEqual([
      "feed",
      "referenceDate",
      "minimumTrips",
      "minimumCoverage",
      "generatedAt",
      "lines",
    ]);
  });

  test("refuses a day with no service rather than writing an empty file", () => {
    expect(() => buildLineData(fixture.db, { ...OPTIONS, date: "20260901" }, NOW)).toThrow(
      /no service on 20260901/,
    );
  });
});

describe("serializeLineData", () => {
  test("is two-space JSON with a trailing newline", () => {
    const text = serializeLineData(buildLineData(fixture.db, OPTIONS, NOW));
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.split("\n")[1]).toBe('  "feed": {');
  });
});
