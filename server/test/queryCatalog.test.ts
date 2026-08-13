import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { searchComuni } from "../src/query/comuni.js";
import { routeIndex, searchRoutes } from "../src/query/routes.js";
import { activeServiceIds } from "../src/query/services.js";
import { createFixtureDb, type FixtureDb } from "./helpers/fixtureDb.js";

const DATE = "20260812";

describe("query catalog", () => {
  let fixture: FixtureDb;

  beforeAll(async () => {
    fixture = await createFixtureDb();
  });
  afterAll(async () => {
    await fixture.dispose();
  });

  describe("activeServiceIds", () => {
    test("resolves service from calendar_dates when weekday columns are all zero", () => {
      expect([...activeServiceIds(fixture.db, DATE)]).toEqual(["S1"]);
    });

    test("honours calendar_dates removals", () => {
      // S2 carries an exception_type=2 row on this date and must never appear.
      expect(activeServiceIds(fixture.db, DATE).has("S2")).toBe(false);
    });

    test("returns an empty set for a date the feed does not cover", () => {
      expect(activeServiceIds(fixture.db, "20261231").size).toBe(0);
    });

    test("rejects a malformed date rather than silently matching nothing", () => {
      expect(() => activeServiceIds(fixture.db, "2026-08-12")).toThrow(/date/i);
    });
  });

  describe("searchComuni", () => {
    test("matches on a normalized prefix", () => {
      expect(searchComuni(fixture.db, { q: "arez" })).toEqual([
        { istatCode: "051002", name: "Arezzo", lat: expect.any(Number), lon: expect.any(Number) },
      ]);
    });

    test("ignores accents, case and spacing", () => {
      expect(searchComuni(fixture.db, { q: " àngh" }).map((c) => c.name)).toEqual(["Anghiari"]);
    });

    test("lists every comune, alphabetically, when no query is given", () => {
      expect(searchComuni(fixture.db, {}).map((c) => c.name)).toEqual(["Anghiari", "Arezzo"]);
    });

    test("applies the limit", () => {
      expect(searchComuni(fixture.db, { limit: 1 })).toHaveLength(1);
    });

    test("returns nothing for a query that matches nothing", () => {
      expect(searchComuni(fixture.db, { q: "zzzz" })).toEqual([]);
    });
  });

  describe("searchRoutes", () => {
    test("finds a line by prefix, case-insensitively", () => {
      expect(searchRoutes(fixture.db, { q: "si3" })).toEqual([
        { shortName: "SI381", longName: "Arezzo - Anghiari", routeIds: ["R1"] },
      ]);
    });

    test("lists every line when no query is given", () => {
      expect(searchRoutes(fixture.db, {}).map((r) => r.shortName)).toEqual(["BAAS", "SI381"]);
    });
  });

  describe("routeIndex", () => {
    test("maps route ids to their line name, for labelling live vehicles", () => {
      expect(routeIndex(fixture.db).get("R2")).toEqual({
        shortName: "BAAS",
        longName: "Arezzo - Anghiari via Ponte",
      });
    });
  });
});
