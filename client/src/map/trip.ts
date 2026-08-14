import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import { LngLatBounds } from "maplibre-gl";
import type { ShapePoint, TrailPoint, TripStop } from "../api/types.js";
import { type LngLat, MAX_OFF_ROUTE_M, RouteGeometry } from "./route.js";

const SHAPE_SOURCE = "trip-shape";
const TRAVELLED_SOURCE = "trip-travelled";
const OBSERVED_SOURCE = "trip-observed";
const STOPS_SOURCE = "trip-stops";
const UNCERTAINTY_SOURCE = "trip-uncertainty";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * The geometry of a trip being watched: what the bus will do, what it has
 * already done, and how much of the latter we actually saw.
 *
 * The travelled path is drawn along the route rather than between the fixes.
 * Consecutive fixes on this feed are 96–130 s and up to 2.7 km apart, so joining
 * them directly draws a straight chord across every curve — a line that says the
 * bus drove through the hillside. The route's own geometry carries 877 points
 * for the same trip, so the honest reconstruction is the stretch of road up to
 * where the bus has got to. The raw fixes stay visible on top as separate marks,
 * because the difference between "we watched this happen" and "we reconstructed
 * this" is exactly the sort of thing this product does not blur.
 */
export class TripLayer {
  readonly #map: MapLibreMap;
  #route: RouteGeometry | null = null;

  constructor(map: MapLibreMap, beforeId?: string) {
    this.#map = map;
    this.#install(beforeId);
  }

  get route(): RouteGeometry | null {
    return this.#route;
  }

  #install(beforeId?: string): void {
    const map = this.#map;
    for (const id of [
      SHAPE_SOURCE,
      TRAVELLED_SOURCE,
      OBSERVED_SOURCE,
      STOPS_SOURCE,
      UNCERTAINTY_SOURCE,
    ]) {
      map.addSource(id, { type: "geojson", data: EMPTY });
    }

    // Where the bus plausibly is, given how far it has been advanced past its
    // last known position. Drawn first so everything else sits on top of it.
    map.addLayer(
      {
        id: "trip-uncertainty",
        type: "fill",
        source: UNCERTAINTY_SOURCE,
        paint: { "fill-color": "#12876a", "fill-opacity": 0.1 },
      },
      beforeId,
    );

