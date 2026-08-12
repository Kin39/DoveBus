import { describe, expect, test } from "vitest";
import { TUSCANY_BBOX } from "../src/config.js";
import { isInsideBbox, isInsideTuscany } from "../src/geo/bbox.js";

describe("isInsideTuscany", () => {
  test("accepts positions inside the region", () => {
    expect(isInsideTuscany(43.7696, 11.2558)).toBe(true); // Firenze
    expect(isInsideTuscany(43.3188, 11.3308)).toBe(true); // Siena
  });

  test("accepts the bbox edges", () => {
    expect(isInsideTuscany(TUSCANY_BBOX.minLat, TUSCANY_BBOX.minLon)).toBe(true);
    expect(isInsideTuscany(TUSCANY_BBOX.maxLat, TUSCANY_BBOX.maxLon)).toBe(true);
  });

  test("rejects the stray positions the live feed really emits", () => {
    expect(isInsideTuscany(0, 0)).toBe(false); // null island
    expect(isInsideTuscany(45.4642, 9.19)).toBe(false); // Milano, north of the bbox
    expect(isInsideTuscany(41.9028, 12.4964)).toBe(false); // Roma, south of the bbox
  });

  test("rejects non-finite coordinates", () => {
    expect(isInsideTuscany(Number.NaN, 11.2)).toBe(false);
    expect(isInsideTuscany(43.7, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("isInsideBbox", () => {
  test("works for an arbitrary viewport box", () => {
    const viewport = { minLat: 43.7, maxLat: 43.8, minLon: 11.2, maxLon: 11.3 };
    expect(isInsideBbox(43.75, 11.25, viewport)).toBe(true);
    expect(isInsideBbox(43.75, 11.35, viewport)).toBe(false);
    expect(isInsideBbox(43.95, 11.25, viewport)).toBe(false);
  });
});
