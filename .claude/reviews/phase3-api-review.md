# Code Review: Phase 3 — HTTP API (search, live vehicles, trip detail, SSE)

**Reviewed:** 2026-08-13 · **Scope:** the Phase 3 changeset (`a5b7ff4..720c6d6`) — 22 source files, 10 test files, config and docs
**Mode:** local (changeset already committed; working tree clean at review start)
**Decision:** **APPROVE** — 1 HIGH and 3 MEDIUM findings were reproduced, fixed and re-verified during the review; the rest are LOW notes left open deliberately.

## Summary

The API answers correctly against the live database and feeds, and the numbers
match what the plan predicted (Arezzo→Anghiari: 17 trips one way, 15 the other,
on SI381 + BAAS). The review found one defect that our development machine
structurally cannot show — the server's own timezone silently deciding which
day's timetable a date-less request gets — plus three hardening gaps around the
SSE endpoint and the proxy assumption. All four are fixed and covered by tests.

Two design decisions taken during the build are worth recording, because both
were forced by live data rather than by the plan: the mode-2 self-join now
collapses inside SQL, and a read handle reopens the database after the refresh
job's atomic swap.

## Findings

### CRITICAL

None. No secrets or credentials anywhere in the changeset (scanned). Every SQL
statement is parameterised — the only interpolations are generated `?`
placeholders and a module-level constant, and the two `LIKE` autocompletes take
input through `normalizeName` (which strips everything but `A–Z0–9`) *and* an
explicit `ESCAPE`. No path handling touches user input. 500s are logged in full
server-side and answered with a fixed message, so internals cannot leak through
an error body — verified by test.

### HIGH

**H1 — Date-less requests served the wrong day's timetable on a UTC host** ·
`src/util/date.ts:toServiceDate` · **FIXED**

`toServiceDate` read the *process's* calendar day. A GTFS service date is a
local day in the agency's timezone, and the deployment target is a UTC VPS: for
the two hours before UTC midnight — 22:00–00:00 UTC, i.e. midnight to 02:00 in
Rome — every request that omits `date` would have resolved to the previous day.
Both search modes, `/api/trip/:id`, the SSE stream and the "is this run out
there right now?" fallback in `liveTrip` all default that way, so the whole API
would quietly serve yesterday's schedule during exactly the window where night
runs matter.

Our development machine runs CEST, where the bug is invisible. Confirmed by
computing both interpretations for `2026-08-12T23:30Z`: host-local says
`20260812`, Rome says `20260813`.

Fixed by resolving the service date in `Europe/Rome` (new `AGENCY_TIMEZONE`
constant) via `Intl`, which also keeps the `refresh` and `verify` CLIs honest.
Covered by a test that asserts Rome semantics and therefore passes under `TZ=UTC`
and `TZ=Europe/Rome` alike — both runs verified.

### MEDIUM

**M1 — A full trip detail was queried just to check a trip existed** ·
`src/api/routes/stream.ts` · **FIXED**

Opening an SSE stream called `tripDetail()` purely to decide between 404 and
200 — loading every stop and every shape point (232 on the trip measured live,
and shapes average ~540 points) and throwing all of it away. Replaced with
`tripExists()`, a single indexed `SELECT 1`.

**M2 — One caller could consume the entire stream budget** ·
`src/api/routes/stream.ts` · **FIXED**

The 500-connection ceiling was global only, so a single client could hold every
slot and lock everyone else out — the cap becoming the outage it exists to
prevent. Added a per-caller ceiling (10, configurable) alongside the global one,
with slots released on disconnect. Covered by a test that fills a caller's
budget, asserts the 503 envelope, and asserts the slot comes back when a
connection closes.

**M3 — `trustProxy` was unconditionally on** · `src/api/server.ts` · **FIXED**

Correct behind Caddy — without it every client shares the proxy's address and
the rate limiter throttles the region as one caller — but wrong if the process
is ever exposed directly, where `X-Forwarded-For` becomes caller-controlled and
makes both the rate limit and the new per-IP stream cap trivially evadable.
Now `DOVEBUS_TRUST_PROXY=false` turns it off, defaulting to on for the intended
deployment.

### LOW

**L1 — Response compression is not configured.** The whole-region
`/api/vehicles` payload is 464 KB. Left to the reverse proxy on purpose: Caddy
gzips upstream responses by default, and compressing twice buys nothing. Worth
revisiting only if the API is ever exposed without a proxy.

**L2 — Statements are prepared per request, not cached.** better-sqlite3 reparses
and replans each query. Measured cost is invisible next to the work itself
(18 ms warm for the origin→destination search), so caching would be speculative.

**L3 — `/healthz` is unauthenticated and detailed.** It exposes the feed sha1,
import time and both pollers' last error strings. All of it concerns a public
CC-BY dataset and a public upstream URL, and it is what makes the endpoint
useful for alerting; noted rather than trimmed.

**L4 — `/api/search/od` resolves comuni before validating `date`.** A request
with both an unknown comune and a malformed date answers 404 rather than 400.
Both are true; the order is arbitrary.

**L5 — Service-day boundaries are not smoothed for the default date.** Just
after midnight, "today" is the new calendar day, so a still-running 25:10
departure must be searched as yesterday's date with `from=25:00`. Correct GTFS
semantics, but a UI convenience worth considering in Phase 4.

**L6 — A few functions exceed the 50-line guideline** (`buildApi` 67,
`searchLine` 61, `tripEndpoints` 59). They are flat: a SQL literal and a single
mapping pass, no branching to speak of. `registerStreamRoutes`, which did have
real logic at 77 lines, was split into a route registration, a per-connection
`stream()` and a `StreamCounter` during this review.

## Design decisions forced by live data

**The mode-2 self-join collapses inside SQL.** The plan's query is correct but
multiplies: a run calling at eleven Arezzo stops and eight Anghiari stops is 88
rows for one bus. A single day of Arezzo→Anghiari blew past a 5,000-row cap and
the afternoon was truncated away — a wrong answer that looked like a complete
one. Each side is now reduced to one stop per trip inside the query (earliest
boarding in the window, first alighting after it), so the result is one row per
run and the cap is never in play.

**A read handle reopens the database after the swap.** The refresh job publishes
by `rename(2)`; an open connection stays pinned to the old inode and would serve
last week's timetable indefinitely with nothing looking broken. `db/handle.ts`
notices the new inode and reopens, and treats a path that momentarily does not
resolve (mid-rename) as normal rather than as an error.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint + format (`biome check`) | Pass |
| Tests (`vitest run`) | Pass — 278 tests, 31 files |
| Coverage | Pass — 96.4% statements, 86.4% branches (threshold 80%) |
| Live smoke (API against the real database and feeds) | Pass — see README "API, against the live database and feeds" |

## Files Reviewed

**Added** — `src/api/{server,context,params,errors,envelope,serialize}.ts`,
`src/api/routes/{catalog,search,vehicles,trip,stream,health}.ts`,
`src/query/{services,comuni,routes,searchLine,searchOd,trip,trips}.ts`,
`src/db/handle.ts`, `src/geo/coordinates.ts`, `src/cli/serve.ts`,
`test/{api,apiServer,apiStream,apiParams,dbHandle,queryCatalog,querySearch,queryTrip}.test.ts`,
`test/helpers/{apiFixture,fixtureDb}.ts`

**Modified** — `src/config.ts`, `src/rt/service.ts` (subscription hook),
`src/util/date.ts` (H1), `src/query/trip.ts` (M1), `README.md`,
`DoveBus-plan.md`, `package.json`
