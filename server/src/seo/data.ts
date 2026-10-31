import type { Db } from "../db/index.js";
import { readFeedMeta } from "../feed/meta.js";
import type { LineDataFile } from "./editions.js";
import { collectLines } from "./lines.js";
import type { DayService } from "./referenceDate.js";
import { assertUniqueSlugs } from "./slug.js";

/**
 * Builds the contents of `client/seo/lines.json` from the timetable.
 *
 * Shared by `seo-data`, which a person runs and reads, and `seo-refresh`, which
 * the weekly job runs and gates — so the file the job commits is byte-for-byte
 * the one a person would have produced with the same day and thresholds.
 */

export interface LineDataOptions {
  readonly date: string;
  readonly minimumTrips: number;
  readonly minimumCoverage: number;
}

/** The whole file, in the key order it has always been written in. */
export interface LineDataPayload extends LineDataFile {
  readonly minimumTrips: number;
  readonly minimumCoverage: number;
  readonly generatedAt: string;
}

/** Services active on each day of the edition, from `calendar_dates` adds. */
export function servicesByDate(db: Db): readonly DayService[] {
  return db
    .prepare(
      `SELECT date, COUNT(*) AS services FROM calendar_dates
       WHERE exception_type = 1 GROUP BY date ORDER BY date`,
    )
    .all() as DayService[];
}

export function buildLineData(db: Db, options: LineDataOptions, now: Date): LineDataPayload {
  const meta = readFeedMeta(db);
  if (!meta) throw new Error("no feed_meta in the database — has the import run?");
  const { feedStartDate, feedEndDate } = meta;
  // The build refuses a file whose window it cannot read, so refuse to write one.
  if (feedStartDate === null || feedEndDate === null) {
    throw new Error(
      "the feed declares no validity window (feed_info) — the pages could not state one",
    );
  }

  // A reference day with no service would produce a file full of nothing, and the
  // most likely cause is a date outside the feed's window rather than a region
  // that stopped running buses.
  const active = servicesByDate(db).find((day) => day.date === options.date)?.services ?? 0;
  if (active === 0) {
    throw new Error(
      `no service on ${options.date} — the feed runs ${feedStartDate}–${feedEndDate}. ` +
        "Pass --date=YYYYMMDD with a weekday inside that window",
    );
  }

  const lines = collectLines(db, options);
  assertUniqueSlugs(
    lines.map((line) => ({
      slug: line.slug,
      routeId: line.routeId,
      shortName: line.shortName,
      comune: line.comune,
    })),
  );

  /*
   * The feed this data came out of, carried with it. Not decoration: the build
   * refuses to publish pages whose data comes from a window that has already
   * closed, and the pages themselves print the window to the reader.
   */
  return {
    feed: {
      startDate: feedStartDate,
      endDate: feedEndDate,
      sha1: meta.sourceSha1,
      importedAt: meta.importedAt,
    },
    referenceDate: options.date,
    minimumTrips: options.minimumTrips,
    minimumCoverage: options.minimumCoverage,
    generatedAt: now.toISOString(),
    lines,
  };
}

/** Exactly how `lines.json` is written: two-space JSON and a trailing newline. */
export function serializeLineData(payload: LineDataPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}
