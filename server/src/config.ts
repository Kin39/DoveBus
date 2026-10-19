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

/**
 * The agency's clock. A GTFS service date is a local calendar day, so "today"
 * must be asked of Rome and not of the server: a UTC box — which is what the
 * deployment target is — would answer with yesterday's date for the two hours
 * before midnight, quietly serving the wrong timetable to every request that
 * omits a date.
 */
export const AGENCY_TIMEZONE = "Europe/Rome";

/** CC BY obligation for both data sources — must be shown in the UI. */
export const ATTRIBUTION_GTFS = "Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)";
export const ATTRIBUTION_COMUNI = "Confini comunali: openpolis/ISTAT (CC BY 4.0)";

/**
 * What `GET /` tells a caller: who serves this API and where its code is. The
 * AGPL asks a network service to offer its users the source, and an API's
 * users never see the site's footer.
 */
export const SERVICE_ABOUT = {
  name: "DoveBus",
  website: "https://dovebus.it",
  sourceCode: "https://github.com/Kin39/DoveBus",
  licence: "AGPL-3.0-or-later",
} as const;

/** Bumped whenever the schema changes in a way that requires a full re-import. */
export const DB_VERSION = 2;

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

/**
 * API listen address. The port is fixed by the plan so the frontend's
 * `VITE_API_BASE` never has to guess; the default host stays on the loopback
 * because the deployment terminates TLS in Caddy in front of this process.
 */
export const API_PORT = Number(process.env.DOVEBUS_PORT ?? 3200);
export const API_HOST = process.env.DOVEBUS_HOST ?? "127.0.0.1";

/**
 * Browser origins allowed to read the API. Open by default: this serves nothing
 * but public CC-BY timetable data, has no cookies and no authentication, so an
 * origin check would protect nothing while breaking every preview deploy.
 */
export const API_CORS_ORIGIN = process.env.DOVEBUS_CORS_ORIGIN ?? "*";

/** Requests per IP per minute. Generous for a map that polls, cheap insurance against a scraper. */
export const RATE_LIMIT_PER_MINUTE = Number(process.env.DOVEBUS_RATE_LIMIT ?? 300);

/**
 * The same, for `/api/vehicles` alone — the one endpoint whose cost is measured
 * in megabytes rather than milliseconds.
 *
 * A viewport request is small, but the whole region is **448 KB in 4.5 ms**, and
 * at the general limit one caller could pull ~134 MB a minute: not a
 * vulnerability, a bill. The map refreshes every 30 s and again 400 ms after a
 * pan settles, so sixty a minute is far more than a person panning hard will
 * ever need and a fifth of what a scraper was being handed.
 */
export const VEHICLES_RATE_LIMIT_PER_MINUTE = Number(process.env.DOVEBUS_VEHICLES_RATE_LIMIT ?? 60);

/**
 * When the share of live trips missing from the timetable means it is stale.
 *
 * The expiry check alone is not enough: this operator republishes *inside* the
 * validity window it declared, so `feed_end_date` can read three weeks out while
 * the timetable has already stopped describing the buses on the road. Measured
 * across that exact event — 3.4% unmatched is normal (genuine extra service),
 * 21.2% was a timetable three days out of date, 0.3% after the refresh. Ten per
 * cent sits clear of both.
 */
export const MAX_UNMATCHED_TRIP_RATIO = 0.1;

/**
 * Live trips needed before that ratio means anything.
 *
 * At 04:00 three buses are running and one piece of extra service would read as
 * a third of the fleet gone missing.
 */
export const MIN_TRIP_MATCH_SAMPLE = 50;

/**
 * How often the API asks whether its timetable still describes the live fleet.
 *
 * Cheap — a few hundred indexed lookups — so the limit is not cost but noise:
 * checking faster than the realtime feed regenerates (~120 s) would just re-read
 * the same fleet.
 */
export const TIMETABLE_CHECK_MS = 5 * 60_000;

/**
 * Minimum gap between two automatically triggered refreshes.
 *
 * Each one is a 125 MB download and a full rebuild. If a refresh did not fix the
 * match rate, repeating it immediately will not either — the cause is upstream,
 * and the daily timer is still there.
 */
