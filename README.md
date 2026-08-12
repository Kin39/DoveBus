# DoveBus

Real-time map of Autolinee Toscane buses in Tuscany, with two search modes
(line + time window, comune → comune + time) and the path already travelled.

Plan: [`DoveBus-plan.md`](DoveBus-plan.md) · Data-source validation:
[`PHASE0-FINDINGS.md`](PHASE0-FINDINGS.md)

**Status:** Phase 1 complete — static import, comune enrichment, feed-validity
refresh job and atomic swap. Realtime poller, API and frontend are next.

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

## Attribution (CC BY — required)

- `Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)`
- `Confini comunali: openpolis/ISTAT (CC BY 4.0)`
