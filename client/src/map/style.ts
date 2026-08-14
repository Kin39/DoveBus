import type { StyleSpecification } from "maplibre-gl";

/** Tuscany, as the map opens. */
export const TUSCANY_CENTER: [number, number] = [11.15, 43.55];
export const TUSCANY_INITIAL_ZOOM = 8.1;

/** The region the API will answer for — the map refuses to wander outside it. */
export const TUSCANY_MAX_BOUNDS: [[number, number], [number, number]] = [
  [8.9, 41.6],
  [13.2, 45.1],
];

export const ATTRIBUTION_HTML = [
  'Dati: <a href="https://dati.toscana.it/" target="_blank" rel="noopener">Regione Toscana</a> (CC BY 4.0)',
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  "© CARTO",
].join(" · ");

/**
 * The basemap.
 *
 * Raster rather than vector because every free vector source needs an API key,
 * and a key is a deployment secret this product does not otherwise have. CARTO's
 * dark tiles are then pulled toward the product's petrol ink by letting a
 * coloured background bleed through them — the tint is applied to the basemap
 * layer alone, so the vehicle colours drawn on top keep their exact meaning.
 */
export function basemapStyle(): StyleSpecification {
  return {
    version: 8,
    // No `glyphs`: the style has no symbol layers, because the raster basemap
    // carries its own labels and the interface draws no map text of its own.
    // An empty string here is not "none" — it is an invalid URL template, and it
    // makes MapLibre reject the whole style, leaving a black screen.
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
          // The map is a backdrop, not the subject — but a backdrop a rider still
          // has to read a street off. Desaturating cools the tiles toward the
          // interface's paper and leaves the vehicle colours as the only
          // saturated things on screen; the contrast stays up so the road
          // network does not wash out to nothing underneath them.
          "raster-opacity": 1,
          "raster-contrast": 0.06,
          "raster-saturation": -0.3,
        },
      },
    ],
  };
}
