# DoveBus — Implementation Plan

**Status:** ✅ APPROVED 2026-08-11 · **Phase 0 spikes VERIFIED 2026-08-12** (full results: [`PHASE0-FINDINGS.md`](PHASE0-FINDINGS.md); throwaway spikes in [`spikes/`](spikes/)) · **Phase 1 BUILT + verified on the live feed 2026-08-12** (static import, comune enrichment, refresh job, atomic swap — see [`README.md`](README.md); code in [`server/`](server/)). Next: Phase 2 (realtime poller). · **Complexity:** Medium (MVP), Large (with all phases)

> **Phase 0 verified deltas (baked into the sections below):** RT↔static `trip_id` join **96.6% exact / 100% route+direction+shape** (top risk retired). Calendar is a **`calendar_dates`-only** model (weekday columns all zero — resolver keys on `calendar_dates` first). RT header regenerates **~120 s → poll 30 s**, not 15 s. Static `/gtfs` is a **125 MB, 10-file consolidated feed** (not 82 MB / 62 files); `shapes.txt` **277 MB**, `stop_times.txt` **268 MB**. Comuni source = **openpolis `limits_R_9`** GeoJSON (273 comuni), PIP **99.3%**. License **CC BY**, string `Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)`.

**Locked decisions:** backend **Node.js + TypeScript**; `trip-updates` (delays/cancellations) in MVP; `shapes` + planned-route line mandatory in MVP. **Frontend must be built with the `frontend-design` skill** (invoke it before writing any UI).

Real-time map of every Autolinee Toscane bus in Tuscany, with two search modes
(known-line-by-time-window, and comune→comune→time for direct runs) plus a trail
of the path already travelled. Data-source facts below are **live-verified** (2026-08-11,
re-probed in Phase 0 on 2026-08-12 — see "0. Source validation").

---

## 0. Source validation (confirmed 2026-08-11, **re-verified in Phase 0 2026-08-12**)

