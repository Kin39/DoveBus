import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { t } from "../i18n/index.js";

/** Tuscany, as the map opens. */
export const TUSCANY_CENTER: [number, number] = [11.15, 43.55];
export const TUSCANY_INITIAL_ZOOM = 8.1;

/** The region the API will answer for — the map refuses to wander outside it. */
export const TUSCANY_MAX_BOUNDS: [[number, number], [number, number]] = [
  [8.9, 41.6],
  [13.2, 45.1],
];

/**
 * The vector basemap: OpenStreetMap data, OpenMapTiles schema, served by
 * OpenFreeMap without an API key.
 *
 * The key is what makes this possible. The earlier note here said every free
 * vector source needs one and a key is a deployment secret this product does
 * not otherwise have — true of Mapbox, MapTiler and CARTO's own vector tiles,
 * false of OpenFreeMap, which serves the planet anonymously.
 */
const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** How long the basemap gets to answer before the raster fallback takes over. */
const STYLE_FETCH_TIMEOUT_MS = 4000;

/**
 * The paper the map is printed on. Shown alone while the style is in flight, so
 * the first frame is the product's own colour rather than a white flash or the
 * canvas's black.
 */
const BASEMAP_PAPER = "#f6f4ef";

export type BasemapSource = "openfreemap" | "carto";

/** Plain-text credits, per basemap, for the footer inside the sheet. */
const BASEMAP_CREDIT: Record<BasemapSource, string> = t.credits.basemap;

export const ATTRIBUTION_HTML = t.credits.attributionHtml;

/**
 * The colour table, applied over Positron by layer id.
 *
 * Positron ships a blue-grey paper, and that grey is most of why the interface
 * reads as glacial: the basemap is four fifths of the screen. Every value here
 * is warmer than the one it replaces, and the ramp stays inside the same
 * editorial rule as the rest of the product — the map is monochrome warm paper,
 * and saturation is spent only on water, which has to stay water.
 *
 * Two departures from the reference this was taken from. Its motorways are
 * amber (`#e2c18f` casing over `#fff0cf`), and amber is DoveBus's delay colour:
 * a rider must never have to ask whether a warm streak is a late bus or a road.
 * The motorway keeps its weight instead, carried by a darker casing than the
 * major roads get. And its tunnels stay as found, because pale cream is far
 * enough from the delay ramp to be read as nothing at all.
 */
