import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(SERVER_ROOT, "..");

/** Consolidated static GTFS feed (~125 MB zip, 10 files). GET only. */
export const GTFS_STATIC_URL =
  "https://regionetoscana.smartregion.toscana.it/mobility/artifacts/gtfs";

/** Tuscany (region 9) municipal boundaries, WGS84, 273 comuni. */
export const COMUNI_GEOJSON_URL =
  "https://raw.githubusercontent.com/openpolis/geojson-italy/master/geojson/limits_R_9_municipalities.geojson";

/** GTFS-RT feeds. GET only — HEAD returns an empty reply. Every fetch is a full snapshot. */
export const RT_VEHICLE_POSITIONS_URL =
  "https://regionetoscana.smartregion.toscana.it/mobility/artifacts/gtfs-rt/vehicle-positions";
export const RT_TRIP_UPDATES_URL =
  "https://regionetoscana.smartregion.toscana.it/mobility/artifacts/gtfs-rt/trip-updates";

export const USER_AGENT = "DoveBus/0.1 (static feed importer)";

/** CC BY obligation for both data sources — must be shown in the UI. */
export const ATTRIBUTION_GTFS = "Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)";
export const ATTRIBUTION_COMUNI = "Confini comunali: openpolis/ISTAT (CC BY 4.0)";

/** Bumped whenever the schema changes in a way that requires a full re-import. */
export const DB_VERSION = 1;

/** Rows per write transaction during bulk import — bounds journal growth. */
export const IMPORT_BATCH_SIZE = 100_000;

/**
 * Poll cadences. The publisher regenerates the vehicle-positions header roughly
 * every 120 s (measured in Phase 0), so 30 s is comfortably ahead of it without
 * hammering the source; trip-updates move slower and only carry delays.
 */
export const RT_VEHICLE_POLL_MS = 30_000;
export const RT_TRIP_UPDATE_POLL_MS = 60_000;

/** Ceiling for the adaptive backoff applied when a snapshot repeats or a fetch fails. */
export const RT_MAX_POLL_MS = 240_000;

/** How long a vehicle's positions are kept for the trail (RAM only, no history in MVP). */
export const TRAIL_WINDOW_MS = 30 * 60_000;

/** A vehicle unseen for this long is dropped from the live state: its run has ended. */
export const VEHICLE_TTL_MS = 10 * 60_000;

/**
 * Freshness buckets, in seconds of age (`now - vehicle.timestamp`).
 *
 * Calibrated to what this operator actually publishes, measured over 1,127
 * vehicles: a bus's timestamp is already ~40–60 s old when the snapshot appears,
 * and that snapshot then ages ~120 s before the next one. The plan's original
 * 30/90/180 s bands were unreachable at the bottom and painted a healthy bus
 * "stale" for much of every cycle — the colour tracked the publisher's clock
 * rather than the bus. These bands describe the bus; the exact age in seconds is
 * shown alongside regardless, so nothing is rounded away.
 */
export const FRESHNESS_LIVE_S = 90;
export const FRESHNESS_RECENT_S = 180;
export const FRESHNESS_DELAYED_S = 300;

/** Sanity bounds for Tuscany — the live feed does emit stray positions outside them. */
export const TUSCANY_BBOX = {
  minLat: 42.2,
  maxLat: 44.5,
  minLon: 9.6,
  maxLon: 12.5,
} as const;

/** Where the built database and download scratch live. Override for tests/deploys. */
export const DATA_DIR = process.env.DOVEBUS_DATA_DIR ?? resolve(REPO_ROOT, "data");

/** The database the API serves from. Never written in place — see swapDatabase. */
export const LIVE_DB_PATH = resolve(DATA_DIR, "gtfs.db");

/** The database an import builds into, then atomically renames over the live one. */
export const STAGING_DB_PATH = resolve(DATA_DIR, "gtfs.new.db");

export const DOWNLOAD_DIR = resolve(DATA_DIR, "tmp");
