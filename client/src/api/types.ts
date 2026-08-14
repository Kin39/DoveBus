/** Mirrors `server/src/api` — the one place the wire shape is written down. */

export type FreshnessBucket = "live" | "recent" | "delayed" | "stale";

export interface Vehicle {
  readonly key: string;
  readonly tripId: string | null;
  readonly routeId: string | null;
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
  readonly ageSeconds: number | null;
  readonly freshness: FreshnessBucket;
  readonly delaySeconds: number | null;
  readonly scheduleRelationship: string | null;
  readonly cancelled: boolean;
  /** Where this bus was before it was here — the other end of a speed measurement. */
  readonly previous: PreviousFix | null;
}

export interface PreviousFix {
  readonly lat: number;
  readonly lon: number;
  /** Seconds since epoch, matching `Vehicle.timestamp`. */
  readonly at: number;
}

export interface TrailPoint {
  readonly lat: number;
  readonly lon: number;
  readonly at: number;
}

export interface LiveTrip {
  readonly vehicle: Vehicle;
  readonly trail: readonly TrailPoint[];
}

export interface Bbox {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLon: number;
  readonly maxLon: number;
}

export interface VehiclesResponse {
  readonly bbox: Bbox;
  readonly count: number;
  readonly vehicles: readonly Vehicle[];
}

export interface Comune {
  readonly istatCode: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

export interface RouteMatch {
  readonly shortName: string;
  readonly longName: string | null;
  readonly routeIds: readonly string[];
}

export interface StopRef {
  readonly stopId: string;
  readonly name: string;
  readonly comune: string | null;
}

export interface LineTrip {
  readonly tripId: string;
  readonly routeId: string;
  readonly line: string;
  readonly headsign: string | null;
  readonly directionId: number | null;
  readonly departureTime: string | null;
  readonly departureSeconds: number | null;
  readonly arrivalTime: string | null;
  readonly arrivalSeconds: number | null;
  readonly origin: StopRef;
  readonly destination: StopRef;
}

export interface LineSearchResponse {
  readonly date: string;
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly trips: readonly LineTrip[];
  readonly truncated: boolean;
}

export interface OdStop {
  readonly stopId: string;
  readonly name: string;
  readonly sequence: number;
}

export interface OdTrip {
  readonly tripId: string;
  readonly routeId: string;
  readonly line: string;
  readonly headsign: string | null;
  readonly directionId: number | null;
  readonly departureSeconds: number | null;
  readonly boarding: OdStop & { readonly departureTime: string | null };
  readonly alighting: OdStop & { readonly arrivalTime: string | null };
}

export interface ComuneRef {
  readonly istatCode: string;
  readonly name: string;
}

export interface OdSearchResponse {
  readonly date: string;
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly from: ComuneRef;
  readonly to: ComuneRef;
  readonly trips: readonly OdTrip[];
  readonly truncated: boolean;
}

export interface TripInfo {
  readonly tripId: string;
  readonly routeId: string;
  readonly line: string;
  readonly routeLongName: string | null;
  readonly headsign: string | null;
  readonly directionId: number | null;
  readonly serviceId: string;
  readonly shapeId: string | null;
  readonly date: string;
  readonly runsOnDate: boolean;
}

export interface TripStop {
  readonly sequence: number;
  readonly stopId: string;
  readonly name: string;
  readonly comune: string | null;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly arrivalTime: string | null;
  readonly arrivalSeconds: number | null;
  readonly departureTime: string | null;
  readonly departureSeconds: number | null;
}

/** `[lat, lon]` — the order the API serves, not GeoJSON's. */
export type ShapePoint = readonly [number, number];

export interface TripDetail {
  readonly trip: TripInfo;
  readonly stops: readonly TripStop[];
  readonly shape: readonly ShapePoint[];
  readonly live: LiveTrip | null;
}

/** What `/api/stream/trip/:tripId` pushes on every poller tick. */
export interface StreamMessage {
  readonly tripId: string;
  readonly date: string;
  readonly at: number;
  readonly live: LiveTrip | null;
}
