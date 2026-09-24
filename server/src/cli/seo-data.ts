/**
 * Writes the line data the static site is built from.
 *
 *   npm run seo-data [-- --date=20260918] [-- --min-trips=70] [-- --min-coverage=0.75]
 *
 * **Why a committed file and not a fetch at build time.** Netlify builds the
 * site without `data/gtfs.db` — it is 1.46 GB and gitignored — so the pages
 * cannot be generated from the database at build time. The alternative, having
 * the build call the API, was rejected for the way it breaks: a fetch that
 * fails without failing the build publishes a sitemap missing those hundred
 * URLs, and a sitemap that stops listing a page is how a site asks for it to be
 * deindexed. It would also make two builds of one commit produce two different
 * sites.
 *
 * So the data is produced here, from the real timetable, read in a diff, and
 * committed. The build is hermetic; what it publishes is what somebody looked
 * at.
 *
 * **The threshold proposes; it does not publish.** Everything above
 * `--min-trips` lands in this file as a *candidate*. Which candidates are
 * actually built into pages is a separate, hand-kept list, so that a new
 * edition of the feed can never make a page appear on its own and walk around
 * the rule that pages go out in small groups.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LIVE_DB_PATH } from "../config.js";
import { openDatabase } from "../db/index.js";
import { readFeedMeta } from "../feed/meta.js";
import { logger } from "../logger.js";
import { collectLines } from "../seo/lines.js";
import { assertUniqueSlugs } from "../seo/slug.js";
import { toServiceDate } from "../util/date.js";

/**
 * The floor for a line to be worth a page, in runs on the reference day.
 *
 * Round, and not reverse-engineered from a target page count: 70 yields 102
 * candidates on the 20260918 timetable, where 72 would have yielded exactly 100
 * — a number that looks chosen because it is. Every line above this floor runs
 * at least seventy times a day, which is the argument that these pages describe
 * service rather than fill a template.
 */
const DEFAULT_MIN_TRIPS = 70;

/**
 * How representative a direction's busiest itinerary must be to be published.
 *
 * Measured over the 200 directions of the first hundred lines: the busiest
 * itinerary covers over 90% of the day's stops in 44% of them, and under half
 * in 24%. At 0.75, 128 directions publish a route — median 25 stops — and the
 * rest say the line has no single one, which for Prato's 207, whose busiest of
 * 24 itineraries touches 42 of 252 stops, is simply the truth.
 */
const DEFAULT_MIN_COVERAGE = 0.75;

/** Written where the client build can read it; `client/data/` would be gitignored. */
const OUTPUT = resolve(import.meta.dirname, "../../../client/seo/lines.json");

function flag(name: string): string | undefined {
  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split("=")[1];
}

const date = flag("date") ?? toServiceDate(new Date());
const minimumTrips = Number(flag("min-trips") ?? DEFAULT_MIN_TRIPS);
const minimumCoverage = Number(flag("min-coverage") ?? DEFAULT_MIN_COVERAGE);
if (!Number.isFinite(minimumCoverage) || minimumCoverage <= 0 || minimumCoverage > 1) {
  throw new Error(`--min-coverage must be between 0 and 1, got ${flag("min-coverage")}`);
}
if (!Number.isFinite(minimumTrips) || minimumTrips < 1) {
  throw new Error(`--min-trips must be a positive number, got ${flag("min-trips")}`);
}

const db = openDatabase(LIVE_DB_PATH, { readonly: true });

const meta = readFeedMeta(db);
if (!meta) throw new Error(`no feed_meta in ${LIVE_DB_PATH} — has the import run?`);

// A reference day with no service would produce a file full of nothing, and the
// most likely cause is a date outside the feed's window rather than a region
// that stopped running buses.
const activeServices = (
  db
    .prepare("SELECT COUNT(*) AS n FROM calendar_dates WHERE date = ? AND exception_type = 1")
    .get(date) as { n: number }
).n;
if (activeServices === 0) {
  throw new Error(
    `no service on ${date} — the feed runs ${meta.feedStartDate}–${meta.feedEndDate}. ` +
      "Pass --date=YYYYMMDD with a weekday inside that window",
  );
}

const lines = collectLines(db, { date, minimumTrips, minimumCoverage });
assertUniqueSlugs(
  lines.map((line) => ({
    slug: line.slug,
    routeId: line.routeId,
    shortName: line.shortName,
    comune: line.comune,
  })),
);

/**
 * The feed this data came out of, carried with it.
 *
 * Not decoration: the build refuses to publish pages whose data comes from a
 * window that has already closed, and the pages themselves print the window to
 * the reader. A measurement without a date beside it does not say whether you
 * are reading yesterday or last spring.
 */
const payload = {
  feed: {
    startDate: meta.feedStartDate,
    endDate: meta.feedEndDate,
    sha1: meta.sourceSha1,
    importedAt: meta.importedAt,
  },
  referenceDate: date,
  minimumTrips,
  minimumCoverage,
  generatedAt: new Date().toISOString(),
  lines,
};

writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const byComune = new Map<string, number>();
for (const line of lines) byComune.set(line.comune, (byComune.get(line.comune) ?? 0) + 1);

logger.info("line data written", {
  file: OUTPUT,
  candidates: lines.length,
  comuni: byComune.size,
  referenceDate: date,
  minimumTrips,
  minimumCoverage,
  senzaPercorso: lines.reduce(
    (n, line) => n + line.directions.filter((d) => d.stops.length === 0).length,
    0,
  ),
  feed: `${meta.feedStartDate}–${meta.feedEndDate}`,
  withoutLength: lines.filter((line) => line.lengthKm === null).length,
});
