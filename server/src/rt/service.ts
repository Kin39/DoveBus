import {
  RT_TRIP_UPDATE_POLL_MS,
  RT_TRIP_UPDATES_URL,
  RT_VEHICLE_POLL_MS,
  RT_VEHICLE_POSITIONS_URL,
} from "../config.js";
import { logger } from "../logger.js";
import { decodeTripUpdates, decodeVehiclePositions } from "./decode.js";
import type { RtFetchResult } from "./fetch.js";
import { createPoller, type Poller, type PollerStatus } from "./poller.js";
import { LiveState, type LiveStats } from "./state.js";

/** A feed unread for this many multiples of its interval counts as down. */
const STALE_POLL_FACTOR = 4;

export interface RealtimeStatus {
  /** False when either feed has not produced a usable snapshot recently. */
  readonly healthy: boolean;
  readonly vehicles: PollerStatus;
  readonly tripUpdates: PollerStatus;
  readonly live: LiveStats;
}

export interface RealtimeServiceOptions {
  readonly state?: LiveState;
  readonly vehicleUrl?: string;
  readonly tripUpdateUrl?: string;
  readonly vehicleIntervalMs?: number;
  readonly tripUpdateIntervalMs?: number;
  /** Injected for tests; defaults to the real HTTP fetch. */
  readonly fetchFeed?: (url: string) => Promise<RtFetchResult>;
}

/** Which feed produced a change — a delay arriving is not a bus having moved. */
export type RealtimeUpdate = "vehicles" | "trip-updates";

export type RealtimeListener = (update: RealtimeUpdate) => void;

export interface RealtimeService {
  readonly state: LiveState;
  start(): void;
  stop(): void;
  /** One poll of each feed, awaited — used by the CLI and by tests. */
  pollOnce(): Promise<void>;
  status(nowMs?: number): RealtimeStatus;
  /**
   * Called after each snapshot is folded into the live state. This is what lets
   * SSE clients be pushed to on the poller's rhythm instead of every connection
   * running its own timer and re-sending an unchanged position.
   */
  subscribe(listener: RealtimeListener): () => void;
}

/**
 * The realtime half of the backend: two pollers feeding one in-memory picture of
 * where every bus is, how late it is, and where it has just been.
 *
 * The feeds are kept independent on purpose — delays going missing is a much
 * smaller failure than positions going missing, and must not cause it.
 */
export function createRealtimeService(options: RealtimeServiceOptions = {}): RealtimeService {
  const state = options.state ?? new LiveState();
  const vehicleIntervalMs = options.vehicleIntervalMs ?? RT_VEHICLE_POLL_MS;
  const tripUpdateIntervalMs = options.tripUpdateIntervalMs ?? RT_TRIP_UPDATE_POLL_MS;
  const listeners = new Set<RealtimeListener>();

  /** One listener throwing must not cost the others their notification, or the poll its loop. */
  function notify(update: RealtimeUpdate): void {
    for (const listener of listeners) {
      try {
        listener(update);
      } catch (error) {
        logger.warn("realtime listener failed", { update, error: String(error) });
      }
    }
  }

  const vehicles = createPoller({
    name: "vehicle-positions",
    url: options.vehicleUrl ?? RT_VEHICLE_POSITIONS_URL,
    intervalMs: vehicleIntervalMs,
    ...(options.fetchFeed ? { fetchFeed: options.fetchFeed } : {}),
    handle: (body, receivedAtMs) => {
      const snapshot = decodeVehiclePositions(body);
      state.applyVehicles(snapshot, receivedAtMs);
      notify("vehicles");
      return { headerTimestamp: snapshot.headerTimestamp };
    },
    onError: (error, failureStreak) =>
      logger.warn("vehicle-positions poll failed", { error: String(error), failureStreak }),
  });

  const tripUpdates = createPoller({
    name: "trip-updates",
    url: options.tripUpdateUrl ?? RT_TRIP_UPDATES_URL,
    intervalMs: tripUpdateIntervalMs,
    ...(options.fetchFeed ? { fetchFeed: options.fetchFeed } : {}),
    handle: (body, receivedAtMs) => {
      const snapshot = decodeTripUpdates(body);
      state.applyTripUpdates(snapshot, receivedAtMs);
      notify("trip-updates");
      return { headerTimestamp: snapshot.headerTimestamp };
    },
    onError: (error, failureStreak) =>
      logger.warn("trip-updates poll failed", { error: String(error), failureStreak }),
  });

  return {
    state,
    start(): void {
      vehicles.start();
      tripUpdates.start();
    },
    stop(): void {
      vehicles.stop();
      tripUpdates.stop();
    },
    async pollOnce(): Promise<void> {
      await Promise.all([vehicles.poll(), tripUpdates.poll()]);
    },
    subscribe(listener: RealtimeListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    status(nowMs: number = Date.now()): RealtimeStatus {
      return {
        healthy:
          isFresh(vehicles, vehicleIntervalMs, nowMs) &&
          isFresh(tripUpdates, tripUpdateIntervalMs, nowMs),
        vehicles: vehicles.status,
        tripUpdates: tripUpdates.status,
        live: state.stats(nowMs),
      };
    },
  };
}

function isFresh(poller: Poller, intervalMs: number, nowMs: number): boolean {
  const lastSuccessMs = poller.status.lastSuccessMs;
  return lastSuccessMs !== null && nowMs - lastSuccessMs <= intervalMs * STALE_POLL_FACTOR;
}
