import { describe, expect, test } from "vitest";
import { formatDay, parseClock, parseDay, stepClock, stepDay } from "../src/ui/when.js";

describe("parseClock", () => {
  test("reads the way a hour is actually typed", () => {
    expect(parseClock("9:30")).toBe("09:30");
    expect(parseClock("09:30")).toBe("09:30");
    expect(parseClock("930")).toBe("09:30");
    expect(parseClock("0930")).toBe("09:30");
    expect(parseClock("9.30")).toBe("09:30");
    expect(parseClock("9,30")).toBe("09:30");
    expect(parseClock("9 30")).toBe("09:30");
  });

  test("a bare hour is that hour, on the hour", () => {
    expect(parseClock("9")).toBe("09:00");
    expect(parseClock("18")).toBe("18:00");
    expect(parseClock("00")).toBe("00:00");
  });

  test("keeps the day it is given: 24 hours, never a meridiem", () => {
    expect(parseClock("13:45")).toBe("13:45");
    expect(parseClock("23:59")).toBe("23:59");
    expect(parseClock("00:00")).toBe("00:00");
  });

  test("refuses a stray sign rather than reading past it", () => {
    // These used to come back as 05:00: the separator split off an empty token
    // and the filter dropped it, so the field committed a time nobody typed.
    expect(parseClock("-5")).toBeNull();
    expect(parseClock("/5")).toBeNull();
    expect(parseClock("5-")).toBeNull();
    expect(parseClock("--5")).toBeNull();
    expect(parseClock(":30")).toBeNull();
  });

  test("refuses what is not an hour of the day", () => {
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("23:60")).toBeNull();
    expect(parseClock("99")).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(parseClock("   ")).toBeNull();
    expect(parseClock("mezzogiorno")).toBeNull();
    expect(parseClock("1:2:3")).toBeNull();
    expect(parseClock("123456")).toBeNull();
    expect(parseClock("9:30pm")).toBeNull();
  });
});

describe("stepClock", () => {
  test("moves by the minutes it is given", () => {
    expect(stepClock("09:30", 5)).toBe("09:35");
    expect(stepClock("09:30", -5)).toBe("09:25");
    expect(stepClock("09:30", 60)).toBe("10:30");
  });

  test("crosses the hour rather than the minute field", () => {
    expect(stepClock("09:58", 5)).toBe("10:03");
    expect(stepClock("10:02", -5)).toBe("09:57");
  });

  test("stops at the ends of the day instead of wrapping around it", () => {
    // A window that wrapped from 23:58 to 00:03 would select nothing, which is
    // the trap `#applyDefaults` already avoids at midnight.
    expect(stepClock("23:58", 5)).toBe("23:59");
    expect(stepClock("00:02", -5)).toBe("00:00");
  });
});

describe("parseDay", () => {
  const today = new Date(2026, 7, 23);

  test("reads the Italian order, whatever the separator", () => {
    expect(parseDay("23/08/2026", today)).toBe("20260823");
    expect(parseDay("23-08-2026", today)).toBe("20260823");
    expect(parseDay("23.08.2026", today)).toBe("20260823");
    expect(parseDay("23 08 2026", today)).toBe("20260823");
  });

  test("forgives the zeros and the century nobody types", () => {
    expect(parseDay("3/8/2026", today)).toBe("20260803");
    expect(parseDay("23/08/26", today)).toBe("20260823");
    expect(parseDay("23082026", today)).toBe("20260823");
    expect(parseDay("230826", today)).toBe("20260823");
  });

  test("a day without a year means this one", () => {
    expect(parseDay("25/12", today)).toBe("20261225");
  });

  test("refuses days that do not exist", () => {
    expect(parseDay("31/02/2026", today)).toBeNull();
    expect(parseDay("32/01/2026", today)).toBeNull();
    expect(parseDay("23/13/2026", today)).toBeNull();
    expect(parseDay("00/08/2026", today)).toBeNull();
    expect(parseDay("", today)).toBeNull();
    expect(parseDay("domani", today)).toBeNull();
  });

  test("accepts the leap day of a leap year and only then", () => {
    expect(parseDay("29/02/2028", today)).toBe("20280229");
    expect(parseDay("29/02/2026", today)).toBeNull();
  });
});

describe("parseDay, at the edges", () => {
  const today = new Date(2026, 7, 23);

  test("refuses a stray separator at either end", () => {
    expect(parseDay("-23/08/2026", today)).toBeNull();
    expect(parseDay("/23/08/2026", today)).toBeNull();
    expect(parseDay("23/08/2026-", today)).toBeNull();
  });
});

describe("formatDay", () => {
  test("shows the day the way it is read aloud here", () => {
    expect(formatDay("20260823")).toBe("23/08/2026");
    expect(formatDay("20260101")).toBe("01/01/2026");
  });

  test("survives a round trip through the parser", () => {
    const today = new Date(2026, 7, 23);
    expect(parseDay(formatDay("20261231"), today)).toBe("20261231");
  });
});

describe("stepDay", () => {
  test("moves by whole days", () => {
    expect(stepDay("20260823", 1)).toBe("20260824");
    expect(stepDay("20260823", -1)).toBe("20260822");
  });

  test("hands back what is not a day instead of inventing one", () => {
    // `new Date("", NaN, NaN)` lands in December 1899; a field stepping from an
    // empty value would have gone there silently.
    expect(stepDay("", 1)).toBe("");
    expect(stepDay("nonsense", 1)).toBe("nonsense");
    expect(stepDay("2026082", 1)).toBe("2026082");
  });

  test("crosses months and years", () => {
    expect(stepDay("20260831", 1)).toBe("20260901");
    expect(stepDay("20261231", 1)).toBe("20270101");
    expect(stepDay("20260301", -1)).toBe("20260228");
  });
});
