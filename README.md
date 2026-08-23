# DoveBus

Real-time map of Autolinee Toscane buses in Tuscany, with two search modes
(line + time window, comune → comune + time) and the path already travelled.

Plan: [`DoveBus-plan.md`](DoveBus-plan.md) · Data-source validation:
[`PHASE0-FINDINGS.md`](PHASE0-FINDINGS.md)

**Status:** Phase 4 complete — static import + comune enrichment + refresh job
(Phase 1), the realtime pollers holding live positions, delays, trails and
freshness in memory (Phase 2), the HTTP API on top of both (Phase 3), and the
mobile-first MapLibre frontend: full-screen map, draggable search sheet, both
search modes, live trip view with trail, planned route, freshness and delay
(Phase 4). Deploy is next.

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

This CLI is the standalone harness for the poller. The API process runs the same
`createRealtimeService()`; nothing about it changes.

## Serving the API

```bash
npm run serve      # http://127.0.0.1:3200
```

One process: the read-only timetable, both realtime pollers, and the HTTP
endpoints. It answers entirely from its own state, so no number of clients can
put load on the regional feed.

| Endpoint | Purpose |
|---|---|
| `GET /api/comuni?q=&limit=` | Comune autocomplete (search mode 2). |
| `GET /api/routes?q=&limit=` | Line autocomplete (search mode 1). |
| `GET /api/search/line?route=&date=&from=&to=` | Runs of a line in a time window. |
| `GET /api/search/od?comuneA=&comuneB=&date=&from=&to=` | Direct runs between two comuni. |
| `GET /api/vehicles?bbox=minLon,minLat,maxLon,maxLat` | Live positions in the viewport. |
| `GET /api/trip/:tripId?date=` | Timetable + planned shape + live position + trail + delay. |
| `GET /api/stream/trip/:tripId?date=` | The same, pushed over SSE as the poller updates. |
| `GET /healthz` | Liveness, timetable validity *and staleness*, both feeds' poller status. |

```bash
curl 'http://127.0.0.1:3200/api/search/od?comuneA=Arezzo&comuneB=Anghiari&from=06:00&to=09:00'
```

- **`/healthz` catches a timetable that was replaced, not just one that expired.**
  The obvious check is impossible — the static feed is a 125 MB GET with no HEAD,
  so an always-on process cannot ask the source whether it republished. So the
  question is turned around: what share of the buses actually running are on
  trips this timetable has never heard of. Normal is ~3%; past 10% (with at least
  50 live trips, or the 04:00 fleet makes the ratio meaningless) the response
  reports `timetable.stale` and `status: "degraded"` — **and the process
  refreshes itself.** This is not hypothetical — see "when the timetable is
  replaced" below.
- **Vehicles carry their previous position.** `/api/vehicles` sends each bus's
  earlier fix alongside its current one, so a map can start moving markers on its
  first response instead of sitting frozen for a publisher cycle — about two
  minutes — while it collects two fixes of its own. It is withheld rather than
  guessed at when it is not strictly older than the current one, which the live
  feed does produce: a trail point falls back to the server's clock for a bus
  reporting no timestamp, so the pair can straddle two clocks.
- **One envelope.** `{"success":true,"data":{…}}` or
  `{"success":false,"error":{"code","message"}}` — including 404s, rate limits and
  the unexpected, so a client writes one unwrapping path and one error path.
- **Dates are GTFS service dates** (`YYYYMMDD`, default today) and times are
  service-day offsets: `from=25:10` is a real, searchable departure.
- **Comuni are named or coded.** `comuneA=Arezzo` and `comuneA=051002` both work,
  and a name that resolves to nothing is a 404 naming it — not an empty result
  list that reads as "no bus goes there".
- **Truncation is stated.** Every search returns a `truncated` flag rather than
  quietly returning a prefix of the answer.
- **CORS is open and there are no cookies**: the data is public CC-BY and the API
  is read-only. Requests are rate limited per IP (300/min by default).

