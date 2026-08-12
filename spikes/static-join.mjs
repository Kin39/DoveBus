// Phase 0 spike — THE critical one: does the live RT trip_id join to static trips.trip_id?
// Fetches a fresh vehicle-positions snapshot, then streams trips.txt and checks:
//   - membership: RT trip_id present in static trips?
//   - agreement: does route_id / direction_id match for the joined trip?
//   - shape availability: does the joined trip carry a shape_id (planned-route line)?
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const VP_URL =
  "https://regionetoscana.smartregion.toscana.it/mobility/artifacts/gtfs-rt/vehicle-positions";
const TRIPS_TXT =
  "/tmp/claude-1000/-home-z13-Documents-DoveBus/6dd59dcc-1215-44fa-a1ad-5c7e0eec8c14/scratchpad/trips.txt";

// 1) fresh RT snapshot -> records keyed by trip_id
const res = await fetch(VP_URL, { headers: { "User-Agent": "DoveBus-spike/0" } });
const buf = Buffer.from(await res.arrayBuffer());
const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
const rt = new Map();
for (const e of feed.entity) {
  const t = e.vehicle?.trip;
  if (t?.tripId)
    rt.set(t.tripId, {
      route_id: t.routeId ?? null,
      direction_id: t.directionId ?? null,
      start_date: t.startDate ?? null,
    });
}
console.log(`RT snapshot: ${rt.size} distinct trip_ids with an assignment`);

// 2) parse trips.txt header -> column indices
function splitCsv(line) {
  const out = [];
  let cur = "",
    q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const rl = createInterface({ input: createReadStream(TRIPS_TXT), crlfDelay: Infinity });
let cols = null;
const staticTrips = new Map();
for await (const line of rl) {
  if (!cols) { cols = splitCsv(line); continue; }
  if (!line) continue;
  const f = splitCsv(line);
  const trip_id = f[cols.indexOf("trip_id")];
  if (!rt.has(trip_id)) continue; // only keep the ~hundreds we care about
  staticTrips.set(trip_id, {
    route_id: f[cols.indexOf("route_id")],
    direction_id: f[cols.indexOf("direction_id")],
    shape_id: f[cols.indexOf("shape_id")],
    service_id: f[cols.indexOf("service_id")],
  });
}
console.log(`static trips.txt columns: ${cols.join(", ")}`);

// 3) compare
let matched = 0,
  routeAgree = 0,
  dirAgree = 0,
  withShape = 0;
const unmatchedSamples = [];
for (const [tripId, r] of rt) {
  const s = staticTrips.get(tripId);
  if (!s) {
    if (unmatchedSamples.length < 15) unmatchedSamples.push({ tripId, ...r });
    continue;
  }
  matched++;
  if (String(r.route_id) === String(s.route_id)) routeAgree++;
  if (r.direction_id == null || String(r.direction_id) === String(s.direction_id)) dirAgree++;
  if (s.shape_id && s.shape_id.trim() !== "") withShape++;
}

const report = {
  rtCount: rt.size,
  matched,
  matchRate: +(matched / rt.size).toFixed(4),
  routeAgree,
  routeAgreeRateOfMatched: +(routeAgree / Math.max(matched, 1)).toFixed(4),
  dirAgree,
  withShape,
  withShapeRateOfMatched: +(withShape / Math.max(matched, 1)).toFixed(4),
  unmatchedSamples,
};
writeFileSync(new URL("./join-report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log("\n=== RT <-> static trip_id join report ===");
console.log(`matched            : ${matched}/${rt.size}  (${(report.matchRate * 100).toFixed(1)}%)`);
console.log(`route_id agreement : ${routeAgree}/${matched}  (${(report.routeAgreeRateOfMatched * 100).toFixed(1)}% of matched)`);
console.log(`direction agreement: ${dirAgree}/${matched}`);
console.log(`joined trip has shape_id: ${withShape}/${matched}  (${(report.withShapeRateOfMatched * 100).toFixed(1)}%)`);
if (unmatchedSamples.length) {
  console.log(`unmatched RT trip_ids (sample):`);
  for (const u of unmatchedSamples) console.log("  " + JSON.stringify(u));
}
