import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Vehicle } from "../api/types.js";
import { ageFromTimestamp, bucketOf } from "../ui/format.js";

const SOURCE_ID = "vehicles";
export const VEHICLE_LAYER_ID = "vehicles-dot";
const SELECTED_LAYER_ID = "vehicles-selected";

/**
 * How long a bus takes to glide from its previous position to the new one.
 *
 * Purely graphical, and shorter than the ~120 s the feed actually takes to
 * refresh: the point is to stop a thousand markers from teleporting, not to
 * pretend the bus is being tracked continuously. The age readout is unaffected
 * by this animation and keeps counting from the bus's own clock.
 */
const GLIDE_MS = 1400;

interface Rendered {
  readonly vehicle: Vehicle;
  /** Where the marker is drawn right now — not necessarily where the bus is. */
  fromLon: number;
  fromLat: number;
  toLon: number;
  toLat: number;
  startedAt: number;
}

/**
 * The live fleet, drawn as a GeoJSON layer.
 *
 * Deliberately not DOM markers: a busy viewport is several hundred buses and the
 * whole region is over a thousand, which no phone will keep at 60 fps as
 * individual nodes. One source, two circle layers, and the interpolation runs on
 * the source data rather than on any element's transform.
 */
export class VehicleLayer {
  readonly #map: MapLibreMap;
  readonly #rendered = new Map<string, Rendered>();
  #selectedKey: string | null = null;
  #frame: number | null = null;
  #reducedMotion: boolean;

  constructor(map: MapLibreMap) {
    this.#map = map;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.#reducedMotion = query.matches;
    query.addEventListener("change", (event) => {
      this.#reducedMotion = event.matches;
    });
    this.#install();
  }

  #install(): void {
    const map = this.#map;
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: VEHICLE_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          // Small enough to read as a fleet when zoomed out over the region,
          // large enough to be a 44 px-ish tap target in a city.
          8,
          3.2,
          11,
          5.5,
          14,
          8,
          16,
          11,
        ],
        "circle-color": [
          "match",
          ["get", "freshness"],
          "live",
          "#4ff0c0",
          "recent",
          "#2bc39a",
          "delayed",
          "#ffb020",
          "#6c7c91",
        ],
        // A silent bus keeps its outline and loses its fill: you can still see
        // that something is there, and that we no longer know it is.
        "circle-opacity": ["match", ["get", "freshness"], "stale", 0.06, 0.92],
        "circle-stroke-width": ["match", ["get", "freshness"], "stale", 1.2, 0.8],
        "circle-stroke-color": [
          "case",
          ["get", "cancelled"],
          "#ff5a5f",
          ["match", ["get", "freshness"], "stale", "#6c7c91", "#06121c"],
        ],
        "circle-stroke-opacity": 0.85,
      },
    });

    map.addLayer({
      id: SELECTED_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["==", ["get", "selected"], true],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 8, 12, 13, 16, 20],
        "circle-color": "#ffffff",
        "circle-opacity": 0.14,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  /** Replaces the fleet with a fresh snapshot, gliding markers that moved. */
  update(vehicles: readonly Vehicle[]): void {
    const now = performance.now();
    const next = new Map<string, Rendered>();

    for (const vehicle of vehicles) {
      const previous = this.#rendered.get(vehicle.key);
      if (previous === undefined) {
        next.set(vehicle.key, {
          vehicle,
          fromLon: vehicle.lon,
          fromLat: vehicle.lat,
          toLon: vehicle.lon,
          toLat: vehicle.lat,
          startedAt: now - GLIDE_MS,
        });
        continue;
      }
      const [lon, lat] = positionOf(previous, now);
      next.set(vehicle.key, {
        vehicle,
        // The glide starts wherever the marker actually is, so a snapshot
        // arriving mid-animation does not snap the marker backwards.
        fromLon: lon,
        fromLat: lat,
        toLon: vehicle.lon,
        toLat: vehicle.lat,
        startedAt: now,
      });
    }

    this.#rendered.clear();
    for (const [key, entry] of next) this.#rendered.set(key, entry);
    this.#draw(now);
    this.#animate();
  }

  select(key: string | null): void {
    if (this.#selectedKey === key) return;
    this.#selectedKey = key;
    this.#draw(performance.now());
  }

  get selectedKey(): string | null {
    return this.#selectedKey;
  }

  vehicleAt(key: string): Vehicle | null {
    return this.#rendered.get(key)?.vehicle ?? null;
  }

  clear(): void {
    this.#rendered.clear();
    this.#draw(performance.now());
  }

  destroy(): void {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }

  #animate(): void {
    if (this.#reducedMotion || this.#frame !== null) return;

    const step = (): void => {
      const now = performance.now();
      const moving = this.#draw(now);
      this.#frame = moving ? requestAnimationFrame(step) : null;
    };
    this.#frame = requestAnimationFrame(step);
  }

  /** Writes the current frame to the source. Returns whether anything is still moving. */
  #draw(now: number): boolean {
    const source = this.#map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return false;

    let moving = false;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

    for (const entry of this.#rendered.values()) {
      const [lon, lat] = this.#reducedMotion ? [entry.toLon, entry.toLat] : positionOf(entry, now);
      if (now - entry.startedAt < GLIDE_MS) moving = true;

      // The bucket is recomputed here rather than trusted from the payload: the
      // fix keeps ageing between snapshots, and a colour frozen on delivery
      // would keep claiming "recente" long after it stopped being true.
      const age = ageFromTimestamp(entry.vehicle.timestamp);
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          key: entry.vehicle.key,
          line: entry.vehicle.line,
          freshness: bucketOf(age),
          cancelled: entry.vehicle.cancelled,
          selected: entry.vehicle.key === this.#selectedKey,
        },
      });
    }

    source.setData({ type: "FeatureCollection", features });
    return moving;
  }
}

function positionOf(entry: Rendered, now: number): [number, number] {
  const progress = Math.min(1, (now - entry.startedAt) / GLIDE_MS);
  const eased = progress * (2 - progress);
  return [
    entry.fromLon + (entry.toLon - entry.fromLon) * eased,
    entry.fromLat + (entry.toLat - entry.fromLat) * eased,
  ];
}