| Item | Result |
|---|---|
| RT `vehicle-positions` | `https://regionetoscana.smartregion.toscana.it/mobility/artifacts/gtfs-rt/vehicle-positions` → HTTP 200, ~91 KB `application/octet-stream`, 0.4 s. **GET only (no HEAD)**. GTFS-RT v1.0, `FULL_DATASET` (every fetch = full snapshot). **Cadence measured: header `timestamp` regenerates ~120 s (119/129 s across two windows), age reaches ~150 s before refresh → poll 30 s + backoff.** |
| RT `trip-updates` / `alerts` | `.../gtfs-rt/trip-updates`, `.../gtfs-rt/alerts` — listed on dataset `rt-oraritr`. **`trip-updates` probed live: ~1377 trips, per-stop `stopTimeUpdate`, delays median 0 s / avg +90 s / range −1046…+8352 s; ~91% of running buses covered.** |
| Static GTFS (consolidated) | `https://regionetoscana.smartregion.toscana.it/mobility/artifacts/gtfs` → HTTP 200, `application/zip`, **~125 MB** (measured; earlier ~82 MB estimate was low), behind Kong 3.9.1. Dataset `rt-oraritb`. The `/gtfs` artifact **IS** the consolidated feed = **10 standard files** (agency, area, stops, routes, trips, stop_times, calendar, calendar_dates, shapes, feed_info) — no per-zone selection, no `AUTOLINEE_TOSCANE.gtfs` picking. `trips.txt` = 207,988 trips; validity `20260812`→`20260901`. |
| Decoded live sample | ~1001 entities, ~981 positioned, 343 routes; fields present verbatim: `trip_id, route_id, direction_id, start_time, start_date, lat/lon, current_stop_sequence, current_status, stop_id, vehicle.id/label/license_plate, occupancy_status, odometer`. 675/1001 carry a `trip_id` (rest deadheading/unassigned). |
| **RT↔static `trip_id` join (top risk)** | **RESOLVED — 96.6% exact join** (649/672), **100% `route_id` + `direction_id` agreement**, **100% of matched trips have a `shape_id`**. The 3.4% unmatched are `route_id` ≥1150 (RT-only extra service not in today's `trips.txt`) → route+start_time+direction fallback covers them. |
| Calendar model | **`calendar_dates`-only:** `calendar.txt` weekday columns all zero; all 513 services active on 2026-08-12 come from `calendar_dates.txt` `exception_type=1` adds. Live check: **657/657** running trips resolve as active-today. Resolver MUST key on `calendar_dates` first. |
| GPS outliers | Real: sample had 2 points outside Tuscany bbox → sanity bbox filter required (confirmed still needed in Phase 0). |
| License | CC-BY on both datasets. Only obligation: attribute *Regione Toscana / dati.toscana.it*. Derived product explicitly allowed. Ship string: `Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)`. |
| Comuni boundaries | **openpolis/geojson-italy → `geojson/limits_R_9_municipalities.geojson`** (Tuscany = region 9, unpadded). WGS84, **273 comuni**, props `name` + `com_istat_code`. June-2023 vintage (minor drift vs ISTAT Jan-2026; absorbed by text fallback). PIP **99.3%** hit, ~232 ms for all 28,964 stops with a bbox pre-filter. |
| OTP rejection | Confirmed: <1 GB → >100 GB (Germany 95 GB). Out of scope, as decided. |
| Hosting | Render free spins down (~15 min) → unsuitable. Hetzner CX22 ~€3.99/mo; Railway ~$5–9/mo. Cloudflare Workers cron = 1-min granularity (rejected for MVP). |

**Two facts to design around:** RT feed is **GET-only, full-snapshot, ~120 s cadence** (poller = fetch→decode→replace, poll 30 s); static zip is **~125 MB / 10 files** with **shapes.txt 277 MB + stop_times.txt 268 MB** (refresh-job + disk budget).

---

## 1. Recommended stack (one decision to confirm)

- **Backend:** Node.js + TypeScript, **Fastify**, **better-sqlite3** (synchronous, fast bulk insert), `gtfs-realtime-bindings`, native SSE. One always-on process.
- **Frontend:** **MapLibre GL JS** + vanilla TS, built with Vite → static bundle. (MapLibre chosen over Leaflet for smooth interpolation of ~1000 moving markers; Leaflet+canvas is the simpler fallback if we hit friction.)
- **DB:** SQLite file on the VPS (no server DB needed).
- **Hosting:** Hetzner CX22 VPS (backend, systemd + Caddy for TLS) + Netlify (frontend, free).
- **Local dev ports (fixed, to avoid clashing with the TruckNav project on 5173):** frontend Vite **`5280`** with `strictPort: true` (fail loudly, never auto-hop to 5174); backend Fastify **`3200`**. Frontend reaches the API via `VITE_API_BASE=http://localhost:3200` so the two are decoupled and changeable in one place.

Rationale: single language across front/back lowers maintenance (matches your low-overhead preference); better-sqlite3 makes the 5M-row import a single fast transaction. **Python is an equally valid alternative** for the backend (your import benchmark was in Python) — say the word and I'll swap the backend to FastAPI + `gtfs-realtime-bindings`. Everything else is language-agnostic.

---

## 2. Data architecture

### 2.1 SQLite schema
Standard GTFS tables: `agency, stops, routes, trips, stop_times, calendar, calendar_dates`, `shapes` (**required** — drives the mandatory planned-route line). Plus:

- **`stops` enriched** with `comune TEXT` and `comune_istat TEXT` (added at import via point-in-polygon; text fallback). Cross-border stops (Emilia/Umbria/Liguria) legitimately resolve to null comune.
- **`comuni`** (istat_code, name, name_norm, centroid_lat/lon) — drives autocomplete for mode 2. Seeded from openpolis `limits_R_9` (273 rows).
- **`feed_meta`** (feed_start_date, feed_end_date, imported_at, source_etag, source_sha1, db_version).

**Indexes:** `stop_times(stop_id)`, `stop_times(trip_id, stop_sequence)`, `trips(route_id)`, `trips(service_id)`, `routes(route_short_name)`, `stops(comune)`, `calendar(service_id)`, `calendar_dates(service_id, date)`, `comuni(name_norm)`. (Names normalized: uppercase, accent-stripped, for prefix/autocomplete matching.)

### 2.2 Static import pipeline (one-off + scheduled)
1. Download the consolidated `/gtfs` zip (**~125 MB**) → temp; capture ETag/SHA1. It already contains the 10 standard files — no per-zone selection.
2. Stream-parse each `.txt` (CSV), bulk-insert in a single transaction (batched). **`shapes.txt` is imported (required)** — **~277 MB** on disk — since the planned-route line is a mandatory feature (100% of trackable trips have a `shape_id`). `stop_times.txt` is **~268 MB**. Index `shapes(shape_id, shape_pt_sequence)`; `trips.shape_id` links a trip to its polyline. (Budget the extra import + disk accordingly; still comfortably within a CX22.)
3. **Comune enrichment (once, at import):** load openpolis Tuscan comuni polygons (GeoJSON, 273 features), build a per-polygon bbox pre-filter (Flatbush/RBush optional — measured ~232 ms for all 28,964 stops without it), point-in-polygon each stop (`@turf/boolean-point-in-polygon`) → set `comune`/`comune_istat`. **Fallback** when PIP misses (near borders): prefix match `stop_name` against `comuni.name_norm`.
4. Write `feed_meta`. Build into `gtfs.new.db`, then **atomic swap** (rename → reopen connection) so live traffic never sees a half-built DB.

### 2.3 Static refresh job (required, not optional)
Scheduled (systemd timer / node-cron), **daily** check: download, compare `feed_end_date` + SHA1 vs `feed_meta`. If changed → re-import + atomic swap. Guards against the ~20-day "summer timetable" expiry (feed_end_date `20260901`) silently serving stale schedules. Emit a log + health flag if the loaded feed is past `feed_end_date`.

### 2.4 Realtime poller (single process, shared cache)
- One interval, **GET** `vehicle-positions`, decode protobuf.
- **Outlier filter:** drop/flag positions outside Tuscany bbox (~42.2–44.5 N, 9.6–12.5 E) — confirmed needed (~2/981 out).
- Build in-memory map keyed by `(trip_id, start_date)` (fallback `vehicle.id`): latest position + status + `vehicle.timestamp`.
- **Trail buffer:** per key, ring buffer of `(lat, lon, ts)` for the last ~30 min (RAM only; no persistent history in MVP).
- **Poll cadence:** **30 s** (header regenerates ~120 s; measured in Phase 0). Adaptive backoff on unchanged header timestamp. Never let a client hit the source — the poller is the only fetcher.
- **`trip-updates` (MVP):** second poller at **~60 s** on `.../gtfs-rt/trip-updates`. Decode → in-memory map keyed by `(trip_id, start_date)` holding delay/schedule-relationship (`SCHEDULED / SKIPPED / CANCELED`) and per-stop arrival/departure delay seconds. Joined onto the vehicle state so the trip live payload carries the current delay and any cancellation. (Live-verified: ~91% of running buses have a matching trip-update.)

### 2.5 Freshness model (busbus-style, honest)
Age = `now − vehicle.timestamp`, bucketed **0–30 s "aggiornato" / 31–90 s "recente" / 91–180 s "attenuato" / >180 s stale**. Thresholds are named constants. Frontend colors markers by bucket; interpolation is graphical only and never resets the age. (Note: header cadence ~120 s means a fresh snapshot's vehicle timestamps commonly sit in the 31–90 s band — expected, not a bug.)

---

## 3. Search modes (queries)

**Mode 1 — known line + time window.** Resolve `route_short_name` → routes; find `trips` whose `service_id` is active on the chosen date (resolve via **`calendar_dates` first** — this feed's `calendar` weekday columns are all zero — then apply `calendar` validity window + `exception_type=2` removals) and whose departure falls in the window; return trip list (origin/destination from first/last `stop_times`, `start_time`). User picks → live-track by `trip_id`.

**Mode 2 — comune → comune → time.** Expand comune A/B → `stop_id` sets via the enriched `comune` column (text fallback). Then the brief's verified self-join, hardened:

```sql
SELECT DISTINCT r.route_short_name, sa.departure_time, t.trip_id
FROM stop_times sa
JOIN stop_times sb ON sa.trip_id = sb.trip_id AND sa.stop_sequence < sb.stop_sequence
JOIN trips  t ON t.trip_id  = sa.trip_id
JOIN routes r ON r.route_id = t.route_id
WHERE sa.stop_id IN (:stopsA)
  AND sb.stop_id IN (:stopsB)
  AND t.service_id IN (:serviceIdsActiveOnDate)   -- resolved via calendar_dates first, then calendar window
  AND sa.departure_time BETWEEN :from AND :to
ORDER BY sa.departure_time;
```

Must-haves proven in the brief's tests: **DISTINCT + calendar filter** (raw join gave 736 rows vs 34 real, ~20×), and the **UI groups by `trip_id`** (collapses the 06:30/06:32 near-stop duplicates, and correctly surfaces multiple lines on the same OD — SI381 + BAAS). Result rows note which exact A-stop serves the run.

---

## 4. Backend API

| Endpoint | Purpose |
|---|---|
| `GET /api/comuni?q=` | Comune autocomplete (mode 2). |
| `GET /api/routes?q=` | Line autocomplete (mode 1). |
| `GET /api/search/line?route=&date=&from=&to=` | Mode 1 trip list. |
| `GET /api/search/od?comuneA=&comuneB=&date=&from=&to=` | Mode 2 trip list. |
| `GET /api/vehicles?bbox=` | Current positions in viewport (map). |
| `GET /api/trip/:tripId?date=` | Schedule + planned shape + current live position + trail + **delay/cancellation** (from `trip-updates`). |
| `GET /api/stream/trip/:tripId` | **SSE** live push (position + trail + freshness + **delay**). |
| `GET /healthz` | Liveness + "feed past feed_end_date?" flag. |

**Live-match:** RT entities carry `trip_id`+`start_date`+`route_id`, so tracking a selected scheduled trip = find the RT entity with matching `(trip_id, start_date)`. **Verified in Phase 0** (RT `trip_id` like `60732-4` aligns with static `trips.trip_id`, 96.6% exact + fallback for the RT-only tail).

**Trail semantics (MVP):** the returned trail is the backend's RAM buffer (last ~30 min), so for a run that started before the backend was watching it, the trail begins where buffering began — honest and clearly labelled. **Phase 2:** reconstruct the full travelled portion from the planned `shape` truncated at `current_stop_sequence`.

---

## 5. Frontend

> **Build with the `frontend-design` skill** — invoke it before writing any UI code so the interface is distinctive and production-grade rather than generic.

- MapLibre map of Tuscany; markers colored by freshness bucket; smooth **interpolation** between the last two GPS reads via `requestAnimationFrame` (labelled as smoothing).
- **Search panel, two tabs:** (1) line + date + time window; (2) comune-A / comune-B (autocomplete) + date + time window. Both produce a trip list → select → live view.
- **Live view:** selected bus marker + **trail polyline** (travelled, from GPS) + **planned-route line** (the full path the bus will follow, from the trip's `shape`) + a freshness badge with the age label + a **delay/cancellation badge** (on-time / +N min late / cancelled, from `trip-updates`). Subscribes to `/api/stream/trip/:tripId` (SSE).
- No app, no login, no cookies beyond essentials. CC-BY attribution footer ("Dati: Regione Toscana — dati.toscana.it").
- Minimal, single-question UX per the busbus.it inspiration.

---

## 6. Hosting / deploy / cost

- **Backend:** Hetzner CX22 (~€3.99/mo) — Node under systemd, Caddy for automatic TLS. SQLite on local SSD. (ARM CAX11 ~€3.79 if the stack is ARM-clean; Railway ~$5–9/mo if you prefer PaaS over a VPS.)
- **Frontend:** Netlify free (matches your existing workflow).
- **Rejected:** Render free (sleeps), Cloudflare Workers (1-min cron + Durable Objects overhead for the trail) — reconsider only as a later optimization.
- **Est. run cost:** ~€4/mo. Domain extra.

---

## 7. Testing (per your TDD/coverage rules, 80%)

Unit: outlier bbox filter; freshness bucketing; comune PIP + text fallback; **`calendar_dates`-first date resolution** (assert the all-zero-weekday case yields the correct active set); OD self-join (assert DISTINCT + trip_id grouping on the Arezzo→Anghiari fixture → SI381 + BAAS, ~34 runs); **`trip-updates` decode → delay/cancellation join onto vehicle state**. Integration: import→schema→indexes; each API endpoint on a fixture DB; SSE emits on poller tick. TDD red→green throughout.

---

## 8. Roadmap — MVP vs later (kept explicitly separate)

### MVP (ship this)
1. **Phase 0 — spikes ✅ DONE (2026-08-12):** RT cadence measured (~120 s); **RT↔static `trip_id` join verified (96.6%/100%)**; calendar semantics confirmed (`calendar_dates`-only); Tuscan comuni GeoJSON fetched + PIP validated (99.3%); license attribution confirmed. Bonus: `trip-updates` live-verified. Results in [`PHASE0-FINDINGS.md`](PHASE0-FINDINGS.md).
2. **Phase 1 — static import ✅ DONE (2026-08-12):** comune enrichment, `feed_end_date` refresh job and atomic swap, built and run against the live feed. Measured: 125 MB download ~45 s; import+enrich+index 71 s → 994 MB DB; 5,574,809 `stop_times` / 7,594,712 `shapes` / 207,987 trips / 28,964 stops; **99.2% comune enrichment** (28,716 polygon, 4 name, 244 nulls); **100% of trips carry a shape**; 513 services active on 2026-08-12, all via `calendar_dates` (**0 weekday patterns — resolver model confirmed on real data**); Arezzo→Anghiari OD search returns 17 trips one way / 15 the other on **SI381 + BAAS** (~180 ms cold), matching the brief's fixture. 96 tests, 97% statement coverage. Usage in [`README.md`](README.md).
3. Realtime poller (vehicle-positions, 30 s) + outlier filter + shared in-memory state + **~30-min trail buffer**; **`trip-updates` poller** (60 s) for delays/cancellations joined onto vehicle state.
4. API: comuni/routes autocomplete, mode-1 search, mode-2 search, vehicles-in-bbox, trip live (with **delay**) via SSE.
5. Frontend: MapLibre map, two search modes, live marker + trail + freshness colors + interpolation + **delay/cancellation badge**.
6. **`shapes` import + planned-route line** — mandatory: `/api/trip/:tripId` serves the trip's `shape` polyline; the frontend draws it as the route the bus will follow.
7. Deploy: Hetzner backend + Netlify frontend + CC-BY attribution.

### Phase 2+
- `alerts` feed (service advisories/disruptions banner).
- **Shape-based full travelled-path** reconstruction (beyond the RAM buffer window).
- Persistent long-term position history.
- Occupancy / vehicle label display; PWA/offline; i18n.

### Explicitly out of scope (per brief)
- Multi-leg routing with transfers (Google-Maps style / OTP / MOTIS).
- Push notifications.
- Paid public developer API — *but* keep the internal API layer clean so it could be exposed later without heavy refactor (design goal, not a requirement).

---

## 9. Risks

| Risk | Likelihood | Status / Mitigation |
|---|---|---|
| RT `trip_id` ≠ static `trip_id` (breaks live-tracking of a selected run) | ~~High~~ **RETIRED** | **Phase 0 verified: 96.6% exact, 100% route+direction+shape agreement.** Fallback on route+start_time+direction for the ~3.4% RT-only tail (route_id ≥1150). |
| Comune enrichment wrong near borders / San-Gimignano-style false positives | ~~Medium~~ **Low** | **Phase 0: 99.3% PIP hit.** **Phase 1 on the full 28,964 stops: the false positive DID appear** — the name fallback claimed "BIVIO PRATO" (a junction 98 km from Prato) for Prato. Fixed in code review: a name match is now only accepted when the stop's coordinates are within ~5 km of that comune's bounding box; unplaceable stops stay NULL. 99.2% resolved, 4 name matches, all verified correct. |
| OD query row explosion | Medium | DISTINCT + calendar filter + group-by-trip_id (proven on fixtures). |
| ~20-day feed validity expiry serving stale schedules | Medium | Daily refresh job on `feed_end_date` (`20260901`); health flag when past validity. |
| Poll cadence / hammering the source | ~~Low~~ **Resolved** | Single poller; **measured ~120 s cadence → 30 s poll + adaptive backoff on unchanged header.** |
| GPS outliers → ghost buses | Low | Tuscany bbox sanity filter (confirmed still needed). |
| 5M-row `stop_times` (~268 MB) + `shapes` (~277 MB) import memory/time | Low | Streamed CSV + batched single transaction (better-sqlite3). |

---

**Phase 0 done — proceed to Phase 1?** Reply to confirm, or adjust any amended detail
(poll cadence, calendar resolver, comuni source) before the static-import build begins.
