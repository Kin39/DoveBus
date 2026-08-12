// Phase 0 spike: probe the GTFS-RT vehicle-positions feed.
// Decodes one snapshot, prints header timestamp + entity stats + sample trip_ids,
// and dumps the full set of RT trip_ids to a file for the static-join spike.
import { writeFileSync } from "node:fs";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const VP_URL =
  "https://regionetoscana.smartregion.toscana.it/mobility/artifacts/gtfs-rt/vehicle-positions";
const TUSCANY_BBOX = { minLat: 42.2, maxLat: 44.5, minLon: 9.6, maxLon: 12.5 };

async function fetchSnapshot(url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": "DoveBus-spike/0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = Date.now() - t0;
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
  return { feed, bytes: buf.length, ms };
}

const { feed, bytes, ms } = await fetchSnapshot(VP_URL);
const header = feed.header;
const ents = feed.entity;

let positioned = 0,
  outOfBbox = 0,
  withTrip = 0;
const tripIds = [];
const routeIds = new Set();
const samples = [];
for (const e of ents) {
  const v = e.vehicle;
  if (!v) continue;
  const p = v.position;
  if (p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
    positioned++;
    if (
      p.latitude < TUSCANY_BBOX.minLat ||
      p.latitude > TUSCANY_BBOX.maxLat ||
      p.longitude < TUSCANY_BBOX.minLon ||
      p.longitude > TUSCANY_BBOX.maxLon
    )
      outOfBbox++;
  }
  const trip = v.trip;
  if (trip && trip.tripId) {
    withTrip++;
    tripIds.push(trip.tripId);
    if (trip.routeId) routeIds.add(trip.routeId);
    if (samples.length < 8)
      samples.push({
        trip_id: trip.tripId,
        route_id: trip.routeId,
        start_date: trip.startDate,
        start_time: trip.startTime,
        direction_id: trip.directionId,
        current_stop_sequence: v.currentStopSequence,
        current_status: v.currentStatus,
        stop_id: v.stopId,
        vehicle_id: v.vehicle?.id,
        vehicle_ts: v.timestamp ? Number(v.timestamp) : null,
      });
  }
}

const hdrTs = header.timestamp ? Number(header.timestamp) : null;
const now = Math.floor(Date.now() / 1000);
console.log("=== GTFS-RT vehicle-positions snapshot ===");
console.log(`bytes=${bytes}  fetch=${ms}ms  gtfsRtVersion=${header.gtfsRealtimeVersion}  incrementality=${header.incrementality}`);
console.log(`header.timestamp=${hdrTs} (${hdrTs ? new Date(hdrTs * 1000).toISOString() : "n/a"})  age=${hdrTs ? now - hdrTs : "n/a"}s`);
console.log(`entities=${ents.length}  positioned=${positioned}  outOfTuscanyBbox=${outOfBbox}  withTripId=${withTrip}  distinctRouteIds=${routeIds.size}`);
console.log("sample entities:");
for (const s of samples) console.log("  " + JSON.stringify(s));

writeFileSync(
  new URL("./rt-trip-ids.json", import.meta.url),
  JSON.stringify({ capturedAt: now, headerTs: hdrTs, tripIds }, null, 2),
);
console.log(`\nWrote ${tripIds.length} RT trip_ids -> rt-trip-ids.json`);