Deploy it alongside the refresh timer:

```ini
# /etc/systemd/system/dovebus-api.service
[Service]
WorkingDirectory=/srv/dovebus/server
ExecStart=/usr/bin/npm run serve
Restart=always
Environment=DOVEBUS_HOST=127.0.0.1 DOVEBUS_PORT=3200

[Install]
WantedBy=multi-user.target
```

## Running the frontend

The API must be running first — the frontend has no fixtures and talks to the
real thing.

```bash
npm run dev         # Vite on http://localhost:5280
```

Port 5280 is fixed with `strictPort`, so a clash fails loudly instead of quietly
moving to 5281. The API address lives in one place, `client/.env`:

```bash
cp client/.env.example client/.env   # VITE_API_BASE=http://localhost:3200
```

```bash
npm run build:client   # typecheck + static bundle into client/dist
```

`client/dist` is what Netlify serves. Nothing else is needed at runtime: the
basemap is public raster tiles and the fonts are bundled.

### The screenshot loop

The interface is built by looking at it, at every viewport, after every change —
so the check is a committed script rather than something run by hand.

```bash
npm run shots              # 13 states × 6 viewports, against the real API
npm run shots -- 375x812   # just the primary target
```

`SHOTS_URL=http://localhost:5280/en/map/ npm run shots -- 375x812` shoots the
same states in English.

It drives the real app with Playwright and writes PNGs plus a `REPORT.md` into
`client/shots/` (gitignored). Alongside the pictures it asserts what a picture
cannot show: no horizontal page scroll, no interactive target under 44 px, no
unexpected console errors, and that every state is reachable at all. A round
exits non-zero if anything is found.

The states it shoots — the empty map, the search sheet on both tabs, an
autocomplete mid-type, a results list, a deliberately long-named one, an empty
result, a live trip, a scheduled one, a tapped vehicle, the day panel open over
a full sheet, and the offline case — are where the risk is. It runs against live data on purpose: Tuscan comune names
run long, a busy viewport is hundreds of buses, and fixtures would hide exactly
the overflow the loop exists to catch.

One of them, `12-journey`, is the state that earns its keep. Every other one
starts from a fresh page load, which is precisely how an earlier round reported
72 clean shots over a search button that died on the *second* search: a control
detached from the DOM mid-flow was never re-enabled, and nothing in the loop ever
performed two actions in a row. `12-journey` runs one continuous session —
search, back, switch tab, search again, open a trip, back — and Playwright's
refusal to click a dead button surfaces that class of bug as an unreachable
state rather than as a picture nobody looks at closely.

`npm run site-shots` is the same idea for the four content pages in each
language — eight pages × six viewports — and it audits what a picture cannot
show there either: title and description lengths, canonical and `og:url`
agreeing with the page's own path, exactly one `<h1>`, the declared `lang`
matching the language the URL promises, JSON-LD that parses and carries no
unsubstituted `%TOKEN%`, every `FAQPage` answer findable in the page's text, and
every date the markup declares spelled out somewhere a reader can see it — in
the page's own language.

### The following check

Two things a screenshot cannot catch happen between frames: the bus a rider is
following leaving the map, and the stops list moving under them while they read
it. Both get a script that watches instead of a shot that samples.

```bash
npm run follow-check
```

It opens a run that is genuinely in service, zooms to street level — where the
viewport becomes narrower than the distance a bus covers between two fixes — and
watches for eighty seconds, across at least two fleet refreshes. It fails if the
followed bus is ever missing from the drawn fleet, if the stops list moves by
more than a pixel, or on any console error. With no bus anywhere in Tuscany
running a trip the loaded timetable describes — which happens at night — it says
so and exits 0.

## Two languages

The site is published in Italian and in English, five pages each:

| Italiano | English |
| --- | --- |
| `/` | `/en/` |
| `/mappa/` | `/en/map/` |
| `/come-funziona/` | `/en/how-it-works/` |
| `/fonte-dati/` | `/en/data-source/` |
| `/privacy/` | `/en/privacy/` |

