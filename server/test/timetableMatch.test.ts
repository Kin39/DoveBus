import { afterAll, describe, expect, test } from "vitest";
import { timetableMatch } from "../src/query/timetableMatch.js";
import { createFixtureDb, type FixtureDb } from "./helpers/fixtureDb.js";

const OPTIONS = { maxUnmatchedRatio: 0.1, minSample: 3 };

let fixture: FixtureDb | null = null;

async function db() {
  fixture ??= await createFixtureDb();
  return fixture.db;
}

afterAll(async () => {
  await fixture?.dispose();
});

describe("timetableMatch", () => {
  test("counts the live trips the timetable can still explain", async () => {
    const result = timetableMatch(await db(), ["T1", "T1", "GHOST"], OPTIONS);

    // Duplicates are one trip, not two: several buses can carry the same id
    // across a service-date boundary and it is the *trip* being looked up.
    expect(result).toMatchObject({ liveTrips: 2, matched: 1, unmatched: 1 });
  });

  test("flags a timetable that no longer describes the buses on the road", async () => {
    const ghosts = Array.from({ length: 9 }, (_, i) => `GHOST${i}`);
    const result = timetableMatch(await db(), ["T1", ...ghosts], OPTIONS);

    expect(result.unmatchedRatio).toBeCloseTo(0.9, 5);
    expect(result.stale).toBe(true);
  });

  test("stays quiet when almost everything matches", async () => {
    const result = timetableMatch(await db(), ["T1", "T2", "T3"], {
      ...OPTIONS,
      maxUnmatchedRatio: 0.9,
    });

    expect(result.stale).toBe(false);
  });

  /**
   * The 04:00 case: three buses are running and one of them is extra service,
   * which is a third of the fleet and means nothing at all.
   */
  test("withholds a verdict when too few buses are running to read anything into", async () => {
    const result = timetableMatch(await db(), ["GHOST"], { ...OPTIONS, minSample: 50 });

    expect(result.unmatchedRatio).toBeNull();
    expect(result.stale).toBe(false);
    expect(result.unmatched).toBe(1);
  });

  test("handles an idle fleet without dividing by zero", async () => {
    const result = timetableMatch(await db(), [], OPTIONS);

    expect(result).toMatchObject({ liveTrips: 0, matched: 0, unmatched: 0, stale: false });
    expect(result.unmatchedRatio).toBeNull();
  });
});