    map.addLayer(
      {
        id: "trip-shape-casing",
        type: "line",
        source: SHAPE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: "trip-shape",
        type: "line",
        source: SHAPE_SOURCE,
        // Butt caps, or the dashes render as a string of dots and become
        // indistinguishable from the stop beads drawn on the same line.
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": "#7c8ba3",
          "line-width": 2.4,
          "line-opacity": 0.85,
          // Dashed: this is the timetable's intention, not an observation.
          "line-dasharray": [4, 2.5],
        },
      },
      beforeId,
    );

    map.addLayer(
      {
        id: "trip-travelled",
        type: "line",
        source: TRAVELLED_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#12876a",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 14, 5.5],
          "line-opacity": 0.95,
        },
      },
      beforeId,
    );

    map.addLayer(
      {
        id: "trip-stops",
        type: "circle",
        source: STOPS_SOURCE,
        paint: {
          // Only from the zoom where a rider is reading individual stops.
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 0, 11, 2.4, 14, 3.6, 16, 5],
          "circle-color": "#ffffff",
          "circle-stroke-width": 1.4,
          "circle-stroke-color": "#5c6b80",
          "circle-stroke-opacity": 0.95,
        },
      },
      beforeId,
    );

    // The positions the bus genuinely reported, on top of the reconstruction.
    map.addLayer(
      {
        id: "trip-observed",
        type: "circle",
        source: OBSERVED_SOURCE,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 14, 3, 16, 4],
          "circle-color": "#0b3d33",
          "circle-stroke-width": 1.2,
          "circle-stroke-color": "#ffffff",
        },
      },
      beforeId,
    );
  }

  /** Loads the planned route and returns its geometry for the estimator to use. */
  setShape(shape: readonly ShapePoint[]): RouteGeometry | null {
    this.#route = shape.length >= 2 ? new RouteGeometry(shape) : null;
    this.#set(SHAPE_SOURCE, lineFeature(shape.map(([lat, lon]) => [lon, lat] as LngLat)));
    return this.#route;
  }

  /**
   * Draws the road already covered, up to where the bus has reached.
   *
   * Falls back to joining the observed fixes when the bus cannot be placed on
   * its route — a diversion, or an RT trip matched to the wrong shape. A crude
   * line is better than a confident wrong one.
   */
  setProgress(position: LngLat | null, observed: readonly TrailPoint[]): void {
    const route = this.#route;
    if (!route?.usable || !position) {
      this.#set(TRAVELLED_SOURCE, lineFeature(observed.map((p) => [p.lon, p.lat] as LngLat)));
      return;
    }

    const projected = route.project(position[1], position[0]);
    if (!projected || projected.offRoute > MAX_OFF_ROUTE_M) {
      this.#set(TRAVELLED_SOURCE, lineFeature(observed.map((p) => [p.lon, p.lat] as LngLat)));
      return;
    }
    this.#set(TRAVELLED_SOURCE, lineFeature(route.slice(0, projected.distance)));
  }

  /** The raw fixes, kept visibly distinct from the reconstructed line. */
  setObserved(trail: readonly TrailPoint[]): void {
    this.#set(OBSERVED_SOURCE, {
      type: "FeatureCollection",
      features: trail.map((point) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [point.lon, point.lat] },
        properties: { at: point.at },
      })),
    });
  }

  /** How far the drawn position may be from the real one, in metres on the ground. */
  setUncertainty(centre: LngLat | null, radiusMetres: number): void {
    if (!centre || radiusMetres < 25) {
      this.#set(UNCERTAINTY_SOURCE, EMPTY);
      return;
    }
    this.#set(UNCERTAINTY_SOURCE, {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [circle(centre, radiusMetres)] },
          properties: {},
        },
      ],
    });
  }

  setStops(stops: readonly TripStop[]): void {
    this.#set(STOPS_SOURCE, {
      type: "FeatureCollection",
      features: stops
        .filter((stop) => stop.lat !== null && stop.lon !== null)
        .map((stop) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [stop.lon as number, stop.lat as number],
          },
          properties: { name: stop.name, sequence: stop.sequence },
        })),
    });
  }

  clear(): void {
    this.#route = null;
    for (const id of [
      SHAPE_SOURCE,
      TRAVELLED_SOURCE,
      OBSERVED_SOURCE,
      STOPS_SOURCE,
      UNCERTAINTY_SOURCE,
    ]) {
      this.#set(id, EMPTY);
    }
  }

  #set(sourceId: string, data: GeoJSON.FeatureCollection): void {
    const source = this.#map.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(data);
  }
}

/** A single LineString, or nothing at all when there is not yet a line to draw. */
function lineFeature(coordinates: readonly LngLat[]): GeoJSON.FeatureCollection {
  if (coordinates.length < 2) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: coordinates as [number, number][] },
        properties: {},
      },
    ],
  };
}

const CIRCLE_SEGMENTS = 48;
const METRES_PER_DEGREE = 111_320;

/** A ground circle as a polygon ring — MapLibre's circle radii are in pixels. */
function circle(centre: LngLat, radiusMetres: number): [number, number][] {
  const latitudeRadius = radiusMetres / METRES_PER_DEGREE;
  const longitudeRadius = latitudeRadius / Math.cos((centre[1] * Math.PI) / 180);

  const ring: [number, number][] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    ring.push([
      centre[0] + Math.cos(angle) * longitudeRadius,
      centre[1] + Math.sin(angle) * latitudeRadius,
    ]);
  }
  return ring;
}

/** Bounds covering a set of `[lat, lon]` points, or null when there are none. */
export function boundsOf(points: readonly ShapePoint[]): LngLatBoundsLike | null {
  const first = points[0];
  if (!first) return null;
  const bounds = new LngLatBounds([first[1], first[0]], [first[1], first[0]]);
  for (const [lat, lon] of points) bounds.extend([lon, lat]);
  return bounds;
}
