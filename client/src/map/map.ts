import type { LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
import { Map as MapLibreMap } from "maplibre-gl";
import type { Basemap } from "./style.js";
import {
  bootStyle,
  cartoBasemap,
  loadBasemap,
  TUSCANY_CENTER,
  TUSCANY_INITIAL_ZOOM,
  TUSCANY_MAX_BOUNDS,
} from "./style.js";
import { TripLayer } from "./trip.js";
import { VEHICLE_LAYER_ID, VehicleLayer } from "./vehicles.js";

/**
 * How long a style gets to finish loading before it is treated as broken.
 *
 * Generous on purpose: this is not a performance budget, it is the line past
 * which we stop waiting for something that is not coming.
 */
const STYLE_SETTLE_TIMEOUT_MS = 10_000;

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
  #basemapCredit: string | null = null;

  constructor(private readonly options: MapControllerOptions) {
    this.map = new MapLibreMap({
      container: options.container,
      style: bootStyle(),
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

    // Held as a local because TypeScript stops tracking a `readonly` field's
    // assignment across an `await` inside the constructor, not because the two
    // ever differ.
    const map = this.map;

    // The basemap is fetched alongside the boot style rather than after it, so
    // the network round trip overlaps the map's own start-up instead of
    // following it.
    const basemap = loadBasemap();
    const booted = new Promise<void>((resolve) => map.once("load", () => resolve()));

    this.#whenReady = (async () => {
      const [loaded] = await Promise.all([basemap, booted]);
      await this.#useBasemap(loaded);

      // Vehicles first so the trip lines have something to be inserted
      // *beneath*: the planned route and the trail must never draw over the
      // bus they belong to.
      this.#vehicles = new VehicleLayer(map);
      this.#trip = new TripLayer(map, VEHICLE_LAYER_ID);
      this.#ready = true;
      this.#bindInteraction();
    })();

    this.map.on("moveend", () => options.onViewportChange());
  }

  get ready(): Promise<void> {
    return this.#whenReady;
  }

  /**
   * The credit line the loaded basemap obliges. Null until the basemap settles,
   * which happens shortly before `ready` resolves.
   */
  get basemapCredit(): string | null {
    return this.#basemapCredit;
  }

  /**
   * Installs a basemap, dropping to the raster one if it will not load.
   *
   * The style document is validated before it gets here, so a broken style is
   * already meant to be impossible. This is the second line: whatever else goes
   * wrong, the map must not sit on a blank sheet forever, because the vehicle
   * layers are added after this and a wait that never ends is a product with no
   * buses in it.
   */
  async #useBasemap(basemap: Basemap): Promise<void> {
    this.#basemapCredit = basemap.credit;
    if (await this.#applyStyle(basemap.style)) return;
    if (basemap.source === "carto") return;

    console.warn("La basemap vettoriale non si è caricata, passo ai tile raster CARTO.");
    const raster = cartoBasemap();
    this.#basemapCredit = raster.credit;
    await this.#applyStyle(raster.style);
  }

  /**
   * Swaps in a style and waits for it to settle. Resolves false on timeout.
   *
   * Our own sources and layers are added only after this resolves. `setStyle`
   * replaces everything MapLibre is holding, so a vehicle layer added against
   * the boot style would be thrown away here without a word — and the bug that
   * causes is an empty map, not an error.
   *
   * `idle` is in here because `styledata` alone deadlocks. Measured against the
   * real style: `setStyle` fires `styledata` three times over ~230 ms with
   * `isStyleLoaded()` false at every one, then goes quiet — the event that
   * finally arrives with the style ready is `idle`. Waiting on `styledata` and
   * trusting it to come back once more is a promise that never resolves.
   */
  #applyStyle(style: StyleSpecification): Promise<boolean> {
    return new Promise((resolve) => {
      const stop = (loaded: boolean): void => {
        window.clearTimeout(timer);
        this.map.off("styledata", settled);
        this.map.off("idle", settled);
        resolve(loaded);
      };
      const settled = (): void => {
        if (this.map.isStyleLoaded()) stop(true);
      };
      const timer = window.setTimeout(() => stop(false), STYLE_SETTLE_TIMEOUT_MS);
      this.map.on("styledata", settled);
      this.map.on("idle", settled);
      this.map.setStyle(style);
    });
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
