import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { centroid } from "@turf/centroid";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { normalizeName } from "./normalize.js";

/**
 * Shortest comune name accepted by the stop-name fallback. Guards against
 * two/three-letter names matching a fragment of an unrelated stop name.
 */
const MIN_FALLBACK_NAME_LENGTH = 4;

/**
 * How far outside a comune's bounding box a name-matched stop may still sit
 * (~5 km). Stop names contain place names that are not the stop's own comune —
 * "BIVIO PRATO" is a junction 98 km from the city of Prato — so a name match is
 * only trusted when the coordinates agree with it.
 */
const FALLBACK_BBOX_MARGIN_DEG = 0.05;

export type Bbox = readonly [minLon: number, minLat: number, maxLon: number, maxLat: number];

export interface Comune {
  readonly istatCode: string;
  readonly name: string;
  readonly nameNorm: string;
  readonly centroidLat: number;
  readonly centroidLon: number;
  readonly bbox: Bbox;
  readonly feature: Feature<Polygon | MultiPolygon>;
}

export interface ComuneResolution {
  readonly istatCode: string;
  readonly name: string;
  /** How the match was made — `polygon` is authoritative, `name` is the fallback. */
  readonly source: "polygon" | "name";
}

export interface StopLocation {
  readonly lat: number | null;
  readonly lon: number | null;
  readonly name: string;
}

export type ComuneResolver = (stop: StopLocation) => ComuneResolution | null;

/**
 * Parses the openpolis `limits_R_9_municipalities.geojson` (Tuscany, 273 comuni,
 * WGS84) into resolver-ready records. Validates at the boundary: a feed that has
 * silently changed shape must fail the import loudly, not enrich stops with nulls.
 */
export function loadComuni(geojson: unknown): readonly Comune[] {
  const collection = geojson as { type?: string; features?: unknown[] };
  if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("comuni GeoJSON: expected a FeatureCollection with a features array");
  }

  return collection.features.map((raw, index) => {
    const feature = raw as Feature<Polygon | MultiPolygon>;
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const name = properties.name;
    const istatCode = properties.com_istat_code;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`comuni GeoJSON: feature ${index} has no "name" property`);
    }
    if (typeof istatCode !== "string" || istatCode.length === 0) {
      throw new Error(`comuni GeoJSON: feature ${index} ("${name}") has no "com_istat_code"`);
    }
    if (!feature.geometry) {
      throw new Error(`comuni GeoJSON: feature ${index} ("${name}") has no geometry`);
    }

    const [centroidLon, centroidLat] = centroid(feature).geometry.coordinates as [number, number];
    return {
      istatCode,
      name,
      nameNorm: normalizeName(name),
      centroidLat,
      centroidLon,
      bbox: boundingBox(feature.geometry.coordinates),
      feature,
    };
  });
}

/**
 * Resolves a stop to its comune: point-in-polygon first (99.3% hit on the live
 * feed), then a normalized stop-name match for the border cases PIP misses.
 * Returns null for stops genuinely outside Tuscany — an honest null beats a
 * wrong comune, since comune membership drives the origin→destination search.
 */
export function createComuneResolver(comuni: readonly Comune[]): ComuneResolver {
  // Longest name first so "SAN GIMIGNANO" wins over a shorter contained name.
  const fallbackCandidates = [...comuni]
    .filter((comune) => comune.nameNorm.length >= MIN_FALLBACK_NAME_LENGTH)
    .sort((a, b) => b.nameNorm.length - a.nameNorm.length);

  return (stop) => {
    const byPolygon = resolveByPolygon(comuni, stop);
    if (byPolygon) return byPolygon;
    return resolveByName(fallbackCandidates, stop);
  };
}

function resolveByPolygon(comuni: readonly Comune[], stop: StopLocation): ComuneResolution | null {
  const { lat, lon } = stop;
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  for (const comune of comuni) {
    const [minLon, minLat, maxLon, maxLat] = comune.bbox;
    // Cheap rejection first: full PIP against 273 polygons per stop is the cost driver.
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
    if (booleanPointInPolygon([lon, lat], comune.feature)) {
      return { istatCode: comune.istatCode, name: comune.name, source: "polygon" };
    }
  }
  return null;
}

function resolveByName(candidates: readonly Comune[], stop: StopLocation): ComuneResolution | null {
  const normalized = normalizeName(stop.name);
  if (normalized.length === 0) return null;

  for (const comune of candidates) {
    if (!normalized.includes(comune.nameNorm)) continue;
    // A name match only counts if the stop is actually near that comune.
    if (!isNearBbox(comune.bbox, stop)) continue;
    return { istatCode: comune.istatCode, name: comune.name, source: "name" };
  }
  return null;
}

/** True when the stop lies within the comune's bbox plus a tolerance margin. */
function isNearBbox(bbox: Bbox, stop: StopLocation): boolean {
  const { lat, lon } = stop;
  // Without coordinates the name is the only evidence there is.
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return true;

  const [minLon, minLat, maxLon, maxLat] = bbox;
  return (
    lon >= minLon - FALLBACK_BBOX_MARGIN_DEG &&
    lon <= maxLon + FALLBACK_BBOX_MARGIN_DEG &&
    lat >= minLat - FALLBACK_BBOX_MARGIN_DEG &&
    lat <= maxLat + FALLBACK_BBOX_MARGIN_DEG
  );
}

function boundingBox(coordinates: unknown): Bbox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const scan = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      const [lon, lat] = node as [number, number];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const child of node) scan(child);
  };
  scan(coordinates);

  return [minLon, minLat, maxLon, maxLat];
}
