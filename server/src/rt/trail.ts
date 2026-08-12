import { TRAIL_WINDOW_MS } from "../config.js";

export interface TrailPoint {
  readonly lat: number;
  readonly lon: number;
  /** Epoch ms the bus was at this point (its own clock when it reports one). */
  readonly at: number;
}

/**
 * Hard ceiling on stored points. The window alone bounds a healthy vehicle to
 * ~60 points, but a bus jittering at a terminus must not be able to grow the
 * buffer indefinitely — ~1000 buses share this process's memory.
 */
export const MAX_TRAIL_POINTS = 500;

/**
 * The path a bus has travelled, kept in RAM for the last window only.
 *
 * MVP has no persistent history: a trail therefore starts where the backend
 * began watching the run, which the UI states plainly rather than implying the
 * bus appeared from nowhere.
 */
export class TrailBuffer {
  readonly #points: TrailPoint[] = [];
  readonly #windowMs: number;

  constructor(windowMs: number = TRAIL_WINDOW_MS) {
    this.#windowMs = windowMs;
  }

  /**
   * Records a position, ignoring repeats.
   *
   * The feed regenerates every ~120 s while we poll every 30 s, so the same
   * position arrives several times; storing each one would draw a trail of
   * duplicates and expire the window early.
   */
  push(point: TrailPoint, nowMs: number): void {
    const last = this.#points[this.#points.length - 1];
    if (last && last.lat === point.lat && last.lon === point.lon) return;

    this.#points.push(point);
    this.#prune(nowMs);
    if (this.#points.length > MAX_TRAIL_POINTS) {
      this.#points.splice(0, this.#points.length - MAX_TRAIL_POINTS);
    }
  }

  /** A copy — the buffer stays the only thing that can mutate itself. */
  points(nowMs?: number): readonly TrailPoint[] {
    if (nowMs !== undefined) this.#prune(nowMs);
    return [...this.#points];
  }

  get last(): TrailPoint | null {
    return this.#points[this.#points.length - 1] ?? null;
  }

  get size(): number {
    return this.#points.length;
  }

  get isEmpty(): boolean {
    return this.#points.length === 0;
  }

  #prune(nowMs: number): void {
    const cutoff = nowMs - this.#windowMs;
    let keepFrom = 0;
    while (keepFrom < this.#points.length && (this.#points[keepFrom]?.at ?? 0) < cutoff) {
      keepFrom++;
    }
    if (keepFrom > 0) this.#points.splice(0, keepFrom);
  }
}