That table lives once, in `PAGES` in `client/vite.config.ts`, and feeds four
things: the sitemap, the `hreflang` block on every page, the language switch —
which therefore always lands on *this* page's twin rather than on the home page
— and the build-time assertion that a page's own `canonical` names the URL it is
served at. Four separate lists is how a bilingual site ends up telling a crawler
that two pages are translations of each other and then linking them to something
else. A page missing its `hreflang` pair or its switch fails the build.

**Not translated, deliberately.** Stop names, line codes and headsigns come from
the operator's feed and are Italian on the pole and on the front of the bus, so
they are Italian on both sites; the map's own labels resolve through
`name:it → name → name:latin` for every reader. And the day is written
`dd/mm/yyyy` with a 24-hour clock in English too: this page is read next to
Italian timetables, and `08/12` must not mean two different days.

Italian is `x-default` and **there is no Accept-Language redirect**: a root that
serves two documents depending on a header makes `hreflang` a claim nobody can
check and turns one URL into two things to cache. The choice is not remembered
either — the privacy page promises the site writes nothing to the browser, and
with no redirect to influence there is nothing for a stored preference to do.

The interface's own words live in `client/src/i18n/`, as a `Strings` **type**
rather than a map of keys: a dictionary that omits a sentence does not compile,
and there is no fallback to Italian, because a fallback is how half a page ends
up in the wrong language without anyone noticing. Anything containing a number
is a function, not a template — `${n} corse` and `${n} trips` stop being the
same sentence at `n = 1`.

## Checking a build

```bash
npm run verify      # smoke checks against the live database
npm test            # unit + integration tests, server and client
npm run coverage    # same, with the 80% threshold enforced
npm run typecheck
npm run check       # Biome: lint + format + import order
npm run check:fix   # apply the safe fixes
```

`verify` asserts the things a green unit test cannot: that the real feed yields
a non-empty active-service set for today, that stops resolved to comuni, that
every trip has a drawable shape, and that the origin→destination search still
returns the Arezzo→Anghiari runs the plan validated.

The client's own unit tests cover the reasoning the interface does *before* it
touches a node — which bus survives a snapshot, how far a viewport query has to
reach, what a typed hour means, and that both dictionaries have the same shape
down to the enum keys the compiler cannot check. Everything that has to be
looked at is checked by the Playwright loops above instead, which is why the
coverage threshold is scoped to those modules rather than spread over `src/**`.

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
                            ├─► decode ─► Tuscany bbox filter ─► LiveState ──► API
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

## How the API works

Design points worth knowing before changing it:

- **The search collapses in SQL, not after it.** The plan's origin→destination
  self-join is correct but multiplies: a run calling at eleven stops in Arezzo
  and eight in Anghiari is eighty-eight rows for one bus, and a live full-day
  Arezzo→Anghiari blew past a 5,000-row cap — the whole afternoon fell off the
  end. Each side is now reduced to one stop per trip inside the query (earliest
  boarding in the window, first alighting after it), so the result is one row per
  run and the cap is never in play.
- **The calendar filter is load-bearing.** Without it every date's copy of every
  trip matches: 736 rows where 34 runs exist.
- **The database can be replaced underneath a running server.** The refresh job
  publishes by `rename(2)`, which leaves open connections pinned to the old
  inode — serving last week's timetable with nothing looking broken. The API
  notices the new inode and reopens; a path that momentarily does not resolve
  (mid-rename) is not an error, it keeps reading the connection it has.
- **SSE is pushed on the poller's rhythm**, not on a timer per connection. The
  feed regenerates about every two minutes, so a client on its own clock would
  mostly re-receive what it already has. Identical payloads are not resent —
  a comment heartbeat every 15 s is what keeps the connection and any proxy alive.
- **Freshness is computed at serialization, never stored.** When the feed stalls
  the position stops changing but its age does not, and the age is the number the
  UI prints.
