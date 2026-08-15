import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Vehicle } from "../api/types.js";
import { ageFromTimestamp, bucketOf, MAX_VISIBLE_AGE_S } from "../ui/format.js";
import { type Estimate, estimate, type Fix } from "./estimate.js";
import type { RouteGeometry } from "./route.js";

const SOURCE_ID = "vehicles";
export const VEHICLE_LAYER_ID = "vehicles-dot";
const SELECTED_LAYER_ID = "vehicles-selected";

/**
 * How often the estimated positions are rewritten.
 *
 * Not every frame, deliberately. A bus at 50 km/h covers 13.9 m per second,
 * which at street zoom is under two pixels — so five updates a second are
 * already smoother than the eye can resolve for this subject, while sixty would
 * mean re-parsing a thousand-feature collection sixty times a second on a phone.
 */
const TICK_MS = 200;

interface Tracked {
  vehicle: Vehicle;
  /** The two most recent positions the bus reported, oldest first. */
  previous: Fix | null;
  latest: Fix;
}

/**
 * The live fleet, drawn as a GeoJSON layer.
 *
 * Deliberately not DOM markers: a busy viewport is several hundred buses and the
 * whole region is over a thousand, which no phone will keep at 60 fps as
 * individual nodes.
 *
 * Markers do not wait for a fix to move. The feed publishes roughly every two
 * minutes and a bus covers real ground in that time, so each one is advanced at
 * the speed it was last observed travelling — along its route where one is
 * known, along its last heading otherwise. What was assumed is never hidden: the
 * age is printed, the colour ages with it, and a bus we have not heard from in
 * five minutes leaves the map instead of being drawn as though it were still
 * being tracked.
 */
export class VehicleLayer {
  readonly #map: MapLibreMap;
  readonly #tracked = new Map<string, Tracked>();
  #selectedKey: string | null = null;
  #selectedRoute: RouteGeometry | null = null;
  #timer: number | null = null;
  #reducedMotion: boolean;

  constructor(map: MapLibreMap) {
    this.#map = map;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.#reducedMotion = query.matches;
    query.addEventListener("change", (event) => {
      this.#reducedMotion = event.matches;
      // Restart, or the cadence chosen at construction outlives the preference.
      if (this.#timer !== null) {
        clearInterval(this.#timer);
        this.#timer = null;
        this.#start();
      }
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
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.2, 11, 5.5, 14, 8, 16, 11],
        "circle-color": [
          "match",
          ["get", "freshness"],
          "live",
          "#0f9d76",
          "recent",
          "#12876a",
          "delayed",
          "#b06a00",
          "#7a8798",
        ],
        "circle-opacity": 0.95,
        "circle-stroke-width": 1.4,
        "circle-stroke-color": ["case", ["get", "cancelled"], "#c8102e", "#ffffff"],
        "circle-stroke-opacity": 0.95,
      },
    });

    map.addLayer({
      id: SELECTED_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["==", ["get", "selected"], true],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 9, 12, 15, 16, 22],
        "circle-color": "#0b3d33",
        "circle-opacity": 0.1,
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#0b3d33",
      },
    });
  }

  /** Takes a fresh snapshot, keeping each bus's previous fix to estimate from. */
  update(vehicles: readonly Vehicle[]): void {
    const next = new Map<string, Tracked>();

    for (const vehicle of vehicles) {
      const fix: Fix = {
        lon: vehicle.lon,
        lat: vehicle.lat,
        // A bus with no clock of its own cannot be extrapolated, only placed.
        at: vehicle.timestamp ?? 0,
      };
      const existing = this.#tracked.get(vehicle.key);
      const moved = existing !== undefined && existing.latest.at !== fix.at;

      // On first sight, take the earlier position the API sends rather than
      // waiting to observe one. Without it a freshly opened map would sit
      // motionless for a whole publisher cycle — about two minutes — before any
      // bus had two fixes to measure a speed between.
      const seeded: Fix | null =
        vehicle.previous === null
          ? null
          : { lon: vehicle.previous.lon, lat: vehicle.previous.lat, at: vehicle.previous.at };

      next.set(vehicle.key, {
        vehicle,
        previous: moved ? existing.latest : (existing?.previous ?? seeded),
        latest: moved || existing === undefined ? fix : existing.latest,
      });
    }

    this.#tracked.clear();
    for (const [key, entry] of next) this.#tracked.set(key, entry);
    this.#draw();
    this.#start();
  }

  /**
   * Marks one bus as the followed one, optionally with its route.
   *
   * The route is what lets its estimate follow the road rather than fly straight
   * on, and the followed bus is also the one exempt from the age cutoff: making
   * it vanish while a rider is watching it would be the worst possible moment to
   * remove it from the map.
   */
  select(key: string | null, route: RouteGeometry | null = null): void {
    if (this.#selectedKey === key && this.#selectedRoute === route) return;
    this.#selectedKey = key;
    this.#selectedRoute = route;
    this.#draw();
  }

  get selectedKey(): string | null {
    return this.#selectedKey;
  }

  /** Where a bus is being drawn right now, and how much of that was assumed. */
  estimateFor(key: string): Estimate | null {
    const entry = this.#tracked.get(key);
    if (!entry) return null;
    const route = key === this.#selectedKey ? this.#selectedRoute : null;
    return estimate(entry.previous, entry.latest, Date.now() / 1000, route);
  }

  clear(): void {
    this.#tracked.clear();
    this.#draw();
  }

  #start(): void {
    if (this.#timer !== null) return;
    // Even with reduced motion the positions must keep updating — the estimate
    // is information, not decoration. Only the cadence relaxes.
    const interval = this.#reducedMotion ? 1000 : TICK_MS;
    this.#timer = window.setInterval(() => this.#draw(), interval);
  }

  #draw(): void {
    const source = this.#map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;

    const nowMs = Date.now();
    const nowSeconds = nowMs / 1000;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

    for (const entry of this.#tracked.values()) {
      const selected = entry.vehicle.key === this.#selectedKey;
      // The bucket is recomputed here rather than trusted from the payload: the
      // fix keeps ageing between snapshots, and a colour frozen on delivery
      // would keep claiming "recente" long after it stopped being true.
      const age = ageFromTimestamp(entry.vehicle.timestamp, nowMs);

      // Past the cutoff we no longer know enough to draw a bus at all — except
      // the one being followed, which stays and says so.
      if (!selected && (age === null || age > MAX_VISIBLE_AGE_S)) continue;

      const position = estimate(
        entry.previous,
        entry.latest,
        nowSeconds,
        selected ? this.#selectedRoute : null,
      );

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [position.point[0], position.point[1]] },
        properties: {
          key: entry.vehicle.key,
          line: entry.vehicle.line,
          freshness: bucketOf(age),
          cancelled: entry.vehicle.cancelled,
          selected,
        },
      });
    }

    source.setData({ type: "FeatureCollection", features });
  }
}
