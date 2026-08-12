import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { LIVE_DB_PATH } from "../config.js";
import { type RefreshOptions, refreshFeed } from "../feed/refresh.js";
import { databaseSizeBytes } from "../feed/swap.js";
import type { DownloadResult } from "../gtfs/download.js";
import type { ProgressEvent } from "../gtfs/import.js";
import { formatBytes, formatDuration, logger } from "../logger.js";

export interface CliFlags {
  readonly force: boolean;
  /** Use a local zip instead of downloading — for development and re-runs. */
  readonly zipPath: string | null;
}

export function parseFlags(argv: readonly string[]): CliFlags {
  let force = false;
  let zipPath: string | null = null;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--force") force = true;
    else if (arg === "--zip") {
      const value = argv[++index];
      if (!value) throw new Error("--zip requires a path");
      zipPath = value;
    } else if (arg?.startsWith("--zip=")) {
      zipPath = arg.slice("--zip=".length);
    } else if (arg !== undefined) {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { force, zipPath };
}

/** Copies a local zip in place of an HTTP fetch, hashing it the same way. */
function localSource(path: string) {
  return async (_url: string, destination: string): Promise<DownloadResult> => {
    const bytes = await readFile(path);
    await copyFile(path, destination);
    return {
      path: destination,
      bytes: bytes.length,
      sha1: createHash("sha1").update(bytes).digest("hex"),
      etag: null,
      lastModified: null,
      contentType: "application/zip",
    };
  };
}

export function logProgress(event: ProgressEvent): void {
  if (event.kind === "table-start") logger.info(`importing ${event.table}`);
  else if (event.kind === "table-rows") logger.info(`  ${event.table}: ${event.rows} rows`);
  else if (event.kind === "table-done") logger.info(`  ${event.table}: ${event.rows} rows total`);
  else logger.info(event.message);
}

/**
 * Shared body of the `import` and `refresh` commands: download (or reuse) the
 * feed, rebuild when it changed, publish atomically, and report what happened.
 */
export async function runRefreshCommand(
  argv: readonly string[],
  defaults: { force: boolean },
): Promise<number> {
  const flags = parseFlags(argv);
  const startedAt = Date.now();

  const options: RefreshOptions = {
    force: flags.force || defaults.force,
    onProgress: logProgress,
    ...(flags.zipPath ? { download: localSource(flags.zipPath) } : {}),
  };

  try {
    const outcome = await refreshFeed(options);

    if (!outcome.imported) {
      logger.info("feed unchanged — database left in place", {
        sha1: outcome.sha1.slice(0, 12),
        importedAt: outcome.previous?.importedAt ?? null,
      });
    } else {
      const result = outcome.result;
      logger.info("database published", {
        reason: outcome.reason,
        rows: result.rowCounts,
        comuni: result.comuniCount,
        enrichment: result.enrichment,
        feed: `${result.feedInfo.feedStartDate}-${result.feedInfo.feedEndDate}`,
        size: formatBytes(databaseSizeBytes(LIVE_DB_PATH)),
        took: formatDuration(result.durationMs),
      });
    }

    if (outcome.validity?.expired === true) {
      logger.warn("loaded timetable is past its feed_end_date — schedules may be stale", {
        daysExpired: -(outcome.validity.daysRemaining ?? 0),
      });
    } else if (outcome.validity !== null) {
      logger.info("timetable validity", { daysRemaining: outcome.validity.daysRemaining });
    }

    logger.info(`done in ${formatDuration(Date.now() - startedAt)}`);
    return 0;
  } catch (error) {
    logger.error("refresh failed — live database untouched", { error: String(error) });
    return 1;
  }
}
