# DoveBus — Phase 0 findings (spikes)

**Run:** 2026-08-12 · **Verdict:** ✅ all spikes pass — the High risk (RT↔static `trip_id` join) is retired. Cleared to build Phase 1.

Spike scripts live in [`spikes/`](spikes/) (throwaway; `node spikes/<name>.mjs`). Raw data (82→**125 MB** GTFS zip, comuni GeoJSON) was pulled to the scratchpad, not committed.

---

## Results vs the plan's Phase 0 checklist

### 1. RT ↔ static `trip_id` join — **THE High risk — PASS** (`static-join.mjs`)
- **96.6%** of live-running trips (649/672) join directly to static `trips.trip_id`.
- **100%** `route_id` agreement and **100%** `direction_id` agreement on every matched trip — the join is exact, not coincidental.
- **100%** of matched trips carry a non-empty `shape_id` → the mandatory planned-route line is drawable for every trackable bus.
- The 3.4% unmatched are a coherent tail: their `route_id`s are almost all **≥ 1150** (`1174, 1168, 1155, 1456…`) — routes present in RT but absent from today's `trips.txt` (newly-added/extra service). The plan's **route+start_time+direction fallback** covers exactly this tail, but at 96.6% exact-match it is a safety net, not load-bearing.

### 2. Calendar semantics — **PASS, with a model correction** (`calendar-check.mjs`)
- This feed uses the **`calendar_dates`-only model**: `calendar.txt` weekday columns are **all zero**; **all 513** services active today come from `calendar_dates.txt` `exception_type=1` additions.
- **Live proof: 657/657** joinable running trips resolve as active-today (100%). Zero false negatives.
- **Implementation rule:** the date resolver MUST treat `calendar_dates` as the primary source. A weekday-column-only resolver would return an **empty** active set for this feed and break both search modes. Still honor `exception_type=2` removals and the `calendar` validity window.

### 3. RT update cadence — **measured** (`rt-cadence.mjs`, two 2-min windows)
- Feed header `timestamp` regenerates **~every 120 s** (observed 119 s and 129 s, consistent). Snapshot age climbs to **~150 s** before a refresh appears.
- Per-vehicle `vehicle.timestamp` values within one snapshot span ~30 s and lag the header.
- **Decision:** poll `vehicle-positions` every **~30 s** (not the plan's 15 s) with adaptive backoff when the header is unchanged; `trip-updates` every **~60 s**. Never let a client hit the source.

### 4. ISTAT comuni + point-in-polygon enrichment — **PASS** (`pip-check.mjs`)
- Source: **`openpolis/geojson-italy` → `geojson/limits_R_9_municipalities.geojson`** (Tuscany = region 9, unpadded). WGS84, **273 comuni**, props incl. `name` + `com_istat_code`. Fixture comuni all present (Arezzo 051002, Anghiari 051001).
  - Caveat: openpolis tracks **June 2023** boundaries, not the Jan 2026 ISTAT vintage the plan named. Fine for stop→comune matching; a few merged comuni are the only drift, absorbed by the text fallback.
- **99.3%** PIP hit on a 3001-stop sample; **~232 ms projected for all 28,964 stops** with just a per-polygon bbox pre-filter (Flatbush/RBush optional, not required).
- The 0.7% misses are **correct**: genuinely non-Tuscan border stops the buses cross into (Porretta Terme & Ponte alla Venturina = Emilia-Romagna, S.Giustino Umbro = Umbria, Marinella = Liguria). They should get null comune. No San-Gimignano-style false positives observed.

### 5. License / attribution — **confirmed**
- **CC BY**, data holder & publisher **Regione Toscana** (dati.toscana.it dataset `rt-oraritb`). GTFS `feed_publisher_name` = "Autolinee Toscane".
- **Attribution string to ship:** `Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)`. openpolis comuni GeoJSON is separately CC-BY (credit openpolis/ISTAT).

---

## Bonus validations (not on the checklist, but done)

- **`trip-updates` feed is live and rich** (MVP delay feature confirmed): 1377 trips, every entity carries per-stop `stopTimeUpdate`; delays median 0 s, avg +90 s, range −1046 s…+8352 s; schedule-relationship field present (all `SCHEDULED` now, `CANCELED` will surface here). **621/680 (~91%)** of running buses have a matching trip-update by `trip_id`.
- **`vehicle-positions` snapshot:** 1001 entities, 981 positioned, **2 outside the Tuscany bbox** → outlier filter is genuinely needed. 675/1001 carry a `trip_id` (rest are deadheading/unassigned).

## Plan amendments (feed back into DoveBus-plan.md)

| Plan said | Reality | Action |
|---|---|---|
| Static zip ~82 MB, 62 files, pick `AUTOLINEE_TOSCANE.gtfs` | **125 MB** download; the `/gtfs` artifact **is** the consolidated feed — **10 standard files** | Import job downloads `/gtfs` directly; no per-zone selection needed |
| `shapes` ~253 MB, ~480 MB total import | **`shapes.txt` 277 MB, `stop_times.txt` 268 MB, ~560 MB** uncompressed | Bump disk/import budget; still fine on a CX22 |
| Poll start 15 s | Header regenerates **~120 s** | Poll 30 s + backoff |
| Calendar + calendar_dates | **calendar_dates-only** (weekday cols all zero) | Resolver keys on calendar_dates first |
| ISTAT Jan-2026 shapefile (needs conversion) | openpolis **R_9 GeoJSON**, ready-to-use, June-2023 vintage | Use openpolis R_9; note vintage |

**Nothing in Phase 0 invalidates the architecture.** The join works, shapes exist for every trackable trip, delays are available, comune enrichment is fast and accurate. Proceed to Phase 1 (static import + enrichment + atomic swap).
