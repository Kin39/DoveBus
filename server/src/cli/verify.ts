/**
 * Post-import smoke check against the live database.
 *
 * Unit tests run on a 5-row fixture; this asserts the real 125 MB feed produced
 * a database the MVP's queries can actually use — the calendar_dates resolver
 * returns a non-empty service set, the comune→comune search finds the
 * Arezzo→Anghiari runs the plan validated, and every trip has a drawable shape.
 *
 *   npm run verify [-- --date=20260812]
 */
import { SERVICE_DAY_END_SECONDS } from "../api/params.js";
import { LIVE_DB_PATH } from "../config.js";
import { openDatabase } from "../db/index.js";
import { feedValidity, readFeedMeta } from "../feed/meta.js";
import { logger } from "../logger.js";
import { searchOd } from "../query/searchOd.js";
import { toServiceDate } from "../util/date.js";

const AREZZO = "051002";
const ANGHIARI = "051001";

const dateArg = process.argv.slice(2).find((arg) => arg.startsWith("--date="));
const date = dateArg?.slice("--date=".length) ?? toServiceDate(new Date());

const db = openDatabase(LIVE_DB_PATH, { readonly: true });
const count = (sql: string, ...params: unknown[]): number =>
  (db.prepare(sql).get(...params) as { n: number }).n;

const checks: { name: string; ok: boolean; detail: Record<string, unknown> }[] = [];
const check = (name: string, ok: boolean, detail: Record<string, unknown>) =>
  checks.push({ name, ok, detail });

const meta = readFeedMeta(db);
if (!meta) throw new Error(`no feed_meta in ${LIVE_DB_PATH} — has the import run?`);
const validity = feedValidity(meta, date);
check("feed validity", !validity.expired && !validity.staleSchema, {
  window: `${meta.feedStartDate}–${meta.feedEndDate}`,
  daysRemaining: validity.daysRemaining,
  importedAt: meta.importedAt,
});

// This feed activates service exclusively through calendar_dates: a resolver
// keyed on calendar's weekday columns would return an empty set here.
const activeServices = count(
  "SELECT COUNT(*) AS n FROM calendar_dates WHERE date = ? AND exception_type = 1",
  date,
);
const weekdayServices = count(
  "SELECT COUNT(*) AS n FROM calendar WHERE monday+tuesday+wednesday+thursday+friday+saturday+sunday > 0",
);
check("calendar_dates activates service", activeServices > 0, {
  activeOnDate: activeServices,
  removedOnDate: count(
    "SELECT COUNT(*) AS n FROM calendar_dates WHERE date = ? AND exception_type = 2",
    date,
  ),
  servicesWithWeekdayPattern: weekdayServices,
});

const tripsToday = count(
  `SELECT COUNT(*) AS n FROM trips
    WHERE service_id IN (SELECT service_id FROM calendar_dates WHERE date = ? AND exception_type = 1)`,
  date,
);
check("trips scheduled on date", tripsToday > 0, { tripsToday });

const stopsWithComune = count("SELECT COUNT(*) AS n FROM stops WHERE comune_istat IS NOT NULL");
const stopsTotal = count("SELECT COUNT(*) AS n FROM stops");
check("comune enrichment", stopsWithComune / stopsTotal > 0.95, {
  resolved: `${((100 * stopsWithComune) / stopsTotal).toFixed(1)}%`,
  unresolved: stopsTotal - stopsWithComune,
  comuni: count("SELECT COUNT(*) AS n FROM comuni"),
});

const tripsWithShape = count(
  "SELECT COUNT(*) AS n FROM trips WHERE shape_id IS NOT NULL AND shape_id <> ''",
);
const tripsTotal = count("SELECT COUNT(*) AS n FROM trips");
check("planned-route shapes", tripsWithShape / tripsTotal > 0.99, {
  withShape: `${((100 * tripsWithShape) / tripsTotal).toFixed(1)}%`,
  shapePoints: count("SELECT COUNT(*) AS n FROM shapes"),
});

// The search the API serves, not a stand-in for it: this check exists to fail
// when the query the riders use cannot answer on the real feed.
const startedAt = performance.now();
const od = searchOd(db, {
  comuneA: AREZZO,
  comuneB: ANGHIARI,
  date,
  fromSeconds: 0,
  toSeconds: SERVICE_DAY_END_SECONDS,
});
const odMs = performance.now() - startedAt;
check("Arezzo→Anghiari search (plan fixture)", od.trips.length > 0 && odMs < 2000, {
  trips: od.trips.length,
  lines: [...new Set(od.trips.map((trip) => trip.line))].join(", "),
  queryMs: Number(odMs.toFixed(1)),
});

db.close();

for (const { name, ok, detail } of checks) {
  const log = ok ? logger.info : logger.error;
  log(`${ok ? "PASS" : "FAIL"} ${name}`, detail);
}
const failed = checks.filter((entry) => !entry.ok).length;
logger.info(`${checks.length - failed}/${checks.length} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
