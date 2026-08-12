import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { isInsideTuscany } from "../geo/bbox.js";

const { transit_realtime: rt } = GtfsRealtimeBindings;

/** Where the bus is relative to `stopId`. */
export type VehicleStopStatus = "INCOMING_AT" | "STOPPED_AT" | "IN_TRANSIT_TO";

export type OccupancyStatus =
  | "EMPTY"
  | "MANY_SEATS_AVAILABLE"
  | "FEW_SEATS_AVAILABLE"
  | "STANDING_ROOM_ONLY"
  | "CRUSHED_STANDING_ROOM_ONLY"
  | "FULL"
  | "NOT_ACCEPTING_PASSENGERS"
  | "NO_DATA_AVAILABLE"
  | "NOT_BOARDABLE";

export type TripScheduleRelationship =
  | "SCHEDULED"
  | "ADDED"
  | "UNSCHEDULED"
  | "CANCELED"
  | "REPLACEMENT"
  | "DUPLICATED"
  | "DELETED"
  | "NEW";

/** One positioned bus from a `vehicle-positions` snapshot, already sanity-filtered. */
export interface RtVehicle {
  readonly tripId: string | null;
  readonly routeId: string | null;
  readonly directionId: number | null;
  readonly startDate: string | null;
  readonly startTime: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly bearing: number | null;
  readonly speed: number | null;
  readonly stopId: string | null;
  readonly currentStopSequence: number | null;
  readonly currentStatus: VehicleStopStatus | null;
  readonly vehicleId: string | null;
  readonly vehicleLabel: string | null;
  readonly licensePlate: string | null;
  readonly occupancyStatus: OccupancyStatus | null;
  /** Seconds since epoch, as reported by the bus. Drives the freshness bucket. */
  readonly timestamp: number | null;
}

export interface VehicleSnapshotStats {
  readonly entities: number;
  readonly positioned: number;
  /** Dropped by the Tuscany sanity filter — a couple per snapshot is normal. */
  readonly outsideBbox: number;
  readonly withTrip: number;
}

export interface VehicleSnapshot {
  readonly headerTimestamp: number | null;
  readonly vehicles: readonly RtVehicle[];
  readonly stats: VehicleSnapshotStats;
}

export interface RtStopTimeUpdate {
  readonly stopId: string | null;
  readonly stopSequence: number | null;
  readonly arrivalDelay: number | null;
  readonly departureDelay: number | null;
  readonly skipped: boolean;
}

export interface RtTripUpdate {
  readonly tripId: string;
  readonly routeId: string | null;
  readonly directionId: number | null;
  readonly startDate: string | null;
  readonly startTime: string | null;
  readonly scheduleRelationship: TripScheduleRelationship;
  /** Representative delay for the run: first per-stop delay, else the trip-level one. */
  readonly delaySeconds: number | null;
  readonly stopUpdates: readonly RtStopTimeUpdate[];
  readonly timestamp: number | null;
}

export interface TripUpdateSnapshot {
  readonly headerTimestamp: number | null;
  readonly updates: readonly RtTripUpdate[];
  readonly stats: { readonly entities: number; readonly withTrip: number };
}

/**
 * Decodes a full-dataset `vehicle-positions` snapshot.
 *
 * Entities without a usable position are dropped here rather than downstream:
 * the rest of the system should only ever see buses that are actually somewhere.
 */
export function decodeVehiclePositions(body: Uint8Array): VehicleSnapshot {
  const feed = decodeFeed(body, "vehicle-positions");

  const vehicles: RtVehicle[] = [];
  let positioned = 0;
  let outsideBbox = 0;
  let withTrip = 0;

  for (const entity of feed.entity ?? []) {
    const vehicle = entity.vehicle;
    if (!vehicle) continue;

    const lat = vehicle.position?.latitude;
    const lon = vehicle.position?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    positioned++;

    if (!isInsideTuscany(lat, lon)) {
      outsideBbox++;
      continue;
    }
    if (vehicle.trip?.tripId) withTrip++;

    vehicles.push({
      tripId: stringField(vehicle.trip, "tripId"),
      routeId: stringField(vehicle.trip, "routeId"),
      directionId: numberField(vehicle.trip, "directionId"),
      startDate: stringField(vehicle.trip, "startDate"),
      startTime: stringField(vehicle.trip, "startTime"),
      lat,
      lon,
      bearing: numberField(vehicle.position, "bearing"),
      speed: numberField(vehicle.position, "speed"),
      stopId: stringField(vehicle, "stopId"),
      currentStopSequence: numberField(vehicle, "currentStopSequence"),
      currentStatus: enumField(rt.VehiclePosition.VehicleStopStatus, vehicle, "currentStatus"),
      vehicleId: stringField(vehicle.vehicle, "id"),
      vehicleLabel: stringField(vehicle.vehicle, "label"),
      licensePlate: stringField(vehicle.vehicle, "licensePlate"),
      occupancyStatus: enumField(rt.VehiclePosition.OccupancyStatus, vehicle, "occupancyStatus"),
      timestamp: numberField(vehicle, "timestamp"),
    });
  }

  return {
    headerTimestamp: numberField(feed.header, "timestamp"),
    vehicles,
    stats: { entities: feed.entity?.length ?? 0, positioned, outsideBbox, withTrip },
  };
}

