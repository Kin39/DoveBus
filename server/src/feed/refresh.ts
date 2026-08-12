import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  COMUNI_GEOJSON_URL,
  DATA_DIR,
  DB_VERSION,
  DOWNLOAD_DIR,
  GTFS_STATIC_URL,
  LIVE_DB_PATH,
  STAGING_DB_PATH,
} from "../config.js";
import { openDatabase } from "../db/index.js";
import { loadComuni } from "../geo/comuni.js";
import { type DownloadResult, downloadTo } from "../gtfs/download.js";
import { type ImportResult, importFeed, type ProgressEvent } from "../gtfs/import.js";
import { toServiceDate } from "../util/date.js";
import { acquireLock } from "../util/lock.js";
import { type FeedMeta, type FeedValidity, feedValidity, readFeedMeta } from "./meta.js";
import { swapDatabase } from "./swap.js";

/** Why an import ran (or did not). Surfaced in logs and the health endpoint. */
export type RefreshReason =
  | "no-database"
  | "feed-changed"
  | "schema-version"
  | "forced"
  | "unchanged";

interface RefreshOutcomeBase {
  readonly sha1: string;
  /** Validity of the database in place *after* this run. */
  readonly validity: FeedValidity | null;
  readonly previous: FeedMeta | null;
}

/**
 * Discriminated on `imported` so callers get the import result without having to
 * assert it is there: no import means there is no result, by construction.
 */
export type RefreshOutcome =
  | (RefreshOutcomeBase & {
      readonly imported: false;
      readonly reason: "unchanged";
      readonly result: null;
    })
  | (RefreshOutcomeBase & {
      readonly imported: true;
      readonly reason: Exclude<RefreshReason, "unchanged">;
      readonly result: ImportResult;
    });

export interface RefreshOptions {
  /** Re-import even when the downloaded feed is byte-identical. */
  readonly force?: boolean;
  readonly gtfsUrl?: string;
  readonly comuniGeoJsonUrl?: string;
  readonly comuniGeoJsonPath?: string;
  readonly livePath?: string;
  readonly stagingPath?: string;
  readonly downloadDir?: string;
  /** Service date used for the validity check; defaults to today. */
  readonly today?: string;
  readonly onProgress?: (event: ProgressEvent) => void;
  /** Injected for tests; defaults to the real HTTP download. */
  readonly download?: (url: string, destination: string) => Promise<DownloadResult>;
}

/**
 * Daily job: fetch the static feed, and rebuild + swap the database only when
 * the source actually changed.
 *
 * The operator publishes ~20-day timetables, so skipping this leaves the API
 * serving schedules that expired days ago — which looks like working data.
 */
export async function refreshFeed(options: RefreshOptions = {}): Promise<RefreshOutcome> {
  const livePath = options.livePath ?? LIVE_DB_PATH;
  const stagingPath = options.stagingPath ?? STAGING_DB_PATH;
  const downloadDir = options.downloadDir ?? DOWNLOAD_DIR;
  const comuniPath = options.comuniGeoJsonPath ?? resolve(DATA_DIR, "comuni_toscana.geojson");
  const download = options.download ?? downloadTo;
  const today = options.today ?? toServiceDate(new Date());

  await mkdir(downloadDir, { recursive: true });
  // Held for the whole run: the daily timer and a manual import must not build
  // the same staging file at the same time.
  const lock = acquireLock(resolve(downloadDir, "import.lock"));
  const previous = readLiveMeta(livePath);
  const zipPath = resolve(downloadDir, "gtfs-download.zip");

  try {
    const feed = await download(options.gtfsUrl ?? GTFS_STATIC_URL, zipPath);
    const reason = decideReason(previous, feed.sha1, options.force === true);

    if (reason === "unchanged") {
      return {
        imported: false,
        reason,
        sha1: feed.sha1,
        validity: previous ? feedValidity(previous, today) : null,
        result: null,
        previous,
      };
    }

    if (!existsSync(comuniPath)) {
      await download(options.comuniGeoJsonUrl ?? COMUNI_GEOJSON_URL, comuniPath);
      await assertUsableComuni(comuniPath);
    }

    const result = await importFeed({
      zipPath,
      comuniGeoJsonPath: comuniPath,
      dbPath: stagingPath,
      source: { sha1: feed.sha1, etag: feed.etag, bytes: feed.bytes },
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });

    swapDatabase(stagingPath, livePath);

    const current = readLiveMeta(livePath);
    return {
      imported: true,
      reason,
      sha1: feed.sha1,
      validity: current ? feedValidity(current, today) : null,
      result,
      previous,
    };
  } finally {
    await rm(zipPath, { force: true });
    lock.release();
  }
}

/**
 * The boundaries file is cached and reused across runs, so a truncated download
 * would otherwise poison every future import until someone deleted it by hand.
 * Validate once, and drop the file if it is unusable.
 */
async function assertUsableComuni(path: string): Promise<void> {
  try {
    loadComuni(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    await rm(path, { force: true });
    throw new Error(`downloaded comuni boundaries are unusable: ${String(error)}`, {
      cause: error,
    });
  }
}

function decideReason(previous: FeedMeta | null, sha1: string, force: boolean): RefreshReason {
  if (previous === null) return "no-database";
  if (force) return "forced";
  if (previous.dbVersion !== DB_VERSION) return "schema-version";
  if (previous.sourceSha1 !== sha1) return "feed-changed";
  return "unchanged";
}

/** Missing or unreadable live database is a normal first-run state, not an error. */
function readLiveMeta(livePath: string): FeedMeta | null {
  if (!existsSync(livePath)) return null;
  const db = openDatabase(livePath, { readonly: true });
  try {
    return readFeedMeta(db);
  } catch {
    return null;
  } finally {
    db.close();
  }
}
