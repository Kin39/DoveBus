import { TRAIL_WINDOW_MS, VEHICLE_TTL_MS } from "../config.js";
import type { Bbox } from "../geo/bbox.js";
import { isInsideBbox } from "../geo/bbox.js";
import {
  delayAtStopSequence,
  type RtTripUpdate,
  type RtVehicle,
  type TripScheduleRelationship,
  type TripUpdateSnapshot,
  type VehicleSnapshot,
} from "./decode.js";
import { type Freshness, freshness } from "./freshness.js";
import { TrailBuffer, type TrailPoint } from "./trail.js";

/** A position from the feed, plus whatever `trip-updates` had to say about the run. */
export interface LiveVehicle extends RtVehicle {
  readonly key: string;
  /** Wall-clock ms this process last saw the vehicle in a snapshot. */
  readonly receivedAt: number;
  readonly delaySeconds: number | null;
  readonly scheduleRelationship: TripScheduleRelationship | null;
}

export interface LiveVehicleView {
  readonly vehicle: LiveVehicle;
  readonly freshness: Freshness;
  readonly trail: readonly TrailPoint[];
}

export interface VehicleApplyResult {
  readonly tracked: number;
  readonly added: number;
  readonly updated: number;
  /** Positioned entities that identified neither a trip nor a vehicle. */
  readonly dropped: number;
  readonly expired: number;
}

export interface TripUpdateApplyResult {
  readonly updates: number;
  /** Updates that landed on a bus we are currently tracking. */
  readonly matched: number;
  readonly expired: number;
}

export interface LiveStats {
  readonly vehicles: number;
  readonly withTrip: number;
  readonly withDelay: number;
  readonly tripUpdates: number;
  readonly byFreshness: Record<Freshness["bucket"], number>;
  readonly lastVehicleUpdateMs: number | null;
  readonly lastTripUpdateMs: number | null;
}

interface VehicleIdentity {
  readonly tripId: string | null;
  readonly startDate: string | null;
  readonly vehicleId: string | null;
}

/**
 * Identity of a run: the trip and the service date it belongs to, since the same
 * trip_id runs again tomorrow. Buses without an assigned trip (deadheading) are
 * still worth showing, keyed on the vehicle itself.
 */
export function vehicleKey(identity: VehicleIdentity): string | null {
  if (identity.tripId) return `trip:${identity.tripId}|${identity.startDate ?? ""}`;
  if (identity.vehicleId) return `vehicle:${identity.vehicleId}`;
  return null;
}

interface StoredTripUpdate {
  readonly update: RtTripUpdate;
  readonly receivedAt: number;
}

/**
 * Everything the API serves about buses right now, held in memory by the single
 * poller process. Clients never reach the upstream feed; they read this.
 */
export class LiveState {
  readonly #vehicles = new Map<string, LiveVehicle>();
  readonly #trails = new Map<string, TrailBuffer>();
  readonly #tripUpdates = new Map<string, StoredTripUpdate>();
  /**
   * Trip-id-only indexes, for the runs where the two feeds disagree about the
   * service date (or omit it). Without them every unmatched entity would scan
   * the whole opposite side, ~1000 × ~1400 times per poll.
   */
  readonly #vehicleKeysByTrip = new Map<string, string>();
  readonly #tripUpdatesByTrip = new Map<string, StoredTripUpdate>();
  /** Physical bus → the key it is currently tracked under. Keeps one bus to one marker. */
  readonly #keysByVehicleId = new Map<string, string>();
  readonly #vehicleTtlMs: number;
  readonly #trailWindowMs: number;
  #lastVehicleUpdateMs: number | null = null;
  #lastTripUpdateMs: number | null = null;

  constructor(options: { readonly vehicleTtlMs?: number; readonly trailWindowMs?: number } = {}) {
    this.#vehicleTtlMs = options.vehicleTtlMs ?? VEHICLE_TTL_MS;
    this.#trailWindowMs = options.trailWindowMs ?? TRAIL_WINDOW_MS;
  }

