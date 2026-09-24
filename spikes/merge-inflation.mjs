/**
 * How far does the merged stop list drift from any route a bus actually runs?
 *
 * The line pages list "the stops of this direction". Ordering them by the
 * lowest sequence any run gives a stop puts the wrong terminus first in 35% of
 * directions (see `stop-order.mjs`), so the patterns are merged instead: the
 * longest run is the spine and variant-only stops are inserted where their
 * variant puts them.
 *
 * That fixes the order and buys a different problem. A line with many distinct
 * itineraries has its union published as one route — a sequence no vehicle ever
 * follows. This measures the gap, per published line, between the merged list
 * and the longest single run, which is the longest journey a passenger can
 * actually make.
 *
 *   node spikes/merge-inflation.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DB = "data/gtfs.db";
const DATE = process.argv[2] ?? "20260918";

function query(sql) {
  const out = execFileSync("sqlite3", ["-separator", "", DB, sql], {
    maxBuffer: 1 << 28,
    encoding: "utf8",
  }).trim();
  return out === "" ? [] : out.split("\n").map((line) => line.split(""));
}

const data = JSON.parse(readFileSync("client/seo/lines.json", "utf8"));
const published = new Set(
  JSON.parse(readFileSync("client/seo/published.json", "utf8")).lines.map((line) => line.slug),
);
const lines = data.lines.filter((line) => published.has(line.slug));

const rows = [];
for (const line of lines) {
  for (const direction of line.directions) {
    const longest = query(`
      SELECT MAX(n) FROM (
        SELECT COUNT(*) AS n FROM trips t JOIN stop_times st ON st.trip_id = t.trip_id
         WHERE t.route_id = '${line.routeId}' AND t.direction_id = ${direction.directionId}
           AND t.service_id IN (SELECT service_id FROM calendar_dates
                                 WHERE date = '${DATE}' AND exception_type = 1)
         GROUP BY t.trip_id);`)[0]?.[0];
    const patterns = query(`
      SELECT COUNT(DISTINCT sig) FROM (
        SELECT t.trip_id, GROUP_CONCAT(st.stop_id) AS sig
          FROM trips t JOIN stop_times st ON st.trip_id = t.trip_id
         WHERE t.route_id = '${line.routeId}' AND t.direction_id = ${direction.directionId}
         GROUP BY t.trip_id);`)[0]?.[0];

    const real = Number(longest ?? 0);
    const merged = direction.stops.length;
    if (real === 0) continue;
    rows.push({
      slug: line.slug,
      dir: direction.directionId,
      merged,
      real,
      patterns: Number(patterns ?? 1),
      inflation: merged / real,
    });
  }
}

rows.sort((a, b) => b.inflation - a.inflation);

const inflated = rows.filter((row) => row.inflation > 1.25);
const clean = rows.filter((row) => row.inflation <= 1.05);

console.log(`direzioni pubblicate: ${rows.length}`);
console.log(
  `  entro il 5% della corsa piu' lunga: ${clean.length} (${((100 * clean.length) / rows.length).toFixed(0)}%)`,
);
console.log(
  `  gonfiate oltre il 25%:              ${inflated.length} (${((100 * inflated.length) / rows.length).toFixed(0)}%)`,
);
console.log("");
console.log("le dieci peggiori:");
for (const row of rows.slice(0, 10)) {
  console.log(
    `  ${row.slug.padEnd(30)} dir ${row.dir}: ${String(row.merged).padStart(3)} fermate pubblicate, ` +
      `${String(row.real).padStart(2)} nella corsa piu' lunga (${row.inflation.toFixed(1)}x, ${row.patterns} percorsi distinti)`,
  );
}
