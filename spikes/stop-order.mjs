/**
 * How should a line page list the stops of one direction?
 *
 * Not every run of a direction calls everywhere: short workings start or finish
 * part-way along, and they are common. That makes "the stops of this direction"
 * ambiguous, and the two obvious answers are both wrong in different ways:
 *
 *   earliest-sequence  order every stop by the lowest sequence number any run
 *                      gives it. A short working that starts mid-route gives
 *                      its first stop sequence 1, so that stop jumps to the top
 *                      of the list and the route reads as starting somewhere it
 *                      does not.
 *   longest-run        take the stop list of the run that calls at most stops.
 *                      Reads correctly end to end, but silently drops any stop
 *                      only a variant serves.
 *
 * This measures the cost of each on the real feed, for the lines that would be
 * published: how often earliest-sequence misplaces the terminus, and how many
 * stops longest-run would leave out.
 *
 *   node spikes/stop-order.mjs
 */
import { execFileSync } from "node:child_process";

const DB = "data/gtfs.db";
const DATE = process.argv[2] ?? "20260918";
const MIN_TRIPS = 70;

function query(sql) {
  const out = execFileSync("sqlite3", ["-separator", "", DB, sql], {
    maxBuffer: 1 << 28,
    encoding: "utf8",
  }).trim();
  return out === "" ? [] : out.split("\n").map((line) => line.split(""));
}

const candidates = query(`
  SELECT r.route_id, r.route_short_name, COUNT(DISTINCT t.trip_id) AS trips
    FROM routes r JOIN trips t ON t.route_id = r.route_id
   WHERE r.route_short_name IS NOT NULL
     AND t.service_id IN (SELECT service_id FROM calendar_dates WHERE date='${DATE}' AND exception_type=1)
   GROUP BY r.route_id HAVING trips >= ${MIN_TRIPS};`);

console.log(`linee candidate: ${candidates.length} (>= ${MIN_TRIPS} corse il ${DATE})`);

let directions = 0;
let terminusMisplaced = 0;
let droppedStopsTotal = 0;
let directionsLosingStops = 0;
const examples = [];

for (const [routeId, shortName] of candidates) {
  const dirs = query(
    `SELECT DISTINCT direction_id FROM trips WHERE route_id='${routeId}' AND direction_id IS NOT NULL;`,
  );
  for (const [directionId] of dirs) {
    directions++;

    // every stop of the direction, with the lowest sequence any run gives it
    const earliest = query(`
      SELECT s.stop_name, MIN(st.stop_sequence) AS seq
        FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id JOIN stops s ON s.stop_id=st.stop_id
       WHERE t.route_id='${routeId}' AND t.direction_id=${directionId}
       GROUP BY st.stop_id ORDER BY seq;`);

    // the run that calls at the most stops
    const longestTrip = query(`
      SELECT t.trip_id, COUNT(*) AS n
        FROM trips t JOIN stop_times st ON st.trip_id=t.trip_id
       WHERE t.route_id='${routeId}' AND t.direction_id=${directionId}
       GROUP BY t.trip_id ORDER BY n DESC, t.trip_id LIMIT 1;`)[0];
    if (!longestTrip) continue;

    const longest = query(`
      SELECT s.stop_name FROM stop_times st JOIN stops s ON s.stop_id=st.stop_id
       WHERE st.trip_id='${longestTrip[0]}' ORDER BY st.stop_sequence;`);

    const headsign = query(
      `SELECT trip_headsign FROM trips WHERE trip_id='${longestTrip[0]}';`,
    )[0]?.[0];

    // Does earliest-sequence put the right stop first? "Right" here means the
    // one the longest run starts from, which is the line's actual origin.
    const earliestFirst = earliest[0]?.[0];
    const longestFirst = longest[0]?.[0];
    if (earliestFirst !== longestFirst) {
      terminusMisplaced++;
      if (examples.length < 8) {
        examples.push(
          `  linea ${shortName} dir ${directionId} -> ${headsign}: ` +
            `per sequenza parte da "${earliestFirst}", il percorso completo da "${longestFirst}"`,
        );
      }
    }

    const longestSet = new Set(longest.map((row) => row[0]));
    const dropped = earliest.filter((row) => !longestSet.has(row[0])).length;
    droppedStopsTotal += dropped;
    if (dropped > 0) directionsLosingStops++;
  }
}

console.log(`direzioni esaminate: ${directions}`);
console.log("");
console.log(`per-sequenza mette il capolinea sbagliato in testa: ${terminusMisplaced} direzioni ` +
  `(${((100 * terminusMisplaced) / directions).toFixed(1)}%)`);
for (const line of examples) console.log(line);
console.log("");
console.log(`corsa-piu-lunga perde almeno una fermata: ${directionsLosingStops} direzioni ` +
  `(${((100 * directionsLosingStops) / directions).toFixed(1)}%)`);
console.log(`fermate perse in totale: ${droppedStopsTotal}`);
