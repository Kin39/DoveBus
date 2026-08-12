import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const { transit_realtime: rt } = GtfsRealtimeBindings;

export interface VehicleFixture {
  readonly id?: string;
  readonly tripId?: string;
  readonly routeId?: string;
  readonly directionId?: number;
  readonly startDate?: string;
  readonly startTime?: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly bearing?: number;
  readonly speed?: number;
  readonly stopId?: string;
  readonly currentStopSequence?: number;
  readonly currentStatus?: number;
  readonly vehicleId?: string;
  readonly vehicleLabel?: string;
  readonly licensePlate?: string;
  readonly occupancyStatus?: number;
  readonly timestamp?: number;
  /** Omit the position entirely — deadheading buses in the live feed do this. */
  readonly noPosition?: boolean;
}

/** Encodes a real GTFS-RT protobuf, so the decoder is tested against the wire format. */
export function encodeVehiclePositions(
  vehicles: readonly VehicleFixture[],
  headerTimestamp: number | null = 1_760_000_000,
): Uint8Array {
  const entity = vehicles.map((vehicle, index) => ({
    id: vehicle.id ?? `e${index}`,
    vehicle: {
      ...(vehicle.tripId || vehicle.routeId || vehicle.startDate
        ? {
            trip: {
              ...(vehicle.tripId ? { tripId: vehicle.tripId } : {}),
              ...(vehicle.routeId ? { routeId: vehicle.routeId } : {}),
              ...(vehicle.directionId === undefined ? {} : { directionId: vehicle.directionId }),
              ...(vehicle.startDate ? { startDate: vehicle.startDate } : {}),
              ...(vehicle.startTime ? { startTime: vehicle.startTime } : {}),
            },
          }
        : {}),
      ...(vehicle.noPosition
        ? {}
        : {
            position: {
              latitude: vehicle.lat ?? 43.7696,
              longitude: vehicle.lon ?? 11.2558,
              ...(vehicle.bearing === undefined ? {} : { bearing: vehicle.bearing }),
              ...(vehicle.speed === undefined ? {} : { speed: vehicle.speed }),
            },
          }),
      ...(vehicle.currentStopSequence === undefined
        ? {}
        : { currentStopSequence: vehicle.currentStopSequence }),
      ...(vehicle.currentStatus === undefined ? {} : { currentStatus: vehicle.currentStatus }),
      ...(vehicle.stopId ? { stopId: vehicle.stopId } : {}),
      ...(vehicle.timestamp === undefined ? {} : { timestamp: vehicle.timestamp }),
      ...(vehicle.occupancyStatus === undefined
        ? {}
        : { occupancyStatus: vehicle.occupancyStatus }),
      ...(vehicle.vehicleId || vehicle.vehicleLabel || vehicle.licensePlate
        ? {
            vehicle: {
              ...(vehicle.vehicleId ? { id: vehicle.vehicleId } : {}),
              ...(vehicle.vehicleLabel ? { label: vehicle.vehicleLabel } : {}),
              ...(vehicle.licensePlate ? { licensePlate: vehicle.licensePlate } : {}),
            },
          }
        : {}),
    },
  }));

  return rt.FeedMessage.encode({
    header: {
      gtfsRealtimeVersion: "1.0",
      incrementality: rt.FeedHeader.Incrementality.FULL_DATASET,
      ...(headerTimestamp === null ? {} : { timestamp: headerTimestamp }),
    },
    entity,
  }).finish();
}

export interface StopTimeUpdateFixture {
  readonly stopId?: string;
  readonly stopSequence?: number;
  readonly arrivalDelay?: number;
  readonly departureDelay?: number;
  readonly skipped?: boolean;
}

export interface TripUpdateFixture {
  readonly tripId?: string;
  readonly routeId?: string;
  readonly startDate?: string;
  readonly startTime?: string;
  readonly directionId?: number;
  readonly scheduleRelationship?: number;
  readonly timestamp?: number;
  readonly delay?: number;
  readonly stopTimeUpdates?: readonly StopTimeUpdateFixture[];
}

export function encodeTripUpdates(
  updates: readonly TripUpdateFixture[],
  headerTimestamp: number | null = 1_760_000_000,
): Uint8Array {
  const entity = updates.map((update, index) => ({
    id: `t${index}`,
    tripUpdate: {
      trip: {
        ...(update.tripId ? { tripId: update.tripId } : {}),
        ...(update.routeId ? { routeId: update.routeId } : {}),
        ...(update.startDate ? { startDate: update.startDate } : {}),
        ...(update.startTime ? { startTime: update.startTime } : {}),
        ...(update.directionId === undefined ? {} : { directionId: update.directionId }),
        ...(update.scheduleRelationship === undefined
          ? {}
          : { scheduleRelationship: update.scheduleRelationship }),
      },
      ...(update.timestamp === undefined ? {} : { timestamp: update.timestamp }),
      ...(update.delay === undefined ? {} : { delay: update.delay }),
      stopTimeUpdate: (update.stopTimeUpdates ?? []).map((stop) => ({
        ...(stop.stopId ? { stopId: stop.stopId } : {}),
        ...(stop.stopSequence === undefined ? {} : { stopSequence: stop.stopSequence }),
        ...(stop.arrivalDelay === undefined ? {} : { arrival: { delay: stop.arrivalDelay } }),
        ...(stop.departureDelay === undefined ? {} : { departure: { delay: stop.departureDelay } }),
        ...(stop.skipped
          ? { scheduleRelationship: rt.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED }
          : {}),
      })),
    },
  }));

  return rt.FeedMessage.encode({
    header: {
      gtfsRealtimeVersion: "1.0",
      incrementality: rt.FeedHeader.Incrementality.FULL_DATASET,
      ...(headerTimestamp === null ? {} : { timestamp: headerTimestamp }),
    },
    entity,
  }).finish();
}
