import { MAX_VISIBLE_AGE_S } from "../ui/format.js";
import type { LngLat, RouteGeometry } from "./route.js";
import { MAX_OFF_ROUTE_M, metresBetween } from "./route.js";

/** One position the bus actually reported, with the bus's own clock on it. */
export interface Fix {
  readonly lon: number;
  readonly lat: number;
  /** Seconds since epoch. */
  readonly at: number;
}

export interface Estimate {
  readonly point: LngLat;
  /**
   * Seconds since the fix this was extrapolated from. Zero means "this is
   * measured". Reported in full even when the advance stopped being extended —
   * the age is a fact, and only the guess is bounded.
   */
  readonly elapsed: number;
  /** Metres the marker has been advanced past the last known position. */
  readonly advanced: number;
  /** Radius, in metres, of where the bus plausibly is. Zero when nothing was guessed. */
  readonly uncertainty: number;
}

/**
 * Nothing on this feed exceeds this, and a pair of fixes that implies more is a
 * GPS glitch rather than a bus — extrapolating from it would fling the marker
 * across the province.
 */
const MAX_SPEED_MS = 30;

/**
 * How fast the guess loses its worth.
 *
 * Uncertainty is expressed as a fraction of the distance that was *invented*:
 * a bus standing at a terminus is exactly where we last saw it however long ago
 * that was, while a bus we have advanced 1.5 km down a road on the strength of
 * its previous two fixes could easily be several hundred metres from there. It
 * grows with what we assumed, not merely with the clock.
 */
const UNCERTAINTY_RATIO = 0.55;

/**
 * Where the bus probably is now, given the last two things it told us.
 *
 * The feed publishes roughly every two minutes, so a marker that only moves when
 * a fix lands is stationary for most of its life and then jumps — which reads as
 * a broken map rather than as an honest one. This advances the marker at the
 * speed the bus was last observed travelling, and reports how much of the result
 * was assumed so the interface can show that rather than hide it.
 *
 * With a `route` the advance follows the road; without one it continues along
 * the last heading, which is the best that can be done for a bus whose trip is
 * not in the timetable.
 */
export function estimate(
  previous: Fix | null,
  latest: Fix,
  nowSeconds: number,
  route?: RouteGeometry | null,
): Estimate {
  const elapsed = Math.max(0, nowSeconds - latest.at);
  /**
   * The guess stops being extended at the age where an ordinary bus would have
   * left the map entirely.
   *
   * The followed bus is deliberately exempt from that cutoff — vanishing while a
   * rider watches is the worst possible moment to disappear — but exempting it
   * from *hiding* must not exempt it from *honesty*. Left unbounded, a selected
   * bus that went silent drifted 58.7 km in an hour and the interface announced
   * the number. Past this point the marker holds its last estimate and the
   * meter, which never stops counting, carries the truth.
   */
  const guessed = Math.min(elapsed, MAX_VISIBLE_AGE_S);
  const still: Estimate = {
    point: [latest.lon, latest.lat],
    elapsed,
    advanced: 0,
    uncertainty: 0,
  };

  if (!previous || previous.at >= latest.at) return still;
  const interval = latest.at - previous.at;

  if (route?.usable) {
    const from = route.project(previous.lat, previous.lon);
    const to = route.project(latest.lat, latest.lon);
    if (from && to && to.offRoute <= MAX_OFF_ROUTE_M && from.offRoute <= MAX_OFF_ROUTE_M) {
      // A bus that projects far from its own route is not on it — a depot
      // detour, a diversion, or the wrong trip matched. Guessing along a road it
      // is not driving would be worse than not guessing at all.
      const speed = clampSpeed((to.distance - from.distance) / interval);
      const advanced = speed * guessed;
      const point = route.at(to.distance + advanced);
      if (point) {
        return { point, elapsed, advanced, uncertainty: Math.abs(advanced) * UNCERTAINTY_RATIO };
      }
    }
    return still;
  }

  const travelled = metresBetween([previous.lon, previous.lat], [latest.lon, latest.lat]);
  const speed = clampSpeed(travelled / interval);
  if (speed === 0) return still;

  // Continue along the last heading. Straight-line dead reckoning is crude, but
  // over one publisher cycle it is closer to the truth than a marker frozen two
  // minutes in the past.
  const ratio = (speed * guessed) / travelled;
  const point: LngLat = [
    latest.lon + (latest.lon - previous.lon) * ratio,
    latest.lat + (latest.lat - previous.lat) * ratio,
  ];
  const advanced = speed * guessed;
  return { point, elapsed, advanced, uncertainty: advanced * UNCERTAINTY_RATIO };
}

function clampSpeed(metresPerSecond: number): number {
  if (!Number.isFinite(metresPerSecond)) return 0;
  return Math.max(-MAX_SPEED_MS, Math.min(MAX_SPEED_MS, metresPerSecond));
}
