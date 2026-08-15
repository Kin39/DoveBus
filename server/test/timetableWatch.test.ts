import { afterAll, describe, expect, test } from "vitest";
import { createTimetableWatch, type TimetableWatchOptions } from "../src/feed/watch.js";
import { createFixtureDb, type FixtureDb } from "./helpers/fixtureDb.js";

const HOUR = 3_600_000;
const NOW = 1_760_000_000_000;

/** Nine trips the timetable has never heard of, against one it has. */
const STALE_FLEET = ["T1", ...Array.from({ length: 9 }, (_, i) => `GHOST${i}`)];

let fixture: FixtureDb | null = null;

async function watchFor(
  liveTripIds: () => readonly string[],
  refresh: () => Promise<void>,
  overrides: Partial<TimetableWatchOptions> = {},
) {
  fixture ??= await createFixtureDb();
  const db = fixture.db;
  return createTimetableWatch({
    db: () => db,
    liveTripIds,
    refresh,
    // Long enough that only the explicit `check()` calls in these tests fire.
    checkIntervalMs: HOUR,
    cooldownMs: HOUR,
    maxUnmatchedRatio: 0.1,
    minSample: 3,
    ...overrides,
  });
}

afterAll(async () => {
  await fixture?.dispose();
});

describe("createTimetableWatch", () => {
  test("refreshes when the timetable stops describing the live fleet", async () => {
    let calls = 0;
    const watch = await watchFor(
      () => STALE_FLEET,
      async () => {
        calls++;
      },
    );

    expect(await watch.check(NOW)).toBe(true);
    expect(calls).toBe(1);
    watch.stop();
  });

  test("leaves a healthy timetable alone", async () => {
    let calls = 0;
    const watch = await watchFor(
      () => ["T1", "T2", "T3"],
      async () => {
        calls++;
      },
      { maxUnmatchedRatio: 0.9 },
    );

    expect(await watch.check(NOW)).toBe(false);
    expect(calls).toBe(0);
    watch.stop();
  });

  /**
   * Each trigger is a 125 MB download. If a refresh did not fix the match rate
   * the cause is upstream, and running it again in five minutes will not help.
   */
  test("holds the cooldown even while the ratio still looks bad", async () => {
    let calls = 0;
    const watch = await watchFor(
      () => STALE_FLEET,
      async () => {
        calls++;
      },
    );

    await watch.check(NOW);
    await watch.check(NOW + 5 * 60_000);
    await watch.check(NOW + 30 * 60_000);
    expect(calls).toBe(1);

    await watch.check(NOW + HOUR + 1);
    expect(calls).toBe(2);
    watch.stop();
  });

  test("does not start a second refresh while one is still running", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const watch = await watchFor(
      () => STALE_FLEET,
      () => {
        calls++;
        return new Promise<void>((resolveRun) => {
          release = resolveRun;
        });
      },
    );

    const first = watch.check(NOW);
    // A refresh takes minutes and the check interval is shorter, so this
    // overlap is the normal case rather than an edge one.
    expect(await watch.check(NOW + HOUR * 2)).toBe(false);
    expect(calls).toBe(1);

    release();
    await first;
    watch.stop();
  });

  test("survives a failed refresh and reports it as not having fixed anything", async () => {
    const watch = await watchFor(
      () => STALE_FLEET,
      async () => {
        throw new Error("download failed");
      },
    );

    // The stale timetable keeps answering: old schedules beat no schedules, and
    // the daily timer is still there.
    expect(await watch.check(NOW)).toBe(false);
    expect(watch.lastTriggeredAtMs).toBe(NOW);
    watch.stop();
  });

  test("says nothing when too few buses are running to judge", async () => {
    let calls = 0;
    const watch = await watchFor(
      () => ["GHOST"],
      async () => {
        calls++;
      },
      { minSample: 50 },
    );

    expect(await watch.check(NOW)).toBe(false);
    expect(calls).toBe(0);
    watch.stop();
  });
});
