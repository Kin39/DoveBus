import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import { LngLatBounds } from "maplibre-gl";
import type { ShapePoint, TrailPoint, TripStop } from "../api/types.js";

const SHAPE_SOURCE = "trip-shape";
const TRAIL_SOURCE = "trip-trail";
const STOPS_SOURCE = "trip-stops";

/**
 * The three lines of a live trip view, stacked in meaning order.
 *
 * The planned shape is the whole path the bus will follow, drawn quietly. The
 * trail is only what this backend actually watched happen, drawn bright — the
 * two must never be confusable, because one is a promise and the other is a
 * record.
 */
export class TripLayer {
  readonly #map: MapLibreMap;

  constructor(map: MapLibreMap, beforeId?: string) {
    this.#map = map;
    this.#install(beforeId);
  }

  #install(beforeId?: string): void {
    const map = this.#map;
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

    map.addSource(SHAPE_SOURCE, { type: "geojson", data: empty });
    // `lineMetrics` is what makes `line-gradient` possible, and it can only be
    // set when the source is created.
    map.addSource(TRAIL_SOURCE, { type: "geojson", data: empty, lineMetrics: true });
    map.addSource(STOPS_SOURCE, { type: "geojson", data: empty });

    map.addLayer(
      {
        id: "trip-shape-casing",
        type: "line",
        source: SHAPE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#06121c", "line-width": 7, "line-opacity": 0.75 },
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
          "line-color": "#8d9cb3",
          "line-width": 2.2,
          "line-opacity": 0.7,
          // Dashed: this is the timetable's intention, not an observation.
          "line-dasharray": [4, 2.5],
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
          // Only from the zoom where a rider is reading individual stops: at
          // region zoom 55 beads on one line is just noise on the route.
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 0, 11, 2.4, 14, 3.6, 16, 5],
          "circle-color": "#0b1524",
          "circle-stroke-width": 1.4,
          "circle-stroke-color": "#aab7c9",
          "circle-stroke-opacity": 0.9,
        },
      },
      beforeId,
    );

    map.addLayer(
      {
        id: "trip-trail",
        type: "line",
        source: TRAIL_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#4ff0c0",
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 14, 4.5],
          // Fades toward the tail: the oldest end of the trail is the least
          // certain thing on screen.
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0,
            "rgba(79,240,192,0.12)",
            1,
            "rgba(79,240,192,0.95)",
          ],
        },
      },
      beforeId,
    );
  }

  setShape(shape: readonly ShapePoint[]): void {
    this.#set(SHAPE_SOURCE, lineFeature(shape.map(([lat, lon]) => [lon, lat] as [number, number])));
  }

  setTrail(trail: readonly TrailPoint[]): void {
    const coordinates = trail.map((point) => [point.lon, point.lat] as [number, number]);
    this.#set(TRAIL_SOURCE, lineFeature(coordinates));
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
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    for (const id of [SHAPE_SOURCE, TRAIL_SOURCE, STOPS_SOURCE]) this.#set(id, empty);
  }

  #set(sourceId: string, data: GeoJSON.FeatureCollection): void {
    const source = this.#map.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(data);
  }
}

/** A single LineString, or nothing at all when there is not yet a line to draw. */
function lineFeature(coordinates: readonly [number, number][]): GeoJSON.FeatureCollection {
  if (coordinates.length < 2) return { type: "FeatureCollection", features: [] };
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

/** Bounds covering a set of `[lat, lon]` points, or null when there are none. */
export function boundsOf(points: readonly ShapePoint[]): LngLatBoundsLike | null {
  const first = points[0];
  if (!first) return null;
  const bounds = new LngLatBounds([first[1], first[0]], [first[1], first[0]]);
  for (const [lat, lon] of points) bounds.extend([lon, lat]);
  return bounds;
}
