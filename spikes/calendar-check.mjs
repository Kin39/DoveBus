// Phase 0 spike: confirm calendar/calendar_dates date-resolution semantics on a live date.
// Builds the set of service_ids active TODAY, then checks that the trips currently
// running in the RT feed resolve as active-today (they must, if our model is right).
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const DIR = "/tmp/claude-1000/-home-z13-Documents-DoveBus/6dd59dcc-1215-44fa-a1ad-5c7e0eec8c14/scratchpad";
const VP_URL =
  "https://regionetoscana.smartregion.toscana.it/mobility/artifacts/gtfs-rt/vehicle-positions";

const today = new Date();
const yyyymmdd =
  `${today.getFullYear()}` +
  `${String(today.getMonth() + 1).padStart(2, "0")}` +
  `${String(today.getDate()).padStart(2, "0")}`;
const dow = today.getDay(); // 0=Sun..6=Sat
const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][dow];
console.log(`today=${yyyymmdd} weekday=${WD}`);

async function* rows(file) {
  const rl = createInterface({ input: createReadStream(`${DIR}/${file}`), crlfDelay: Infinity });
  let cols = null;
  for await (const line of rl) {
    const f = line.split(","); // these files have no quoted commas in the columns we read
    if (!cols) { cols = f; continue; }
    if (line) yield { f, cols };
  }
}

// calendar.txt: base weekly pattern within [start_date,end_date]
const activeByWeekday = new Set();
for await (const { f, cols } of rows("calendar.txt")) {
  const g = (n) => f[cols.indexOf(n)];
  if (g(WD) === "1" && g("start_date") <= yyyymmdd && yyyymmdd <= g("end_date"))
    activeByWeekday.add(g("service_id"));
}
// calendar_dates.txt: exceptions on the specific date (1=add, 2=remove)
const added = new Set(),
  removed = new Set();
for await (const { f, cols } of rows("calendar_dates.txt")) {
  const g = (n) => f[cols.indexOf(n)];
  if (g("date") !== yyyymmdd) continue;
  if (g("exception_type") === "1") added.add(g("service_id"));
  else if (g("exception_type") === "2") removed.add(g("service_id"));
}
const activeToday = new Set([...activeByWeekday, ...added]);
for (const s of removed) activeToday.delete(s);
console.log(
  `services active-by-weekday=${activeByWeekday.size}  added-today=${added.size}  removed-today=${removed.size}  => activeToday=${activeToday.size}`,
);
const addedOnly = [...added].filter((s) => !activeByWeekday.has(s)).length;
console.log(`  (of which ${addedOnly} are active ONLY via a calendar_dates add, no weekday pattern)`);

// RT trips running now -> their service_id -> is it active today?
const res = await fetch(VP_URL, { headers: { "User-Agent": "DoveBus-spike/0" } });
const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(Buffer.from(await res.arrayBuffer()));
const runningTripIds = new Set();
for (const e of feed.entity) if (e.vehicle?.trip?.tripId) runningTripIds.add(e.vehicle.trip.tripId);

let checked = 0,
  activeOk = 0,
  notActive = 0,
  tripNotFound = 0;
const notActiveSamples = [];
for await (const { f, cols } of rows("trips.txt")) {
  const trip_id = f[cols.indexOf("trip_id")];
  if (!runningTripIds.has(trip_id)) continue;
  const service_id = f[cols.indexOf("service_id")];
  checked++;
  if (activeToday.has(service_id)) activeOk++;
  else {
    notActive++;
    if (notActiveSamples.length < 10) notActiveSamples.push({ trip_id, service_id });
  }
}
tripNotFound = runningTripIds.size - checked; // running RT trips absent from static trips.txt
console.log("\n=== calendar resolution vs live-running trips ===");
console.log(`running RT trips: ${runningTripIds.size}  (in static trips.txt: ${checked}, absent: ${tripNotFound})`);
console.log(`of the ${checked} joinable running trips: service active-today=${activeOk}, NOT active=${notActive}`);
if (notActiveSamples.length) {
  console.log("running-but-not-active-today samples (would be a model bug):");
  for (const s of notActiveSamples) console.log("  " + JSON.stringify(s));
}
