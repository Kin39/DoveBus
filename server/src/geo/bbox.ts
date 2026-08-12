import { TUSCANY_BBOX } from "../config.js";

export interface Bbox {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLon: number;
  readonly maxLon: number;
}

/** Inclusive on the edges — a bus sitting exactly on a boundary is still a bus. */
export function isInsideBbox(lat: number, lon: number, bbox: Bbox): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
}

/**
 * Sanity filter for realtime positions.
 *
 * The live feed emits a couple of positions per snapshot far outside the region
 * (null island and similar); without this they render as ghost buses on the map.
 */
export function isInsideTuscany(lat: number, lon: number): boolean {
  return isInsideBbox(lat, lon, TUSCANY_BBOX);
}
