# DoveBus — Implementation Plan

**Status:** ✅ APPROVED 2026-08-11 · **Phase 4 BUILT + verified by the screenshot loop, then revised after the owner's manual check 2026-08-14** (MapLibre frontend, mobile-first, **light theme**; position estimated along the route between fixes with its uncertainty drawn; travelled path reconstructed on the shape; buses unheard-from 5 min hidden — see [`README.md`](README.md); code in [`client/`](client/)) · **Phase 0 spikes VERIFIED 2026-08-12** (full results: [`PHASE0-FINDINGS.md`](PHASE0-FINDINGS.md); throwaway spikes in [`spikes/`](spikes/)) · **Phase 1 BUILT + verified on the live feed 2026-08-12** (static import, comune enrichment, refresh job, atomic swap) · **Phase 2 BUILT + verified on the live feeds 2026-08-12** (realtime pollers, trails, freshness, delay/cancellation join) · **Phase 3 BUILT + verified against the live database and feeds 2026-08-13** (Fastify API: both search modes, vehicles-in-bbox, trip detail with planned shape, SSE live stream, healthz — see [`README.md`](README.md); code in [`server/`](server/)) · **Phase 5 — public web surface ✅ COMPLETE 2026-08-22** (landing at `/`, the three trust pages, app moved to `/mappa/`, head + JSON-LD + og-image + manifest + robots + sitemap; both screenshot loops clean — see §10.4) · **Technical SEO audit of the built site ✅ DONE 2026-08-22** (run against `client/dist`, not the sources; seven fixes — intent split between `/` and `/mappa/`, the map page given a heading, shared entity markup and a crawlable attribution, the redirect table completed, `FAQPage` made quotable and guarded by a new assertion — see §10.8). Next: deploy (Hetzner + Netlify) — set the real `SITE_URL` first, see §10.7. · **Complexity:** Medium (MVP), Large (with all phases)

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

> **Feed republishing — observed 2026-08-15, after Phase 4.** The `/gtfs` artifact is **not stable for the validity window it declares**. A feed imported on 12/08 declaring `20260812→20260901` was replaced upstream by 15/08 with a different one (`20260815→20260904`, 270,823 trips against 207,987) while the original still had 17 days of declared validity left. Anything that trusts `feed_end_date` to decide freshness will be wrong for days at a time; the refresh job's SHA1 comparison is the check that works.

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

### 2.3 Static refresh job (required, not optional) — **scheduled *and* reactive**
Scheduled (systemd timer / node-cron), **daily** check: download, compare `feed_end_date` + SHA1 vs `feed_meta`. If changed → re-import + atomic swap. **Plus, since 2026-08-15, reactive:** the API watches what share of live trips its timetable cannot explain and refreshes itself when that crosses 10%. The daily timer alone left a wrong timetable serving for up to a day, which is exactly what happened; and the source cannot be asked cheaply (no `ETag`, no `Last-Modified`, `Range` ignored — verified), so a free signal has to trigger the 125 MB check rather than a clock. Guards against the ~20-day "summer timetable" expiry (feed_end_date `20260901`) silently serving stale schedules. Emit a log + health flag if the loaded feed is past `feed_end_date`.

### 2.4 Realtime poller (single process, shared cache)
- One interval, **GET** `vehicle-positions`, decode protobuf.
- **Outlier filter:** drop/flag positions outside Tuscany bbox (~42.2–44.5 N, 9.6–12.5 E) — confirmed needed (~2/981 out).
- Build in-memory map keyed by `(trip_id, start_date)` (fallback `vehicle.id`): latest position + status + `vehicle.timestamp`.
- **Trail buffer:** per key, ring buffer of `(lat, lon, ts)` for the last ~30 min (RAM only; no persistent history in MVP).
- **Poll cadence:** **30 s** (header regenerates ~120 s; measured in Phase 0). Adaptive backoff on unchanged header timestamp. Never let a client hit the source — the poller is the only fetcher.
- **`trip-updates` (MVP):** second poller at **~60 s** on `.../gtfs-rt/trip-updates`. Decode → in-memory map keyed by `(trip_id, start_date)` holding delay/schedule-relationship (`SCHEDULED / SKIPPED / CANCELED`) and per-stop arrival/departure delay seconds. Joined onto the vehicle state so the trip live payload carries the current delay and any cancellation. (Live-verified: ~91% of running buses have a matching trip-update.)

### 2.5 Freshness model (busbus-style, honest) — **recalibrated in Phase 2**
Age = `now − vehicle.timestamp`, bucketed **0–90 s "aggiornato" / 91–180 s "recente" / 181–300 s "attenuato" / >300 s stale**. Thresholds are named constants in `config.ts`. Frontend colors markers by bucket **and always prints the exact age in seconds next to the label** ("aggiornato 47 s fa"); interpolation is graphical only and never resets the age.

> **Colour cycling — raised and RESOLVED in Phase 4 (2026-08-14).** Building the map made a residual effect visible that the numbers alone did not: because a fix arrives already ~116 s old and then ages ~120 s before the next snapshot, an ordinary healthy bus travels from **recente** into **attenuato** on every publisher cycle, and the whole fleet does it *together*. **Resolved by the age cutoff rather than by moving the bands.** The owner chose the busbus approach — hide what we cannot vouch for — and the cutoff was derived from this feed rather than borrowed: busbus.it hides at 3 minutes, which measured against 1,092 live vehicles over two and a half minutes would have emptied the map completely twice (0% / 83% / 82% / 74% / 26% / 0% visible). **`MAX_VISIBLE_AGE_S = 300`** is where that flicker stops — a steady 84–85% of the fleet drawn, and the ~15% left out genuinely no longer reporting. The visible population therefore lives entirely between ~116 s and 300 s, the bands still describe it correctly, and `live` (0–90 s) stays in the code unreachable so it lights up by itself if the publisher ever speeds up. **The bus a rider is actively following is exempt from the cutoff** — vanishing mid-watch is the worst possible moment to disappear.
>
> **Why these numbers and not the plan's original 0–30 / 31–90 / 91–180.** Phase 2 measured 1,127 live vehicles for 5 minutes: a bus's own timestamp is already ~40–60 s old when the snapshot appears, and that snapshot then ages ~120 s before the next one. **Not one vehicle ever reached the 0–30 s bucket**; right after a refresh 70% read "recente" / 12% "attenuato" / 18% "stale", and ~2 minutes later 100% read "stale" — with nothing wrong at all. The old bands reported *where we were in the publisher's cycle*, not whether a bus was reporting well. The bands now describe the bus; the printed age is the unrounded truth, so honesty does not depend on the colour.

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

> **MOBILE FIRST — owner's explicit requirement (2026-08-13), not a nice-to-have.** The phone is the primary target and the design starts there; the desktop layout is what the mobile one grows into, never the reverse. Concretely, and to be held to in review:
> - **Design at 375×812 first.** Nothing ships until it works there; wider viewports are progressive enhancement.
> - **The map owns the screen**, the search lives in a **bottom sheet** — thumb-reachable, draggable, collapsible. No sidebar, no top-anchored controls a thumb cannot reach.
> - **Touch targets ≥44 px**, no hover-only affordances (there is no hover on a bus), honour safe-area insets for notches and home indicators.
> - **Render vehicles as MapLibre GeoJSON layers, never DOM markers.** ~1,150 markers as DOM nodes will not hold a frame rate on a mid-range phone; the interpolation runs on the layer's source data.
> - **Ask for the viewport, not the region:** `GET /api/vehicles?bbox=` — the whole region is 464 KB, a city viewport ~108 KB (measured), and the difference is a rider's mobile data.
> - **Assume the network drops.** A bus rider is on a moving bus: the SSE stream must reconnect cleanly, and the freshness age must stay honest across a reconnection rather than resetting.
> - **Legible in sunlight, one-handed, at a bus stop** — that is the actual usage context and it decides contrast, type size and how much can be on screen at once.

> **The frontend is built as a screenshot loop — owner's explicit requirement (2026-08-13).** Not "build it, then check it at the end": every increment is verified by looking at it, at several resolutions, before moving on.
>
> ```
> build/change ─► screenshot at every viewport ─► read the shots, list concrete defects
>      ▲                                                          │
>      └──────────────── fix / improve ◄─────────────────────────┘   until a pass is clean
> ```
>
> - **Viewports, every round:** 320×568 (smallest realistic), **375×812 (the primary target)**, 393×852, 414×896, 768×1024, 1280×800. Light and dark if the design is themed.
> - **Screenshot the states, not just the landing page** — an empty map, the search sheet open on both tabs, an autocomplete dropdown mid-type, a results list (including a long one), the live trip view with trail + freshness + delay badges, and the error/offline state. Most of the risk is in the states, not the first paint.
> - **Shoot against the real API and the real data.** Tuscan comune names run long ("Castelnuovo di Val di Cecina"), a busy viewport is hundreds of buses, and a delay badge can read "+139 min". Fixtures would hide exactly the overflow this loop exists to catch.
> - **Assert what a screenshot cannot show, in the same run:** no horizontal page scroll, touch targets ≥44 px, no console errors, no layout shift after load, and a frame rate that survives a full viewport of vehicles.
> - **The loop runs until a round produces no findings** — a round that only finds nits still gets a fix pass and another round.
> - **Committed as a script** (e.g. `npm run shots`), not ad-hoc tooling, so the owner can rerun the exact same check and so it survives into later phases. Playwright drives it; the artifacts land in a gitignored directory.

