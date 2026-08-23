import { describe, expect, test } from "vitest";
import { FOLLOW_PAD_M, padViewport } from "../src/map/viewport.js";

/** Metres per degree of latitude — the same figure `padViewport` reasons with. */
const METRES_PER_DEGREE = 111_320;

describe("padViewport", () => {
  test("pads a wide viewport by the fraction it was given", () => {
    const box = padViewport({ west: 11, south: 43, east: 12, north: 44 }, 0.15, 0);

    expect(box.minLon).toBeCloseTo(10.85, 6);
    expect(box.maxLon).toBeCloseTo(12.15, 6);
    expect(box.minLat).toBeCloseTo(42.85, 6);
    expect(box.maxLat).toBeCloseTo(44.15, 6);
  });

  test("never asks for less than the floor, however far in the map is zoomed", () => {
    // The viewport measured at zoom 16 on a 1280×800 screen, where the fleet
    // request came back without the bus the rider was watching.
    const box = padViewport(
      { west: 11.2389, south: 43.8033, east: 11.2568, north: 43.8113 },
      0.15,
      FOLLOW_PAD_M,
    );

    const latPadDegrees = 43.8033 - box.minLat;
    expect(latPadDegrees * METRES_PER_DEGREE).toBeCloseTo(FOLLOW_PAD_M, 6);
    // Two kilometres each side of a 1.4 km viewport: the box grows past 5 km,
    // which covers the ~1.9 km the marker was measured running ahead of its fix.
    expect(
      (box.maxLon - box.minLon) * METRES_PER_DEGREE * Math.cos((43.8 * Math.PI) / 180),
    ).toBeGreaterThan(5_000);
  });

  test("the floor is a distance, so its longitude cost grows with latitude", () => {
    const south = padViewport({ west: 11, south: 0, east: 11.01, north: 0.01 }, 0, 2_000);
    const north = padViewport({ west: 11, south: 60, east: 11.01, north: 60.01 }, 0, 2_000);

    expect(north.maxLon - north.minLon).toBeGreaterThan(south.maxLon - south.minLon);
  });

  test("the fraction still wins when the viewport is larger than the floor", () => {
    const box = padViewport({ west: 11, south: 43, east: 12, north: 44 }, 0.15, FOLLOW_PAD_M);
    expect(box.minLat).toBeCloseTo(42.85, 6);
  });

  test("a degenerate viewport still produces a usable box", () => {
    const box = padViewport({ west: 11.2, south: 43.8, east: 11.2, north: 43.8 }, 0.15, 2_000);
    expect(box.maxLat).toBeGreaterThan(box.minLat);
    expect(box.maxLon).toBeGreaterThan(box.minLon);
  });
});
