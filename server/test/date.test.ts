import { describe, expect, test } from "vitest";
import { daysBetweenServiceDates, parseServiceDate, toServiceDate } from "../src/util/date.js";

describe("toServiceDate", () => {
  test("formats a local date as YYYYMMDD", () => {
    expect(toServiceDate(new Date(2026, 7, 12))).toBe("20260812");
    expect(toServiceDate(new Date(2026, 0, 1))).toBe("20260101");
  });
});

describe("parseServiceDate", () => {
  test("parses a valid date", () => {
    expect(parseServiceDate("20260812")?.toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });

  test("rejects malformed and impossible dates", () => {
    expect(parseServiceDate("2026-08-12")).toBeNull();
    expect(parseServiceDate("")).toBeNull();
    expect(parseServiceDate("20260231")).toBeNull();
    expect(parseServiceDate("20261301")).toBeNull();
  });
});

describe("daysBetweenServiceDates", () => {
  test("counts whole days forward and backward", () => {
    expect(daysBetweenServiceDates("20260812", "20260901")).toBe(20);
    expect(daysBetweenServiceDates("20260902", "20260901")).toBe(-1);
    expect(daysBetweenServiceDates("20260812", "20260812")).toBe(0);
  });

  test("crosses a DST boundary without drifting", () => {
    expect(daysBetweenServiceDates("20261024", "20261026")).toBe(2);
  });

  test("returns null when either date is unparseable", () => {
    expect(daysBetweenServiceDates("nope", "20260901")).toBeNull();
    expect(daysBetweenServiceDates("20260812", "")).toBeNull();
  });
});