- MapLibre map of Tuscany; markers colored by freshness bucket; smooth **interpolation** between the last two GPS reads via `requestAnimationFrame` (labelled as smoothing).
- **Search panel, two tabs:** (1) line + date + time window; (2) comune-A / comune-B (autocomplete) + date + time window. Both produce a trip list → select → live view.
- **Live view:** selected bus marker + **trail polyline** (travelled, from GPS) + **planned-route line** (the full path the bus will follow, from the trip's `shape`) + a freshness badge with the age label + a **delay/cancellation badge** (on-time / +N min late / cancelled, from `trip-updates`). Subscribes to `/api/stream/trip/:tripId` (SSE).
- No app, no login, no cookies beyond essentials. CC-BY attribution footer ("Dati: Regione Toscana — dati.toscana.it").
- Minimal, single-question UX per the busbus.it inspiration.

---

## 6. Hosting / deploy / cost

- **Backend:** a small always-on VPS — Node under systemd, Caddy for automatic TLS, SQLite on local SSD.
- **Frontend:** Netlify free (matches your existing workflow).
- **Rejected:** Render free (sleeps), Cloudflare Workers (1-min cron + Durable Objects overhead for the trail) — reconsider only as a later optimization. Serverless of any kind is out for four separate reasons: a 1.2 GB database on a persistent disk, pollers whose value *is* the state they accumulate in RAM, long-lived SSE connections, and the one-process design that keeps every client off the regional feed.
- **~~Hetzner CX22 (~€3.99/mo)~~ — the price this plan quoted no longer exists.** Checked in the console on 2026-08-24: the CX/CAX line now sits under "Cost-Optimized" and is **not available**, and what can actually be bought starts at **€14.02/mo** (CPX12, 1 vCPU / 2 GB / 40 GB) and **€23.78/mo** (CPX22), VAT included. Six times the note this plan carried. A cost figure that is wrong is worse than none, hence this correction.

### 6.0 What the machine actually has to do — measured 2026-08-24

Sizing this by reading the code was how the €3.99 got written down. These are the numbers instead:

| | Measured |
|---|---|
| API process, steady state | **133 MB RSS** — the database is read through the OS page cache, not the heap |
| Import, peak of the whole process tree | **774 MB RSS** (`/usr/bin/time -v`, full download + rebuild) |
| Import, wall clock | **3m 13s** end to end, 83 s of CPU — a 138 MB download and 7.5 M `stop_times` rows |
| Database on disk | **1.19 GB**; peak during a refresh ~2.6 GB with the staging copy and the zip |
| `/api/vehicles`, whole region | 406 KB in 5.8 ms |

So the floor is **2 GB of RAM and ~20 GB of disk**: the import peak plus the API plus the OS lands near 1.1 GB, which a 2 GB box carries with room and a 1 GB box does not. Anything above that is headroom, not requirement — and the €4–7/mo band buys 2–4 GB comfortably from several providers (Aruba's Italian datacentre, OVH, netcup), which is where this deploy goes instead.

### 6.1 Blockers found before deploying — verified on the running stack 2026-08-19 — ✅ ALL CLOSED 2026-08-24 (§12)

Measured against the real servers, not read off the code. Netlify is not implicated in any of them: it serves `client/dist` and the only couplings are `VITE_API_BASE`, which Vite **bakes into the bundle at build time** (changing the API address needs a rebuild, not an env var), and CORS.

**a. `npm ci --omit=dev` breaks both the API and the refresh — fix before the first deploy.** `server/package.json` has no build script: production runs `tsx src/cli/serve.ts`, and `tsx` + `typescript` sit in `devDependencies`. A standard production install leaves nothing able to start. Either install with dev dependencies, move `tsx` into `dependencies`, or add a compile step.

**b. The refresh spawn does work — verified, not assumed.** `serve.ts` spawns `node [...process.execArgv] refresh.ts`, i.e. it hands Node a TypeScript file, which only survives if the tsx loader is in `execArgv`. Tested under `npm run serve`'s own invocation: `execArgv` carries `--require tsx/preflight.cjs --import tsx/loader.mjs`, and the child ran a `.ts` file to exit 0. No change needed.

**c. `AUTO_REFRESH` will re-download 142 MB every hour, forever, without ever fixing what it is reacting to.** On 2026-08-19 a manual refresh moved the unmatched-trip ratio only 0.204 → 0.169, against a 0.10 threshold — not the 0.3% the 2026-08-15 incident settled at. The cause is not a stale timetable: **trip ids `78000–79999` are wholly absent from the static feed** (0 rows, against 27,345 in `70000–77999`) while the realtime feed broadcasts 26 live buses on them. Both feeds are the operator's; they disagree. No refresh can reconcile that, so `timetableMatch` stays `stale`, `/healthz` stays `degraded`, and the watch fires on every cooldown — 24 rebuilds/day, ~2.5 GB written each, ~60 GB/day of SSD writes plus minutes of a shared vCPU at 100%. `watch.ts` anticipated the shape of this ("if a refresh did not fix it, running it again immediately will not either") but the cooldown only slows the loop, it does not break it. ~~**Deploy with `DOVEBUS_AUTO_REFRESH=false` and the daily timer alone until the watch can give up**~~ — **the watch gives up now (§12.4), so this deploy note is retired**: the durable fix is to stop retrying when a refresh fails to improve the ratio, and only rearm when the static feed's SHA1 changes. Excluding the chronically unresolvable ids from the sample would also make the ratio measure staleness again rather than this.

**d. Nothing locks the two refresh paths against each other.** The README installs a `Type=oneshot` timer at 04:30 *and* the API runs the reactive watch. The watch's `running` guard is in-process only and knows nothing about the systemd unit, so both can build `gtfs.new.db` at once and `rename` over each other. No `flock`, lockfile or `O_EXCL` anywhere in `refresh.ts`, `swap.ts` or the import.

**e. CORS ships wide open.** `API_CORS_ORIGIN` defaults to `*`; set `DOVEBUS_CORS_ORIGIN` to the Netlify origin. `API_HOST` is already correct at `127.0.0.1` behind Caddy, and the README's unit sets it explicitly.

**f. Disk is not a constraint.** Peak during a refresh is the live database plus the staging copy — 1.24 GB each — plus the extraction, and `data/tmp/` is cleaned afterwards. Comfortable on the CX22's 40 GB.

### 6.2 Security review — findings 2026-08-21, verified against the running API — ✅ ALL CLOSED 2026-08-24 (§12)

Static review plus probes against a live server. No CRITICAL, and the codebase held up well under adversarial input (see "sound" below). Three items to fix, ordered.

**a. HIGH — the rate limit and the per-IP SSE cap are bypassable with a header.** `TRUST_PROXY` (`config.ts:182`) is `process.env.DOVEBUS_TRUST_PROXY !== "false"`, i.e. **on unless explicitly disabled**, so Fastify trusts `X-Forwarded-For` — which the client writes. Measured on the running API: 30 concurrent SSE connections from one machine were **all accepted** when each carried a different forged `X-Forwarded-For`, against **20 × `503`** (cap 10) without it; `x-ratelimit-remaining` likewise reset to 299 for every invented IP. The setting survives a reverse proxy: `trustProxy: true` is a boolean that trusts the *whole* chain, and Caddy/nginx **append** to `X-Forwarded-For` rather than overwriting it, so `proxy-addr` walks back to the attacker's leftmost value. Fix both halves: set `DOVEBUS_TRUST_PROXY=false` if the process is exposed directly, or configure the proxy to overwrite the header and pass a trusted-hop *count* instead of `true`; and **invert the default to `=== "true"`** so the unsafe mode requires a deliberate act.

**b. MEDIUM — the SSE endpoint breaks any CORS whitelist.** `stream.ts:36-37,80` writes the configured `corsOrigin` string verbatim into `access-control-allow-origin`, instead of reflecting the request's matching origin the way `@fastify/cors` does everywhere else. Measured with `DOVEBUS_CORS_ORIGIN="https://a.example,https://b.example"`: `/api/routes` correctly returned `https://a.example` for a matching origin and no header for a non-matching one, while the stream returned **`https://a.example,https://b.example`** — a comma-joined value browsers reject, which breaks SSE for *every* whitelisted origin. Fails closed, not open, so it is not a hole; but it detonates precisely at the deploy that moves off `*`. **Fix it in the same change that sets the real origin.**

**c. MEDIUM — production source maps.** `vite.config.ts:14` sets `sourcemap: true`, emitting `dist/assets/index-*.js.map` — **2,462,968 bytes** of original TypeScript, published. Set `false`, or `"hidden"` if error tracking needs them without serving them.

**d. MEDIUM — no security headers, and nowhere to put them.** No `X-Content-Type-Options`, `Referrer-Policy` or HSTS on the API (low impact: JSON/SSE only, no HTML surface). On the client a CSP matters, and **the repo has no deploy config at all** — no `netlify.toml`, no `_headers`, no Dockerfile. The real origins a CSP must allow, read from the source: `tiles.openfreemap.org`, `{a,b,c}.basemaps.cartocdn.com`, `dati.toscana.it`, `www.openstreetmap.org`.

**e. LOW — `download.ts:25-54` has no byte ceiling**, unlike `rt/fetch.ts` (64 MB). The URLs are hardcoded constants and unreachable from client input, so this is defence-in-depth against a compromised or misbehaving upstream, not an exposed path.

**f. Cost, not a vulnerability.** `/api/vehicles` without a `bbox` returns **448 KB in 4.5 ms**; at 300 req/min that is ~134 MB/min of egress per client. Worth a default bbox or a lower cap before it becomes a bill.

**Verified sound — checked and found correct, not merely "nothing found".** SQL injection is absent by construction: every query uses prepared statements; the two interpolations build only `?,?,?` placeholders from an array length, and `LIKE` patterns escape `%` `_` `\` with `ESCAPE`. Confirmed with live payloads — `date=2026-08-20' OR 1=1--` and `q=' OR 1=1--` were both rejected by the validator. Zip Slip does not apply: the importer never writes zip entries to disk, streaming a fixed filename list from `yauzl` into `csv-parse`. Input bounds hold under probing: `limit=999999999` clamped to **500 with `truncated: true`**, `bbox` rejected for NaN, out-of-range and wrong arity, a 10,000-character `route` returned empty without incident, URL path traversal resolved to a clean 404. Error responses carry no stack traces or filesystem paths. Client XSS surface is clean: all feed-derived strings go through `textContent`, and the five `innerHTML` uses in the codebase contain only hardcoded templates. `npm audit`: **0 vulnerabilities across 309 dependencies**; no secrets in the git history (`-S` across nine patterns, zero hits); `.env` files untracked. `licensePlate` is decoded from the RT feed but deliberately **not** serialized to the public API — the one semi-identifying field never leaves the server.

---

## 7. Testing (per your TDD/coverage rules, 80%)

Unit: outlier bbox filter; freshness bucketing; comune PIP + text fallback; **`calendar_dates`-first date resolution** (assert the all-zero-weekday case yields the correct active set); OD self-join (assert DISTINCT + trip_id grouping on the Arezzo→Anghiari fixture → SI381 + BAAS, ~34 runs); **`trip-updates` decode → delay/cancellation join onto vehicle state**. Integration: import→schema→indexes; each API endpoint on a fixture DB; SSE emits on poller tick. TDD red→green throughout.

---

## 8. Roadmap — MVP vs later (kept explicitly separate)

### MVP (ship this)
1. **Phase 0 — spikes ✅ DONE (2026-08-12):** RT cadence measured (~120 s); **RT↔static `trip_id` join verified (96.6%/100%)**; calendar semantics confirmed (`calendar_dates`-only); Tuscan comuni GeoJSON fetched + PIP validated (99.3%); license attribution confirmed. Bonus: `trip-updates` live-verified. Results in [`PHASE0-FINDINGS.md`](PHASE0-FINDINGS.md).
2. **Phase 1 — static import ✅ DONE (2026-08-12):** comune enrichment, `feed_end_date` refresh job and atomic swap, built and run against the live feed. Measured: 125 MB download ~45 s; import+enrich+index 71 s → 994 MB DB; 5,574,809 `stop_times` / 7,594,712 `shapes` / 207,987 trips / 28,964 stops; **99.2% comune enrichment** (28,716 polygon, 4 name, 244 nulls); **100% of trips carry a shape**; 513 services active on 2026-08-12, all via `calendar_dates` (**0 weekday patterns — resolver model confirmed on real data**); Arezzo→Anghiari OD search returns 17 trips one way / 15 the other on **SI381 + BAAS** (~180 ms cold), matching the brief's fixture. 96 tests, 97% statement coverage. Usage in [`README.md`](README.md).
3. **Phase 2 — realtime poller ✅ DONE (2026-08-12):** `vehicle-positions` (30 s) + `trip-updates` (60 s) pollers with adaptive backoff, Tuscany bbox outlier filter, shared in-memory `LiveState` keyed on `(trip_id, start_date)` (vehicle-id fallback), 30-min RAM trail buffer, freshness buckets, and the delay/cancellation join onto vehicle state. Verified live: **1061 vehicles, 726 with a trip, 645 with a delay (89%), 1438 trip-updates, 94.9% of live trips join the imported timetable**. `npm run poll` is the standalone harness. Two live findings: the `trip-updates` endpoint intermittently hangs (~30 s, empty reply) then serves in <1 s — hence a 15 s timeout and a first-failure retry at normal cadence; and **observed vehicle-timestamp ages run older than the plan assumed** (see the freshness note below).
4. **Phase 3 — API ✅ DONE (2026-08-13):** Fastify on port 3200, one process holding the read-only timetable and both pollers. Endpoints as specified: comuni/routes autocomplete, mode-1 and mode-2 search, `vehicles?bbox`, `trip/:tripId` (timetable + planned shape + live position + trail + delay), `stream/trip/:tripId` (SSE, pushed on the poller tick), `healthz`. Verified live: **Arezzo→Anghiari returns the plan's 17 trips / 15 reverse on SI381 + BAAS in 160 ms**, 1,152 live vehicles served in 16 ms (464 KB, 712 with a line joined from the timetable, 646 with a delay), trip detail in 12 ms, and a 100-second SSE session delivering a snapshot plus a real update with no duplicate pushes. 276 tests, 96% statements. **One design change against the plan:** the mode-2 self-join is collapsed *inside* SQL (one boarding and one alighting stop per trip) — as written it produced >5,000 raw rows for a single day of Arezzo→Anghiari and truncated the afternoon away. Also added: a read handle that reopens the database after the refresh job's atomic swap, without which the API would serve a stale timetable forever.
5. **Phase 4 — Frontend ✅ DONE (2026-08-14), revised the same day after the owner's manual check.** Four findings, all addressed: a light theme replaced the dark one outright (owner's call, busbus.it as reference — the data ramp was re-picked against paper, not inverted, since a luminous aqua carries under 2:1 on white); the search button died on the *second* search (a control detached from the DOM was never re-enabled — and the screenshot loop had not caught it because every state started from a fresh page load, so a continuous-journey state was added); markers moved only when a snapshot landed, every ~2 minutes; and the travelled trail was drawn as straight chords between fixes up to 2.7 km apart, cutting through hillsides. The last two shared one fix — **projecting position onto the trip's `shape`** (`client/src/map/route.ts`), which yields both a distance-along-route to advance the marker smoothly along the road and a travelled path that *is* the road. Estimated motion was chosen with its uncertainty made visible (owner's option (a)): the trip view states how far the marker has been advanced past the last real fix, a disc on the map shows how far off it could be, the raw fixes stay drawn as separate marks so reconstruction is never confused with observation, and buses unheard-from for 5 minutes leave the map. The estimate also stops being *extended* at that same 5 minutes: the followed bus is exempt from the cutoff so it never vanishes mid-watch, but a code review found that exemption also made its extrapolation unbounded — a selected bus going silent drifted **58.7 km in an hour** while the interface announced the number. The age reported stays truthful past the cap; only the guess is bounded. **One API change came out of it:** estimating a speed needs two fixes, and a client starting cold has one — so `/api/vehicles` now sends each bus's previous position, taken from the trail buffer the server already keeps. Verified on the live feed: RT positions project onto the published shape to within **0–7 m**, the reconstructed trail carries **1,800 vertices where the raw fixes gave 15**, and **59% of markers move within 14 s of a cold load** against 0% before. The feed also produces a "previous" stamped *later* than the current fix (a trail point falls back to the server clock for a bus reporting none), so that case is withheld rather than served — covered by `server/test/serialize.test.ts`. Original build notes follow.
   **Phase 4 — original build notes:** Vite + TypeScript + MapLibre on port 5280 (`strictPort`), built with the `frontend-design` skill and mobile-first at 375×812. Full-screen petrol-tinted raster basemap (no API key), a three-detent draggable bottom sheet holding both search modes, comune/line autocomplete as an ARIA combobox, a trip list led by the line's own code plate, and a live view with the planned shape, the GPS trail, the delay badge and the freshness meter. Vehicles are a GeoJSON circle layer with `requestAnimationFrame` interpolation on the source data — never DOM markers. Above 720 px the sheet becomes a left column and the map's padding follows it. **Verified by the screenshot loop** (`npm run shots`, committed): 12 states × 6 viewports = 72 shots against the live API, two consecutive clean rounds — no horizontal scroll, no interactive target under 44 px, no unexpected console errors, every state reachable. **One design change against the plan:** freshness is recomputed on the client every frame from the bus's own `timestamp` rather than trusted from the payload — the server's bucket is correct on delivery and wrong a minute later, and a colour frozen at send time would keep claiming "recente" for a bus that had gone silent. **One observation for the owner:** with the Phase-2 bands (90/180/300 s) and the measured 116→240 s age cycle, the whole fleet still swings green→amber together on the publisher's ~120 s rhythm — the bands describe the bus better than the old ones did, but "attenuato" is still reached by healthy buses for roughly half of every cycle. See "colour cycling" below.
6. **`shapes` import + planned-route line** — mandatory: `/api/trip/:tripId` serves the trip's `shape` polyline; the frontend draws it as the route the bus will follow.
7. **Phase 5 — public web surface ✅ COMPLETE (2026-08-22).** App split to `/mappa/`, landing at `/`, three trust pages, full head + JSON-LD block, `og-image`, manifest, `robots.txt`, `sitemap.xml`, and the CC-BY attribution moved out of the JS footer into every served document. Built with the `frontend-design` skill, verified by a new content-page screenshot loop and a rerun of the app one. Item-by-item outcome, deviations and what looking caught that the loop did not: **§10.4**. Auditing the *result* of those nine items then found seven more things, none of which were in the plan — including two places §10.4 claimed more than the code did: **§10.8**.
8. **Pre-deploy fixes ✅ COMPLETE (2026-08-24).** Every §6.1 and §6.2 item, plus the two §11.8 recorded but not done, plus §10.7's two content decisions. Three of them were changes whose success is indistinguishable from their failure without a measurement, so each is stated with the measurement: **§12**. One finding turned out to have been fixed since Phase 1 and never struck off (§6.1 (d), the refresh lock).
9. **Phase 6 — the owner's five findings ✅ COMPLETE (2026-08-23).** Two defects found by using the product (a followed bus vanishing at street zoom; the stops list jumping under the reader), one that had been visible in every committed screenshot for weeks (AM/PM and `08/22/2026` in the search form), and the English edition of the whole site with the language switch that reaches it. Measurements, decisions and what looking caught: **§11**.
10. **Deploy ✅ LIVE 2026-08-24** — https://dovebus.it and https://api.dovebus.it. Not Hetzner: their cheap line was gone (§6). An OVH VPS-1 instead — 2 vCore, 4 GB, 40 GB NVMe, **€5,48/mese IVA inclusa, senza impegno**, the same price Aruba wanted for half the machine. What was done, and the two faults only a deploy could find: **§13**.

### Phase 2+
- **Expose the timetable match rate as a metric**, not only as a health flag — it moved 3% → 21% → 0.3% across the 2026-08-15 republish and was the only thing that noticed.
- `alerts` feed (service advisories/disruptions banner).
- **Shape-based full travelled-path** reconstruction (beyond the RAM buffer window).
- Persistent long-term position history.
- Occupancy / vehicle label display; PWA/offline. (**i18n shipped 2026-08-23 — see §11.**)

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
| ~20-day feed validity expiry serving stale schedules | Medium | Daily refresh job comparing the download's SHA1; health flag when past validity. |
| **Feed *replaced* inside its validity window** (new, observed 2026-08-15) | ~~Unknown~~ **Handled** | **This actually happened and hid for three days.** The operator republished mid-window, so `feed_end_date` still read three weeks out and every expiry check stayed green while **21.2% of live buses had become untraceable** (against 3.4% normal). The source cannot be polled for this — 125 MB, GET only, no HEAD — so `/healthz` watches the inverse: the share of live trips absent from the loaded timetable, flagged past 10% with a 50-trip sample floor. **The API also acts on it** — the cheap signal (a few hundred indexed lookups, every 5 min) triggers the expensive check (125 MB), so the daily timer became a safety net instead of the only defence and the wrong-timetable window went from "up to 24 h" to "as long as a download takes". Guarded by a sample floor, one-at-a-time, and a 1 h cooldown that holds even while the ratio still looks bad; `DOVEBUS_AUTO_REFRESH=false` opts out. After `npm run refresh`: 207,987 → 270,823 trips, unmatched 21.2% → 0.3%. **`feed_end_date` is not a health signal on its own: a feed stops being true long before it stops being valid.** |
| Poll cadence / hammering the source | ~~Low~~ **Resolved** | Single poller; **measured ~120 s cadence → 30 s poll + adaptive backoff on unchanged header.** |
| GPS outliers → ghost buses | Low | Tuscany bbox sanity filter (confirmed still needed). |
| **Upstream RT endpoints intermittently hang** (new, Phase 2) | Medium | Measured 4 timeouts in a 5-minute run on both feeds: the connection hangs, is aborted at 15 s, and the next request succeeds in <1 s. Mitigated: 15 s fetch timeout, first retry at normal cadence then exponential backoff (cap 4 min), the two feeds fail independently, and the last good state keeps being served rather than blanking the map. |
| 5M-row `stop_times` (~268 MB) + `shapes` (~277 MB) import memory/time | Low | Streamed CSV + batched single transaction (better-sqlite3). |

---

## 10. SEO & the public web surface — planned 2026-08-21, ✅ BUILT 2026-08-22

Written after a security + SEO review of the running stack. Everything numeric below was **measured**, not estimated: the client was built and the shell parsed, the entity counts come from `data/gtfs.db`.

### 10.1 The baseline, measured

Built `client/dist` and stripped the scripts from `index.html` to see what a crawler reads before executing JS. **The entire indexable content of the site is eleven words:**

> DoveBus — i bus della Toscana, adesso · Vai alla ricerca · Dove Bus · — · bus in vista

Bundle as shipped: **1,098 KB JS** (299 KB gzip), **88.8 KB CSS** (14.3 KB gzip), `index.html` 2.69 KB. Google renders JS in a second wave, so *something* would eventually be recovered — but the structural problem is not rendering. **Search, results and trip detail all live on the single URL `/`**, reachable only by submitting a form. There is no URL for "line SI381" to rank, and no URL to share with a friend. That second half is a product defect before it is an SEO one.

### 10.2 Decision — landing at `/`, app at `/mappa/` — ✅ BUILT 2026-08-22

The root becomes a static, text-real, near-zero-JS landing page; the MapLibre app moves to `/mappa/`. Rationale: for the foreseeable future **every visitor arrives cold** — from a search result or a shared link — so optimising the root for returning users optimises for a population that does not exist yet. A landing that paints in ~200 ms beats one that ships 1.1 MB of JS before saying anything.

- **Build:** Vite multi-page via `build.rollupOptions.input`, with `client/index.html` (landing) and `client/mappa/index.html` (app). Directory form, not `mappa.html`, so the URLs are host-agnostic rather than relying on Netlify's `.html` stripping. Each entry gets its own bundle — **the landing must not import `maplibre-gl`**, and that is the whole point of the split; verify it in the build output, do not assume it.
- **Canonical form is the trailing slash** (`/mappa/`); Netlify redirects the bare form to it.
- **Manifest `start_url` becomes `/mappa/`**, not `/` — a user who installs the app wants the map, not the pitch.
- **Deliberately not built now:** the `localStorage` redirect that bounces returning visitors from `/` straight to `/mappa/`. It is a strict superset of this decision — roughly six lines added later, no rearchitecting — and today it would solve friction the site does not have. If it is ever added: key it on stored state, **never on user-agent** (that is cloaking), gate it behind an inline `<head>` script using `location.replace()` so there is no flash and no history entry, and give it an escape hatch (`/?home=1`) so the landing stays readable.

### 10.3 Rejected — mass-generating 877 comune/line pages

An SEO review proposed generating one static page per comune (267) and per line (610). **Rejected on measured grounds.** Counted over `data/gtfs.db`, lines-per-comune is severely concentrated and the tail is empty:

| | |
|---|---|
| Firenze / Siena | 101 / 97 lines |
| top 10 comuni | 23.4% of line coverage |
| top 30 comuni | 42.6% |
| comuni with ≤3 lines | **108 of 267** |
| comuni with ≤5 lines | **164 of 267 (61%)** |

Sixty-one percent of those pages would say little more than *"line 123 passes through Chiusdino"* — templated, near-empty, in volume. That is the exact profile Google's **scaled content abuse** policy targets, and the downside (a sitewide quality signal) is worse than the upside. Stop pages (**28,985**) were never on the table for the same reason at larger scale.

**What is worth doing instead, later and by hand:** a curated page for each of the ~20–30 comuni that actually carry lines, written as content rather than emitted by a template. Small, defensible, and it captures most of the realistic long-tail volume anyway.

**The better lever, and a product win first:** make the app's state addressable — `/mappa/?linea=381`, `/mappa/?corsa=78231-2`. Today a rider cannot send anyone the bus they are watching. It costs a fraction of 877 pages, serves a real user, and incidentally gives Google URLs that exist. Note the dependency: **`WebSite` + `SearchAction` JSON-LD must not be added until this exists**, or the markup declares a navigation feature the site does not have.

### 10.4 The pre-deploy SEO set — ✅ COMPLETE 2026-08-22

All nine items built, in one commit, with the `frontend-design` skill. Built as a Vite multi-page
app: five entries, and **the split verified in the build output rather than assumed** — the four
content pages carry **0.8 KB of JavaScript between them**, MapLibre's 1,098 KB stays in the `mappa`
chunk alone. Indexable prose went from the **eleven words** measured in §10.1 to **1200 / 892 / 655 /
773** on landing / come-funziona / fonte-dati / privacy.

1. **Landing page `/`** ✅ — hero, the ageing band, the two search modes, the live-view feature list,
   an honest "what DoveBus is not" section, an eight-question FAQ in `<details>` (so the answers are
   in the served document, not behind a script), closing CTA, footer.
2. **`/come-funziona/`** ✅ — the four-step path of a position, a measured/estimated/reconstructed/
   never-invented table, and five limits stated in full (the ~2 min age on arrival, the ~3% of live
   runs absent from the timetable, the ~9-in-10 delay coverage, the upstream republish, and a
   stopped bus being indistinguishable from a silent one).
3. **`/fonte-dati/`** ✅ — four sources each with licence and link, what DoveBus adds, the exact
   attribution string, and the not-affiliated disclaimer. **openpolis/ISTAT confirmed CC BY 4.0**
   (fetched, not assumed). The CC-BY line is now in the served HTML of *every* page via a build-time
   partial, which discharges the licence obligation the JS-only footer did not. **«Every» was four
   pages out of five when this was written** — `/mappa/` does not use the partial and kept rendering
   its attribution from `main.ts`, so on the one page with a third-party basemap the obligation was
   discharged only for clients that run JavaScript. Closed in §10.8.
4. **`/privacy/`** ✅ — **and the plan was wrong here.** This item assumed the client used browser
   geolocation. It does not: greps for `navigator.`, `localStorage`, `sessionStorage` and `cookie`
   over `client/src` return **nothing**. The page says so, and states instead what genuinely leaves
   the browser — API queries, the viewport bbox, the IP any server sees, the per-IP rate-limit
   counter held in memory for one minute, error-log lines carrying the URL but not the IP, and the
   tile provider as the one third party, on `/mappa/` only.
5. **`<head>` block** ✅ — per-page `title`/`description`/`canonical`, full Open Graph, Twitter
   `summary_large_image`, `Organization` + `WebApplication` on the landing, `TechArticle` /
   `Dataset` / `WebPage` on the trust pages, and `FAQPage` for the FAQ. **No `WebSite` +
   `SearchAction`**, per §10.3 — the app's state is still not URL-addressable. `/mappa/` got no
   JSON-LD at all here, which left `WebApplication` describing `/mappa/` from `/`; §10.8 moves it to
   a partial both pages share.
6. **`og-image.png`, 1200×630** ✅ — produced from HTML by `npm run og` (`client/scripts/og.html`)
   rather than drawn once in an editor, so it stays editable and in sync. It carries the ageing band,
   not a map thumbnail: a map at feed size is an unreadable grey rectangle.
7. **`site.webmanifest`** ✅ — `start_url: "/mappa/"`; the two orphaned icons finally have a referent.
8. **`robots.txt` + `sitemap.xml`** ✅ — **emitted by a Vite plugin from the same `SITE_URL` constant
   the head blocks use**, so a page added to the build cannot silently miss the sitemap. No
   `Disallow: /api/`, as specified.
9. **`preconnect` / `dns-prefetch`** ✅ — on `/mappa/` only.

**Navigation, decided rather than defaulted.** No hamburger anywhere. Content pages carry one 44 px
row — wordmark plus the single action a visitor came for — with the other links in every page's
footer and in a sub-navigation on the trust pages, where they are siblings. On the map the top bar
was already a two-object composition tuned at 320 px, so the **wordmark became the way home** and the
three pages joined the **credits block at the bottom of the sheet** — thumb-reachable, and sitting
with the attribution they belong with. A drawer would have cost a script, a focus trap and an overlay
to hide three links from a four-page site.

**Design.** No second typeface and no marketing accent: the product's rule is that the chrome is
monochrome and every saturated colour is a datum, and a landing page with a gradient would contradict
what it is selling. Display type is the wordmark's own device at 5 rem instead of 13 px — soft roman
question, stamped condensed answer — which is also how a bus writes its destination on its front. The
signature element is **the ageing band**: the real freshness scale on a real axis of seconds, marker
entering at 116 s and climbing on the publisher's 120 s cadence, the unreachable 0–90 s bucket drawn
hatched, and the 300 s cutoff drawn as the point where the scale stops being a scale.

**Verification.** `npm run site-shots` is the content-page half of the loop — same six viewports,
offline and in seconds, so it actually gets run. It also asserts the head block, which no screenshot
can show, and caught three over-length meta descriptions. Final state: **24 shots clean**, plus a
rerun of `npm run shots` against the live feed — **78 shots, thirteen states, clean**.

**What the loop could not find, and looking did.** Recorded because it is the same lesson as
§«measure, don't deduce», pointing the other way:

| Defect | Found by |
|---|---|
| Wordmark dot drifting **8.4 px** below the words on content pages (`align-items: center` against `align-self: baseline`) | the owner, by eye |
| **8 px** opening between "Dove" and "BUS" on the map — extracting the mark to `brand.css` let the pill's `gap` win on import order | measuring after the owner's report |
| **16 section dividers** a gutter too wide per side (a `border-top` paints on the padding box) | the owner, by eye |
| Counts row with **25 px above and 0 below**, labels resting on the rule | the same report |
| `~1.000` reading as indented — the tilde carries a quarter of a digit's mass over a full advance | the same report |
| `.credits__nav` "Privacy" at **38×44** | `npm run shots`, on all 78 |
| Three meta descriptions over 165 chars | `npm run site-shots` |

The scripts measure geometry; they cannot see optical alignment. Both halves were needed.

**One change outside the SEO set, at the owner's request:** the map CTAs take the dot's green
(`--fresh-recent`). Two consequences handled rather than discovered later — white on `#018164` is
**4.86:1**, clearing AA but no longer the highest-contrast object on the page; and the focus ring had
to leave `--fresh-live`, a neighbouring green that would have vanished on that fill. It is also the
first deliberate exception to the "saturated colour means data" rule.

### 10.5 Core Web Vitals — two findings that cancel work

- **Do not lazy-load MapLibre to "protect LCP".** A `<canvas>` is **not an LCP-eligible element** (the spec counts `<img>`, SVG `<image>`, video posters, CSS `background-image`, and text blocks). The LCP element is shell text, which MapLibre does not gate. Delaying the map would degrade the product to move a metric it does not touch.
- **Do not split `maplibre-gl.css` out of the bundle.** The proposed trigger was "if the combined CSS exceeds ~30–40 KB gzip". Measured: **14.3 KB gzip**. Comfortably under — the refactor is unnecessary.

What does remain: **1.1 MB of JS (299 KB gzip) executing at mount**, on phones used at a bus stop. That is an INP concern, not LCP. Measure with `rollup-plugin-visualizer` before optimising anything. The `/mappa/` split does not shrink it — it only keeps it off the landing, which is the point.

### 10.6 Deferred, on purpose

Curated comune pages (§10.3) · URL-addressable app state and the `SearchAction` that depends on it · `localStorage` return-visitor redirect (§10.2) · Netlify's bot prerendering extension — Googlebot has not needed it for years, and it only matters for non-Google crawlers.

### 10.7 Still open before deploy — two content decisions, not code — ✅ SETTLED 2026-08-24 (§12.10)

Neither blocks a build; both make the deployed site wrong if left as they are.

1. **`SITE_URL` is still the placeholder `https://dovebus.it`.** It lives once, now in
   `client/site-url.ts`, and feeds `canonical`, every `og:url`, the JSON-LD `@id`s, `robots.txt`,
   `sitemap.xml` **and the domain printed inside `og-image.png`** — so if the real domain differs,
   **every one of those points at the wrong host** until it is changed. Overridable at build time
   with `SITE_URL=…`, same for `CONTACT_EMAIL` (`dovebusapp@gmail.com` since the deploy — the
   `ciao@dovebus.it` this section was written with was a placeholder with no mailbox behind it), which appears in the
   footer, the privacy page and the `Organization` markup.

   **The card was the exception until 2026-08-22, and it was the worst place for one.** `scripts/`
   `og.html` had `dovebus.it` typed into it by hand, so the constant moved and the share image did
   not — and that domain is **rasterised into a PNG**, where a canonical tag cannot correct it after
   the fact and nobody re-reads it. It is a `%SITE_HOST%` token now, substituted by `npm run og`
   from the same module the build reads, which is also why `SITE_URL` left `vite.config.ts`: the
   card script is a second consumer, and a constant with two consumers in one file is a constant
   about to be copied. The script **throws** if the token is ever renamed away rather than
   rasterising the literal. Verified both ways — overriding the origin changes the domain in the
   image, and rendering with the default reproduces the committed PNG **byte for byte**.

   **Deploy note:** changing the domain means `npm run og` as well as a rebuild. The head blocks
   update from a build; the image does not.
2. **`/privacy/` names the static host generically** ("un fornitore di hosting"). Once Netlify is
   confirmed it should be named, since the point of the page is that it says what actually happens.

Also worth a rerun rather than an assumption: `npm run site-shots` asserts that `canonical` and
`og:url` end in each page's own path, so a wrong `SITE_URL` will not be caught by it — it checks the
path, not the origin.


---

**Phase 0 done — proceed to Phase 1?** Reply to confirm, or adjust any amended detail
(poll cadence, calendar resolver, comuni source) before the static-import build begins.

### 10.8 Technical SEO audit of the built site — ✅ DONE 2026-08-22

Run against `client/dist` after a build, not against the sources — `robots.txt` and `sitemap.xml`
do not exist until `crawlerFiles()` emits them, and a source `<head>` is incomplete by construction
until the partials expand. Seven fixes, a build after each, `npm run site-shots` clean on 24 shots.
**Nothing in this section was in the plan before today**; §10.4 shipped nine planned items and this
is what auditing the result of them found.

**1. Cannibalisation — `/` and `/mappa/` were competing for one query.** Invisible to every
per-page check, because each page passes on its own; it only shows when the five are laid side by
side. `/` said «dove sono gli autobus **in Toscana**», `/mappa/` said «**Mappa** live dei **bus in
Toscana**», and both descriptions opened on *«…mappa in tempo reale delle corse Autolinee
Toscane…»*. Google picks one and the other's equity goes nowhere — and it would pick `/`, since
`/mappa/` was an empty document to a crawler. **One primary intent per URL, assigned:**

| URL | Primary intent | Owns |
|---|---|---|
| `/` | *where are the buses* | the head term — the only page that can rank on it |
| `/mappa/` | *which line, which connection* | «Cerca la tua linea o un collegamento» |
| `/come-funziona/` | *how fresh is this, how does it work* | the cadence and the limits |
| `/fonte-dati/` | *where is the data from, may I reuse it* | GTFS / GTFS-RT / licences |
| `/privacy/` | *what do you collect* | branded trust |

**2. `/mappa/` was a dead end with one outbound link** — the wordmark — no `H1` and no JSON-LD, on a
page that is `Allow`ed and sits in the sitemap at 0.9. The choice was never «index it or not»: it
was «index it as an eleven-word rival to `/`, or as the page that answers a different question». An
empty indexed document next to a full one is what made finding 1 worse. Closed with:

- **A clipped `H1`** (`.sr-only` in `base.css`). Not a keyword insertion — the page *has* a heading,
  the design draws it as the wordmark because a title bar over a full-bleed map is chrome competing
  with what the chrome is for. `display: none` would take it out of the accessibility tree too;
  clipping a 1 px box leaves it in.
- **`partials/jsonld-app.html`** — `Organization` + `WebApplication`, shared by `/` and `/mappa/`
  under the same `@id`. The node's own `url` is `/mappa/`, so declaring it only on the landing
  described one page from another and left the described one bare. A partial rather than a copy so
  the `featureList` cannot claim one set of features on the landing and another on the app. The
  landing's `FAQPage` became its own second `<script>`, since those eight answers are only there.
- **A static credits block as the initial content of `#sheet-scroll`.** `#showSearch()` runs in the
  constructor and `clear()`s that node, so it is gone by first paint and cannot duplicate the footer
  the app renders — *verified in the browser, not deduced: one `footer.credits`, zero layout shift.*
  It carries the CC-BY line and the three page links, which closes the §10.4 item 3 gap above. The
  basemap is credited generically, as `main.ts` does until its style settles.

Served HTML on `/mappa/`: **11 words → 41**, four outbound internal links, 2.17 → 4.11 KB gzip.

**3. `_redirects` — clean, and half-finished.** No chains: every rule is one hop, and every target is
exactly the URL that page's `canonical` names. But only two of the five `index.html` forms had a
rule. The file's stated reason for existing is to not depend on Netlify's Pretty URLs setting — so
the guarantee was real for `/` and `/mappa/` and a hope for the other three. Three rules added.

**4. Four of eight `FAQPage` answers were not on the page** — abridged rewrites, not excerpts. Easy
to do by accident: the JSON and the `<details>` are three hundred lines apart in the same file. All
eight are now contiguous excerpts, and **`auditFaqParity()` in `scripts/site-shots.ts` fails the run
if one ever drifts again.** Negative-tested: swap an answer for a paraphrase and it goes red.

Two things that check taught, both now in its comments: **a `const` arrow counts as a named inner
function** for the `__name` trap `auditHead` already warned about; and it must read `textContent`,
not `innerText`, because the answers live in *closed* `<details>` and `innerText` reports only what
is laid out — it saw nothing and failed all eight. Google indexes accordion content and its FAQ
guidance permits expandable sections, so `innerText` was the wrong yardstick, not the markup. The
existing `%SITE_URL%` guard was widened to any `%TOKEN%`, there being four constants now.

**5. `Dataset` promised downloads without saying where.** Two `DataDownload` nodes had no
`contentUrl`. They now carry the three real artifact URLs the server already polls. The
openpolis/ISTAT boundaries came out of the `description`: a `Dataset` whose `creator` is one
publisher must not fold a second publisher's data into what it describes.

**6. `dateModified` on `/privacy/` was a hardcoded second copy** of the day the page states in prose,
in the same file. Now one `PRIVACY_UPDATED` constant, two substitutions, and a `<time datetime>` in
the prose. **Deliberately not `process.env` and deliberately not «today»** — `SITE_URL` is a deploy
fact, this is an editorial claim about when a document changed, and stamping it at build time would
make every rebuild announce a policy revision that did not happen.

**7. Internal linking.** Anchor text was already good — not one «clicca qui» in the site. The gap was
that the three trust pages reached each other only through nav chrome, never from prose. Two
contextual links added, `/come-funziona/` ↔ `/fonte-dati/`, plus `author` on the `TechArticle`.

**Checklist items that do not apply here, recorded so they are not re-raised.** ~~`hreflang` — one
language.~~ **Superseded 2026-08-23 by §11.5** — the site is two languages now, `hreflang` applies,
and it is built; §11.9 audits it. **Font preload for LCP** — `font-display: swap` is set, so the fallback paint *is* the LCP
paint and the webfont gates nothing; §10.5's «findings that cancel work» applies a third time.
`BreadcrumbList` — four pages at one level. Image `alt` — the site has no `<img>` at all. Sitemap
`<priority>` — Google ignores it; left alone because it costs nothing and misleads nobody.

**Left undone on purpose.** `og:type` says `website` on `/come-funziona/` while its JSON-LD says
`TechArticle`. Fixing it means an override in the shared head partial, and the field moves social
cards, not rankings — it is recorded because an audit reports what it saw, not because it should be
done.

**Decided by the owner, and built — `/come-funziona/` shows its date.** The question was whether that
article should display a date before its markup claimed one, and the answer settles the general rule:
**a date the markup declares is a date the page owes a reader.** Anything else is the `FAQPage` fault
in a smaller costume. The date is placed under the limits, next to the numbers rather than in a
footer, because that is what earns it: the page carries **measured** figures — the ~120 s cadence,
the 96,6% join, the ~3% of runs missing from the timetable — and a measurement with no date beside it
does not tell a reader whether they are looking at yesterday or at two years ago. Here the date
serves the reader before it serves the crawler.

Built with the §10.8 item 6 mechanism generalised rather than copied: one `UPDATED` map, an
`inItalian()` renderer, and `%NAME_UPDATED%` / `%NAME_UPDATED_IT%` derived from it, so the second
page did not become a second pair of hand-typed strings. `datePublished` and `dateModified` on the
`TechArticle` read the same constant as the prose.

And the rule is now enforced, not remembered: **`auditDateParity()`** fails the run if any JSON-LD
`datePublished` or `dateModified` is not spelled out in the page's text. It checks the reader's form
(«22 agosto 2026»), not the ISO one — `datetime="2026-08-22"` satisfies a parser and nobody else. A
page declaring no date is fine and skipped; the rule forbids declaring one *privately*, not having
none. Negative-tested: point the markup at 21 agosto while the page says 22 and all six viewports go
red.

**One correction made mid-audit, recorded because it is the standing lesson pointing a third way.**
A landing FAQ sentence was edited so a markup excerpt would come out tidy. That is backwards — the
markup quotes the prose, not the reverse — so the sentence was restored and the excerpt cut at the
clause instead. Proved rather than asserted: the site was rebuilt from `HEAD` in a scratch worktree
and the rendered body text of all five pages diffed. **`/` is character-identical**; the only
visible copy changes in the whole site are the two links in item 7 and the `<time>` wrapper in
item 6.


---

## 11. The owner's five findings — planned and BUILT 2026-08-23

Five items raised by the owner after using the deployed-shaped build. Two were defects, one was a
defect nobody had read, and two were features. Everything below was measured against the live feed
before it was touched, per §10's standing lesson.

### 11.1 A followed bus left the map at street zoom — two causes, not one

**Measured.** Following line 40 (trip `27145-19`) and zooming to 16: the viewport query became
`11.2389,43.8033,11.2568,43.8113` — **1.45 km × 0.89 km** — and two consecutive `/api/vehicles`
answers came back with `count: 0`, not containing the followed bus at all. The drawn collection went
from 27 features to 0, and the bus did not come back for the 80 s the probe kept watching.

**Cause A.** `VehicleLayer.update()` rebuilt its tracked map from the answer alone, so anything the
answer did not mention was deleted — including the one bus the rider was watching. `select()`
exempted that bus from the *age* cutoff and from nothing else.

**Cause B.** The request is bounded by the viewport and the server answers from each bus's last
**reported** position, while the marker is drawn at the position we have **extrapolated** to. The
trip view was printing the size of that gap at the time: *«avanzata di ~1,5 km»*. At zoom 16 the
visible strip is narrower than the gap, so the followed bus falls outside its own request — and so,
intermittently, does every other bus on screen.

**Cause C, why it did not heal.** The SSE stream pushes only when the poller ticks **and** the
signature changes, so a bus that is stationary or silent never triggers the merge that would have
put it back.

**Fixed on both axes.** The followed bus is no longer dropped for being absent (`map/tracking.ts`,
extracted so the rule can be tested without a WebGL context), and the request has a **2 km floor**
per side (`map/viewport.ts`): a fraction of the viewport is the right margin while the viewport is
large and useless once it is not — 15% of 1.4 km is 210 m. Cost measured at ~25 vehicles in a city
viewport, a few kilobytes every thirty seconds.

**Enforced, not remembered.** `npm run follow-check` opens a trip that is genuinely in service,
zooms to street level and watches for eighty seconds across at least two fleet refreshes. Verified in
both directions: green on the new code (79/79 samples with the bus drawn), red on the old code put
back.

### 11.2 The stops column moved while it was being read

**Measured.** The `.stops` block jumped **16.5 px** (top 383.5 → 367) within one second, repeatedly,
roughly every nine seconds. The cause was not the redraw: it was Instrument Sans's **proportional
figures**. The estimate sentence sits exactly on a line break at 1280 px, so `~1.9 km` wrapped to two
lines where `~1.1 km` fitted on one, and the list below moved every time the number changed.

`tokens.css` already states this rule for the freshness readout — *«or the readout will jump as it
ticks»* — it simply had never been applied to the sentence above the list. Now: tabular figures, the
distance rounded (50 m below a kilometre, a tenth above) so the text changes at the scale the bus
moves rather than the scale the clock ticks, a two-line box held whether or not there is a sentence
in it, and no rewrite when the string is identical.

### 11.3 The clock said `03:13 PM`, and the field cut it to `03:13 F`

**Measured three ways before replacing anything.** `lang="it-IT"` on the element changes nothing;
Chromium launched with `--lang=it-IT` still draws `01:45 PM` and `08/23/2026`; Playwright's
`locale: "it-IT"` does not move it either. The format of `<input type="date">` and `<input
type="time">` follows the **browser's** language, and no page can override it.

It was in `client/shots/*--02-search-full.png` on every round for weeks — `03:13 F`, the value
clipped to make room for a meridiem nobody here uses — and `scripts/shots.ts` carried a comment
asserting the opposite ("the Italian UI locale is what makes the native controls render the way a
Tuscan rider's phone renders them"). A screenshot loop only catches what someone looks at.

The mild version of the problem is half-days. The sharp one is that `08/12` meant 8 December or 12
August depending on a setting the page cannot read — and that field chooses which day of timetable is
queried. Both controls are now ours (`ui/when.ts` for the reading, `ui/whenfield.ts` for the field),
generous about how an hour is written (`9`, `930`, `9:30`, `9.30`, `09 30`) and strict about what it
means (`24:00` and `31/02` are refused, the calendar is asked rather than a table of month lengths).
Arrow-key stepping is kept, clamped at the ends of the day rather than wrapped — a window from 23:58
to 00:03 selects nothing.

### 11.3b The owner looked at it, and two things were wrong

**The fields had a keyboard and nothing else.** Normalising on blur and arrow-key
stepping are what a *keyboard* had; on a phone there are no arrow keys, so the
replacement offered typing and nothing more — and it had thrown away the one
thing the native control did better than a text field, the panel. There is a
button in each field now, where the native picker icon used to be, opening a
month grid and an hours/minutes pair of columns of our own: Monday first in both
languages, 24-hour, `dd/mm/yyyy`, and a panel that always opens on the value the
field holds at that moment.

**And then the hour became a clock face.** The first panel offered two columns of
numbers, which is honest and joyless: choosing 07:45 meant reading two lists,
which is the thing a clock face exists to spare you. It is the Android dial now —
twelve hours outside, the other twelve inside, midnight at the top, the minutes
on their own ring after the hour is chosen — in the site's ink rather than
Material's pink, and with no OK button, because every tap commits to the field
and leaving early should leave a time that is true rather than one that was
abandoned. No dragging of the hand: it is the one gesture of that dial a mouse
learns second and a screen reader never learns at all, and every value it reaches
is one tap away without it.

The day cells and the dial's inner ring are the only controls on the site below
the 44 px floor, and in both cases the arithmetic is the reason rather than the
taste. At 320 px the sheet gives the panel 288 px, so a seven-column month grid
has 41 px per cell *before* a single gap; and twelve numbers on the dial's inner
ring sit 31 px apart centre to centre, so a 44 px target would overlap the two
beside it. Both clear the 24 px WCAG 2.2 asks for, and the exemption is written
into the audit next to the number rather than left for someone to rediscover.
The month arrows and the readout had no such excuse — the round caught them at
32 and at 44×35 — and are 44.

**Two defects the dial turned up on its way in.** `el()` wrote booleans the HTML
way: `aria-pressed: true` became `aria-pressed=""`, which is not a valid ARIA
value and reads as *not* pressed, and `false` dropped the attribute altogether.
Every decorative `aria-hidden` on the site was announcing itself and every
selected cell was silent. Fixed where it was wrong — in the helper — so all of
them came right at once. And on the desktop the day field clipped to
`24/08/202`: three fields plus their 44 px buttons need 143 + 103 + 103 px and
the 380 px column has 332 to give, so above 720 px the day goes back onto its own
row exactly as it does under 380. Checked for clipping at six widths in both
languages afterwards.

**The language switch vanished exactly when it was used.** Focusing any search
field snaps the sheet to full, and `.mapctl` faded out at that detent — a rule
written for phones, where a full sheet leaves no map to frame, but it outranked
the wide-screen override on specificity, so on a 1512 px desktop the switch and
the framing button disappeared the moment a rider touched the form, with the map
in full view beside them. Scoped to below 720 px. Measured before and after:
opacity 0 → 1 on the desktop, still 0 on the phone.

And on a phone the fade is *right*, which leaves the switch unreachable while the
sheet is open — so the language is now also the last link in the credits block
inside the panel, named in the language it leads to.

### 11.4 The crosshair promised a feature the product refuses to have

The framing control wore the icon every map on earth uses for *find my location*, which this map
deliberately does not do and says so on `/privacy/`. It is four corner brackets now — frame the
region, or frame the trip being followed — and the language switch sits above it in the same stack.

### 11.5 The site in English — and the rule that kept it honest

Five pages each, paired: `/` ↔ `/en/`, `/mappa/` ↔ `/en/map/`, `/come-funziona/` ↔
`/en/how-it-works/`, `/fonte-dati/` ↔ `/en/data-source/`, `/privacy/` ↔ `/en/privacy/`. **English
slugs**, decided by the owner: a bare prefix would have made the pairing trivial to compute and left
every English URL carrying an Italian word.

**One table, four consumers.** `PAGES` in `vite.config.ts` feeds the sitemap, the `hreflang` block,
the language switch's destination, and the build-time assertion that a page's `canonical` names the
URL it is served at. Four separate lists is how a bilingual site tells a crawler that two pages are
translations and then links them elsewhere. Negative-tested both assertions: a mis-copied canonical
and a missing `<!--@hreflang-->` each fail the build.

**Partials are per language with no fallback.** A missing `partials/en/footer.html` fails the build
rather than shipping an English page with an Italian licence line — the licence is the reason the
partials exist at all (§10.4).

**`x-default` is Italian and there is no Accept-Language redirect.** A root that serves two documents
depending on a header makes `hreflang` a claim nobody can check and turns one URL into two things to
cache.

**The choice is not remembered, and that reverses the plan.** Storing it in `localStorage` would have
made `/privacy/` false — it promises, in both languages, that the site writes nothing to the browser
— in exchange for nothing: there is no redirect to influence, and every page a reader lands on
afterwards carries links in the language they chose.

**Not translated, deliberately.** Stop names, line codes and headsigns are Italian on the pole and on
the front of the bus, so they are Italian in both editions; `titleCase` stays on `it-IT` for that
reason. The map's labels already resolved through `name:it → name → name:latin` for every reader —
work the code had done before the requirement existed. And the day is `dd/mm/yyyy` on a 24-hour clock
in English too: this page is read next to an Italian timetable.

**The words moved out of the code into a `Strings` *type*.** A dictionary that omits a sentence does
not compile, there is no fallback to Italian — a fallback is how half a page ends up in the wrong
language unnoticed — and every sentence containing a number is a function, because `${n} corse` and
`${n} trips` stop being the same sentence at `n = 1`. What the compiler cannot check (the feed's
occupancy enum, the link list) is checked by a parity test.

**`messageFor` stopped forwarding `error.message` for unrecognised codes.** It was a direct channel
from the server's English, parameter-shaped log messages to a rider's screen.

### 11.6 What the existing checks caught, and what they missed

The site loop found three real defects in the English pages within a minute of their existing: its
own date-parity audit was hard-coded to Italian, its `lang` check demanded `it` on every page, and one
FAQ answer was not a prefix of the text the page renders. The first two were faults in the auditor,
which is the auditor working.

What it missed, and a measurement caught: at 320 px the header's one action wrapped to two lines and
lost its arrow once the switch was added. Not for want of room — 86 + 36 + 145 fits in 288 — but
because flex was shrinking the one element that could not spare it.

### 11.7 The review round, and what it changed

Three reviewers ran against the finished work. Nine findings, seven fixed here, two recorded.

**Accessibility — the replaced controls had lost two things the native ones gave for free.** An entry
that could not be read was reverted silently: the border flinch is not audible, and `#submit()`
commits before searching, so a mistyped hour became a search on the *previous* value with no signal
at all to anyone not watching the field. And with a value in it — which is always, since the form
fills itself — a text input announces its label and its contents and nothing else, where
`<input type="date">` announces its day, month and year segments. Both are now `sr-only` nodes
beside each field: a permanent description carrying the shape and the arrow keys, and a `role="status"`
region that says what was kept. Verified in the browser: empty on load, `«Non l'ho capito: resta
13:52.»` after `banana`, empty again after `7:15`. The language switch dropped its `title`, which
duplicated the `aria-label` word for word and is read a second time by some screen reader and browser
pairs.

**TypeScript — four defects, all introduced by this round's own changes.**
`titleCase` was being applied to the *sentence* rather than to the label inside it, and its rules are
Italian: an English `"Vehicle A"` came back as `"Vehicle a"`, because `a` is an Italian particle and
fleet labels are unconstrained text. `parseClock("-5")` returned `05:00` — a leading separator split
off an empty token that the filter dropped, so the field committed a time nobody had typed, which is
the exact failure `when.ts` exists to prevent. `stepDay("")` returned `18991201` through `Date`'s
two-digit-year rollover, where `stepClock` had always defended itself. And `TripView` never reset its
`#connected` flag when a new trip opened, so a run whose stream was fine could be painted carrying
"riconnessione…" inherited from the previous one. Each has a test.

**SEO — one asymmetry, on the one page that writes its own head.** `/mappa/` was the only page of
ten without `og:locale:alternate`; the build now refuses a page that has a twin and does not say so
to a social card, alongside the `hreflang` and `canonical` checks it already made.

`Strings.prefix` was removed rather than kept: it was written expecting the switch to need it, and
the switch resolves its destination from `PAGES` at build time. A field with no readers.

### 11.8 Recorded, not done

**`<lastmod>` in the sitemap is the build date**, on every URL, on every deploy — including deploys
that changed nothing on that page. That is the opposite of what the field is for, and a sitemap whose
`lastmod` is always today is one Google learns to ignore. It predates this round. The honest fix is
probably to drop the field rather than to compute it: two pages have an `UPDATED` constant and three
do not, and deriving the rest from git history at build time buys precision nobody asked for.

**`FAQPage` no longer produces anything in Google Search** — the rich result was retired in May 2026,
including for the last exempted categories. The markup on `/` and `/en/` is valid, matches the visible
text in both languages, and is now inert. Nothing to fix; worth knowing before anyone spends effort
keeping the two copies in step.

**Two `console.warn` strings** in `map/map.ts` and `map/style.ts` are still Italian while every other
developer-facing string in the repo is English. They are read by whoever opens the console, not by a
rider.

### 11.9 Technical SEO audit of the bilingual site — ✅ DONE 2026-08-24

Second pass of the §10.8 grid, re-run against `client/dist` now that every page exists twice. **The
bilingual work holds up**: ten pages, ten correct canonicals, and `hreflang` that is reciprocal and
self-referencing on every one of them — checked by walking the graph, not by eye. `x-default` points
at Italian throughout, the redirect table covers both trees with no chain, the sitemap lists all ten,
the language switch is generated markup with `lang`, `hreflang` and an `aria-label` and needs no
JavaScript, and the contextual links added in §10.8 were translated rather than dropped. The
deliberate absence of an `Accept-Language` redirect on `/` is documented in `_redirects` and is the
right call for the reason given there.

Two things were wrong. Both are the same shape: **a translated label describing an untranslated
thing.**

**1. Every English page shared the Italian card.** `og:image` pointed at `og-image.png` on all ten
pages while `og:image:alt` had been translated — so the markup described an English freshness scale
that did not exist, and a reader who had navigated to `/en/` and shared the link got a picture
reading «Non a che ora doveva passare il bus» with the legend «In diretta · Recente · Attenuato ·
Silenzioso». The card is the most-seen asset of a shared link and the only one nobody proof-reads,
because it is a picture.

Fixed by rendering one card per language from the one template, which is why the card was a template
in the first place. **The four freshness words are read from `src/i18n/{it,en}.ts`**, not retyped:
they are the product's own vocabulary and are printed beside every bus on the map, so a card still
saying «attenuato» after the app had moved on would be the CC-BY drift problem in the one asset a
reader cannot correct. Only the two sentences that exist nowhere but the card are held in `og.ts` —
putting those in `Strings` would ship build-time copy inside the 1.1 MB runtime bundle and widen a
type whose stated job is «every word the interface says».

*And the check was satisfied by the bug.* `auditHead` asserted `ogImage.endsWith("/og-image.png")`,
which is exactly what all ten pages did — the assertion passed hardest at the moment it was most
wrong. It now derives the expected card from the URL's language. Negative-tested: point the English
pages back at the Italian card and 24 checks go red.

**2. `Dataset.inLanguage` said `en-GB` on `/en/data-source/`.** On a `Dataset` that property is the
language **of the data**, not of the page describing it — and this data is the Regione Toscana feed,
whose stop names, line codes, headsigns and municipality names are Italian and, by the owner's
standing rule, stay Italian in both editions. The English page was telling anyone reading the markup
to decide whether the feed was usable in English the opposite of the truth. Now `it-IT` on both
pages, with a comment saying why it looks wrong and is not.

The two `Dataset` nodes also had **no `@id`**, so one real dataset appeared as two. They now share
`%SITE_URL%/#gtfs-toscana`, matching how `#org`, `#app` and `#app-en` were already handled.

**Reported, not fixed.** `Organization` carries the same `@id` on all four landing/map pages with a
*different* `description` per language — strictly a contradiction under one identifier, practically
the standard localisation pattern that Google resolves per page. Both repairs are worse than the
problem: splitting the `@id` would claim two organisations exist, and dropping the localised
description would make one language poorer. `FAQPage` has no `inLanguage` on either landing —
absent, not wrong, and unused by search engines. Sitemap `xhtml:link` alternates are unnecessary
because the HTML `hreflang` block is present, which is one of the three forms Google accepts.

**The map's Italian names were checked, not assumed.** `italianLabelFor()` in `map/style.ts` rewrites
every naming layer to `coalesce(name:it, name, name:latin)` **regardless of interface language**, and
`i18n/strings.ts` already states in its own docstring that stop names, line codes and headsigns are
out of scope because they come from the operator's feed. Nothing needed changing, and nothing in this
audit proposes translating them: a bus stop is not translated, it is asked for by name.


---

## 12. The pre-deploy fixes — ✅ DONE 2026-08-24

Roadmap item 8, which had stayed open across two phases: every §6.1 and §6.2 finding, plus the two
items §11.8 recorded but did not do. Each one is stated below with what it was, what it is now, and
**how that was checked** — because three of these are exactly the kind of change whose success is
indistinguishable from its failure until something is measured.

### 12.1 The production install could not start the server — §6.1 (a)

`tsx` and `typescript` were both `devDependencies` and there is no build step, so `npm ci --omit=dev`
left a box with nothing able to run `src/cli/serve.ts`. `tsx` is a **runtime dependency** now;
`typescript` stays in dev, where it belongs, since only `tsc --noEmit` uses it (tsx bundles esbuild
and needs no compiler).

*Checked, not assumed:* a scratch copy of the three manifests plus the lockfile, `npm ci --omit=dev`,
then a `.ts` file run through the installed binary — it printed. `better-sqlite3` resolves in the same
tree. The lockfile diff is what it should be: esbuild's platform packages stop being `dev`.

### 12.2 `X-Forwarded-For` was believed by default — §6.2 (a), HIGH

`TRUST_PROXY` was `!== "false"`, so the unsafe mode was the default and both per-IP limits were
evadable by inventing an address. It is now off unless a deploy says otherwise, and it takes a **hop
count** — `DOVEBUS_TRUST_PROXY=1` — rather than only a boolean, because `true` trusts the whole chain
and both Caddy and nginx *append* to the header instead of overwriting it, so the forged leftmost
value is still what `proxy-addr` walks back to. A value it cannot interpret throws at startup rather
than being guessed at.

*Checked:* a test that spends the rate limit under three different forged `X-Forwarded-For` values and
expects the third to be refused — and it was **negative-tested**, by putting the old behaviour back
and watching it go red. Plus a companion test that the knob still works when a deploy sets it, since
behind Caddy without it the whole region throttles as one caller.

### 12.3 The live stream broke every CORS whitelist — §6.2 (b), MEDIUM

`stream.ts` wrote the *configured string* into `access-control-allow-origin`. With one origin that is
accidentally correct; with two it emits `https://a,https://b`, which no browser accepts — so the
stream would have died for every allowed origin at the exact deploy that stopped allowing all of
them. Both halves of the API now read one parser (`api/cors.ts`): the JSON routes through
`@fastify/cors`, the hijacked SSE response through the same module, reflecting the caller's own
origin and sending `vary: origin`. A disallowed origin gets **no header**, not a wrong one.

*Checked:* unit tests on the parser, and an integration test that opens a real stream against a
two-origin whitelist and reads the header off the response.

### 12.4 The watch could not give up — §6.1 (c)

The measured state of this source is that it broadcasts live trip ids its own static feed does not
contain (78000–79999: 0 rows against 27,345 in the range below), so the unmatched ratio sits at ~0.17
against a 0.10 threshold **permanently**. The cooldown only paced the resulting loop: 24 rebuilds a
day, ~2.5 GB written each. The watch now measures the ratio *again after* the refresh it triggered,
and a refresh that leaves it stale disarms the watch for that feed's SHA-1. Only a feed with a
different SHA-1 rearms it — which the daily timer is what eventually brings in.

This is what makes `DOVEBUS_AUTO_REFRESH=true` defensible as a default again; the deploy note in
§6.1 (c) telling the operator to turn it off is retired.

*Checked:* the old test asserted the second download after the cooldown, so it was rewritten to assert
the opposite — no second attempt a day later — with two more tests beside it: a new SHA-1 rearms, and
a refresh that *did* restore the match leaves the watch armed, so one good outcome cannot silence it
until the next publication.

### 12.5 §6.1 (d) was already fixed, and the plan had not noticed

The finding says there is no lock anywhere in the refresh paths. There is:
`server/src/util/lock.ts`, acquired for the whole of `refreshFeed()` at `data/tmp/import.lock` with
`O_EXCL` and pid takeover for a lock left by a killed process — and both paths, the systemd timer and
the API's spawned child, go through that one function. It has been there since the Phase-1 commit
(`c33773b`); §6.1 (d) was written against a reading of the code rather than the code. Nothing to fix.

### 12.6 Production source maps — §6.2 (c)

`sourcemap: false`. It was emitting 2,462,968 bytes of original TypeScript beside the bundle, read by
nobody: there is no error tracking wired to this site. `"hidden"` is the setting for the day there is.

### 12.7 The deploy config that did not exist — §6.2 (d)

There is now a `netlify.toml` (build command, publish directory, Node version, and the three build
variables written down where someone setting up the site will look) and a **generated** `_headers`.

Generated, not committed, for the reason the sitemap is: the CSP has to name the API's origin, and
that origin is `VITE_API_BASE` — a build input. A hand-written copy would be correct on the machine it
was written on and would block every request on the deploy that moved the API. The build reads the
same `loadEnv` value the bundle is compiled with, and then **asserts that the origin it allowed is one
the built JavaScript actually dials** — §11.9's lesson applied before the fact rather than after, and
negative-tested by forcing the two apart and watching the build refuse.

The headers: `nosniff`, `Referrer-Policy`, `X-Frame-Options`, a `Permissions-Policy` denying every
sensor the product does not use, HSTS, immutable caching for the hashed assets, and the CSP.

What the file *says* lives in `client/deploy-headers.ts` rather than in the build config: it is a
deploy artifact with rules of its own, and being a plain function of the API's origin makes it the one
part of the build that can be **unit tested** — which is where the three measurements below are
written down as assertions instead of only as comments (§12.11).

**And it is checked by driving it, because a CSP cannot be reviewed by reading.** `npm run
preview:headers` serves `client/dist` applying the *emitted* `_headers` file, and `npm run
headers-check` loads all seven pages through it and fails on any violation or console error — and
also when a map page loaded no tiles or never called the API, since a page that loads nothing
violates nothing. Three allowances survived that measurement, each for a stated reason:

- `worker-src blob:` — MapLibre decodes tiles in a worker it builds from a blob. Without it the map
  does not draw at all.
- `style-src-attr 'unsafe-inline'` — the landing page sets a `--w` per freshness-band segment, which
  is a style *attribute*. Verified by removing it: the band renders at **zero width**. Granted to
  attributes alone, so an injected `<style>` block still has nowhere to land.
- `upgrade-insecure-requests` **only when the API origin is `https`**. Emitted unconditionally it
  upgraded the LAN API call — the address the site is checked from a phone with — and `connect-src`
  then blocked it, because a private address is not "potentially trustworthy" the way `localhost` is.
  A build aimed at an `http` API is not a deploy; making the artifact verifiable locally is worth more
  than a directive that is redundant when every URL in it is already `https`.

Result: **7 pages, nothing blocked**, both map pages having fetched tiles and called the API.

### 12.8 The cost items — §6.2 (e), (f)

`downloadTo` has a byte ceiling now (512 MB, against a 125 MB feed), refusing both a declared
`content-length` over it and a body that simply keeps arriving, and it removes the partial file rather
than leaving half a feed where the next run expects a whole one. Defence in depth: these URLs are
hardcoded constants no client can reach.

`/api/vehicles` has its own rate limit — 60/min against the general 300 — because it is the one
endpoint that answers in hundreds of kilobytes (448 KB for the region), which priced one caller at
~134 MB a minute. The map refreshes every 30 s and again 400 ms after a pan settles, so sixty is far
more than a person panning hard will use.

### 12.9 The two things §11.8 recorded

`<lastmod>` is **gone** from the sitemap rather than computed. It was the build date on every URL on
every deploy, including deploys that changed nothing on that page — the opposite of what the field is
for. Omitting it says nothing; stamping it said something false, and two pages have an honest
`UPDATED` constant while three do not.

The two Italian `console.warn` strings in `map/map.ts` and `map/style.ts` are English, like every
other developer-facing string in the repo.

### 12.10 §10.7's two content decisions — settled by the owner, 2026-08-24

1. **The domain is `dovebus.it`.** The placeholder was the real value all along, so `SITE_URL` needs
   no override at build time and the committed share cards — which have the domain rasterised into
   them — are correct as they stand.
2. **`/privacy/` keeps naming the static host generically.** Deliberate, not pending.

### 12.11 The review round

`/ecc:code-review` over the whole change, after the two agent reviews (`security-reviewer`,
`code-reviewer`) had come back with nothing above INFO. It found three things, all maintainability,
all fixed in this same change rather than recorded:

1. **`vite.config.ts` had reached 484 lines holding four separate jobs.** The headers moved out to
   `client/deploy-headers.ts`, beside `site-url.ts` and for the same kind of reason. Proven
   behaviour-preserving the only way that means anything for a generated artifact: the file was
   regenerated in both shapes and diffed against a baseline taken before the move — **byte for byte
   identical**, http build and https build alike.
2. **The three CSP allowances existed only as comments.** `worker-src blob:`,
   `style-src-attr 'unsafe-inline'` and the conditional `upgrade-insecure-requests` are exactly the
   kind of thing a later tidy-up removes for looking too permissive — and nothing would have gone red
   until someone opened the site. They are eight tests now, each carrying the measurement that
   justifies it: the band that renders at zero width, the map that does not draw, the LAN API call
   that gets upgraded and then blocked.
3. **`watch.ts` threaded the same options into `timetableMatch` twice.** One `measure()`, called by
   both readings — which have to be taken the same way, or the second is answering a slightly
   different question than the first.

Accepted rather than "fixed": `createTimetableWatch` sits over the 50-line guidance because it is a
factory holding two named closures and its own state; splitting it further needs a three-state return
(`clear` / `leave` / `disarm on this SHA-1`) that reads worse than what it replaces. The `console.log`
calls in `client/scripts/*` stay, because in those tools stdout **is** the result.

### 12.12 Still not code, and still open — ✅ CLOSED by the deploy (§13)

Nothing blocked a deploy in the repository. What remained was the deployment itself: `VITE_API_BASE`
set to the API's public origin **for the build** (it is baked in, and the CSP is generated from it),
`DOVEBUS_CORS_ORIGIN` and `DOVEBUS_TRUST_PROXY=1` on the API unit, and the API over `https`. All
three are in place and each was verified against the running system rather than the configuration
file — see §13.

---

## 13. The deploy — ✅ LIVE 2026-08-24

`https://dovebus.it` · `https://api.dovebus.it`

**Not Hetzner.** §6 priced a CX22 at €3.99/mo; in their console that line is "Cost-Optimized" and
unavailable, and what remained started at €14.02. The machine is an **OVH VPS-1** — 2 vCore, 4 GB,
40 GB NVMe, Strasbourg — at **€5,48/mese IVA inclusa, no commitment**, which is exactly what Aruba
charges for one vCPU and 2 GB. Latency measured from Tuscany: **31 ms**, inside data that is up to
two minutes old by construction.

What runs where: Netlify serves ten static pages and rebuilds on every push to `main`; the VPS runs
one Node process behind Caddy, holding a 1.19 GB SQLite timetable and both realtime pollers, with a
systemd timer rebuilding the timetable nightly at 04:30. `DEPLOY.md` is the runbook, and it was
followed rather than written afterwards — the two places it was wrong are noted below.

**The security posture, verified by probing rather than by reading the config.** Password login over
SSH is refused (`Permission denied (publickey)`); port 3200 does not answer from outside; the API
reflects `https://dovebus.it` to that origin and sends **no** `access-control-allow-origin` at all to
one that is not listed. Ubuntu's cloud images keep their real SSH settings in two files under
`sshd_config.d/` that would have re-enabled passwords behind `sshd_config`'s back — found by asking
the running daemon (`sshd -T`) instead of trusting the file.

### 13.1 Two faults that only a deploy could find

**Every page but the home redirected to itself, for ever.** `_redirects` marked its bare-to-slash
rules with `!` — "apply even when the file exists" — and Netlify matches a rule's path with and
without its trailing slash. So `/mappa/` matched the rule written for `/mappa` and was sent to
itself: fifty hops and the client gives up. The map, the three content pages and the whole English
tree were unreachable; the home was fine, which is why the first deploy looked like it had worked.
Nothing local could have caught it: the dev server does not read `_redirects`, `serve-dist.ts`
implements headers and not redirects, and the file only becomes executable code on Netlify. Fixed by
dropping the force flag, which also restores what those lines were for — the existing file wins, and
only the bare form is redirected. Verified on all ten URLs: 200, zero redirects, and the bare forms
still redirect in a single hop.

**Netlify injects a widget into every page**, and the CSP blocks it. The heads-up display for
logged-in teammates loads from `/.netlify/scripts/hud` and then tries to run inline code and inject
an inline stylesheet — both correctly refused. Not a fault in the site, but it made `headers-check`
red on every deploy, and a check that always fails is one people stop reading. It now knows those two
snippets by the hash the browser reports for each; a change to what Netlify injects turns it red
again, which is the point. Confirmed as the host's and not ours by diffing the served HTML against
the local build: no inline `<script>` or `<style>` in either, and the only content difference is
`CONTACT_EMAIL`, correctly set in production.

### 13.2 Where the runbook was wrong, and now is not

`DEPLOY.md` assumed a `root` login and an anonymous `git clone`. Neither holds: OVH's Ubuntu image
has no root SSH and forces a password change on first login as `ubuntu`, and this repository is
private, so the server needs a **read-only deploy key** — generated on the VPS and registered on the
repo, which is the right shape anyway since the machine only ever needs to read.

### 13.3 Measured on the deployed system

| | |
|---|---|
| First import on the VPS | **5m 22s** (3m 44s of rebuild), 1.19 GB, 282,329 trips |
| `/healthz` | `ok` — 1,157 live vehicles, 734 of 773 trips matched, feed valid 20 more days |
| `https://api.dovebus.it/healthz` | HTTP 200 in **155 ms** from the public internet |
| The ten pages | 200, zero redirects, both languages |
| `headers-check` against production | **7 pages, nothing blocked**; both maps `tiles=7 apiCalls=2` |
| TLS | Let's Encrypt, one certificate covering `dovebus.it` and `www.dovebus.it` |
| Run cost | €5,48/mese + the domain |

### 13.4 Recorded, not done

**DNS is slow in two places, and neither is a fault.** Aruba published the records about six minutes
after the panel showed them, and the apex's own TTL was an hour — so the site was reachable by IP,
with a valid certificate, for 38 minutes before any resolver would say so. Worth knowing before
anyone debugs a working deploy.

**The `ubuntu` password still exists.** SSH refuses it, but the OVH KVM console does not. Changing it
costs thirty seconds and closes the last thing anyone was ever told over email.
