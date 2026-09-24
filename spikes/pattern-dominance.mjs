/**
 * Is "the route of this line" a well-defined thing?
 *
 * The line pages list the stops of a direction. Merging every itinerary of that
 * direction invents a journey no bus makes — 35% of published directions list
 * over 25% more stops than the longest real run. The alternative is to publish
 * one real itinerary, but only if one of them is actually representative.
 *
 * So, per published direction: what share of the day's runs follow the single
 * most common stop pattern, and how much of the direction's stop set does that
 * pattern cover? A direction where one pattern carries most of the runs has a
 * route worth publishing. One where the runs are spread over thirty itineraries
 * does not, and the honest page there says so instead of drawing a line.
 *
 *   node spikes/pattern-dominance.mjs [YYYYMMDD]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DB = "data/gtfs.db";
const DATE = process.argv[2] ?? "20260918";
const SEP = "";

function query(sql) {
  const out = execFileSync("sqlite3", ["-separator", SEP, DB, sql], {
    maxBuffer: 1 << 28,
    encoding: "utf8",
  }).trim();
  return out === "" ? [] : out.split("\n").map((line) => line.split(SEP));
}

const data = JSON.parse(readFileSync("client/seo/lines.json", "utf8"));
const published = new Set(
  JSON.parse(readFileSync("client/seo/published.json", "utf8")).lines.map((line) => line.slug),
);
const lines = data.lines.filter((line) => published.has(line.slug));

const rows = [];
for (const line of lines) {
  for (const direction of line.directions) {
    const patterns = query(`
      SELECT sig, COUNT(*) AS runs, MAX(stops) AS stops FROM (
        SELECT t.trip_id, GROUP_CONCAT(st.stop_id) AS sig, COUNT(*) AS stops
          FROM trips t JOIN stop_times st ON st.trip_id = t.trip_id
         WHERE t.route_id = '${line.routeId}' AND t.direction_id = ${direction.directionId}
           AND t.service_id IN (SELECT service_id FROM calendar_dates
                                 WHERE date = '${DATE}' AND exception_type = 1)
         GROUP BY t.trip_id)
      GROUP BY sig ORDER BY runs DESC, stops DESC;`);
    if (patterns.length === 0) continue;

    const totalRuns = patterns.reduce((sum, row) => sum + Number(row[1]), 0);
    const topRuns = Number(patterns[0][1]);
    const topStops = Number(patterns[0][2]);

    // How much of the direction's whole stop set the dominant pattern covers.
    const allStops = Number(
      query(`SELECT COUNT(DISTINCT st.stop_id) FROM trips t JOIN stop_times st ON st.trip_id = t.trip_id
              WHERE t.route_id = '${line.routeId}' AND t.direction_id = ${direction.directionId}
                AND t.service_id IN (SELECT service_id FROM calendar_dates
                                      WHERE date = '${DATE}' AND exception_type = 1);`)[0][0],
    );

    rows.push({
      slug: line.slug,
      dir: direction.directionId,
      patterns: patterns.length,
      share: topRuns / totalRuns,
      coverage: allStops === 0 ? 0 : topStops / allStops,
      topStops,
      allStops,
      published: direction.stops.length,
    });
  }
}

const pct = (n) => `${(100 * n).toFixed(0)}%`;
const bucket = (rows, test) => rows.filter(test).length;

console.log(`direzioni pubblicate: ${rows.length}`);
console.log("");
console.log("quota delle corse che segue il percorso piu' battuto:");
for (const [label, test] of [
  ["oltre il 75%", (r) => r.share > 0.75],
  ["50-75%", (r) => r.share > 0.5 && r.share <= 0.75],
  ["25-50%", (r) => r.share > 0.25 && r.share <= 0.5],
  ["sotto il 25%", (r) => r.share <= 0.25],
]) {
  const n = bucket(rows, test);
  console.log(`  ${label.padEnd(14)} ${String(n).padStart(3)} direzioni (${pct(n / rows.length)})`);
}

console.log("");
console.log("fermate coperte dal percorso piu' battuto, rispetto a tutte quelle servite nel giorno:");
for (const [label, test] of [
  ["oltre il 90%", (r) => r.coverage > 0.9],
  ["75-90%", (r) => r.coverage > 0.75 && r.coverage <= 0.9],
  ["50-75%", (r) => r.coverage > 0.5 && r.coverage <= 0.75],
  ["sotto il 50%", (r) => r.coverage <= 0.5],
]) {
  const n = bucket(rows, test);
  console.log(`  ${label.padEnd(14)} ${String(n).padStart(3)} direzioni (${pct(n / rows.length)})`);
}

console.log("");
console.log("le dieci direzioni meno rappresentabili da un solo percorso:");
for (const row of [...rows].sort((a, b) => a.coverage - b.coverage).slice(0, 10)) {
  console.log(
    `  ${row.slug.padEnd(30)} dir ${row.dir}: percorso piu' battuto ${row.topStops} fermate su ${row.allStops} servite ` +
      `(${pct(row.coverage)}), seguito dal ${pct(row.share)} delle corse, ${row.patterns} percorsi`,
  );
}

console.log("");
console.log("quante pagine avrebbero una lista onesta e corta:");
const good = rows.filter((r) => r.coverage >= 0.75);
console.log(`  copertura >= 75%: ${good.length} direzioni su ${rows.length} (${pct(good.length / rows.length)})`);
const medianStops = [...good.map((r) => r.topStops)].sort((a, b) => a - b)[Math.floor(good.length / 2)];
console.log(`  mediana delle fermate pubblicate in quel caso: ${medianStops}`);

// Per-line rollup: a page has two directions, and what matters is how many
// pages come out honest, not how many directions do.
const byLine = new Map();
for (const row of rows) {
  const list = byLine.get(row.slug);
  if (list === undefined) byLine.set(row.slug, [row]);
  else list.push(row);
}
let both = 0;
let one = 0;
let neither = 0;
const lost = [];
for (const [slug, dirs] of byLine) {
  const ok = dirs.filter((d) => d.coverage >= 0.75).length;
  if (ok === dirs.length) both++;
  else if (ok > 0) one++;
  else {
    neither++;
    lost.push(slug);
  }
}
console.log("");
console.log(`pagine (linee) pubblicate: ${byLine.size}`);
console.log(`  entrambe le direzioni rappresentabili: ${both}`);
console.log(`  una sola:                             ${one}`);
console.log(`  nessuna delle due:                    ${neither}`);
console.log(`  linee senza percorso pubblicabile: ${lost.join(", ")}`);
