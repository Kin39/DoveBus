import type { LngLatBoundsLike } from "maplibre-gl";
import { Map as MapLibreMap } from "maplibre-gl";
import { basemapStyle, TUSCANY_CENTER, TUSCANY_INITIAL_ZOOM, TUSCANY_MAX_BOUNDS } from "./style.js";
import { TripLayer } from "./trip.js";
import { VEHICLE_LAYER_ID, VehicleLayer } from "./vehicles.js";

export interface MapPadding {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
}

export interface MapControllerOptions {
  readonly container: HTMLElement;
  readonly onSelectVehicle: (key: string | null) => void;
  readonly onViewportChange: () => void;
}

/**
 * The map surface, and the only thing that knows MapLibre exists.
 *
 * Everything above this reasons in trips, vehicles and bounding boxes; swapping
 * the renderer would not reach the interface.
 */
export class MapController {
  readonly map: MapLibreMap;
  #vehicles: VehicleLayer | null = null;
  #trip: TripLayer | null = null;
  #ready = false;
  readonly #whenReady: Promise<void>;

  constructor(private readonly options: MapControllerOptions) {
    this.map = new MapLibreMap({
      container: options.container,
      style: basemapStyle(),
      center: TUSCANY_CENTER,
      zoom: TUSCANY_INITIAL_ZOOM,
      maxBounds: TUSCANY_MAX_BOUNDS,
      minZoom: 6.5,
      maxZoom: 17,
      attributionControl: false,
      // The compass is a desktop affordation and rotation on a transit map only
      // ever gets triggered by accident with two thumbs.
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: true,
    });
    this.map.touchZoomRotate.disableRotation();

    this.#whenReady = new Promise((resolve) => {
      this.map.on("load", () => {
        // Vehicles first so the trip lines have something to be inserted
        // *beneath*: the planned route and the trail must never draw over the
        // bus they belong to.
        this.#vehicles = new VehicleLayer(this.map);
        this.#trip = new TripLayer(this.map, VEHICLE_LAYER_ID);
        this.#ready = true;
        this.#bindInteraction();
        resolve();
      });
    });

    this.map.on("moveend", () => options.onViewportChange());
  }

  get ready(): Promise<void> {
    return this.#whenReady;
  }

  get vehicles(): VehicleLayer | null {
    return this.#vehicles;
  }

  get trip(): TripLayer | null {
    return this.#trip;
  }

  #bindInteraction(): void {
    const map = this.map;

    map.on("click", VEHICLE_LAYER_ID, (event) => {
      const key = event.features?.[0]?.properties?.key;
      if (typeof key === "string") this.options.onSelectVehicle(key);
    });

    // A tap on empty map is how a rider puts a bus down again.
    map.on("click", (event) => {
      if (!this.#ready) return;
      const hits = map.queryRenderedFeatures(event.point, { layers: [VEHICLE_LAYER_ID] });
      if (hits.length === 0) this.options.onSelectVehicle(null);
    });

    map.on("mouseenter", VEHICLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", VEHICLE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  /**
   * The viewport as the API wants it.
   *
   * Padded outward by a margin so a bus just off the edge is already loaded when
   * a small pan brings it into view, instead of popping in afterwards.
   */
  viewportBbox(margin = 0.15): {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  } {
    const bounds = this.map.getBounds();
    const lonPad = (bounds.getEast() - bounds.getWest()) * margin;
    const latPad = (bounds.getNorth() - bounds.getSouth()) * margin;
    return {
      minLon: bounds.getWest() - lonPad,
      minLat: bounds.getSouth() - latPad,
      maxLon: bounds.getEast() + lonPad,
      maxLat: bounds.getNorth() + latPad,
    };
  }

  /**
   * Keeps the map's idea of "centre" clear of the sheet.
   *
   * Without this, flying to a bus puts it behind the panel — the single most
   * common way a map wastes a tap. The sheet is a bottom sheet on a phone and a
   * left column on a wide screen, so which edge is obscured changes with it.
   */
  setPadding(padding: MapPadding): void {
    this.map.setPadding({
      top: padding.top,
      bottom: padding.bottom,
      left: padding.left,
      right: 0,
    });
  }

  focus(center: [number, number], zoom?: number): void {
    this.map.easeTo({
      center,
      ...(zoom === undefined ? {} : { zoom }),
      duration: prefersReducedMotion() ? 0 : 700,
    });
  }

  fit(bounds: LngLatBoundsLike, extraPadding = 48): void {
    this.map.fitBounds(bounds, {
      padding: extraPadding,
      duration: prefersReducedMotion() ? 0 : 800,
      maxZoom: 14,
    });
  }

  resize(): void {
    this.map.resize();
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
