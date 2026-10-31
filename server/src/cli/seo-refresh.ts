/**
 * Refreshes the line data without a person, or refuses to.
 *
 *   npm run seo-refresh [-- --date=YYYYMMDD] [-- --today=YYYYMMDD]
 *                       [-- --previous=path] [-- --report=path]
 *
 * What `seo-data` does by hand, plus the two decisions a person used to make
 * around it: which day the numbers describe (`chooseReferenceDate`) and whether
 * the new edition may replace the committed one (`compareEditions`). It writes
 * `client/seo/lines.json` only when every check passes, so a blocked run leaves
 * the committed data exactly as it was — still in date, and still what the site
 * is built from.
 *
 * The outcome is printed and, under GitHub Actions, written to `$GITHUB_OUTPUT`
 * as `outcome=written|unchanged|blocked`. Only `blocked` exits non-zero: an
 * unchanged feed is the normal state of most weeks, not a failure — unless the
 * committed edition is about to run out, which blocks a week ahead.
 *
 * `--previous` compares against another file than the committed one — how the
 * gates are exercised against an older edition without touching the repository.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { LIVE_DB_PATH } from "../config.js";
import { openDatabase } from "../db/index.js";
import { logger } from "../logger.js";
import { buildLineData, serializeLineData, servicesByDate } from "../seo/data.js";
import {
  DEFAULT_MIN_COVERAGE,
  DEFAULT_MIN_TRIPS,
  LINE_DATA_PATH,
  PUBLISHED_PATH,
} from "../seo/defaults.js";
import {
  compareEditions,
  formatReport,
  type LineDataFile,
  type PublishedFile,
} from "../seo/editions.js";
import { chooseReferenceDate, lastFullServiceDate } from "../seo/referenceDate.js";
import { toServiceDate } from "../util/date.js";

type Outcome = "written" | "unchanged" | "blocked";

function flag(name: string): string | undefined {
  return process.argv
    .slice(2)
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.split("=")[1];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function report(outcome: Outcome, details: Record<string, string>): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const lines = Object.entries({ outcome, ...details }).map(([key, value]) => `${key}=${value}`);
    appendFileSync(githubOutput, `${lines.join("\n")}\n`, "utf8");
  }
}

const now = new Date();
const today = flag("today") ?? toServiceDate(now);
const db = openDatabase(LIVE_DB_PATH, { readonly: true });
const days = servicesByDate(db);
const date = flag("date") ?? chooseReferenceDate(days, today);

const next = buildLineData(
  db,
  { date, minimumTrips: DEFAULT_MIN_TRIPS, minimumCoverage: DEFAULT_MIN_COVERAGE },
  now,
);
const previous = readJson<LineDataFile>(flag("previous") ?? LINE_DATA_PATH);
const published = readJson<PublishedFile>(PUBLISHED_PATH);

const comparison = compareEditions(previous, next, published, {
  today,
  lastFullServiceDate: lastFullServiceDate(days),
});
const text = formatReport(previous, next, comparison);

const reportPath = flag("report");
if (reportPath) writeFileSync(reportPath, text, "utf8");
process.stdout.write(text);

const details = {
  edition: `${next.feed.startDate}-${next.feed.endDate}`,
  reference: date,
  changed: String(comparison.changedPages.length),
};

if (comparison.blocking.length > 0) {
  logger.error("line data refresh blocked — lines.json left as it was", {
    ...details,
    findings: comparison.blocking.map((finding) => finding.code).join(","),
  });
  report("blocked", details);
  process.exitCode = 1;
} else if (comparison.unchanged) {
  logger.info("line data unchanged — the committed edition is the current feed", details);
  report("unchanged", details);
} else {
  writeFileSync(LINE_DATA_PATH, serializeLineData(next), "utf8");
  logger.info("line data written", { ...details, file: LINE_DATA_PATH });
  report("written", details);
}