export const TIMETABLE_REFRESH_COOLDOWN_MS = 60 * 60_000;

/**
 * Whether the API may refresh its own timetable when it goes stale.
 *
 * On by default: the alternative is serving schedules that no longer describe
 * the buses on the road for up to a day, which is what happened on 2026-08-15.
 * Off for anyone who would rather the scheduled job be the only thing that
 * downloads 125 MB.
 *
 * The default is only defensible because the watch now **gives up**: a refresh
 * that fails to restore the match disarms it until the operator publishes a
 * different feed. Without that, a live fleet running trip ids the static feed
 * has never contained — which is the standing state of this source — meant one
 * rebuild per cooldown, for ever. See `feed/watch.ts`.
 */
export const AUTO_REFRESH = process.env.DOVEBUS_AUTO_REFRESH !== "false";

/** How often a read re-stats the database file to notice the refresh job's atomic swap. */
export const DB_RELOAD_CHECK_MS = 5_000;

/** Comment line sent on idle SSE connections so proxies do not reap them. */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * How long a shutdown waits for in-flight work before exiting anyway.
 *
 * A live stream is an open socket held for as long as a rider watches their bus,
 * and a graceful close waits for every one of them — so a restart with viewers
 * connected would hang until systemd lost patience and sent SIGKILL. Browsers
 * reconnect to an SSE endpoint on their own, so dropping the stragglers costs a
 * client nothing and makes `systemctl restart` deterministic.
 */
export const SHUTDOWN_GRACE_MS = 5_000;

/**
 * Ceiling on concurrent live-trip streams. Each one is an open socket held for
 * as long as a rider watches their bus; without a cap a single client can pin
 * the process's file descriptors.
 */
export const MAX_SSE_CLIENTS = Number(process.env.DOVEBUS_MAX_STREAMS ?? 500);

/** Per-caller share of that budget: one client must not be able to spend all of it. */
export const MAX_SSE_CLIENTS_PER_IP = Number(process.env.DOVEBUS_MAX_STREAMS_PER_IP ?? 10);

/**
 * Whether to believe `X-Forwarded-For` — and if so, for how many hops.
 *
 * **Off unless a deploy says otherwise.** It used to be on unless disabled, and
 * that default was measured doing exactly what it looks like: 30 concurrent SSE
 * connections from one machine were all accepted when each carried a different
 * invented `X-Forwarded-For`, against 20 × `503` without it, and the rate
 * limiter's remaining count reset for every made-up address. The header is
 * written by the caller, so trusting it by default means the per-IP limits are
 * evadable by default; a deployment that needs the real client address is a
 * deliberate act and can say so.
 *
 * `DOVEBUS_TRUST_PROXY=1` is the form to prefer over `true`: `true` trusts the
 * *whole* chain, and Caddy and nginx **append** to `X-Forwarded-For` rather than
 * overwriting it, so a forged leftmost value is still what `proxy-addr` walks
 * back to. A hop count trusts only the proxies actually in front of this
 * process — one, in the intended deployment.
 */
export const TRUST_PROXY = parseTrustProxy(process.env.DOVEBUS_TRUST_PROXY);

function parseTrustProxy(raw: string | undefined): boolean | number {
  if (raw === undefined || raw === "" || raw === "false") return false;
  if (raw === "true") return true;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops > 0) return hops;
  throw new Error(
    `DOVEBUS_TRUST_PROXY must be "false", "true" or a positive hop count — got "${raw}"`,
  );
}

/** Where the built database and download scratch live. Override for tests/deploys. */
export const DATA_DIR = process.env.DOVEBUS_DATA_DIR ?? resolve(REPO_ROOT, "data");

/** The database the API serves from. Never written in place — see swapDatabase. */
export const LIVE_DB_PATH = resolve(DATA_DIR, "gtfs.db");

/** The database an import builds into, then atomically renames over the live one. */
export const STAGING_DB_PATH = resolve(DATA_DIR, "gtfs.new.db");

export const DOWNLOAD_DIR = resolve(DATA_DIR, "tmp");
