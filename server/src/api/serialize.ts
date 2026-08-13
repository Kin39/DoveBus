import { roundCoordinate } from "../geo/coordinates.js";
import type { RouteName } from "../query/routes.js";
import type { FreshnessBucket } from "../rt/freshness.js";
import { freshness } from "../rt/freshness.js";
import type { LiveVehicle, LiveVehicleView } from "../rt/state.js";
import type { TrailPoint } from "../rt/trail.js";

export interface VehicleJson {
  readonly key: string;
  readonly tripId: string | null;
  readonly routeId: string | null;
  /** Resolved from the timetable: the feed carries only `route_id`, riders read line numbers. */
  readonly line: string | null;
  readonly startDate: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly bearing: number | null;
  readonly speed: number | null;
  readonly stopId: string | null;
  readonly stopSequence: number | null;
  readonly status: string | null;
  readonly vehicleId: string | null;
  readonly vehicleLabel: string | null;
  readonly occupancy: string | null;
  /** Seconds since epoch, as reported by the bus itself. */
  readonly timestamp: number | null;
  /** The honest number the UI prints next to the colour. Null when the bus sent no clock. */
  readonly ageSeconds: number | null;
  readonly freshness: FreshnessBucket;
  readonly delaySeconds: number | null;
  readonly scheduleRelationship: string | null;
  readonly cancelled: boolean;
}

export interface TrailPointJson {
  readonly lat: number;
  readonly lon: number;
  readonly at: number;
}

export interface LiveTripJson {
  readonly vehicle: VehicleJson;
  readonly trail: readonly TrailPointJson[];
}

/**
 * A live bus as the map and the trip view see it.
 *
 * Age and bucket are computed at serialization time rather than stored: the
 * position stops changing when the feed stalls, but its age never stops growing,
 * and a client must be told the second number, not the first.
 */
export function toVehicleJson(
  vehicle: LiveVehicle,
  nowMs: number,
  routes: ReadonlyMap<string, RouteName>,
): VehicleJson {
  const age = freshness(nowMs, vehicle.timestamp);
  return {
    key: vehicle.key,
    tripId: vehicle.tripId,
    routeId: vehicle.routeId,
    line: (vehicle.routeId === null ? null : routes.get(vehicle.routeId)?.shortName) ?? null,
    startDate: vehicle.startDate,
    lat: roundCoordinate(vehicle.lat),
    lon: roundCoordinate(vehicle.lon),
    bearing: vehicle.bearing,
    speed: vehicle.speed,
    stopId: vehicle.stopId,
    stopSequence: vehicle.currentStopSequence,
    status: vehicle.currentStatus,
    vehicleId: vehicle.vehicleId,
    vehicleLabel: vehicle.vehicleLabel,
    occupancy: vehicle.occupancyStatus,
    timestamp: vehicle.timestamp,
    ageSeconds: age.ageSeconds,
    freshness: age.bucket,
    delaySeconds: vehicle.delaySeconds,
    scheduleRelationship: vehicle.scheduleRelationship,
    // Surfaced as its own flag: a cancelled run is the one thing a rider must not
    // have to infer from an enum name.
    cancelled:
      vehicle.scheduleRelationship === "CANCELED" || vehicle.scheduleRelationship === "DELETED",
  };
}

export function toLiveTripJson(
  view: LiveVehicleView,
  nowMs: number,
  routes: ReadonlyMap<string, RouteName>,
): LiveTripJson {
  return {
    vehicle: toVehicleJson(view.vehicle, nowMs, routes),
    trail: view.trail.map(toTrailPointJson),
  };
}

function toTrailPointJson(point: TrailPoint): TrailPointJson {
  return { lat: roundCoordinate(point.lat), lon: roundCoordinate(point.lon), at: point.at };
}
