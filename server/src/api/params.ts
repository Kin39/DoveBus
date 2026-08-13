import { TUSCANY_BBOX } from "../config.js";
import type { Bbox } from "../geo/bbox.js";
import { gtfsTimeToSeconds } from "../gtfs/time.js";
import { parseServiceDate, toServiceDate } from "../util/date.js";
import { HttpError } from "./errors.js";

/**
 * The end of a service day, in seconds since its midnight. GTFS runs past 24:00
 * (a 25:10 departure belongs to the previous day), so an unbounded window has to
 * reach beyond 24 h or the night runs disappear from every search.
 */
export const SERVICE_DAY_END_SECONDS = 27 * 3600;

const COORDINATE_LIMITS = { lat: 90, lon: 180 } as const;

/**
 * Query string as plain single-valued strings.
 *
 * Fastify hands back an array when a parameter is repeated (`?q=a&q=b`); the API
 * is single-valued throughout, so the last value wins rather than a handler
 * comparing an array against a string and getting a confusing 400.
 */
export function readQuery(raw: unknown): Record<string, string | undefined> {
  const source = (raw ?? {}) as Record<string, unknown>;
  const params: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(source)) {
    const single = Array.isArray(value) ? value[value.length - 1] : value;
    if (typeof single === "string") params[key] = single;
  }
  return params;
}

export function requireParam(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw HttpError.badRequest(`${name} is required`);
  return trimmed;
}

/** GTFS service date (`YYYYMMDD`), defaulting to today in the agency's local day. */
export function parseDate(value: string | undefined, now: Date = new Date()): string {
  const raw = value?.trim();
  if (!raw) return toServiceDate(now);
  if (!parseServiceDate(raw)) {
    throw HttpError.badRequest(`date must be a valid YYYYMMDD service date, got "${raw}"`);
  }
  return raw;
}

export interface TimeWindow {
  readonly fromSeconds: number;
  readonly toSeconds: number;
}

/**
 * A departure window, in seconds since service midnight.
 *
 * Accepts `HH:MM` and `HH:MM:SS`, including hours past 24 — the same convention
 * the timetable itself uses, so "give me tonight's last runs" is expressible.
 */
export function parseWindow(from: string | undefined, to: string | undefined): TimeWindow {
  const fromSeconds = parseTime("from", from, 0);
  const toSeconds = parseTime("to", to, SERVICE_DAY_END_SECONDS);
  if (toSeconds < fromSeconds) {
    throw HttpError.badRequest("to must not be before from");
  }
  return { fromSeconds, toSeconds };
}

function parseTime(name: string, value: string | undefined, fallback: number): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  // HH:MM is what a time input sends; GTFS itself always writes seconds.
  const seconds = gtfsTimeToSeconds(/^\d{1,3}:\d{2}$/.test(raw) ? `${raw}:00` : raw);
  if (seconds === null) {
    throw HttpError.badRequest(`${name} must be a time like 06:30 or 25:10:00, got "${raw}"`);
  }
  return seconds;
}

/**
 * Map viewport, as `minLon,minLat,maxLon,maxLat` — the order MapLibre's
 * `getBounds().toArray()` flattens to, so the frontend passes it straight through.
 * Absent means the whole region, which is ~1000 vehicles and a bounded response.
 */
export function parseBbox(value: string | undefined): Bbox {
  const raw = value?.trim();
  if (!raw) return TUSCANY_BBOX;

  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw HttpError.badRequest("bbox must be four numbers: minLon,minLat,maxLon,maxLat");
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];

  if (
    Math.abs(minLat) > COORDINATE_LIMITS.lat ||
    Math.abs(maxLat) > COORDINATE_LIMITS.lat ||
    Math.abs(minLon) > COORDINATE_LIMITS.lon ||
    Math.abs(maxLon) > COORDINATE_LIMITS.lon
  ) {
    throw HttpError.badRequest("bbox coordinates are out of range");
  }
  if (minLat > maxLat || minLon > maxLon) {
    throw HttpError.badRequest("bbox minimums must not exceed its maximums");
  }
  return { minLat, maxLat, minLon, maxLon };
}

export interface LimitOptions {
  readonly fallback: number;
  readonly max: number;
}

/** Clamped rather than rejected at the top end: a big number is a client being hopeful, not wrong. */
export function parseLimit(value: string | undefined, options: LimitOptions): number {
  const raw = value?.trim();
  if (!raw) return options.fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw HttpError.badRequest(`limit must be a non-negative integer, got "${raw}"`);
  }
  return Math.min(parsed, options.max);
}
