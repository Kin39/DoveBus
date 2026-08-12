import { RT_MAX_POLL_MS } from "../config.js";
import { fetchRtFeed, type RtFetchResult } from "./fetch.js";

/**
 * How far the unchanged-snapshot backoff may stretch, as a multiple of the base
 * interval. The base interval is already set to about a quarter of the
 * publisher's cadence, so doubling it still keeps us ahead of the next refresh.
 */
const UNCHANGED_BACKOFF_CAP = 2;

/** Growth per consecutive unchanged snapshot, as a fraction of the base interval. */
const UNCHANGED_BACKOFF_STEP = 0.5;

export interface PollOutcome {
  /** Feed header timestamp — how the poller tells a new snapshot from a repeat. */
  readonly headerTimestamp: number | null;
}

export interface PollerStatus {
  readonly name: string;
  readonly running: boolean;
  readonly polls: number;
  readonly failures: number;
  readonly failureStreak: number;
  readonly unchangedStreak: number;
  readonly lastSuccessMs: number | null;
  readonly lastErrorMs: number | null;
  readonly lastError: string | null;
  readonly lastHeaderTimestamp: number | null;
  readonly lastDurationMs: number | null;
  readonly lastBytes: number | null;
  /** Delay before the next poll, after backoff. */
  readonly nextDelayMs: number;
}

export interface PollerOptions {
  readonly name: string;
  readonly url: string;
  readonly intervalMs: number;
  /** Handles the snapshot body; returning the header timestamp drives the backoff. */
  readonly handle: (body: Uint8Array, receivedAtMs: number) => PollOutcome;
  readonly fetchFeed?: (url: string) => Promise<RtFetchResult>;
  readonly onError?: (error: unknown, failureStreak: number) => void;
  readonly onPoll?: (status: PollerStatus) => void;
  readonly maxUnchangedMs?: number;
  readonly maxErrorMs?: number;
}

export interface Poller {
  start(): void;
  stop(): void;
  /** Runs one poll now; the loop uses it, tests and the CLI can too. */
  poll(): Promise<void>;
  readonly status: PollerStatus;
}

export interface BackoffState {
  readonly intervalMs: number;
  readonly maxUnchangedMs: number;
  readonly maxErrorMs: number;
  readonly unchangedStreak: number;
  readonly failureStreak: number;
}

/**
 * Next poll delay.
 *
 * A repeated snapshot means the publisher has not regenerated the feed yet, so
 * polling harder buys nothing; a failing source deserves real exponential
 * backoff, capped so a recovered feed is picked up again within a few minutes.
 */
export function nextDelayMs(state: BackoffState): number {
  if (state.failureStreak > 0) {
    // The first failure costs nothing extra: this source drops a connection now
    // and then and serves the very next request in under a second.
    return Math.min(state.intervalMs * 2 ** (state.failureStreak - 1), state.maxErrorMs);
  }
  const eased = state.intervalMs * (1 + state.unchangedStreak * UNCHANGED_BACKOFF_STEP);
  return Math.min(eased, state.maxUnchangedMs);
}

/**
 * The only thing in the system that talks to the realtime source.
 *
 * One loop per feed, in one process: clients read the shared state instead of
 * reaching upstream, which is what keeps us a well-behaved consumer of a public
 * feed that regenerates roughly every two minutes.
 */
export function createPoller(options: PollerOptions): Poller {
  const fetchFeed = options.fetchFeed ?? fetchRtFeed;
  const maxUnchangedMs = options.maxUnchangedMs ?? options.intervalMs * UNCHANGED_BACKOFF_CAP;
  const maxErrorMs = options.maxErrorMs ?? RT_MAX_POLL_MS;

  let running = false;
  let timer: NodeJS.Timeout | null = null;
  let polls = 0;
  let failures = 0;
  let failureStreak = 0;
  let unchangedStreak = 0;
  let lastSuccessMs: number | null = null;
  let lastErrorMs: number | null = null;
  let lastError: string | null = null;
  let lastHeaderTimestamp: number | null = null;
  let lastDurationMs: number | null = null;
  let lastBytes: number | null = null;

  const status = (): PollerStatus => ({
    name: options.name,
    running,
    polls,
    failures,
    failureStreak,
    unchangedStreak,
    lastSuccessMs,
    lastErrorMs,
    lastError,
    lastHeaderTimestamp,
    lastDurationMs,
    lastBytes,
    nextDelayMs: nextDelayMs({
      intervalMs: options.intervalMs,
      maxUnchangedMs,
      maxErrorMs,
      unchangedStreak,
      failureStreak,
    }),
  });

  async function poll(): Promise<void> {
    polls++;
    try {
      const fetched = await fetchFeed(options.url);
      const receivedAtMs = Date.now();
      const outcome = options.handle(fetched.body, receivedAtMs);

      const repeated =
        outcome.headerTimestamp !== null && outcome.headerTimestamp === lastHeaderTimestamp;
      unchangedStreak = repeated ? unchangedStreak + 1 : 0;
      lastHeaderTimestamp = outcome.headerTimestamp;
      lastDurationMs = fetched.durationMs;
      lastBytes = fetched.bytes;
      lastSuccessMs = receivedAtMs;
      failureStreak = 0;
    } catch (error) {
      // A bad gateway, a timeout and a corrupt body are the same thing to the
      // loop: no usable snapshot this time. Keep the last good state on screen.
      failures++;
      failureStreak++;
      lastErrorMs = Date.now();
      lastError = String(error);
      options.onError?.(error, failureStreak);
    }
    options.onPoll?.(status());
  }

  function scheduleNext(): void {
    if (!running) return;
    timer = setTimeout(() => {
      void poll().finally(scheduleNext);
    }, status().nextDelayMs);
    // Never hold the process open on our account — shutdown is the caller's call.
    timer.unref?.();
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      void poll().finally(scheduleNext);
    },
    stop(): void {
      running = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    poll,
    get status(): PollerStatus {
      return status();
    },
  };
}
