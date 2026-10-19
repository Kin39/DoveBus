import { readFile } from "node:fs/promises";
import { DB_VERSION, IMPORT_BATCH_SIZE } from "../config.js";
import { analyzeDatabase, createIndexes, createStagingDatabase, type Db } from "../db/index.js";
import { writeFeedMeta } from "../feed/meta.js";
import { createComuneResolver, loadComuni } from "../geo/comuni.js";
import { type EnrichmentStats, enrichStops, seedComuni } from "../geo/enrich.js";
import { buildTripComuni } from "../geo/tripComuni.js";
import { readCsv } from "./csv.js";
import { type FeedInfo, readFeedInfo } from "./feedInfo.js";
import { buildRowMapper, insertStatementFor, TABLE_SPECS, type TableSpec } from "./tables.js";
import { openZip, type ZipArchive } from "./zip.js";

const FEED_INFO_FILE = "feed_info.txt";

export interface FeedSource {
  readonly sha1: string;
  readonly etag: string | null;
  readonly bytes: number | null;
}

export interface ImportOptions {
  readonly zipPath: string;
  readonly comuniGeoJsonPath: string;
  /** Database file to build. Always a staging path — never the live database. */
  readonly dbPath: string;
  readonly source: FeedSource;
  readonly onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { readonly kind: "table-start"; readonly table: string }
  | { readonly kind: "table-rows"; readonly table: string; readonly rows: number }
  | { readonly kind: "table-done"; readonly table: string; readonly rows: number }
  | { readonly kind: "step"; readonly message: string };

export interface ImportResult {
  readonly dbPath: string;
  readonly rowCounts: Readonly<Record<string, number>>;
  readonly enrichment: EnrichmentStats;
  readonly feedInfo: FeedInfo;
  readonly comuniCount: number;
  readonly durationMs: number;
}

/**
 * Builds a complete SQLite database from the consolidated feed zip.
 *
 * Order matters: bulk rows first, then comune enrichment (needs `stops`), then
 * indexes (an order of magnitude cheaper after the inserts than during them),
 * then the trip/comune table the comune→comune search prunes with.
 */
export async function importFeed(options: ImportOptions): Promise<ImportResult> {
  const startedAt = Date.now();
  const report = options.onProgress ?? (() => {});

  const archive = await openZip(options.zipPath);
  const db = createStagingDatabase(options.dbPath);

  try {
    const rowCounts = await importTables(db, archive, report);
    const feedInfo = await readFeedInfoEntry(archive);

    report({ kind: "step", message: "comune enrichment" });
    const comuni = loadComuni(JSON.parse(await readFile(options.comuniGeoJsonPath, "utf8")));
    const comuniCount = seedComuni(db, comuni);
    const enrichment = enrichStops(db, createComuneResolver(comuni));

    report({ kind: "step", message: "indexes" });
    createIndexes(db);

    report({ kind: "step", message: "trip comuni" });
    buildTripComuni(db);

    report({ kind: "step", message: "analyze" });
    analyzeDatabase(db);

    writeFeedMeta(db, {
      feedStartDate: feedInfo.feedStartDate,
      feedEndDate: feedInfo.feedEndDate,
      importedAt: new Date().toISOString(),
      sourceEtag: options.source.etag,
      sourceSha1: options.source.sha1,
      sourceBytes: options.source.bytes,
      dbVersion: DB_VERSION,
    });

    return {
      dbPath: options.dbPath,
      rowCounts,
      enrichment,
      feedInfo,
      comuniCount,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    db.close();
    archive.close();
  }
}

async function importTables(
  db: Db,
  archive: ZipArchive,
  report: (event: ProgressEvent) => void,
): Promise<Record<string, number>> {
  const rowCounts: Record<string, number> = {};

  for (const spec of TABLE_SPECS) {
    if (!archive.has(spec.file)) {
      if (spec.required) throw new Error(`feed is missing required file ${spec.file}`);
      rowCounts[spec.table] = 0;
      continue;
    }
    report({ kind: "table-start", table: spec.table });
    const rows = await importTable(db, archive, spec, report);
    rowCounts[spec.table] = rows;
    report({ kind: "table-done", table: spec.table, rows });
  }
  return rowCounts;
}

/**
 * Streams one file into its table in bounded transactions.
 *
 * better-sqlite3 is synchronous, so each row is inserted as it is parsed — no
 * intermediate array of 5M rows ever exists.
 */
async function importTable(
  db: Db,
  archive: ZipArchive,
  spec: TableSpec,
  report: (event: ProgressEvent) => void,
): Promise<number> {
  const insert = db.prepare(insertStatementFor(spec));
  const stream = await archive.openEntry(spec.file);

  let mapRow: ((row: readonly string[]) => (string | number | null)[]) | null = null;
  let rows = 0;
  let inTransaction = false;

  const begin = () => {
    if (!inTransaction) {
      db.exec("BEGIN");
      inTransaction = true;
    }
  };
  const commit = () => {
    if (inTransaction) {
      db.exec("COMMIT");
      inTransaction = false;
    }
  };

  try {
    for await (const { header, row } of readCsv(stream)) {
      mapRow ??= buildRowMapper(spec, header);
      begin();
      insert.run(mapRow(row));
      rows++;
      if (rows % IMPORT_BATCH_SIZE === 0) {
        commit();
        report({ kind: "table-rows", table: spec.table, rows });
      }
    }
    commit();
  } catch (error) {
    // The staging file is discarded on failure, so a failed rollback (journal is
    // off during import) must not mask the error that actually stopped us.
    if (inTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
    }
    throw new Error(`import of ${spec.file} failed after ${rows} rows: ${String(error)}`, {
      cause: error,
    });
  }

  return rows;
}

async function readFeedInfoEntry(archive: ZipArchive): Promise<FeedInfo> {
  if (!archive.has(FEED_INFO_FILE)) {
    return { publisherName: null, feedStartDate: null, feedEndDate: null, feedVersion: null };
  }
  return readFeedInfo(await archive.openEntry(FEED_INFO_FILE));
}