/** Decodes a `trip-updates` snapshot — the MVP source of delays and cancellations. */
export function decodeTripUpdates(body: Uint8Array): TripUpdateSnapshot {
  const feed = decodeFeed(body, "trip-updates");

  const updates: RtTripUpdate[] = [];
  for (const entity of feed.entity ?? []) {
    const update = entity.tripUpdate;
    // Without a trip_id there is nothing to join a delay onto.
    if (!update?.trip?.tripId) continue;

    const stopUpdates = (update.stopTimeUpdate ?? []).map(
      (stop): RtStopTimeUpdate => ({
        stopId: stringField(stop, "stopId"),
        stopSequence: numberField(stop, "stopSequence"),
        arrivalDelay: numberField(stop.arrival, "delay"),
        departureDelay: numberField(stop.departure, "delay"),
        skipped:
          stop.scheduleRelationship === rt.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED,
      }),
    );

    updates.push({
      tripId: update.trip.tripId,
      routeId: stringField(update.trip, "routeId"),
      directionId: numberField(update.trip, "directionId"),
      startDate: stringField(update.trip, "startDate"),
      startTime: stringField(update.trip, "startTime"),
      scheduleRelationship:
        enumField<TripScheduleRelationship>(
          rt.TripDescriptor.ScheduleRelationship,
          update.trip,
          "scheduleRelationship",
        ) ?? "SCHEDULED",
      delaySeconds: representativeDelay(stopUpdates) ?? numberField(update, "delay"),
      stopUpdates,
      timestamp: numberField(update, "timestamp"),
    });
  }

  return {
    headerTimestamp: numberField(feed.header, "timestamp"),
    updates,
    stats: { entities: feed.entity?.length ?? 0, withTrip: updates.length },
  };
}

/** The delay a rider would quote: the first stop on the run that reports one. */
function representativeDelay(stopUpdates: readonly RtStopTimeUpdate[]): number | null {
  for (const stop of stopUpdates) {
    if (stop.arrivalDelay !== null) return stop.arrivalDelay;
    if (stop.departureDelay !== null) return stop.departureDelay;
  }
  return null;
}

/**
 * Delay at (or immediately after) a given stop sequence — the number to show for
 * a bus that is already part-way through its run.
 */
export function delayAtStopSequence(
  update: RtTripUpdate,
  stopSequence: number | null,
): number | null {
  if (stopSequence === null) return update.delaySeconds;

  for (const stop of update.stopUpdates) {
    if (stop.stopSequence === null || stop.stopSequence < stopSequence) continue;
    if (stop.arrivalDelay !== null) return stop.arrivalDelay;
    if (stop.departureDelay !== null) return stop.departureDelay;
  }
  return update.delaySeconds;
}

/**
 * A gateway error page decodes as an empty-ish protobuf rather than throwing, so
 * garbage would otherwise look like "the region has no buses right now".
 */
function decodeFeed(
  body: Uint8Array,
  feedName: string,
): GtfsRealtimeBindings.transit_realtime.FeedMessage {
  let feed: GtfsRealtimeBindings.transit_realtime.FeedMessage;
  try {
    feed = rt.FeedMessage.decode(body);
  } catch (error) {
    throw new Error(`${feedName}: response is not a GTFS-RT feed`, { cause: error });
  }
  if (!feed.header?.gtfsRealtimeVersion) {
    throw new Error(`${feedName}: response is not a GTFS-RT feed (no header version)`);
  }
  return feed;
}

/**
 * protobufjs exposes unset optional fields as prototype defaults (`0`, `""`), so
 * reading them directly cannot tell "delay of zero" from "no delay reported".
 * Own-property presence is the only honest test.
 */
function ownValue(message: object | null | undefined, key: string): unknown {
  if (message === null || message === undefined) return undefined;
  return Object.hasOwn(message, key) ? (message as Record<string, unknown>)[key] : undefined;
}

function stringField(message: object | null | undefined, key: string): string | null {
  const value = ownValue(message, key);
  return typeof value === "string" && value !== "" ? value : null;
}

/** 64-bit fields arrive as `Long`, which coerces cleanly through `Number`. */
function numberField(message: object | null | undefined, key: string): number | null {
  const value = ownValue(message, key);
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Maps an enum field to its name, so nothing downstream deals in magic ints. */
function enumField<T extends string>(
  enumeration: Record<number, string>,
  message: object | null | undefined,
  key: string,
): T | null {
  const value = numberField(message, key);
  if (value === null) return null;
  const name = enumeration[value];
  return typeof name === "string" ? (name as T) : null;
}
