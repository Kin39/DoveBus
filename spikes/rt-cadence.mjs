// Phase 0 spike: measure the real update cadence of vehicle-positions.
// Polls the feed every INTERVAL_MS for DURATION_MS, records the feed header
// timestamp each time, and reports how often the snapshot actually changes.
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const VP_URL =
  "https://regionetoscana.smartregion.toscana.it/mobility/artifacts/gtfs-rt/vehicle-positions";
const INTERVAL_MS = 5000;
const DURATION_MS = 120000;

async function headerTs() {
  const res = await fetch(VP_URL, { headers: { "User-Agent": "DoveBus-spike/0" } });
  const buf = Buffer.from(await res.arrayBuffer());
  const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
  return { ts: feed.header.timestamp ? Number(feed.header.timestamp) : null, bytes: buf.length };
}

const samples = [];
const start = Date.now();
console.log("polling every 5s for 120s ...");
while (Date.now() - start < DURATION_MS) {
  const wall = Math.floor(Date.now() / 1000);
  try {
    const { ts, bytes } = await headerTs();
    samples.push(ts);
    console.log(`wall=${wall} headerTs=${ts} age=${ts ? wall - ts : "n/a"}s bytes=${bytes}`);
  } catch (e) {
    console.log(`wall=${wall} ERROR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

// Distinct consecutive header timestamps -> update intervals
const changes = [];
for (let i = 1; i < samples.length; i++) {
  if (samples[i] !== samples[i - 1] && samples[i] != null && samples[i - 1] != null) {
    changes.push(samples[i] - samples[i - 1]);
  }
}
const distinct = [...new Set(samples.filter((x) => x != null))];
console.log("\n=== cadence summary ===");
console.log(`polls=${samples.length}  distinctHeaderTs=${distinct.length}`);
if (changes.length) {
  const min = Math.min(...changes),
    max = Math.max(...changes),
    avg = changes.reduce((a, b) => a + b, 0) / changes.length;
  console.log(`header-ts advance intervals (s): min=${min} max=${max} avg=${avg.toFixed(1)}  observed=${JSON.stringify(changes)}`);
} else {
  console.log("header ts never advanced during the window");
}
