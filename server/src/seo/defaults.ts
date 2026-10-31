import { resolve } from "node:path";

/**
 * The thresholds and paths behind `client/seo/lines.json`, shared by `seo-data`
 * and `seo-refresh` so a scheduled refresh can never drift from a manual one.
 */

/**
 * The floor for a line to be worth a page, in runs on the reference day.
 *
 * Round, and not reverse-engineered from a target page count: 70 yields 102
 * candidates on the 20260918 timetable, where 72 would have yielded exactly 100
 * — a number that looks chosen because it is. Every line above this floor runs
 * at least seventy times a day, which is the argument that these pages describe
 * service rather than fill a template.
 */
export const DEFAULT_MIN_TRIPS = 70;

/**
 * How representative a direction's busiest itinerary must be to be published.
 *
 * Measured over the 200 directions of the first hundred lines: the busiest
 * itinerary covers over 90% of the day's stops in 44% of them, and under half
 * in 24%. At 0.75, 128 directions publish a route — median 25 stops — and the
 * rest say the line has no single one, which for Prato's 207, whose busiest of
 * 24 itineraries touches 42 of 252 stops, is simply the truth.
 */
export const DEFAULT_MIN_COVERAGE = 0.75;

/** Written where the client build can read it; `client/data/` would be gitignored. */
export const LINE_DATA_PATH = resolve(import.meta.dirname, "../../../client/seo/lines.json");

/** The hand-kept list of which candidates are published, and in which batch. */
export const PUBLISHED_PATH = resolve(import.meta.dirname, "../../../client/seo/published.json");
