-- Created after bulk insert: building these up front would slow the import by
-- an order of magnitude on the ~12M rows of stop_times + shapes.

-- Origin→destination search: stops of comune A, filtered by departure window.
CREATE INDEX idx_stop_times_stop_dep ON stop_times (stop_id, departure_s);
-- Trip timetable and the self-join partner lookup.
CREATE UNIQUE INDEX idx_stop_times_trip_seq ON stop_times (trip_id, stop_sequence);

-- Planned-route polyline for a trip.
CREATE UNIQUE INDEX idx_shapes_pt ON shapes (shape_id, shape_pt_sequence);

CREATE INDEX idx_trips_route ON trips (route_id);
CREATE INDEX idx_trips_service ON trips (service_id);
CREATE INDEX idx_trips_shape ON trips (shape_id);

CREATE INDEX idx_routes_short_name ON routes (route_short_name_norm);

CREATE INDEX idx_stops_comune ON stops (comune_istat);
CREATE INDEX idx_stops_name_norm ON stops (stop_name_norm);

-- Date resolution: "services active on D" reads (date, exception_type) first.
CREATE INDEX idx_calendar_dates_date ON calendar_dates (date, exception_type);
CREATE UNIQUE INDEX idx_calendar_dates_service_date ON calendar_dates (service_id, date);

CREATE INDEX idx_comuni_name_norm ON comuni (name_norm);
