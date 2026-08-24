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
    feedSha1: () => "feed-sha1-unchanged",
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
   * Each trigger is a 125 MB download and a ~2.5 GB rebuild. If a refresh did not
   * fix the match rate the cause is upstream — measured: the operator broadcasts
   * live trip ids its own static feed does not contain — and no number of
   * retries reconciles two feeds that disagree.
   */
  test("stops asking once a refresh has failed to fix the ratio", async () => {
    let calls = 0;
    const watch = await watchFor(
      () => STALE_FLEET,
      async () => {
        calls++;
      },
    );

    await watch.check(NOW);
    expect(calls).toBe(1);

    await watch.check(NOW + 5 * 60_000);
    await watch.check(NOW + 30 * 60_000);
    // Long past the cooldown, which on its own would have downloaded 125 MB
    // every hour for ever without ever changing the answer.
    await watch.check(NOW + HOUR + 1);
    await watch.check(NOW + 24 * HOUR);
    expect(calls).toBe(1);
    expect(watch.disarmedForSha1).toBe("feed-sha1-unchanged");
    watch.stop();
  });

  test("tries again as soon as the operator publishes a different feed", async () => {
    let calls = 0;
    let sha1 = "feed-sha1-first";
    const watch = await watchFor(
      () => STALE_FLEET,
      async () => {
        calls++;
      },
      { feedSha1: () => sha1 },
    );

    await watch.check(NOW);
    await watch.check(NOW + 2 * HOUR);
    expect(calls).toBe(1);

    // What the daily timer eventually brings in — a new feed is a new question.
    sha1 = "feed-sha1-second";
    expect(await watch.check(NOW + 3 * HOUR)).toBe(true);
    expect(calls).toBe(2);
    watch.stop();
  });

  test("keeps the cooldown for a refresh that stays hopeful", async () => {
    // A refresh that *does* restore the match must leave the watch armed, or one
    // good outcome would silence it until the next publication.
    let calls = 0;
    let fleet: readonly string[] = STALE_FLEET;
    const watch = await watchFor(
      () => fleet,
      async () => {
        calls++;
        fleet = ["T1", "T2"]; // Both in the fixture timetable: nothing unmatched.
      },
      { minSample: 2 },
    );

    expect(await watch.check(NOW)).toBe(true);
    expect(watch.disarmedForSha1).toBeNull();

    fleet = STALE_FLEET;
    await watch.check(NOW + 5 * 60_000);
    expect(calls).toBe(1); // Held by the cooldown, not by having given up.
    expect(await watch.check(NOW + HOUR + 1)).toBe(true);
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
