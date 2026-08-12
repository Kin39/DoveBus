import { normalizeName } from "../geo/normalize.js";
import { gtfsTimeToSeconds } from "./time.js";

export type CellValue = string | number | null;

export interface SourceColumn {
  /** Column in the GTFS `.txt` file. */
  readonly csv: string;
  /** Column in the SQLite table. */
  readonly db: string;
  readonly type: "text" | "int" | "real";
  /** Import fails if the file omits this column — it is an identity/join key. */
  readonly required?: boolean;
}

export interface DerivedColumn {
  readonly db: string;
  /** Source CSV column the value is computed from. */
  readonly from: string;
  readonly compute: (value: string) => CellValue;
}

export interface TableSpec {
  readonly file: string;
  readonly table: string;
  /** A missing required file aborts the import; optional files are skipped. */
  readonly required: boolean;
  readonly columns: readonly SourceColumn[];
  readonly derived: readonly DerivedColumn[];
}

const text = (csv: string, required = false): SourceColumn => ({
  csv,
  db: csv,
  type: "text",
  ...(required ? { required } : {}),
});
const int = (csv: string, required = false): SourceColumn => ({
  csv,
  db: csv,
  type: "int",
  ...(required ? { required } : {}),
});
const real = (csv: string, required = false): SourceColumn => ({
  csv,
  db: csv,
  type: "real",
  ...(required ? { required } : {}),
});

const normalized = (db: string, from: string): DerivedColumn => ({
  db,
  from,
  compute: (value) => (value === "" ? null : normalizeName(value)),
});

const seconds = (db: string, from: string): DerivedColumn => ({
  db,
  from,
  compute: (value) => gtfsTimeToSeconds(value),
});

/**
 * The import contract: which feed file lands in which table, with which columns.
 * Columns absent here are deliberately not imported (unused by the MVP and, on
 * the 5M-row files, not free).
 */
export const TABLE_SPECS: readonly TableSpec[] = [
  {
    file: "agency.txt",
    table: "agency",
    required: true,
    columns: [
      text("agency_id", true),
      text("agency_name"),
      text("agency_url"),
      text("agency_timezone"),
      text("agency_lang"),
      text("agency_phone"),
      int("agency_sort_order"),
    ],
    derived: [],
  },
  {
    file: "area.txt",
    table: "areas",
    required: false,
    columns: [text("area_id", true), text("area_name"), text("area_type"), int("area_sort_order")],
    derived: [],
  },
  {
    file: "stops.txt",
    table: "stops",
    required: true,
    columns: [
      text("stop_id", true),
      text("stop_code"),
      text("stop_name"),
      real("stop_lat"),
      real("stop_lon"),
      int("location_type"),
      text("parent_station"),
      int("wheelchair_boarding"),
      text("platform_code"),
      text("area_id"),
    ],
    derived: [normalized("stop_name_norm", "stop_name")],
  },
  {
    file: "routes.txt",
    table: "routes",
    required: true,
    columns: [
      text("route_id", true),
      text("agency_id"),
      text("route_short_name"),
      text("route_long_name"),
      int("route_type"),
      text("route_color"),
      text("route_text_color"),
      int("route_sort_order"),
    ],
    derived: [normalized("route_short_name_norm", "route_short_name")],
  },
  {
    file: "trips.txt",
    table: "trips",
    required: true,
    columns: [
      text("trip_id", true),
      text("route_id", true),
      text("service_id", true),
      text("trip_headsign"),
      text("trip_short_name"),
      int("direction_id"),
      text("block_id"),
      text("shape_id"),
      int("wheelchair_accessible"),
      int("bikes_allowed"),
    ],
    derived: [],
  },
  {
    file: "stop_times.txt",
    table: "stop_times",
    required: true,
    columns: [
      text("trip_id", true),
      int("stop_sequence", true),
      text("stop_id", true),
      text("arrival_time"),
      text("departure_time"),
      int("pickup_type"),
      int("drop_off_type"),
      real("shape_dist_traveled"),
    ],
    derived: [seconds("arrival_s", "arrival_time"), seconds("departure_s", "departure_time")],
  },
  {
    file: "calendar.txt",
    table: "calendar",
    required: true,
    columns: [
      text("service_id", true),
      int("monday"),
      int("tuesday"),
      int("wednesday"),
      int("thursday"),
      int("friday"),
      int("saturday"),
      int("sunday"),
      text("start_date"),
      text("end_date"),
    ],
    derived: [],
  },
  {
    file: "calendar_dates.txt",
    table: "calendar_dates",
    required: true,
    columns: [text("service_id", true), text("date", true), int("exception_type", true)],
    derived: [],
  },
  {
    file: "shapes.txt",
    table: "shapes",
    required: true,
    columns: [
      text("shape_id", true),
      int("shape_pt_sequence", true),
      real("shape_pt_lat", true),
      real("shape_pt_lon", true),
      real("shape_dist_traveled"),
    ],
    derived: [],
  },
];

export function specForFile(file: string): TableSpec | undefined {
  return TABLE_SPECS.find((spec) => spec.file === file);
}

export function insertStatementFor(spec: TableSpec): string {
  const names = [...spec.columns, ...spec.derived].map((column) => column.db);
  const placeholders = names.map(() => "?").join(", ");
  return `INSERT INTO ${spec.table} (${names.join(", ")}) VALUES (${placeholders})`;
}

/**
 * Binds a spec to one file's header, returning a mapper from raw CSV row to the
 * positional values of `insertStatementFor`. Column positions are resolved once
 * per file rather than per row — on `stop_times` that is 5M lookups saved.
 */
export function buildRowMapper(
  spec: TableSpec,
  header: readonly string[],
): (row: readonly string[]) => CellValue[] {
  const sourcePlan = spec.columns.map((column) => {
    const index = header.indexOf(column.csv);
    if (index === -1 && column.required === true) {
      throw new Error(`${spec.file}: required column "${column.csv}" is missing from the header`);
    }
    return { index, type: column.type };
  });

  const derivedPlan = spec.derived.map((column) => ({
    index: header.indexOf(column.from),
    compute: column.compute,
  }));

  const width = sourcePlan.length + derivedPlan.length;

  return (row) => {
    const values: CellValue[] = new Array<CellValue>(width);
    let position = 0;
    for (const { index, type } of sourcePlan) {
      values[position++] = index === -1 ? null : coerce(row[index], type);
    }
    for (const { index, compute } of derivedPlan) {
      const raw = index === -1 ? undefined : row[index];
      values[position++] = raw === undefined ? null : compute(raw);
    }
    return values;
  };
}

function coerce(raw: string | undefined, type: SourceColumn["type"]): CellValue {
  if (raw === undefined || raw === "") return null;
  if (type === "text") return raw;
  const parsed = type === "int" ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
