import { FRESHNESS_DELAYED_S, FRESHNESS_LIVE_S, FRESHNESS_RECENT_S } from "../config.js";

/**
 * How old the position on screen is. Reported rather than hidden: the feed
 * regenerates about every 120 s, so "recent" is the normal state of a healthy
 * bus and pretending otherwise would be dishonest.
 */
export type FreshnessBucket = "live" | "recent" | "delayed" | "stale";

export interface Freshness {
  /** Null when the vehicle sent no timestamp at all. */
  readonly ageSeconds: number | null;
  readonly bucket: FreshnessBucket;
}

export function freshnessBucket(ageSeconds: number): FreshnessBucket {
  if (ageSeconds <= FRESHNESS_LIVE_S) return "live";
  if (ageSeconds <= FRESHNESS_RECENT_S) return "recent";
  if (ageSeconds <= FRESHNESS_DELAYED_S) return "delayed";
  return "stale";
}

/**
 * Age of a vehicle timestamp (seconds since epoch) at wall-clock `nowMs`.
 *
 * Clamped at zero: some vehicle clocks run slightly ahead of ours, and a
 * negative age would read as "from the future" in the UI.
 */
export function ageSeconds(nowMs: number, vehicleTimestamp: number | null): number | null {
  if (vehicleTimestamp === null) return null;
  return Math.max(0, Math.floor(nowMs / 1000) - vehicleTimestamp);
}

/** A missing timestamp counts as stale — we cannot vouch for a position we cannot date. */
export function freshness(nowMs: number, vehicleTimestamp: number | null): Freshness {
  const age = ageSeconds(nowMs, vehicleTimestamp);
  return { ageSeconds: age, bucket: age === null ? "stale" : freshnessBucket(age) };
}
