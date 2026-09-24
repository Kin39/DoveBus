/**
 * Is `route_id` a safe key to freeze a published URL onto?
 *
 * The line pages are addressed `/linea/<number>-<comune>/`, and the slug is
 * frozen at publication so an indexed URL never changes under a reader. That
 * only holds if the feed does not *recycle* `route_id`: if id 92 stops being
 * Florence's 32 and becomes something else, the frozen slug would silently
 * point a published address at the wrong line — the worst kind of failure,
 * because nothing errors and the page still renders.
 *
 * So this probe compares two editions of the feed on the ids they share, and
 * asks three questions of each, from cheapest to strongest:
 *
 *   1. did `route_short_name` change?     the line's number
 *   2. did `route_long_name` change?      the line's description
 *   3. did the set of stops change wholesale? a recycled id would keep neither
 *
 * Run it against any two imported databases:
 *
 *   node spikes/route-id-stability.mjs <old.db> <new.db>
 *
 * The answer it gave on 2026-09-17, comparing the 20260824 feed with the
 * 20260917 one, is in the commit that added it.
 */
import { execFileSync } from "node:child_process";

const [, , OLD, NEW] = process.argv;
if (!OLD || !NEW) {
  console.error("usage: node spikes/route-id-stability.mjs <old.db> <new.db>");
  process.exit(2);
}

/** One `sqlite3` call, rows split on a separator no GTFS field contains. */
function query(db, sql) {
  const out = execFileSync("sqlite3", ["-separator", "", db, sql], {
    maxBuffer: 1 << 28,
    encoding: "utf8",
  }).trim();
  return out === "" ? [] : out.split("\n").map((line) => line.split(""));
}

/** Every route with its names, and a fingerprint of the stops it calls at. */
const ROUTES = `
SELECT r.route_id,
       COALESCE(r.route_short_name, ''),
       COALESCE(r.route_long_name, ''),
       COUNT(DISTINCT st.stop_id)
  FROM routes r
  JOIN trips t ON t.route_id = r.route_id
  JOIN stop_times st ON st.trip_id = t.trip_id
 GROUP BY r.route_id;`;

/**
 * The stop ids a route serves, as a sorted string.
 *
 * Done per route rather than in the query above because the comparison that
 * matters is set overlap, not a count: two different lines through the same
 * town can call at the same *number* of stops and share none of them.
 */
function stopSets(db) {
  const rows = query(
    db,
    `SELECT t.route_id, st.stop_id FROM trips t
       JOIN stop_times st ON st.trip_id = t.trip_id
      GROUP BY t.route_id, st.stop_id;`,
  );
  const sets = new Map();
  for (const [routeId, stopId] of rows) {
    let set = sets.get(routeId);
    if (set === undefined) {
      set = new Set();
      sets.set(routeId, set);
    }
    set.add(stopId);
  }
  return sets;
}

const before = new Map(
  query(OLD, ROUTES).map(([id, short, long, stops]) => [id, { short, long, stops: Number(stops) }]),
);
const after = new Map(
  query(NEW, ROUTES).map(([id, short, long, stops]) => [id, { short, long, stops: Number(stops) }]),
);

const beforeStops = stopSets(OLD);
const afterStops = stopSets(NEW);

const shared = [...after.keys()].filter((id) => before.has(id));
console.log(`route_id in ${OLD}: ${before.size}`);
console.log(`route_id in ${NEW}: ${after.size}`);
console.log(`presenti in entrambe:  ${shared.length}`);

const renamed = [];
const relabelled = [];
const rerouted = [];

for (const id of shared) {
  const was = before.get(id);
  const is = after.get(id);
  if (was.short !== is.short) renamed.push(`route ${id}: "${was.short}" -> "${is.short}"`);
  if (was.long !== is.long) relabelled.push(`route ${id}: "${was.long}" -> "${is.long}"`);

  // Jaccard overlap of the stop sets, reported only for ids whose names did
  // *not* change. On its own a collapsed overlap does not prove recycling: a
  // line can keep its number and its description and still be rerouted between
  // a summer and a winter timetable, which is a change of itinerary, not of
  // identity — and a frozen slug is still correct for it. What would prove
  // recycling is a collapsed overlap *together* with a changed name, which is
  // why the verdict below weighs the two together rather than either alone.
  const wasStops = beforeStops.get(id) ?? new Set();
  const isStops = afterStops.get(id) ?? new Set();
  let common = 0;
  for (const stop of isStops) if (wasStops.has(stop)) common++;
  const union = wasStops.size + isStops.size - common;
  const overlap = union === 0 ? 1 : common / union;
  if (overlap < 0.2) {
    rerouted.push(`route ${id} "${is.short}": solo ${(overlap * 100).toFixed(0)}% di fermate in comune`);
  }
}

console.log("");
console.log(`hanno cambiato route_short_name: ${renamed.length}`);
for (const line of renamed.slice(0, 20)) console.log(`  ${line}`);
console.log(`hanno cambiato route_long_name:  ${relabelled.length}`);
for (const line of relabelled.slice(0, 20)) console.log(`  ${line}`);
console.log(`itinerario rifatto da capo (fermate quasi tutte diverse): ${rerouted.length}`);
for (const line of rerouted.slice(0, 20)) console.log(`  ${line}`);

// Recycling is a *name* change on a kept id: that is what would attach a
// published address to a different line. A rerouted line is a content change on
// the same page, which the regeneration handles by itself.
console.log("");
if (renamed.length === 0) {
  console.log(
    "VERDETTO: nessun route_id ha cambiato numero di linea fra queste due edizioni,",
  );
  console.log(
    "          quindi lo slug congelato non ha attaccato nessun indirizzo alla linea sbagliata.",
  );
  console.log(
    "          Due edizioni non sono una garanzia: l'asserzione in build resta obbligatoria.",
  );
} else {
  console.log(
    "VERDETTO: un route_id ha cambiato numero di linea. Lo slug congelato NON regge da solo,",
  );
  console.log("          e l'asserzione in build e' l'unica cosa che impedisce la pubblicazione.");
}
if (rerouted.length > 0) {
  console.log(
    `          ${rerouted.length} linee hanno tenuto numero e descrizione ma rifatto l'itinerario:`,
  );
  console.log("          e' un cambio di contenuto della pagina, non di indirizzo.");
}
