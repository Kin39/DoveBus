# Code Review: Phase 1 — static import, enrichment, refresh, atomic swap

**Reviewed:** 2026-08-12 · **Scope:** all Phase 1 code in `server/` (21 source files, 15 test files)
**Mode:** local (repo is not under git — reviewed the full Phase 1 surface instead of a diff)
**Decision:** **APPROVE** — 1 HIGH and 3 MEDIUM findings were fixed and re-verified during the review; the rest are LOW notes.

## Summary

The pipeline is faithful to the feed: 0 orphan rows across every foreign-key
relationship, 0 missing derived values, and the built database answers the
plan's fixture queries. One real correctness defect was found by checking the
enrichment output against the real 28,964 stops rather than the 6-stop fixture:
the comune name fallback assigned two stops to a comune 98 km away. Fixed.

## Findings

### CRITICAL
None. No credentials, no user-controlled SQL (every query is parameterised or
built from a fixed table-name constant), no path traversal surface, no network
input that is trusted without validation.

### HIGH

**H1 — Name fallback attributed stops to a comune 98 km away** ·
`src/geo/comuni.ts:resolveByName` · **FIXED**

The fallback accepted any stop whose name *contained* a comune name, with no
check that the stop was anywhere near it. On the live feed this misassigned
`BIVIO PRATO` (43.4826 N, 12.1821 E — a junction near Monterchi) to **Prato**,
97.7 km away. Consequence: a comune→comune search for Prato would have offered a
run that never goes near Prato — a wrong answer presented as a correct one, in
the exact feature the fallback exists to serve.

*Fix:* a name match is now accepted only if the stop's coordinates fall within
the comune's bounding box expanded by ~5 km (`FALLBACK_BBOX_MARGIN_DEG`). Stops
with no coordinates still fall back on the name alone, since nothing else exists.

*Verified:* full re-import — the 2 bad rows are now NULL; the 4 remaining name
matches (Portoferraio, Monterchi ×2, Sansepolcro) are all 2–18 km from their
comune and all correct. Regression covered by a unit test and by a fixture stop
in the import integration test.

### MEDIUM

**M1 — Two imports could publish a corrupted database** · `src/feed/refresh.ts` · **FIXED**

The daily systemd timer and a manual `npm run import` both build
`data/gtfs.new.db` and rename it over the live file. Overlapping runs would
interleave writes into one staging file. Added `src/util/lock.ts`: an exclusive
pid lock held for the whole run, released in `finally`, with takeover of a lock
left by a crashed process (pid checked with signal 0).

**M2 — A truncated boundaries download would poison every future import** ·
`src/feed/refresh.ts` · **FIXED**

`comuni_toscana.geojson` is cached and reused forever once written. A partial
write would make every subsequent import fail at `JSON.parse` until someone
deleted the file by hand. The download is now validated through `loadComuni`
immediately, and deleted if unusable.

**M3 — Documented enrichment result was wrong** · `README.md`, `DoveBus-plan.md` · **FIXED**

I had reported the 242 unresolved stops as "cross-border nulls". Sampling shows
that is only mostly true: some are Tuscan coastal/island stops (e.g. `Cavo,
Punta Paffe` on Elba) sitting just outside the June-2023 polygon coastline.
Corrected in both documents. The stops stay NULL — honest, and improving them
means snapping to the nearest polygon, which is a deliberate change, not a fix.

**M4 — Misleading contract in a doc comment** · `src/gtfs/csv.ts` · **FIXED**

The comment claimed row arrays are reused between iterations and callers must
copy. `csv-parse` allocates a fresh array per record (verified empirically), so
the comment would have caused pointless defensive copying on 12M rows.

### LOW (not changed — flagging for your call)

- **L1** `src/feed/refresh.ts:refreshFeed` is 58 lines, just over the 50-line
  guideline. It is linear (download → decide → import → swap → report) and
  splitting it would add indirection without clarity. Left as is.
- **L2** ~~`src/cli/run.ts` uses a non-null assertion (`outcome.result!`)~~ —
  **FIXED** when Biome flagged the same line: `RefreshOutcome` is now a union
  discriminated on `imported`, so no import means no result, by construction.
- **L3** The boundaries file is never refreshed once cached, so an openpolis
  boundary update is only picked up if the file is deleted. Acceptable (June-2023
  vintage is already known and documented), but worth a note in the runbook.
- **L4** A live database that exists but is not valid SQLite makes `refresh`
  fail rather than rebuild. Loud failure is defensible; rebuilding would be
  friendlier.
- **L5** `stop_times.pickup_type` / `drop_off_type` are imported but not yet used
  — the origin→destination search should exclude `pickup_type = 1` (no boarding)
  when the API is built in Phase 2.

## Validation

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | **Pass** |
| Lint + format (Biome 2.5.8, added after this review) | **Pass** — `biome check` clean on 41 files. 49 lint findings fixed in the source (34 `useLiteralKeys`, 14 `noNonNullAssertion` incl. L2 below, 1 `useOptionalChain`); formatter set to 2-space / 100 cols to match the codebase, 19 files normalised |
| Tests (`vitest run`) | **Pass** — 107 tests, 15 files |
| Coverage | **Pass** — 96.97% statements / 84.87% branches / 100% functions (threshold 80%) |
| Build | N/A — run via `tsx`, no build step |
| Real-feed import + `verify` | **Pass** — 6/6 checks on the 125 MB live feed |

## Data-integrity checks run against the built database

| Check | Result |
|---|---|
| `stop_times` → missing stop / trip | 0 / 0 |
| `trips` → missing route / service / shape rows | 0 / 0 / 0 |
| `departure_time` present but `departure_s` NULL | 0 |
| `route_short_name` present but norm NULL | 0 |
| Stops without coordinates | 0 |
