import { describe, expect, test } from "vitest";
import { ageSeconds, freshness, freshnessBucket } from "../src/rt/freshness.js";

describe("freshnessBucket", () => {
  // Calibrated to the operator's measured ~120s cycle: a bus reporting normally
  // is never fresher than ~40s, so the bands describe the bus, not the publisher.
  test("labels a bus reporting on the publisher's normal cycle as live", () => {
    expect(freshnessBucket(0)).toBe("live");
    expect(freshnessBucket(45)).toBe("live");
    expect(freshnessBucket(90)).toBe("live");
  });

  test("labels a bus that has missed one cycle as recent", () => {
    expect(freshnessBucket(91)).toBe("recent");
    expect(freshnessBucket(180)).toBe("recent");
  });

  test("labels a bus that has missed several cycles as delayed", () => {
    expect(freshnessBucket(181)).toBe("delayed");
    expect(freshnessBucket(300)).toBe("delayed");
  });

  test("labels anything past five minutes as stale", () => {
    expect(freshnessBucket(301)).toBe("stale");
    expect(freshnessBucket(36_000)).toBe("stale");
  });
});

describe("ageSeconds", () => {
  test("measures the gap between now and the vehicle timestamp", () => {
    expect(ageSeconds(1_760_000_100_000, 1_760_000_040)).toBe(60);
  });

  test("clamps a vehicle clock running ahead of ours to zero", () => {
    expect(ageSeconds(1_760_000_000_000, 1_760_000_045)).toBe(0);
  });

  test("reports no age when the vehicle sent no timestamp", () => {
    expect(ageSeconds(1_760_000_000_000, null)).toBeNull();
  });
});

describe("freshness", () => {
  test("pairs the age with its bucket", () => {
    expect(freshness(1_760_000_100_000, 1_760_000_000)).toEqual({
      ageSeconds: 100,
      bucket: "recent",
    });
  });

  test("an unknown timestamp is stale rather than silently fresh", () => {
    expect(freshness(1_760_000_100_000, null)).toEqual({ ageSeconds: null, bucket: "stale" });
  });
});
