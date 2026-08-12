import { describe, expect, test } from "vitest";
import { gtfsTimeToSeconds } from "../src/gtfs/time.js";

describe("gtfsTimeToSeconds", () => {
  test("converts a normal wall-clock time", () => {
    expect(gtfsTimeToSeconds("06:30:00")).toBe(6 * 3600 + 30 * 60);
    expect(gtfsTimeToSeconds("00:00:00")).toBe(0);
    expect(gtfsTimeToSeconds("23:59:59")).toBe(86_399);
  });

  test("keeps GTFS after-midnight times past 24h (service-day semantics)", () => {
    expect(gtfsTimeToSeconds("25:10:00")).toBe(25 * 3600 + 10 * 60);
    expect(gtfsTimeToSeconds("27:05:30")).toBe(27 * 3600 + 5 * 60 + 30);
  });

  test("accepts a non-padded hour", () => {
    expect(gtfsTimeToSeconds("6:05:00")).toBe(6 * 3600 + 5 * 60);
  });

  test("returns null for empty or malformed values", () => {
    expect(gtfsTimeToSeconds("")).toBeNull();
    expect(gtfsTimeToSeconds("   ")).toBeNull();
    expect(gtfsTimeToSeconds("nope")).toBeNull();
    expect(gtfsTimeToSeconds("12:60:00")).toBeNull();
    expect(gtfsTimeToSeconds("12:00:60")).toBeNull();
    expect(gtfsTimeToSeconds("12:00")).toBeNull();
  });
});
