// Phase 0 spike: probe the GTFS-RT trip-updates feed (MVP delay/cancellation source).
// Decodes one snapshot, reports header, entity count, schedule-relationship distribution,
// delay stats, and how many trip-updates key onto currently-running vehicle trips.
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const BASE = "https://regionetoscana.smartregion.toscana.it/mobility/artifacts/gtfs-rt";
const { transit_realtime: TR } = GtfsRealtimeBindings;

async function decode(url) {
  const res = await fetch(url, { headers: { "User-Agent": "DoveBus-spike/0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { feed: TR.FeedMessage.decode(buf), bytes: buf.length };
}

// vehicle-positions trip_ids for cross-keying
const vp = await decode(`${BASE}/vehicle-positions`);
const vpTrips = new Set();
for (const e of vp.feed.entity) if (e.vehicle?.trip?.tripId) vpTrips.add(e.vehicle.trip.tripId);

const { feed, bytes } = await decode(`${BASE}/trip-updates`);
const hdrTs = feed.header.timestamp ? Number(feed.header.timestamp) : null;
console.log("=== GTFS-RT trip-updates snapshot ===");
console.log(`bytes=${bytes} entities=${feed.entity.length} headerTs=${hdrTs} (${hdrTs ? new Date(hdrTs * 1000).toISOString() : "n/a"})`);

const REL = ["SCHEDULED", "ADDED", "UNSCHEDULED", "CANCELED", "REPLACEMENT", "DUPLICATED", "DELETED"];
const relCounts = {};
let withTripUpdate = 0,
  keyedToVp = 0,
  withStopUpdates = 0;
const delays = [];
const samples = [];
for (const e of feed.entity) {
  const tu = e.tripUpdate;
  if (!tu) continue;
  withTripUpdate++;
  const rel = tu.trip?.scheduleRelationship ?? 0;
  const relName = REL[rel] ?? String(rel);
  relCounts[relName] = (relCounts[relName] || 0) + 1;
  if (tu.trip?.tripId && vpTrips.has(tu.trip.tripId)) keyedToVp++;
  const stus = tu.stopTimeUpdate || [];
  if (stus.length) withStopUpdates++;
  // pull a representative delay: prefer arrival delay of the first stop update that has one
  let repDelay = null;
  for (const s of stus) {
    const d = s.arrival?.delay ?? s.departure?.delay;
    if (d != null) { repDelay = d; break; }
  }
  if (repDelay != null) delays.push(repDelay);
  if (samples.length < 8)
    samples.push({
      trip_id: tu.trip?.tripId,
      route_id: tu.trip?.routeId,
      start_date: tu.trip?.startDate,
      rel: relName,
      stopUpdates: stus.length,
      repDelaySec: repDelay,
    });
}

console.log(`entities with tripUpdate: ${withTripUpdate}`);
console.log(`schedule relationship distribution: ${JSON.stringify(relCounts)}`);
console.log(`with >=1 stopTimeUpdate: ${withStopUpdates}`);
console.log(`keyed onto a running vehicle trip_id: ${keyedToVp}/${withTripUpdate} (vp running trips=${vpTrips.size})`);
if (delays.length) {
  delays.sort((a, b) => a - b);
  const sum = delays.reduce((a, b) => a + b, 0);
  console.log(`delay seconds: n=${delays.length} min=${delays[0]} p50=${delays[Math.floor(delays.length / 2)]} max=${delays[delays.length - 1]} avg=${(sum / delays.length).toFixed(0)}`);
}
console.log("samples:");
for (const s of samples) console.log("  " + JSON.stringify(s));
