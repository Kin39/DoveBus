import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RT_MAX_POLL_MS } from "../src/config.js";
import { createPoller, nextDelayMs } from "../src/rt/poller.js";

describe("nextDelayMs", () => {
  const base = { intervalMs: 30_000, maxUnchangedMs: 60_000, maxErrorMs: RT_MAX_POLL_MS };

  test("polls at the base cadence while the feed keeps producing new snapshots", () => {
    expect(nextDelayMs({ ...base, unchangedStreak: 0, failureStreak: 0 })).toBe(30_000);
  });

  test("eases off while the publisher is still sitting on the same snapshot", () => {
    expect(nextDelayMs({ ...base, unchangedStreak: 1, failureStreak: 0 })).toBe(45_000);
    expect(nextDelayMs({ ...base, unchangedStreak: 2, failureStreak: 0 })).toBe(60_000);
  });

  test("never backs off past half the publisher's cadence", () => {
    expect(nextDelayMs({ ...base, unchangedStreak: 99, failureStreak: 0 })).toBe(60_000);
  });

  test("retries a one-off failure at the normal cadence", () => {
    // The live trip-updates feed drops a connection now and then, and serves the
    // next request immediately — punishing that with a long wait loses data.
    expect(nextDelayMs({ ...base, unchangedStreak: 0, failureStreak: 1 })).toBe(30_000);
  });

  test("backs off exponentially while the source stays down", () => {
    expect(nextDelayMs({ ...base, unchangedStreak: 0, failureStreak: 2 })).toBe(60_000);
    expect(nextDelayMs({ ...base, unchangedStreak: 0, failureStreak: 3 })).toBe(120_000);
    expect(nextDelayMs({ ...base, unchangedStreak: 0, failureStreak: 4 })).toBe(240_000);
  });

  test("caps the failure backoff so a recovered feed is picked up again", () => {
    expect(nextDelayMs({ ...base, unchangedStreak: 0, failureStreak: 20 })).toBe(RT_MAX_POLL_MS);
  });
});

describe("createPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const feed = (headerTimestamps: readonly (number | null)[]) => {
    const calls: string[] = [];
    let index = 0;
    const handled: (number | null)[] = [];
    return {
      calls,
      handled,
      fetchFeed: async (url: string) => {
        calls.push(url);
        return { body: new Uint8Array([index]), bytes: 1, durationMs: 5 };
      },
      handle: (_body: Uint8Array) => {
        const timestamp = headerTimestamps[Math.min(index, headerTimestamps.length - 1)] ?? null;
        index++;
        handled.push(timestamp);
        return { headerTimestamp: timestamp };
      },
    };
  };

  test("polls immediately on start, then on the interval", async () => {
    const source = feed([100, 200, 300]);
    const poller = createPoller({
      name: "vehicle-positions",
      url: "https://feed.test/vp",
      intervalMs: 30_000,
      fetchFeed: source.fetchFeed,
      handle: source.handle,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(source.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(source.calls).toHaveLength(2);

    poller.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(source.calls).toHaveLength(2);
  });

  test("slows down while the snapshot repeats and speeds back up when it changes", async () => {
    const source = feed([100, 100, 100, 400]);
    const poller = createPoller({
      name: "vehicle-positions",
      url: "https://feed.test/vp",
      intervalMs: 30_000,
      fetchFeed: source.fetchFeed,
      handle: source.handle,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.status.nextDelayMs).toBe(30_000);

    await vi.advanceTimersByTimeAsync(30_000); // same header → back off
    expect(poller.status.unchangedStreak).toBe(1);
    expect(poller.status.nextDelayMs).toBe(45_000);

    await vi.advanceTimersByTimeAsync(45_000); // same again
    expect(poller.status.nextDelayMs).toBe(60_000);

    await vi.advanceTimersByTimeAsync(60_000); // new snapshot → back to base
    expect(poller.status.unchangedStreak).toBe(0);
    expect(poller.status.nextDelayMs).toBe(30_000);

    poller.stop();
  });

  test("keeps running after a failed fetch and reports it", async () => {
    const errors: unknown[] = [];
    let attempt = 0;
    const poller = createPoller({
      name: "vehicle-positions",
      url: "https://feed.test/vp",
      intervalMs: 30_000,
      fetchFeed: async () => {
        attempt++;
        if (attempt === 1) throw new Error("HTTP 502");
        return { body: new Uint8Array(), bytes: 0, durationMs: 1 };
      },
      handle: () => ({ headerTimestamp: 100 }),
      onError: (error) => errors.push(error),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    expect(poller.status.failureStreak).toBe(1);
    expect(poller.status.nextDelayMs).toBe(30_000);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(poller.status.failureStreak).toBe(0);
    expect(poller.status.lastSuccessMs).not.toBeNull();

    poller.stop();
  });

  test("treats a decode failure like a fetch failure — the feed is unusable either way", async () => {
    const errors: unknown[] = [];
    const poller = createPoller({
      name: "trip-updates",
      url: "https://feed.test/tu",
      intervalMs: 60_000,
      fetchFeed: async () => ({ body: new Uint8Array(), bytes: 0, durationMs: 1 }),
      handle: () => {
        throw new Error("not a GTFS-RT feed");
      },
      onError: (error) => errors.push(error),
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(errors).toHaveLength(1);
    expect(poller.status.failureStreak).toBe(1);
    poller.stop();
  });

  test("does not start a second loop when started twice", async () => {
    const source = feed([100, 200]);
    const poller = createPoller({
      name: "vehicle-positions",
      url: "https://feed.test/vp",
      intervalMs: 30_000,
      fetchFeed: source.fetchFeed,
      handle: source.handle,
    });

    poller.start();
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(source.calls).toHaveLength(2);
    poller.stop();
  });

  test("reports its health for the health endpoint", async () => {
    const source = feed([100]);
    const poller = createPoller({
      name: "vehicle-positions",
      url: "https://feed.test/vp",
      intervalMs: 30_000,
      fetchFeed: source.fetchFeed,
      handle: source.handle,
    });

    expect(poller.status).toMatchObject({ running: false, polls: 0, lastSuccessMs: null });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(poller.status).toMatchObject({
      name: "vehicle-positions",
      running: true,
      polls: 1,
      failureStreak: 0,
      lastHeaderTimestamp: 100,
    });

    poller.stop();
    expect(poller.status.running).toBe(false);
  });
});
