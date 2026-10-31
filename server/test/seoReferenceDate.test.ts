import { describe, expect, test } from "vitest";
import {
  chooseReferenceDate,
  type DayService,
  lastFullServiceDate,
  weekdayMedian,
} from "../src/seo/referenceDate.js";

/**
 * The 20261031 edition as imported, services per day: a full weekday runs
 * 586–702, Saturday 716, Sunday 227, and the last three days carry 3 each —
 * the edition declares 20261120 but its service really ends on the 17th.
 */
const EDITION_20261031: readonly DayService[] = [
  ["20261031", 716],
  ["20261101", 227],
  ["20261102", 702],
  ["20261103", 639],
  ["20261104", 613],
  ["20261105", 597],
  ["20261106", 586],
  ["20261107", 716],
  ["20261108", 227],
  ["20261109", 702],
  ["20261110", 639],
  ["20261111", 613],
  ["20261112", 597],
  ["20261113", 586],
  ["20261114", 716],
  ["20261115", 227],
  ["20261116", 702],
  ["20261117", 623],
  ["20261118", 3],
  ["20261119", 3],
  ["20261120", 3],
].map(([date, services]) => ({ date: date as string, services: services as number }));

function withServices(overrides: Record<string, number>): readonly DayService[] {
  return EDITION_20261031.map((day) => ({ ...day, services: overrides[day.date] ?? day.services }));
}

describe("weekdayMedian", () => {
  test("is taken over Monday to Friday only, so weekends cannot drag it", () => {
    expect(weekdayMedian(EDITION_20261031)).toBe(613);
  });

  test("is zero for an edition with no weekday", () => {
    expect(weekdayMedian([{ date: "20261101", services: 227 }])).toBe(0);
  });
});

describe("chooseReferenceDate", () => {
  test("on a Saturday, picks the coming Tuesday rather than today", () => {
    expect(chooseReferenceDate(EDITION_20261031, "20261031")).toBe("20261103");
  });

  test("takes today when today is itself a full Tuesday to Thursday", () => {
    expect(chooseReferenceDate(EDITION_20261031, "20261104")).toBe("20261104");
  });

  test("never picks a Monday or a Friday, whose service differs from midweek", () => {
    const picked = chooseReferenceDate(EDITION_20261031, "20261106");
    expect(picked).toBe("20261110");
  });

  test("skips a midweek day with reduced service — a holiday or a patron saint's day", () => {
    // 3 November at Sunday levels, as on a public holiday.
    const holiday = withServices({ "20261103": 230 });
    expect(chooseReferenceDate(holiday, "20261031")).toBe("20261104");
  });

  test("accepts a day just inside 95% of the weekday median and refuses one just outside", () => {
    // Two flat weeks at 100, so changing one day cannot move the median: 95% is 95.
    const flat = (tuesday: number): readonly DayService[] =>
      ["02", "03", "04", "05", "06", "09", "10", "11", "12", "13"].map((day) => ({
        date: `202611${day}`,
        services: day === "03" ? tuesday : 100,
      }));
    expect(chooseReferenceDate(flat(95), "20261102")).toBe("20261103");
    expect(chooseReferenceDate(flat(94), "20261102")).toBe("20261104");
  });

  test("ignores days before today even when they would qualify", () => {
    expect(chooseReferenceDate(EDITION_20261031, "20261113")).toBe("20261117");
  });

  test("throws when no day qualifies, rather than describing a weekend as a weekday", () => {
    expect(() => chooseReferenceDate(EDITION_20261031, "20261118")).toThrow(/no full Tuesday/);
  });

  test("rejects an unreadable today", () => {
    expect(() => chooseReferenceDate(EDITION_20261031, "2026-10-31")).toThrow(/YYYYMMDD/);
  });
});

describe("lastFullServiceDate", () => {
  test("finds where service really ends, not where the edition says it does", () => {
    expect(lastFullServiceDate(EDITION_20261031)).toBe("20261117");
  });

  test("counts a Sunday as service — it is a fifth of a weekday or more", () => {
    const endsOnSunday = EDITION_20261031.filter((day) => day.date <= "20261115");
    expect(lastFullServiceDate(endsOnSunday)).toBe("20261115");
  });

  test("is null for an edition with no service at all", () => {
    expect(lastFullServiceDate([{ date: "20261102", services: 0 }])).toBeNull();
  });
});