const BASEMAP_PAINT: Record<string, Record<string, unknown>> = {
  background: { "background-color": BASEMAP_PAPER },
  park: { "fill-color": "#dcebd5", "fill-opacity": 0.9 },
  water: { "fill-color": "#a9d6ed" },
  landuse_residential: { "fill-color": "#efeee9" },
  landcover_wood: { "fill-color": "#d7e8d1" },
  waterway: { "line-color": "#9bcbe3" },
  building: { "fill-color": "#e8e5df", "fill-outline-color": "#d9d5ce" },
  road_area_pier: { "fill-color": BASEMAP_PAPER },
  road_pier: { "line-color": BASEMAP_PAPER },
  highway_path: { "line-color": "#eeeae3", "line-opacity": 0.82 },
  highway_minor: { "line-color": "#ffffff", "line-opacity": 0.96 },
  highway_major_casing: { "line-color": "#d8d3ca" },
  highway_major_inner: { "line-color": "#fffdf9" },
  highway_major_subtle: { "line-color": "rgba(203, 199, 191, 0.72)" },
  highway_motorway_casing: { "line-color": "#c7bfb2" },
  highway_motorway_inner: { "line-color": "#fffdf9" },
  highway_motorway_subtle: { "line-color": "rgba(199, 191, 178, 0.7)" },
  highway_motorway_bridge_casing: { "line-color": "#c7bfb2" },
  highway_motorway_bridge_inner: { "line-color": "#fffdf9" },
  tunnel_motorway_casing: { "line-color": "#ded7cd" },
  tunnel_motorway_inner: { "line-color": "#f8efe1" },
  railway: { "line-color": "#c9c7c3" },
  railway_transit: { "line-color": "#c9c7c3" },
  railway_service: { "line-color": "#d1cfcb" },
  boundary_2: { "line-color": "#aaa9a5" },
  boundary_3: { "line-color": "#b5b3ae" },
  boundary_disputed: { "line-color": "#aaa9a5" },
  waterway_line_label: { "text-color": "#4d84a5", "text-halo-color": "rgba(246, 250, 252, 0.9)" },
  water_name_point_label: {
    "text-color": "#3479a3",
    "text-halo-color": "rgba(246, 250, 252, 0.9)",
  },
  water_name_line_label: { "text-color": "#3479a3", "text-halo-color": "rgba(246, 250, 252, 0.9)" },
  "highway-name-path": { "text-color": "#85817a", "text-halo-color": "rgba(255, 253, 249, 0.92)" },
  "highway-name-minor": { "text-color": "#6e6c68", "text-halo-color": "rgba(255, 253, 249, 0.92)" },
  "highway-name-major": { "text-color": "#5f5d59", "text-halo-color": "rgba(255, 253, 249, 0.94)" },
  airport: { "text-color": "#686a6d", "text-halo-color": "rgba(255, 255, 255, 0.92)" },
  label_other: { "text-color": "#5f6265", "text-halo-color": "rgba(255, 255, 255, 0.9)" },
  label_village: { "text-color": "#34373a", "text-halo-color": "rgba(255, 255, 255, 0.92)" },
  label_town: { "text-color": "#292c2f", "text-halo-color": "rgba(255, 255, 255, 0.94)" },
  label_city: { "text-color": "#202326", "text-halo-color": "rgba(255, 255, 255, 0.94)" },
  label_city_capital: { "text-color": "#202326", "text-halo-color": "rgba(255, 255, 255, 0.94)" },
};

/** A layer as this module needs to read it, behind the style spec's union. */
interface PaintedLayer {
  readonly id: string;
  readonly paint?: Record<string, unknown>;
  readonly layout?: Record<string, unknown>;
}

/**
 * The Italian label for a layer, or undefined if the layer names no place.
 *
 * Positron asks for `name_en` before `name`, which puts "Florence" and "Leghorn"
 * on a map whose entire interface is in Italian. The order is inverted here: the
 * Italian name, then the name OSM holds locally — which in Tuscany is already
 * the Italian one — and last a Latin transliteration, for the rare foreign
 * feature whose own script the font cannot set.
 *
 * Only layers that actually name a place get one: road shields set their `ref` —
 * "A1", "SS67" — and rewriting those would blank every motorway badge. Testing
 * the existing expression for the string `name` is what tells the two apart
 * without hard-coding a list that a style update could silently outdate.
 *
 * A fresh expression is built per layer rather than shared across all fourteen
 * of them. MapLibre compiles expressions and does not write to them, so one
 * shared array would work today — it is simply not worth owning that assumption.
 */
function italianLabelFor(layout: Record<string, unknown> | undefined): unknown {
  const field = layout?.["text-field"];
  if (field === undefined) return undefined;
  if (!JSON.stringify(field).includes('"name')) return undefined;
  return ["coalesce", ["get", "name:it"], ["get", "name"], ["get", "name:latin"]];
}

/** A layer with our colours and our labels, as a new object. */
function repainted(layer: LayerSpecification): LayerSpecification {
  const source = layer as unknown as PaintedLayer;
  const paint = BASEMAP_PAINT[source.id];
  const label = italianLabelFor(source.layout);
  if (paint === undefined && label === undefined) return layer;
  return {
    ...layer,
    ...(paint === undefined ? {} : { paint: { ...source.paint, ...paint } }),
    ...(label === undefined ? {} : { layout: { ...source.layout, "text-field": label } }),
  } as LayerSpecification;
}

