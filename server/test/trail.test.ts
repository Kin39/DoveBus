import { describe, expect, test } from "vitest";
import { MAX_TRAIL_POINTS, TrailBuffer, type TrailPoint } from "../src/rt/trail.js";

const START = 1_760_000_000_000;

describe("TrailBuffer", () => {
  test("keeps the path in the order it was travelled", () => {
    const trail = new TrailBuffer();
    trail.push({ lat: 43.1, lon: 11.1, at: START }, START);
    trail.push({ lat: 43.2, lon: 11.2, at: START + 30_000 }, START + 30_000);

    expect(trail.points()).toEqual([
      { lat: 43.1, lon: 11.1, at: START },
      { lat: 43.2, lon: 11.2, at: START + 30_000 },
    ]);
    expect(trail.size).toBe(2);
  });

  test("forgets everything older than the window", () => {
    const trail = new TrailBuffer(60_000);
    trail.push({ lat: 43.1, lon: 11.1, at: START }, START);
    trail.push({ lat: 43.2, lon: 11.2, at: START + 30_000 }, START + 30_000);
    trail.push({ lat: 43.3, lon: 11.3, at: START + 90_000 }, START + 90_000);

    expect(trail.points().map((point) => point.lat)).toEqual([43.2, 43.3]);
  });

  test("ignores a position already recorded — the feed repeats between refreshes", () => {
    const trail = new TrailBuffer();
    trail.push({ lat: 43.1, lon: 11.1, at: START }, START);
    // Same snapshot polled again 30s later: identical vehicle timestamp.
    trail.push({ lat: 43.1, lon: 11.1, at: START }, START + 30_000);

    expect(trail.size).toBe(1);
  });

  test("ignores a repeated position even when the timestamp moves", () => {
    const trail = new TrailBuffer();
    trail.push({ lat: 43.1, lon: 11.1, at: START }, START);
    trail.push({ lat: 43.1, lon: 11.1, at: START + 30_000 }, START + 30_000);

    expect(trail.size).toBe(1);
    expect(trail.last).toEqual({ lat: 43.1, lon: 11.1, at: START });
  });

  test("records a bus that moves back to a position it held before", () => {
    const trail = new TrailBuffer();
    trail.push({ lat: 43.1, lon: 11.1, at: START }, START);
    trail.push({ lat: 43.2, lon: 11.2, at: START + 30_000 }, START + 30_000);
    trail.push({ lat: 43.1, lon: 11.1, at: START + 60_000 }, START + 60_000);

    expect(trail.size).toBe(3);
  });

  test("caps the buffer so a jittering vehicle cannot grow it without bound", () => {
    const trail = new TrailBuffer();
    for (let index = 0; index <= MAX_TRAIL_POINTS + 50; index++) {
      trail.push({ lat: 43 + index / 100_000, lon: 11, at: START + index }, START + index);
    }

    expect(trail.size).toBe(MAX_TRAIL_POINTS);
    expect(trail.last?.at).toBe(START + MAX_TRAIL_POINTS + 50);
  });

  test("hands out a copy, so callers cannot corrupt the buffer", () => {
    const trail = new TrailBuffer();
    trail.push({ lat: 43.1, lon: 11.1, at: START }, START);

    (trail.points() as TrailPoint[]).pop();

    expect(trail.size).toBe(1);
  });

  test("prunes on read as well, so a parked bus does not keep a stale trail", () => {
    const trail = new TrailBuffer(60_000);
    trail.push({ lat: 43.1, lon: 11.1, at: START }, START);

    expect(trail.points(START + 120_000)).toEqual([]);
    expect(trail.isEmpty).toBe(true);
  });
});