  /** Replaces the live picture with a fresh full snapshot. */
  applyVehicles(snapshot: VehicleSnapshot, nowMs: number): VehicleApplyResult {
    let added = 0;
    let updated = 0;
    let dropped = 0;

    for (const vehicle of snapshot.vehicles) {
      const key = vehicleKey(vehicle);
      if (key === null) {
        dropped++;
        continue;
      }

      // A bus changes key when it takes up a run (vehicle:… → trip:…) or finishes
      // one. Without dropping the entry it held before, the same physical bus
      // would sit on the map twice — once live, once frozen where it was when it
      // changed — until the old entry timed out.
      if (vehicle.vehicleId) {
        const previousKey = this.#keysByVehicleId.get(vehicle.vehicleId);
        // Only reclaim the old entry if it is still this same bus: two vehicles
        // can briefly report the same trip (a relief bus), and dropping the
        // other one's live position would make it blink off the map.
        if (previousKey !== undefined && previousKey !== key) {
          if (this.#vehicles.get(previousKey)?.vehicleId === vehicle.vehicleId) {
            this.#forget(previousKey);
          }
        }
        this.#keysByVehicleId.set(vehicle.vehicleId, key);
      }

      const previous = this.#vehicles.get(key);
      if (previous) updated++;
      else added++;

      const carried = this.#tripUpdates.get(key) ?? this.#tripUpdateByTrip(vehicle.tripId);
      this.#vehicles.set(key, {
        ...vehicle,
        key,
        receivedAt: nowMs,
        delaySeconds: carried
          ? delayAtStopSequence(carried.update, vehicle.currentStopSequence)
          : null,
        scheduleRelationship: carried?.update.scheduleRelationship ?? null,
      });
      this.#trailFor(key).push(
        { lat: vehicle.lat, lon: vehicle.lon, at: positionTime(vehicle, nowMs) },
        nowMs,
      );
      if (vehicle.tripId) this.#vehicleKeysByTrip.set(vehicle.tripId, key);
    }

    this.#lastVehicleUpdateMs = nowMs;
    const expired = this.#expire(nowMs);
    return { tracked: added + updated, added, updated, dropped, expired };
  }

  /** Folds delays and cancellations onto the buses already being tracked. */
  applyTripUpdates(snapshot: TripUpdateSnapshot, nowMs: number): TripUpdateApplyResult {
    let matched = 0;

    for (const update of snapshot.updates) {
      const key = vehicleKey({
        tripId: update.tripId,
        startDate: update.startDate,
        vehicleId: null,
      });
      if (key === null) continue;
      const stored = { update, receivedAt: nowMs };
      this.#tripUpdates.set(key, stored);
      this.#tripUpdatesByTrip.set(update.tripId, stored);

      const vehicle = this.#vehicles.get(key) ?? this.#vehicleByTrip(update.tripId);
      if (!vehicle) continue;
      matched++;
      this.#vehicles.set(vehicle.key, {
        ...vehicle,
        delaySeconds: delayAtStopSequence(update, vehicle.currentStopSequence),
        scheduleRelationship: update.scheduleRelationship,
      });
    }

    this.#lastTripUpdateMs = nowMs;
    const expired = this.#expire(nowMs);
    return { updates: snapshot.updates.length, matched, expired };
  }

  get size(): number {
    return this.#vehicles.size;
  }

  get(key: string): LiveVehicle | null {
    return this.#vehicles.get(key) ?? null;
  }

  /** For callers holding a scheduled trip but not the service date it is running on. */
  findByTrip(tripId: string, startDate?: string): LiveVehicle | null {
    if (startDate !== undefined) return this.get(`trip:${tripId}|${startDate}`);
    return this.#vehicleByTrip(tripId);
  }

  list(): readonly LiveVehicle[] {
    return [...this.#vehicles.values()];
  }

  /**
   * What the map asks for: only the buses actually in the viewport.
   *
   * Reads never expire anything — every poll already sweeps, and a GET that
   * quietly deletes state is a poor thing to build an API on. If the poller
   * stops, vehicles stay put and age visibly instead of the map emptying itself.
   */
  listInBbox(bbox: Bbox): readonly LiveVehicle[] {
    return this.list().filter((vehicle) => isInsideBbox(vehicle.lat, vehicle.lon, bbox));
  }

  trail(key: string): readonly TrailPoint[] {
    return this.#trails.get(key)?.points() ?? [];
  }

  /**
   * The position a vehicle reported before its current one.
   *
   * Served alongside the current position so a client can estimate where a bus
   * is *now* from its first response, rather than having to sit through a
   * publisher cycle — about two minutes — before it has two fixes of its own to
   * measure a speed between.
   */
  previousFix(key: string): TrailPoint | null {
    return this.#trails.get(key)?.previous ?? null;
  }

  /** Position + honest age + travelled path: everything the live view needs. */
  describe(key: string, nowMs: number): LiveVehicleView | null {
    const vehicle = this.get(key);
    if (!vehicle) return null;
    return {
      vehicle,
      freshness: freshness(nowMs, vehicle.timestamp),
      trail: this.trail(key),
    };
  }

  stats(nowMs: number): LiveStats {
    const byFreshness: Record<Freshness["bucket"], number> = {
      live: 0,
      recent: 0,
      delayed: 0,
      stale: 0,
    };
    let withTrip = 0;
    let withDelay = 0;

    for (const vehicle of this.#vehicles.values()) {
      byFreshness[freshness(nowMs, vehicle.timestamp).bucket]++;
      if (vehicle.tripId) withTrip++;
      if (vehicle.delaySeconds !== null) withDelay++;
    }

    return {
      vehicles: this.#vehicles.size,
      withTrip,
      withDelay,
      tripUpdates: this.#tripUpdates.size,
      byFreshness,
      lastVehicleUpdateMs: this.#lastVehicleUpdateMs,
      lastTripUpdateMs: this.#lastTripUpdateMs,
    };
  }

  #trailFor(key: string): TrailBuffer {
    const existing = this.#trails.get(key);
    if (existing) return existing;
    const created = new TrailBuffer(this.#trailWindowMs);
    this.#trails.set(key, created);
    return created;
  }

  /** A trip-update whose service date we do not know, matched on trip id alone. */
  #tripUpdateByTrip(tripId: string | null): StoredTripUpdate | null {
    if (!tripId) return null;
    return this.#tripUpdatesByTrip.get(tripId) ?? null;
  }

  #vehicleByTrip(tripId: string | null): LiveVehicle | null {
    if (!tripId) return null;
    const key = this.#vehicleKeysByTrip.get(tripId);
    return key === undefined ? null : (this.#vehicles.get(key) ?? null);
  }

  /**
   * Buses vanish from the feed when their run ends; without this the map would
   * accumulate ghosts and the process would leak a trail buffer per run, all day.
   */
  /** Drops a run and everything indexed under it, leaving no dangling pointers. */
  #forget(key: string): void {
    const vehicle = this.#vehicles.get(key);
    this.#vehicles.delete(key);
    this.#trails.delete(key);
    if (!vehicle) return;

    // Only drop an index entry if it still points at this run: the same trip_id
    // (or bus) may already have been re-registered under a newer key.
    if (vehicle.tripId && this.#vehicleKeysByTrip.get(vehicle.tripId) === key) {
      this.#vehicleKeysByTrip.delete(vehicle.tripId);
    }
    if (vehicle.vehicleId && this.#keysByVehicleId.get(vehicle.vehicleId) === key) {
      this.#keysByVehicleId.delete(vehicle.vehicleId);
    }
  }

  #expire(nowMs: number): number {
    const cutoff = nowMs - this.#vehicleTtlMs;
    let expired = 0;

    for (const [key, vehicle] of this.#vehicles) {
      if (vehicle.receivedAt >= cutoff) continue;
      this.#forget(key);
      expired++;
    }
    for (const [key, stored] of this.#tripUpdates) {
      if (stored.receivedAt >= cutoff) continue;
      this.#tripUpdates.delete(key);
      if (this.#tripUpdatesByTrip.get(stored.update.tripId) === stored) {
        this.#tripUpdatesByTrip.delete(stored.update.tripId);
      }
    }
    return expired;
  }
}

/** Prefer the bus's own clock: it is what the freshness badge is measured against. */
function positionTime(vehicle: RtVehicle, nowMs: number): number {
  return vehicle.timestamp === null ? nowMs : vehicle.timestamp * 1000;
}