/**
 * Is what came back actually a style?
 *
 * `response.ok` and a successful `JSON.parse` prove only that something arrived
 * and that it was JSON — which a CDN error page, a captive portal, or a schema
 * change upstream all satisfy. Without this check that document reaches
 * `setStyle`, MapLibre rejects it, and the map never finishes loading: no
 * basemap, no vehicle layer, no error a rider can see, and no fallback, because
 * as far as the fetch was concerned nothing went wrong. Failing here instead
 * puts it back on the path that already knows what to do.
 *
 * The check is deliberately shallow. Proving a style renders is MapLibre's job;
 * ours is only to refuse a document that plainly is not one.
 */
function isUsableStyle(value: unknown): value is StyleSpecification {
  if (typeof value !== "object" || value === null) return false;
  const style = value as { version?: unknown; layers?: unknown; sources?: unknown };
  if (style.version !== 8) return false;
  if (!Array.isArray(style.layers)) return false;
  return typeof style.sources === "object" && style.sources !== null;
}

/**
 * The first frame: paper and nothing else.
 *
 * MapLibre needs a valid style at construction, and the real one arrives over
 * the network a moment later. An empty background is the honest placeholder —
 * it is the same colour the finished map is printed on, so the basemap fades in
 * rather than replacing something that looked like a different product.
 */
export function bootStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "paper", type: "background", paint: { "background-color": BASEMAP_PAPER } }],
  };
}

/**
 * The fallback.
 *
 * CARTO's raster Positron — the same cartography, already painted into PNGs, so
 * the only colour control left is a wash over the whole image. It cannot be
 * warmed to match the vector table above, and it is not meant to: this is what
 * the map looks like on the day OpenFreeMap does not answer, and a slightly
 * cooler map is a better failure than no map.
 */
function cartoStyle(): StyleSpecification {
  return {
    version: 8,
    // No `glyphs`: this style has no symbol layers, because the raster basemap
    // carries its own labels. An empty string here is not "none" — it is an
    // invalid URL template, and it makes MapLibre reject the whole style.
    sources: {
      carto: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: ATTRIBUTION_HTML,
      },
    },
    layers: [
      { id: "paper", type: "background", paint: { "background-color": "#eef2f7" } },
      {
        id: "basemap",
        type: "raster",
        source: "carto",
        paint: {
          "raster-opacity": 1,
          "raster-contrast": 0.06,
          "raster-saturation": -0.3,
        },
      },
    ],
  };
}

/** Fetches Positron and repaints it, or throws so the caller can fall back. */
async function openFreeMapStyle(): Promise<StyleSpecification> {
  const response = await fetch(OPENFREEMAP_STYLE_URL, {
    signal: AbortSignal.timeout(STYLE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`basemap style: HTTP ${response.status}`);

  const parsed: unknown = await response.json();
  if (!isUsableStyle(parsed)) throw new Error("basemap style: not a MapLibre style document");

  return { ...parsed, layers: parsed.layers.map(repainted) };
}

export interface Basemap {
  readonly style: StyleSpecification;
  readonly source: BasemapSource;
  /** Plain-text line for the credits footer, naming whichever basemap loaded. */
  readonly credit: string;
}

/** The raster basemap, ready to use — reachable without the network. */
export function cartoBasemap(): Basemap {
  return { style: cartoStyle(), source: "carto", credit: BASEMAP_CREDIT.carto };
}

/**
 * The basemap, with its fallback.
 *
 * OpenFreeMap is free, unmetered and run on donations by one person — which is
 * the whole reason this is written as a race against a clock rather than a
 * plain await. Neither basemap comes with an agreement to be up, so the answer
 * to both is the same: try the good one, bounded, and keep the other warm.
 */
export async function loadBasemap(): Promise<Basemap> {
  try {
    return {
      style: await openFreeMapStyle(),
      source: "openfreemap",
      credit: BASEMAP_CREDIT.openfreemap,
    };
  } catch (error) {
    console.warn("Vector basemap unavailable — using CARTO raster tiles.", error);
    return cartoBasemap();
  }
}
