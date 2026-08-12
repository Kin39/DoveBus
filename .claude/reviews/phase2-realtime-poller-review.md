# Code Review: Phase 2 — realtime pollers, live state, trails, freshness

**Reviewed:** 2026-08-12 · **Scope:** all Phase 2 code (9 source files, 8 test files, config additions)
**Mode:** local (uncommitted changes)
**Decision:** **APPROVE** — 1 HIGH and 2 MEDIUM findings were reproduced, fixed and re-verified during the review; the rest are LOW notes left open deliberately.

## Summary

The realtime half works against the live feeds: 1,127 vehicles tracked, 90% of
running trips carrying a delay from `trip-updates`, 95.0% joining onto the
imported timetable. One real user-visible defect was found by reasoning about
what happens when a bus *changes identity* mid-day rather than by looking at a
single snapshot: a bus taking up a run appeared on the map twice. Fixed.

Two live findings that shaped the design are recorded in `README.md` and the
plan: the upstream endpoints intermittently hang (~4 timeouts per 5 minutes),
and the plan's freshness thresholds were miscalibrated against what this
operator actually publishes.

## Findings

### CRITICAL

None. No credentials or secrets, no user-controlled input yet (the API arrives
in Phase 3), the one SQL statement (`cli/poll.ts`) is parameterised, and every
byte from the network is decoded through a validated GTFS-RT header check before
anything downstream sees it.

### HIGH

**H1 — The same physical bus was shown twice while taking up a run** ·
`src/rt/state.ts:applyVehicles` · **FIXED**

A bus keys as `vehicle:<id>` while deadheading and as `trip:<trip_id>|<date>`
once it is assigned a run. Nothing dropped the entry it held before, so for up
to `VEHICLE_TTL_MS` (10 minutes) the old marker sat frozen at the position where
the bus changed identity, next to the live one. This happens at the start *and*
end of every run — continuously, across ~1000 buses. Reproduced:

```
keys: [ 'vehicle:BUS9@43.10', 'trip:T1|20260812@43.20' ]   → size 2, expected 1
```

*Fix:* a `vehicleId → key` index; when a bus reports under a new key the previous
entry is reclaimed through a single `#forget()` that also clears every index, so
no dangling pointers are left behind. The trail deliberately restarts: the
approach to the terminus is not part of the run a rider selected.

*Guard against making it worse:* two buses can briefly report the same `trip_id`
(a relief bus), so the old entry is reclaimed **only if it is still the same
physical bus** — otherwise the other bus would blink off the map.

*Covered by:* 4 tests (start of run, end of run, trail restart, relief bus).

### MEDIUM

**M1 — Unbounded response buffering** · `src/rt/fetch.ts` · **FIXED**

`response.arrayBuffer()` accepted any size from a third-party endpoint, on a box
that also holds a ~1 GB database. Capped at 64 MB (`RT_MAX_BODY_BYTES`), checked
both on the announced `content-length` and on the bytes actually received. The
real feeds are ~100 KB and ~760 KB, so this is headroom, not a constraint.

**M2 — Read paths mutated state** · `src/rt/state.ts:listInBbox`, `trail` · **FIXED**

Both called expiry, so a `GET` was what deleted vehicles — a poor foundation for
the Phase 3 API, and O(n) work on every request. Reads are now pure; expiry
happens on the write path, which already runs every poll. Side benefit: if the
poller dies, vehicles stay visible and age honestly instead of the map quietly
emptying itself.

### LOW (open, deliberate)

- **A vehicle clock running ahead reads as perfectly fresh** ·
  `src/rt/freshness.ts` — age is clamped at zero, so a bus with a skewed-forward
  clock would always show "aggiornato". Not observed on this feed. Fix if it
  appears: treat a timestamp more than N minutes in the future as unknown.
- **Unhandled rejection if an `onPoll`/`onError` callback throws** ·
  `src/rt/poller.ts` — only our own callbacks are passed today.
- **`stats()` counts vehicles expiry has not swept yet**, so it can differ for an
  instant from the next poll's numbers. Cosmetic.
- **`npm run poll --bad-flag` prints a stack trace** instead of a usage line.
- Two functions sit near the 50-line guideline (`createPoller` 65,
  `applyVehicles` 53). Both are a closure factory and a flat loop; splitting them
  would cost more readability than it buys. Left as is, knowingly.

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (Biome) | Pass |
| Tests | Pass — 190 (184 before the review, +6 from it) |
| Coverage | 96.69% statements · 85.99% branches · 100% functions |
| Live feeds | Re-run after the fixes: vehicle count stable, no accumulation |
| `npm run verify` (timetable DB) | 6/6 |

## Files Reviewed

| File | Change |
|---|---|
| `server/src/rt/decode.ts` | Added |
| `server/src/rt/state.ts` | Added (fixed: H1, M2) |
| `server/src/rt/trail.ts` | Added |
| `server/src/rt/freshness.ts` | Added |
| `server/src/rt/poller.ts` | Added |
| `server/src/rt/fetch.ts` | Added (fixed: M1) |
| `server/src/rt/service.ts` | Added |
| `server/src/geo/bbox.ts` | Added |
| `server/src/cli/poll.ts` | Added |
| `server/src/config.ts` | Modified — RT URLs, cadences, TTLs, bbox, freshness bands |
| `server/test/{decode,liveState,trail,freshness,poller,realtimeService,rtFetch,bbox}.test.ts` | Added |
| `server/test/helpers/rtFixture.ts` | Added |
| `README.md`, `DoveBus-plan.md` | Modified — Phase 2 status, measurements, freshness recalibration |
