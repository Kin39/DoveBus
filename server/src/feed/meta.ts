import { DB_VERSION } from "../config.js";
import type { Db } from "../db/index.js";
import { daysBetweenServiceDates } from "../util/date.js";

export interface FeedMeta {
  readonly feedStartDate: string | null;
  readonly feedEndDate: string | null;
  readonly importedAt: string;
  readonly sourceEtag: string | null;
  readonly sourceSha1: string;
  readonly sourceBytes: number | null;
  readonly dbVersion: number;
}

export interface FeedValidity {
  /** The loaded timetable no longer covers today — schedules served are stale. */
  readonly expired: boolean;
  /** Days until feed_end_date; negative once expired, null if the date is absent. */
  readonly daysRemaining: number | null;
  /** The schema this database was built with differs from the running code's. */
  readonly staleSchema: boolean;
}

export function writeFeedMeta(db: Db, meta: FeedMeta): void {
  db.prepare("DELETE FROM feed_meta").run();
  db.prepare(
    `INSERT INTO feed_meta
       (id, feed_start_date, feed_end_date, imported_at, source_etag, source_sha1, source_bytes, db_version)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    meta.feedStartDate,
    meta.feedEndDate,
    meta.importedAt,
    meta.sourceEtag,
    meta.sourceSha1,
    meta.sourceBytes,
    meta.dbVersion,
  );
}

export function readFeedMeta(db: Db): FeedMeta | null {
  const row = db
    .prepare(
      `SELECT feed_start_date, feed_end_date, imported_at, source_etag, source_sha1,
              source_bytes, db_version
         FROM feed_meta WHERE id = 1`,
    )
    .get() as Record<string, string | number | null> | undefined;
  if (!row) return null;

  return {
    feedStartDate: (row.feed_start_date as string | null) ?? null,
    feedEndDate: (row.feed_end_date as string | null) ?? null,
    importedAt: String(row.imported_at),
    sourceEtag: (row.source_etag as string | null) ?? null,
    sourceSha1: String(row.source_sha1),
    sourceBytes: (row.source_bytes as number | null) ?? null,
    dbVersion: Number(row.db_version),
  };
}

/**
 * Health signal behind `/healthz`: this operator ships ~20-day timetables, so a
 * database that silently outlives its `feed_end_date` keeps answering searches
 * with schedules that no longer apply.
 */
export function feedValidity(meta: FeedMeta, today: string): FeedValidity {
  const daysRemaining =
    meta.feedEndDate === null ? null : daysBetweenServiceDates(today, meta.feedEndDate);
  return {
    expired: daysRemaining !== null && daysRemaining < 0,
    daysRemaining,
    staleSchema: meta.dbVersion !== DB_VERSION,
  };
}