- **Coordinates are rounded to five decimals** (~1 m). Realtime positions are
  protobuf floats: a bus at 43.47 arrives as 43.470001220703125, twice per point,
  ~1150 vehicles a request.
- **Errors never carry internals.** A 500 is logged in full server-side and
  answered with a fixed message; only 4xx text is derived from the request.
- **`/healthz` is always 200 while the process can answer.** A timetable past its
  validity window and a dead realtime feed are data problems reported as flags —
  a 503 would have a load balancer pull a working API for a public feed's hiccup.

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

### API, against the live database and feeds (2026-08-13)

| Endpoint | Result | Time |
|---|---|---|
| `/api/search/od` Arezzo→Anghiari, whole day | 17 trips, SI381 + BAAS (15 the other way) — the plan's fixture, exactly | 160 ms cold, 19 ms warm |
| `/api/search/od` Firenze→Prato, 07:00–09:00 | 9 trips | 0.50 s |
| `/api/search/od` Firenze→Prato, whole day | 38 trips | 1.5 s |
| `/api/search/line` SI381, 06:00–12:00 | 13 runs with origin/destination | 5 ms |
| `/api/vehicles` (whole region) | 1,152 buses, 712 with a line, 646 with a delay; 464 KB | 16 ms |
| `/api/vehicles?bbox=` (Firenze) | 265 buses, 108 KB | 10 ms |
| `/api/trip/:id` | 11 stops + 232 shape points + live position, delay −40 s, trail; 7.7 KB | 12 ms |
| `/api/stream/trip/:id` over 100 s | snapshot immediately, one update when the publisher regenerated (age 174 s → 107 s), 6 heartbeats, no duplicate pushes | — |

> **The one slow query is the largest one possible.** Firenze is 1,335 stops and
> ~1.06M `stop_times` rows; asking for every run from anywhere in Firenze to
> anywhere in Prato across a whole service day reads all of them and takes ~1.5 s.
> With a time window — which is what the search panel sends — the same pair is
> half a second, and every other shape of query is milliseconds.

## How the frontend works

```
client/src
  ├─ api/          typed fetch of the envelope + the SSE url
  ├─ i18n/         one `Strings` type, two dictionaries, no fallback
  ├─ map/          the only place MapLibre exists
  │    ├─ style    petrol-tinted raster basemap (no API key)
  │    ├─ tracking which bus survives a snapshot that does not mention it
  │    ├─ vehicles one GeoJSON source, rAF interpolation on the source data
  │    ├─ viewport how far a fleet request has to reach past the screen
  │    └─ trip     planned shape (dashed) · trail (gradient) · stop beads
  ├─ ui/           bottom sheet, combobox, the freshness meter, when-fields, views
  └─ styles/       tokens → base → sheet → panel → trip
```

Five decisions carry the design:

**The map owns the screen; the sheet owns the thumb.** Everything a rider does
happens in a bottom sheet with three detents, draggable, flick-aware, and
keyboard-operable. Above 720 px the same sheet becomes a left column and the map
takes the rest — the desktop layout is what the phone grows into, not the
reverse. The map's `padding` follows the sheet, so flying to a bus never parks
it behind the panel.

**Vehicles are a layer, never DOM markers.** A busy viewport is several hundred
buses and the region is over a thousand; as element nodes that will not hold a
frame rate on a mid-range phone. One `geojson` source, two circle layers, and
the positions are rewritten five times a second rather than sixty — a bus at
50 km/h covers under two pixels per second at street zoom, so the extra
fifty-five redraws would buy nothing and cost a phone its frame rate.

