import type { Db } from "../db/index.js";
import { logger } from "../logger.js";
import { timetableMatch } from "../query/timetableMatch.js";

export interface TimetableWatchOptions {
  /** Resolved per check: the refresh this triggers swaps the database underneath. */
  readonly db: () => Db;
  /** The trip ids of every bus currently running. */
  readonly liveTripIds: () => readonly string[];
  /** Starts a refresh. Resolves when it has finished, rejects if it failed. */
  readonly refresh: () => Promise<void>;
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
 */
export function createTimetableWatch(options: TimetableWatchOptions): TimetableWatch {
  let lastTriggeredAtMs: number | null = null;
  let running = false;

  async function check(nowMs: number = Date.now()): Promise<boolean> {
    // One at a time: a refresh takes minutes and the interval is shorter.
    if (running) return false;

    const match = timetableMatch(options.db(), options.liveTripIds(), {
      maxUnmatchedRatio: options.maxUnmatchedRatio,
      minSample: options.minSample,
    });
    if (!match.stale) return false;

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

  const timer = setInterval(() => void check(), options.checkIntervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    check,
    get lastTriggeredAtMs() {
      return lastTriggeredAtMs;
    },
  };
}
