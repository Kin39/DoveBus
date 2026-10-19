# Review — comune→comune search speed-up (trip_comuni)

**Date:** 2026-10-19 · **Reviewer:** ecc:code-reviewer agent (Claude Opus 5.5), plus the
equivalence runs below · **Verdict:** APPROVE, 0 CRITICAL / 0 HIGH, both MEDIUMs fixed before commit.

## Why

Measured in production: `GET /api/search/od?comuneA=Firenze&comuneB=Prato` took 6.8 s, and a
`/healthz` sent one second into it answered after 5.8 s — better-sqlite3 is synchronous, so the
single Node thread served nobody else meanwhile. Locally the cause was the first CTE: 1,144,491
`stop_times` rows read at Firenze's 1,351 stops across the whole feed, to keep the 7,736 trips
running that day.

## Change

A derived `trip_comuni` table (comune × trip → min/max stop_sequence, min/max departure_s),
built at import after the indexes. The search prunes with it first, then chooses the boarding and
alighting stops from `stop_times` exactly as before. `DB_VERSION` 1 → 2.

## Equivalence (old query vs new, JSON equality of the full result)

| Run | Cases | With rows | Truncated | Mismatches |
|---|---|---|---|---|
| Mixed: random/connected/same-comune pairs, 6 dates incl. weekend and out-of-feed, 5 window kinds, limits 5/200 | 219 | 71 | 12 | 0 |
| Same, 800 connected pairs | 869 | 290 | 29 | 0 |
| Dense: weekdays, all-day and 3 h windows, 1,500 connected pairs | 1,569 | 1,303 | 149 | 0 |
| Reviewer's own: 21 dates × 8 windows, limits 3/200 | 1,920 | 910 | 343 | 0 |
| Reviewer's boundaries: window edge at a trip's min/max departure ±1 s | 240 | 197 | — | 0 |

All on a copy of the 8 October database (248,028 trips, 6.68M stop_times).

## Speed (local, same database)

Firenze → Prato 1,746 ms → 31 ms; Arezzo → Anghiari 279 ms → 6 ms; worst case over 1,569 dense
cases 1,928 ms → 74 ms. `trip_comuni`: 444,249 rows, 15 MB, built in 4.7 s.

## Findings

- **MEDIUM — deploy order.** New code on a v1 database fails every OD search ("no such table")
  until the import lands. Fixed: `DEPLOY.md` now says import before restart, and why.
- **MEDIUM — no gate on the new table.** An empty `trip_comuni` would have passed the swap check
  and made every search answer "no direct runs"; `verify` checked a stand-in query instead of the
  real one. Fixed: `trip_comuni` is in `REQUIRED_NON_EMPTY_TABLES`; `verify` calls `searchOd`.
- **LOW — schema-version rebuild untested.** Fixed: `refresh.test.ts` now rebuilds an unchanged
  feed whose database carries an older `DB_VERSION`.
- **LOW — fixture rows have one stop per comune.** Not fixed in the import test; the new search
  tests (looping trip, NULL departure, same comune) cover the aggregation at the result level.