**A bus does not wait for a fix to move.** The feed publishes roughly every two
minutes, and a marker that only moves when a snapshot lands sits still for two
minutes and then jumps. Every bus is advanced at the speed it was last observed
travelling — along its route where one is known (`map/route.ts` turns a position
into a distance along the shape), along its last heading otherwise. The speed
needs two fixes, so the API sends the earlier one with the current one and the
map moves from its first response rather than after a two-minute wait: measured
at **59% of markers moving within 14 seconds of a cold load**, against 0% before.
What was assumed is never hidden: the trip view states how far the marker has
been advanced past the last real fix, and a disc on the map shows how far off it
could be. **The guess stops being extended at five minutes** — the same age at
which an ordinary bus leaves the map. The followed bus is exempt from that
cutoff, because vanishing while a rider watches is the worst possible moment to
disappear, but exempting it from *hiding* must not exempt it from honesty:
unbounded, a selected bus that went silent drifted 58.7 km in an hour with the
interface announcing the figure. Past the cap the marker holds and the meter,
which never stops counting, carries the truth.

**Freshness is recomputed on the client, continuously, and old buses leave.**
The server's bucket is correct when it is sent and wrong a minute later, because
the fix keeps ageing while the screen is open, so both the map colour and the
meter derive the age from the bus's own `timestamp`. Past five minutes a bus is
removed from the map rather than drawn faded — the threshold is derived from
this feed and not borrowed (see `MAX_VISIBLE_AGE_S`), and the bus a rider is
actively following is exempt, because vanishing mid-watch is the worst possible
moment to disappear.

**Colour means data, never decoration.** The interface is paper and ink; the
only saturated colours are the freshness ramp (green → amber, draining to grey),
the delay badge on its own separate scale, and red, which is reserved for a
cancelled run and appears nowhere else. The ramp was re-picked against white
rather than inverted from the dark original — a luminous aqua carries under 2:1
on paper.

### The trail is a reconstruction, and says so

Consecutive fixes on this feed are 96–130 s and **up to 2.7 km** apart, so a line
joining them draws a straight chord across every curve — visibly through
hillsides. The route's own shape carries 877 points for the same trip, so the
travelled path is drawn as *the stretch of road up to where the bus has got to*,
projected onto that shape. The raw fixes stay on top as separate marks: the
difference between "we watched this happen" and "we reconstructed this" is
exactly the sort of thing this product does not blur, and the caption says which
is which.

### When the timetable is replaced

On 2026-08-15 the operator republished the static feed **inside its own declared
validity window**. Every expiry check stayed green — `feed_end_date` still read
three weeks out — while one live bus in five had become untraceable, because the
realtime feed was quoting trip ids from a file the database did not have.

What it looked like, measured:

| | stale (3 days old) | after `npm run refresh` |
|---|---|---|
| declared validity | 20260812 → 20260901 | 20260815 → 20260904 |
| trips in the database | 207,987 | 270,823 |
| live trips not in the timetable | **21.2%** | **0.3%** |

Two things follow. The refresh job is not optional maintenance — it is what keeps
the timetable describing reality, and it compares the download's SHA1 rather than
trusting the declared dates. And `feed_end_date` is not a health signal on its
own: a feed can stop being true long before it stops being valid, which is why
`/healthz` watches the match rate instead.

**The daily timer is now a safety net rather than the only defence.** The API
checks the match rate every 5 minutes — a few hundred indexed lookups, free — and
when it crosses the threshold it runs the refresh itself, as a child process. The
window of a wrong timetable goes from "up to 24 hours" to "however long the
download takes".

It is deliberately hard to provoke, because each trigger costs 125 MB: a 50-trip
sample floor, a threshold clear of normal extra service, one refresh at a time,
and a one-hour cooldown that holds even while the ratio still looks bad — if a
refresh did not fix it, the cause is upstream and repeating it will not help. A
failed refresh is logged and the stale timetable keeps answering: old schedules
beat no schedules. Set `DOVEBUS_AUTO_REFRESH=false` to leave it to the timer.

The reason it spawns a child rather than importing in place: the rebuild is
synchronous by design — better-sqlite3 is what makes five million rows fast — so
running it in the API process would block the event loop for the full two
minutes. The child builds into a staging file and renames it over the live one,
and the API notices the swap by itself.

## Attribution (CC BY — required)

- `Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)`
- `Confini comunali: openpolis/ISTAT (CC BY 4.0)`
