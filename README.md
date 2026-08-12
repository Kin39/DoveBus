# DoveBus

Real-time map of Autolinee Toscane buses in Tuscany, with two search modes
(line + time window, comune → comune + time) and the path already travelled.

Plan: [`DoveBus-plan.md`](DoveBus-plan.md) · Data-source validation:
[`PHASE0-FINDINGS.md`](PHASE0-FINDINGS.md)

**Status:** Phase 2 complete — static import + comune enrichment + refresh job
(Phase 1), and the realtime pollers: live positions, delays and cancellations,
trails and freshness, all held in memory. API and frontend are next.

---

## Requirements

Node.js ≥ 22. No database server: the whole timetable lives in one SQLite file.

```bash
npm install
```

## Building the timetable database

```bash
npm run import
```

Downloads the consolidated feed (~125 MB), builds `data/gtfs.new.db`, enriches
every stop with its comune, creates indexes, then renames the file over
`data/gtfs.db`. Takes ~2 minutes end to end and produces a ~1 GB database.

To rebuild from a zip you already have (no download):

```bash
npm run import -- --zip=/path/to/gtfs.zip
```

## Keeping it current (daily job)

```bash
npm run refresh
```

Downloads the feed and rebuilds **only if the bytes changed**; otherwise the
live database is left untouched. Warns when the loaded timetable is past its
`feed_end_date` — the operator publishes ~20-day timetables, so a database that
outlives its window keeps answering searches with schedules that no longer apply.

Run it daily under systemd:

```ini
# /etc/systemd/system/dovebus-refresh.service
[Service]
Type=oneshot
WorkingDirectory=/srv/dovebus/server
ExecStart=/usr/bin/npm run refresh

# /etc/systemd/system/dovebus-refresh.timer
[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true
[Install]
WantedBy=timers.target
```

## Watching the buses (realtime)

```bash
npm run poll -- --once                      # one snapshot of both feeds, then exit
npm run poll -- --duration=300 --report=30  # run for 5 min, report every 30 s
npm run poll                                # run until Ctrl-C
```

Polls `vehicle-positions` (30 s) and `trip-updates` (60 s), keeps the live
picture in memory and prints what it holds: how many buses, how many carry a
trip, how many have a delay, the freshness mix, and — if a timetable database
has been imported — how many live trips join onto it.

This CLI is the standalone harness for the poller. Phase 3 runs the same
`createRealtimeService()` inside the API process; nothing about it changes.

## Checking a build

```bash
npm run verify      # smoke checks against the live database
npm test            # unit + integration tests
npm run coverage    # same, with the 80% threshold enforced
npm run typecheck
npm run check       # Biome: lint + format + import order
npm run check:fix   # apply the safe fixes
```

`verify` asserts the things a green unit test cannot: that the real feed yields
a non-empty active-service set for today, that stops resolved to comuni, that
every trip has a drawable shape, and that the origin→destination search still
returns the Arezzo→Anghiari runs the plan validated.

---

## How the import works

```
/gtfs (zip, 125 MB)
  └─ stream each .txt ─► CSV parser ─► batched INSERT ─► data/gtfs.new.db
       ├─ derived columns: departure_s/arrival_s, *_norm
       ├─ comune enrichment: point-in-polygon (openpolis R_9) + bounded name fallback
       ├─ indexes + ANALYZE  (after inserts — an order of magnitude cheaper)
       ├─ feed_meta: sha1, etag, validity window, db_version
       └─ verify (integrity + non-empty tables) ─► rename over data/gtfs.db
```

Design points worth knowing before changing it:

- **Nothing is written in place.** An import builds a staging file and publishes
  it with `rename(2)`, which is atomic within a filesystem. A reader either sees
  the whole old database or the whole new one. Readers must reopen their
  connection after a swap to pick up the new file.
- **A build is verified before it is published.** A truncated download or a feed
  that changed shape fails verification and the live database survives untouched.
- **Rows stream, they never accumulate.** `stop_times` is 5.6M rows and `shapes`
  is 7.6M; both are piped from the zip straight into SQLite.
- **`calendar_dates` is the source of truth for dates.** This feed's `calendar`
  weekday columns are all zero — a resolver keyed on weekdays returns an empty
  set and breaks both search modes.
- **GTFS times are service-day offsets.** `25:10:00` is a real departure. The
  import stores `departure_s`/`arrival_s` so time-window queries order correctly.
- **A stop name is not evidence of its comune.** The name fallback only applies
  when the coordinates also put the stop near that comune: the live feed has a
  junction called "BIVIO PRATO" 98 km from the city of Prato. A stop that cannot
  be placed stays NULL rather than being attributed to the wrong comune.
- **One import at a time.** The job takes an exclusive lock, so the daily timer
  and a manual run cannot build the same staging file simultaneously.

### Schema

Standard GTFS tables (`agency, areas, stops, routes, trips, stop_times,
calendar, calendar_dates, shapes`) as a deliberate column subset, plus:

| Table / column | Purpose |
|---|---|
| `stops.comune`, `comune_istat`, `comune_source` | comune → comune search; `comune_source` records whether the match came from the polygon or the name fallback |
| `stops.stop_name_norm`, `routes.route_short_name_norm` | accent-stripped uppercase, for autocomplete |
| `stop_times.arrival_s`, `departure_s` | seconds since service midnight |
| `comuni` | 273 Tuscan municipalities with centroids |
| `feed_meta` | sha1 / etag / validity window / schema version of the loaded feed |

## How the realtime side works

```
vehicle-positions ─poll 30s─┐
                            ├─► decode ─► Tuscany bbox filter ─► LiveState ──► API (Phase 3)
trip-updates      ─poll 60s─┘                                     ├─ position per run
                                                                  ├─ delay / cancellation
                                                                  └─ trail (last 30 min, RAM)
```

- **One process fetches, everybody else reads.** Clients never touch the upstream
  feed. Both feeds are full snapshots on every GET, so a poll is
  fetch → decode → replace.
- **The two feeds are independent.** `trip-updates` going down costs delays, not
  positions; it must not take the map with it. They fail and back off separately.
- **Backoff is adaptive.** An unchanged feed header means the publisher has not
  regenerated the snapshot yet, so polling harder buys nothing — the interval
  eases up to 2× and snaps back the moment a new snapshot appears. A failure
  retries at the normal cadence first (this source drops a connection
  occasionally and serves the next request in under a second) and only then
  backs off exponentially, capped at 4 minutes.
- **A run is keyed by `(trip_id, start_date)`**, falling back to the vehicle id
  for buses with no trip assigned (deadheading — about a third of the feed).
  The same `trip_id` runs again tomorrow, so the date is part of the identity.
- **Positions outside Tuscany are dropped**, not flagged: the live feed emits a
  couple of them per snapshot and they would render as ghost buses.
- **Absent for one snapshot ≠ gone.** A bus is forgotten after 10 minutes of
  silence, which also frees its trail buffer — otherwise a day of finished runs
  would accumulate in memory.
- **Freshness is reported, never smoothed.** Age is `now − vehicle.timestamp`,
  bucketed with named thresholds; a missing timestamp counts as stale rather
  than fresh. Interpolation on the map (Phase 4) is cosmetic and must not reset
  the age.
- **Trails are RAM-only and honest.** Last 30 minutes, capped at 500 points, and
  a repeated position is not stored twice — the feed regenerates every ~120 s
  while we poll every 30 s. A trail therefore begins where the backend started
  watching, which the UI will say plainly.

## Measured on the live feed (2026-08-12)

| | |
|---|---|
| Download | 125 MB in ~45 s |
| Import + enrich + index | 71 s → 994 MB database |
| Rows | stop_times 5,574,809 · shapes 7,594,712 · trips 207,987 · stops 28,964 |
| Comune enrichment | 99.2% resolved (28,716 by polygon, 4 by name, 244 nulls — mostly genuine Emilia/Umbria/Liguria border stops, plus some coastal/island stops just outside the June-2023 polygons) |
| Trips with a shape | 100% |
| Services active on 2026-08-12 | 513, all via `calendar_dates` (0 weekday patterns) |
| Arezzo → Anghiari search | 380 raw rows → 17 trips, lines SI381 + BAAS, ~180 ms cold |

### Realtime, over a 5-minute run (2026-08-12 17:41–17:46)

| | |
|---|---|
| `vehicle-positions` | ~100 KB, 0.4–0.6 s per fetch, header regenerates ~120 s |
| `trip-updates` | ~760 KB, 0.7–0.9 s per fetch, 1,438–1,540 trips |
| Vehicles tracked | 1,061 → 1,127 (776 with a trip, the rest deadheading) |
| Trips with a delay joined | 701 / 776 = **90%** |
| Live trips found in the timetable | **95.0%** (737 / 776) |
| Upstream timeouts | 4 in 5 min (3 on positions, 1 on trip-updates) — the source hangs, then serves the next request in <1 s. Backoff absorbed all of them and the last good picture kept being served. |
| Freshness spread (old bands) | Right after a new snapshot: 70% *recente*, 12% *attenuato*, 18% *stale*. Two minutes later, with no new snapshot: 100% *stale*. **Nothing ever landed in the 0–30 s bucket** — which is why the bands were recalibrated. |

> **Freshness was recalibrated to this operator (2026-08-12).** The plan's
> busbus-style buckets (0–30 / 31–90 / 91–180 s) assumed the operator publishes
> faster than it does. Measured, a bus's own timestamp is already ~40–60 s old
> when the snapshot appears, and the snapshot then ages ~120 s before the next
> one — so the colour tracked *where we were in the publisher's cycle*, not
> whether a bus was reporting well, and a healthy bus read "stale" for much of
> every cycle. The bands are now **0–90 / 91–180 / 181–300 / >300 s** and
> describe the bus. The exact age in seconds is always shown next to the label,
> so the honest number never depends on the colour.

## Attribution (CC BY — required)

- `Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)`
- `Confini comunali: openpolis/ISTAT (CC BY 4.0)`
