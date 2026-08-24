import type { Db } from "../db/index.js";
import { logger } from "../logger.js";
import { type TimetableMatch, timetableMatch } from "../query/timetableMatch.js";

export interface TimetableWatchOptions {
  /** Resolved per check: the refresh this triggers swaps the database underneath. */
  readonly db: () => Db;
  /** The trip ids of every bus currently running. */
  readonly liveTripIds: () => readonly string[];
  /** Starts a refresh. Resolves when it has finished, rejects if it failed. */
  readonly refresh: () => Promise<void>;
  /**
   * SHA-1 of the static feed the loaded database was built from, or null if
   * there is no timetable to ask. This is the rearm signal: a refresh that did
   * not help will not help again until the *source* changes.
   */
  readonly feedSha1: () => string | null;
  readonly checkIntervalMs: number;
  /** Minimum gap between two triggered refreshes, however bad the ratio looks. */
  readonly cooldownMs: number;
  readonly maxUnmatchedRatio: number;
  readonly minSample: number;
}

export interface TimetableWatch {
  stop(): void;
  /** Runs one check now. Exposed for tests and for a manual poke. */
  check(nowMs?: number): Promise<boolean>;
  readonly lastTriggeredAtMs: number | null;
  /** The feed SHA-1 this watch has given up on, or null while it is armed. */
  readonly disarmedForSha1: string | null;
}

/**
 * Refreshes the timetable when it stops describing reality, rather than only
 * when a clock says to.
 *
 * The scheduled daily job is a safety net, not a solution: this operator
 * republishes the feed *inside* the validity window it declared, so a timetable
 * can be wrong for a whole day before the timer next looks. Nothing can ask the
 * source whether it republished without downloading 125 MB — no ETag, no
 * Last-Modified, range requests ignored — so the cheap signal does the noticing
 * and the expensive check only runs when there is something to find.
 *
 * A trigger costs a 125 MB download, so it is deliberately hard to provoke: a
 * sample floor, a threshold well clear of normal extra service, and a cooldown
 * that holds even if the ratio keeps looking bad — because if a refresh did not
 * fix it, running it again immediately will not either.
 *
 * **And it gives up, which the cooldown alone did not.** Measured on 2026-08-19:
 * a manual refresh moved the unmatched ratio 0.204 → 0.169 against a 0.10
 * threshold, because trip ids 78000–79999 are broadcast live and absent from the
 * static feed entirely — the operator's two feeds disagree, and no download can
 * reconcile that. A cooldown only slows that loop down: it would have rebuilt
 * the database every hour, for ever, ~2.5 GB of writes each time, and never
 * fixed what it was reacting to. So a refresh that leaves the ratio stale
 * disarms the watch for that feed, and only a feed with a different SHA-1
 * rearms it. The daily timer keeps running either way, and that is what
 * eventually brings a new SHA-1 in.
 */
export function createTimetableWatch(options: TimetableWatchOptions): TimetableWatch {
  let lastTriggeredAtMs: number | null = null;
  let disarmedForSha1: string | null = null;
  let running = false;

  /**
   * How much of the live fleet the loaded timetable can explain, right now.
   *
   * Asked twice per trigger — once to decide, once to find out whether the
   * refresh helped — and both readings have to be taken the same way, or the
   * second would be answering a slightly different question than the first.
   */
  const measure = (): TimetableMatch =>
    timetableMatch(options.db(), options.liveTripIds(), {
      maxUnmatchedRatio: options.maxUnmatchedRatio,
      minSample: options.minSample,
    });

  async function check(nowMs: number = Date.now()): Promise<boolean> {
    // One at a time: a refresh takes minutes and the interval is shorter.
    if (running) return false;

    const match = measure();
    if (!match.stale) return false;

    // Already tried against this exact feed and it did not help. Nothing will
    // change until the operator publishes a different one.
    const sha1BeforeRefresh = options.feedSha1();
    if (disarmedForSha1 !== null && sha1BeforeRefresh === disarmedForSha1) return false;

    if (lastTriggeredAtMs !== null && nowMs - lastTriggeredAtMs < options.cooldownMs) {
      return false;
    }

    running = true;
    lastTriggeredAtMs = nowMs;
    logger.warn("timetable no longer describes the live fleet — refreshing", {
      liveTrips: match.liveTrips,
      unmatched: match.unmatched,
      unmatchedRatio: Number((match.unmatchedRatio ?? 0).toFixed(3)),
    });

    try {
      await options.refresh();
      logger.info("triggered refresh finished");
      recordOutcome();
      return true;
    } catch (error) {
      // The daily timer still runs, and the stale timetable keeps answering:
      // old schedules beat no schedules, and /healthz says which it is.
      logger.error("triggered refresh failed", { error: String(error) });
      return false;
    } finally {
      running = false;
    }
  }

  /**
   * Did the refresh restore the match? Measured again rather than assumed: the
   * refresh may have imported a new feed, imported nothing because the bytes
   * were identical, or imported one that still does not describe these buses.
   * Only the last matters here, and only measuring can tell the three apart.
   */
  function recordOutcome(): void {
    const after = measure();
    if (!after.stale) {
      disarmedForSha1 = null;
      return;
    }

    const sha1 = options.feedSha1();
    if (sha1 === null) return; // Nothing to key the give-up on; the cooldown still holds.
    disarmedForSha1 = sha1;
    logger.warn("refresh did not restore the timetable match — waiting for a new feed", {
      feedSha1: sha1.slice(0, 12),
      unmatched: after.unmatched,
      liveTrips: after.liveTrips,
      unmatchedRatio: Number((after.unmatchedRatio ?? 0).toFixed(3)),
    });
  }

  const timer = setInterval(() => void check(), options.checkIntervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    check,
    get lastTriggeredAtMs() {
      return lastTriggeredAtMs;
    },
    get disarmedForSha1() {
      return disarmedForSha1;
    },
  };
}
