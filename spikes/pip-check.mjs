// Phase 0 spike: feasibility of stop -> comune enrichment via point-in-polygon.
// Bbox pre-filter per comune polygon, then turf PIP. Reports hit rate on a sample,
// text-prefix fallback recovery for misses, and timing to extrapolate to all stops.
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

const DIR = "/tmp/claude-1000/-home-z13-Documents-DoveBus/6dd59dcc-1215-44fa-a1ad-5c7e0eec8c14/scratchpad";
const SAMPLE = 3000;

const gj = JSON.parse(readFileSync(`${DIR}/comuni_toscana.geojson`, "utf8"));
function splitCsv(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
}
const norm = (s) => s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/g, "");

// precompute bbox per comune feature
const feats = gj.features.map((f) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scan = (coords) => {
    for (const c of coords) {
      if (Array.isArray(c[0])) scan(c);
      else {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
      }
    }
  };
  scan(f.geometry.coordinates);
  return { f, name: f.properties.name, istat: f.properties.com_istat_code, bbox: [minX, minY, maxX, maxY] };
});
const nameByNorm = new Map(feats.map((x) => [norm(x.name), x]));

// load stops
const rl = createInterface({ input: createReadStream(`${DIR}/stops.txt`), crlfDelay: Infinity });
let idx = null;
const stops = [];
for await (const line of rl) {
  const rec = splitCsv(line);
  if (!idx) {
    idx = { id: rec.indexOf("stop_id"), name: rec.indexOf("stop_name"), lat: rec.indexOf("stop_lat"), lon: rec.indexOf("stop_lon") };
    continue;
  }
  const lat = parseFloat(rec[idx.lat]);
  const lon = parseFloat(rec[idx.lon]);
  if (Number.isFinite(lat) && Number.isFinite(lon))
    stops.push({ id: rec[idx.id], name: rec[idx.name], lat, lon });
}

// even sample across the file
const pool = stops.length <= SAMPLE ? stops : (() => {
  const s = []; const step = stops.length / SAMPLE;
  for (let i = 0; i < stops.length; i += step) s.push(stops[Math.floor(i)]);
  return s;
})();

const t0 = Date.now();
let pipHit = 0, fallbackHit = 0, miss = 0;
const missSamples = [];
for (const s of pool) {
  const pt = [s.lon, s.lat];
  let found = null;
  for (const cand of feats) {
    const [minX, minY, maxX, maxY] = cand.bbox;
    if (s.lon < minX || s.lon > maxX || s.lat < minY || s.lat > maxY) continue;
    if (booleanPointInPolygon(pt, cand.f)) { found = cand; break; }
  }
  if (found) { pipHit++; continue; }
  const n = norm(s.name);
  let fb = null;
  for (const [k, cand] of nameByNorm) if (k.length >= 4 && n.includes(k)) { fb = cand; break; }
  if (fb) fallbackHit++;
  else { miss++; if (missSamples.length < 12) missSamples.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon }); }
}
const ms = Date.now() - t0;
console.log("=== stop -> comune PIP feasibility ===");
console.log(`total stops (with coords): ${stops.length}  sampled: ${pool.length}`);
console.log(`PIP hit         : ${pipHit}  (${(100 * pipHit / pool.length).toFixed(1)}%)`);
console.log(`text fallback   : ${fallbackHit}  (${(100 * fallbackHit / pool.length).toFixed(1)}%)`);
console.log(`unresolved      : ${miss}  (${(100 * miss / pool.length).toFixed(1)}%)`);
console.log(`resolved total  : ${(100 * (pipHit + fallbackHit) / pool.length).toFixed(1)}%`);
console.log(`time: ${ms}ms for ${pool.length} stops -> ~${Math.round(ms / pool.length * stops.length)}ms projected for all ${stops.length}`);
if (missSamples.length) { console.log("unresolved samples:"); for (const m of missSamples) console.log("  " + JSON.stringify(m)); }
