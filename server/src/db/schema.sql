-- DoveBus static GTFS schema.
-- Columns are a deliberate subset of the feed: everything the MVP queries need
-- (search modes, live trip view, planned-route line) plus derived columns the
-- importer fills. Indexes live in indexes.sql and are created after bulk insert.

CREATE TABLE agency (
  agency_id         TEXT PRIMARY KEY,
  agency_name       TEXT NOT NULL,
  agency_url        TEXT,
  agency_timezone   TEXT,
  agency_lang       TEXT,
  agency_phone      TEXT,
  agency_sort_order INTEGER
);

-- Provinces, referenced by stops.area_id (AR, FI, ...).
CREATE TABLE areas (
  area_id         TEXT PRIMARY KEY,
  area_name       TEXT,
  area_type       TEXT,
  area_sort_order INTEGER
);

CREATE TABLE stops (
  stop_id             TEXT PRIMARY KEY,
  stop_code           TEXT,
  stop_name           TEXT,
  -- derived: accent-stripped uppercase, for stop search and the comune fallback
  stop_name_norm      TEXT,
  stop_lat            REAL,
  stop_lon            REAL,
  location_type       INTEGER,
  parent_station      TEXT,
  wheelchair_boarding INTEGER,
  platform_code       TEXT,
  area_id             TEXT,
  -- enriched at import (point-in-polygon, name fallback). NULL = outside Tuscany.
  comune              TEXT,
  comune_istat        TEXT,
  comune_source       TEXT
);

CREATE TABLE routes (
  route_id              TEXT PRIMARY KEY,
  agency_id             TEXT,
  route_short_name      TEXT,
  -- derived: for line autocomplete
  route_short_name_norm TEXT,
  route_long_name       TEXT,
  route_type            INTEGER,
  route_color           TEXT,
  route_text_color      TEXT,
  route_sort_order      INTEGER
);

CREATE TABLE trips (
  trip_id               TEXT PRIMARY KEY,
  route_id              TEXT NOT NULL,
  service_id            TEXT NOT NULL,
  trip_headsign         TEXT,
  trip_short_name       TEXT,
  direction_id          INTEGER,
  block_id              TEXT,
  shape_id              TEXT,
  wheelchair_accessible INTEGER,
  bikes_allowed         INTEGER
);

-- ~5M rows. arrival_s/departure_s are derived seconds-since-service-midnight:
-- GTFS times run past 24:00:00, which plain text comparison orders wrongly.
CREATE TABLE stop_times (
  trip_id             TEXT NOT NULL,
  stop_sequence       INTEGER NOT NULL,
  stop_id             TEXT NOT NULL,
  arrival_time        TEXT,
  departure_time      TEXT,
  arrival_s           INTEGER,
  departure_s         INTEGER,
  pickup_type         INTEGER,
  drop_off_type       INTEGER,
  shape_dist_traveled REAL
);

-- ~7M rows. Drives the mandatory planned-route line.
CREATE TABLE shapes (
  shape_id            TEXT NOT NULL,
  shape_pt_sequence   INTEGER NOT NULL,
  shape_pt_lat        REAL NOT NULL,
  shape_pt_lon        REAL NOT NULL,
  shape_dist_traveled REAL
);

-- This feed's weekday columns are ALL ZERO: calendar only carries the validity
-- window. Service activation comes from calendar_dates (see docs/PHASE0-FINDINGS).
CREATE TABLE calendar (
  service_id TEXT PRIMARY KEY,
  monday     INTEGER,
  tuesday    INTEGER,
  wednesday  INTEGER,
  thursday   INTEGER,
  friday     INTEGER,
  saturday   INTEGER,
  sunday     INTEGER,
  start_date TEXT,
  end_date   TEXT
);

-- Primary source of truth for "which services run on date D" in this feed.
-- exception_type: 1 = added, 2 = removed.
CREATE TABLE calendar_dates (
  service_id     TEXT NOT NULL,
  date           TEXT NOT NULL,
  exception_type INTEGER NOT NULL
);

-- Derived at import: one row per (comune, trip) the trip calls in, with the
-- span of stop sequences and departures it has there. The comune→comune search
-- reads this to find the few trips that can possibly match before it touches
-- stop_times, instead of reading every departure of every stop in comune A for
-- the whole feed — 1.1M rows for Firenze, to keep 7.7k trips that run that day.
-- It only prunes: the exact boarding/alighting stops are still computed from
-- stop_times, so the answer cannot differ from reading stop_times alone.
CREATE TABLE trip_comuni (
  comune_istat TEXT NOT NULL,
  trip_id      TEXT NOT NULL,
  min_seq      INTEGER NOT NULL,
  max_seq      INTEGER NOT NULL,
  -- NULL when no stop of the trip in this comune has a departure time.
  min_dep_s    INTEGER,
  max_dep_s    INTEGER,
  PRIMARY KEY (comune_istat, trip_id)
) WITHOUT ROWID;

-- Tuscan municipalities (openpolis R_9), drives comune autocomplete.
CREATE TABLE comuni (
  istat_code   TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  name_norm    TEXT NOT NULL,
  centroid_lat REAL,
  centroid_lon REAL
);

-- Single-row provenance record: what feed this database was built from.
CREATE TABLE feed_meta (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  feed_start_date TEXT,
  feed_end_date   TEXT,
  imported_at     TEXT NOT NULL,
  source_etag     TEXT,
  source_sha1     TEXT NOT NULL,
  source_bytes    INTEGER,
  db_version      INTEGER NOT NULL
);
