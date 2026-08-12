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

export const USER_AGENT = "DoveBus/0.1 (static feed importer)";

/** CC BY obligation for both data sources — must be shown in the UI. */
export const ATTRIBUTION_GTFS = "Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)";
export const ATTRIBUTION_COMUNI = "Confini comunali: openpolis/ISTAT (CC BY 4.0)";

/** Bumped whenever the schema changes in a way that requires a full re-import. */
export const DB_VERSION = 1;

/** Rows per write transaction during bulk import — bounds journal growth. */
export const IMPORT_BATCH_SIZE = 100_000;

/** Where the built database and download scratch live. Override for tests/deploys. */
export const DATA_DIR = process.env.DOVEBUS_DATA_DIR ?? resolve(REPO_ROOT, "data");

/** The database the API serves from. Never written in place — see swapDatabase. */
export const LIVE_DB_PATH = resolve(DATA_DIR, "gtfs.db");

/** The database an import builds into, then atomically renames over the live one. */
export const STAGING_DB_PATH = resolve(DATA_DIR, "gtfs.new.db");

export const DOWNLOAD_DIR = resolve(DATA_DIR, "tmp");
