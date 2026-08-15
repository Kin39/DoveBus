import type { ShapePoint } from "../api/types.js";

/** Metres per degree of latitude. Good to ~0.1% over Tuscany, which is far below GPS noise. */
const METRES_PER_DEGREE = 111_320;

export type LngLat = readonly [number, number];

/**
 * How far a fix may sit from its route and still be treated as on it.
 *
 * Beyond this the bus is not driving that shape — a diversion, a depot move, or
 * an RT trip matched to the wrong pattern — and snapping it to the road would
 * place it confidently somewhere it is not.
 */
export const MAX_OFF_ROUTE_M = 250;

export interface Projection {
  /** Metres travelled along the route to reach the closest point on it. */
  readonly distance: number;
  /** That closest point — the position snapped onto the road. */
  readonly point: LngLat;
  /** Metres between the raw fix and the road. Large values mean "not on this route". */
  readonly offRoute: number;
}

/**
 * A trip's planned path, as geometry that can be measured along.
 *
 * This is the piece both of the map's honesty problems needed. A GPS fix arrives
 * roughly every two minutes, which on a moving bus is up to 2.7 km — so joining
 * consecutive fixes with straight lines cuts every corner off the route, and a
 * marker that only moves when a fix lands sits still for two minutes and then
 * jumps. Turning a position into a *distance along the route* fixes both: the
 * travelled path becomes the road itself, and the bus can be advanced along that
 * road between fixes instead of teleporting.
 */
export class RouteGeometry {
  readonly #coords: LngLat[];
  /** Cumulative metres from the start of the route to each vertex. */
  readonly #cumulative: number[];

  constructor(shape: readonly ShapePoint[]) {
    this.#coords = shape.map(([lat, lon]) => [lon, lat] as LngLat);
    this.#cumulative = new Array(this.#coords.length);

    let total = 0;
    for (let i = 0; i < this.#coords.length; i++) {
      if (i > 0) {
        total += metresBetween(this.#coords[i - 1] as LngLat, this.#coords[i] as LngLat);
      }
      this.#cumulative[i] = total;
    }
  }

  get length(): number {
    return this.#cumulative[this.#cumulative.length - 1] ?? 0;
  }

  get usable(): boolean {
    return this.#coords.length >= 2;
  }

  /**
   * Snaps a raw fix onto the route.
   *
   * Linear over the vertices rather than indexed: a Tuscan trip shape is a few
   * thousand points and this runs once per snapshot, not per frame.
   */
  project(lat: number, lon: number): Projection | null {
    if (!this.usable) return null;
    const target: LngLat = [lon, lat];

    let best: Projection | null = null;
    for (let i = 1; i < this.#coords.length; i++) {
      const from = this.#coords[i - 1] as LngLat;
      const to = this.#coords[i] as LngLat;
      const { point, t } = closestPointOnSegment(target, from, to);
      const offRoute = metresBetween(target, point);
      if (best !== null && offRoute >= best.offRoute) continue;

      const base = this.#cumulative[i - 1] ?? 0;
      const segment = (this.#cumulative[i] ?? 0) - base;
      best = { distance: base + segment * t, point, offRoute };
    }
    return best;
  }

  /** The point this many metres along the route, clamped to its two ends. */
  at(distance: number): LngLat | null {
    if (!this.usable) return null;
    const clamped = Math.max(0, Math.min(this.length, distance));
    const index = this.#vertexAtOrBefore(clamped);

    const from = this.#coords[index] as LngLat;
    const to = this.#coords[index + 1];
    if (!to) return from;

    const base = this.#cumulative[index] ?? 0;
    const segment = (this.#cumulative[index + 1] ?? 0) - base;
    const t = segment === 0 ? 0 : (clamped - base) / segment;
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  }

  /**
   * The stretch of route between two distances, as a drawable line.
   *
   * This is what a trail should be: the road the bus actually drove down, not
   * the chords between the handful of moments we happened to hear from it.
   */
  slice(fromDistance: number, toDistance: number): LngLat[] {
    if (!this.usable || toDistance <= fromDistance) return [];
    const start = Math.max(0, fromDistance);
    const end = Math.min(this.length, toDistance);

    const head = this.at(start);
    const tail = this.at(end);
    if (!head || !tail) return [];

    const between = this.#coords.filter((_, index) => {
      const along = this.#cumulative[index] ?? 0;
      return along > start && along < end;
    });
    return [head, ...between, tail];
  }

  #vertexAtOrBefore(distance: number): number {
    let low = 0;
    let high = this.#cumulative.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((this.#cumulative[mid] ?? 0) <= distance) low = mid;
      else high = mid - 1;
    }
    return low;
  }
}

export function metresBetween(a: LngLat, b: LngLat): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * Math.cos(meanLat);
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy) * METRES_PER_DEGREE;
}

/** Closest point on a segment, plus how far along it that point sits (0…1). */
function closestPointOnSegment(
  target: LngLat,
  from: LngLat,
  to: LngLat,
): { point: LngLat; t: number } {
  // Longitude is scaled to metres-equivalent before the dot product, or the
  // projection is skewed by the latitude at which it is taken.
  const scale = Math.cos((from[1] * Math.PI) / 180);
  const vx = (to[0] - from[0]) * scale;
  const vy = to[1] - from[1];
  const wx = (target[0] - from[0]) * scale;
  const wy = target[1] - from[1];

  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) return { point: from, t: 0 };

  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared));
  return { point: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t], t };
}
