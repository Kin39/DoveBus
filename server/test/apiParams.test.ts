import { describe, expect, test } from "vitest";
import { HttpError } from "../src/api/errors.js";
import { parseBbox, parseDate, parseLimit, parseWindow, requireParam } from "../src/api/params.js";

describe("requireParam", () => {
  test("returns the trimmed value", () => {
    expect(requireParam("route", " SI381 ")).toBe("SI381");
  });

  test("rejects a missing or blank value, naming the parameter", () => {
    expect(() => requireParam("route", undefined)).toThrow(/route is required/);
    expect(() => requireParam("route", "   ")).toThrow(/route is required/);
    expect(() => requireParam("route", undefined)).toThrow(HttpError);
  });
});

describe("parseDate", () => {
  test("accepts a GTFS service date", () => {
    expect(parseDate("20260812")).toBe("20260812");
  });

  test("defaults to today when absent", () => {
    expect(parseDate(undefined, new Date(2026, 7, 13))).toBe("20260813");
  });

  test("rejects other formats and impossible dates", () => {
    expect(() => parseDate("2026-08-12")).toThrow(/YYYYMMDD/);
    expect(() => parseDate("20260231")).toThrow(/YYYYMMDD/);
  });
});

describe("parseWindow", () => {
  test("parses HH:MM and HH:MM:SS into seconds since service midnight", () => {
    expect(parseWindow("06:00", "07:30:30")).toEqual({
      fromSeconds: 6 * 3600,
      toSeconds: 7 * 3600 + 1830,
    });
  });

  test("accepts times past midnight, which GTFS service days require", () => {
    expect(parseWindow("24:00", "25:10").toSeconds).toBe(25 * 3600 + 600);
  });

  test("covers the whole service day when either bound is omitted", () => {
    expect(parseWindow(undefined, undefined)).toEqual({ fromSeconds: 0, toSeconds: 27 * 3600 });
  });

  test("rejects a malformed time", () => {
    expect(() => parseWindow("6am", undefined)).toThrow(/from/);
    expect(() => parseWindow(undefined, "07:75")).toThrow(/to/);
  });

  test("rejects a window that ends before it starts", () => {
    expect(() => parseWindow("08:00", "07:00")).toThrow(/before/);
  });
});

describe("parseBbox", () => {
  test("parses minLon,minLat,maxLon,maxLat", () => {
    expect(parseBbox("11.0,43.0,12.0,44.0")).toEqual({
      minLon: 11,
      minLat: 43,
      maxLon: 12,
      maxLat: 44,
    });
  });

  test("defaults to the whole region when absent", () => {
    expect(parseBbox(undefined)).toEqual({
      minLat: 42.2,
      maxLat: 44.5,
      minLon: 9.6,
      maxLon: 12.5,
    });
  });

  test("rejects the wrong number of values, non-numbers and out-of-range coordinates", () => {
    expect(() => parseBbox("11.0,43.0,12.0")).toThrow(/bbox/);
    expect(() => parseBbox("a,b,c,d")).toThrow(/bbox/);
    expect(() => parseBbox("11.0,43.0,12.0,91.0")).toThrow(/bbox/);
  });

  test("rejects an inverted box rather than silently returning nothing", () => {
    expect(() => parseBbox("12.0,43.0,11.0,44.0")).toThrow(/min/);
  });
});

describe("parseLimit", () => {
  test("falls back to the default and clamps to the maximum", () => {
    expect(parseLimit(undefined, { fallback: 20, max: 100 })).toBe(20);
    expect(parseLimit("500", { fallback: 20, max: 100 })).toBe(100);
  });

  test("accepts a value inside the range", () => {
    expect(parseLimit("7", { fallback: 20, max: 100 })).toBe(7);
  });

  test("rejects a non-integer or negative limit", () => {
    expect(() => parseLimit("abc", { fallback: 20, max: 100 })).toThrow(/limit/);
    expect(() => parseLimit("-1", { fallback: 20, max: 100 })).toThrow(/limit/);
  });
});
