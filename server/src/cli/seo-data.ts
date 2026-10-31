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
import { LIVE_DB_PATH } from "../config.js";
import { openDatabase } from "../db/index.js";
import { logger } from "../logger.js";
import { buildLineData, serializeLineData } from "../seo/data.js";
import { DEFAULT_MIN_COVERAGE, DEFAULT_MIN_TRIPS, LINE_DATA_PATH } from "../seo/defaults.js";
import { toServiceDate } from "../util/date.js";

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
const payload = buildLineData(db, { date, minimumTrips, minimumCoverage }, new Date());
const { lines, feed } = payload;

writeFileSync(LINE_DATA_PATH, serializeLineData(payload), "utf8");

const byComune = new Map<string, number>();
for (const line of lines) byComune.set(line.comune, (byComune.get(line.comune) ?? 0) + 1);

logger.info("line data written", {
  file: LINE_DATA_PATH,
  candidates: lines.length,
  comuni: byComune.size,
  referenceDate: date,
  minimumTrips,
  minimumCoverage,
  senzaPercorso: lines.reduce(
    (n, line) => n + line.directions.filter((d) => d.stops.length === 0).length,
    0,
  ),
  feed: `${feed.startDate}–${feed.endDate}`,
  withoutLength: lines.filter((line) => line.lengthKm === null).length,
});
