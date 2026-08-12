import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";

/**
 * A miniature Autolinee Toscane feed with the same shape as the real one:
 * quoted stop names, all-zero calendar weekdays with activation via
 * calendar_dates, an after-midnight departure, and stops on both sides of the
 * regional border.
 */
export const FIXTURE_FILES = {
  "agency.txt": [
    "agency_id,agency_name,agency_url,agency_timezone,agency_lang,agency_phone,agency_fare_url,agency_email,agency_sort_order",
    'AT,"Autolinee Toscane",https://www.at-bus.it,Europe/Rome,it,,,,10',
  ].join("\n"),

  "area.txt": ["area_id,area_name,area_sort_order,area_type", "AR,Arezzo,1,province"].join("\n"),

  "stops.txt": [
    "stop_id,stop_code,stop_name,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station,stop_timezone,wheelchair_boarding,level_id,platform_code,area_id",
    "AR001,AR0001,AREZZO STAZIONE,43.4634,11.8766,,,0,,,,,,AR",
    'AR002,AR0943,"VIA DELLA CHIMERA, 87",43.4725,11.8743,,,0,,,,,,AR',
    "AN001,AR0500,ANGHIARI CENTRO,43.5417,12.0556,,,0,,,,,,AR",
    // Just outside the Anghiari polygon (border/coastline precision) — the name
    // fallback should still claim it.
    "XX001,AR0600,ANGHIARI PONTE,43.6200,12.0500,,,0,,,,,,AR",
    // Genuinely cross-border: no Tuscan comune, and no name match either.
    "EM001,BO0001,PORRETTA TERME,44.1600,11.0000,,,0,,,,,,AR",
    // Names a comune it is nowhere near (the live feed's "BIVIO PRATO" case):
    // must stay unresolved rather than being claimed by that comune.
    "FP001,AR0700,BIVIO AREZZO,44.9000,10.0000,,,0,,,,,,AR",
  ].join("\n"),

  "routes.txt": [
    "route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_color,route_text_color,route_sort_order",
    'R1,AT,SI381,"Arezzo - Anghiari",,3,15ac96,FFFFFF,30',
    'R2,AT,BAAS,"Arezzo - Anghiari via Ponte",,3,15ac96,FFFFFF,40',
  ].join("\n"),

  "trips.txt": [
    "route_id,service_id,trip_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id,wheelchair_accessible,bikes_allowed",
    'R1,S1,T1,"Anghiari",1101,0,,SH1,,',
    'R2,S1,T2,"Anghiari",1102,0,,SH2,,',
  ].join("\n"),

  "stop_times.txt": [
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint,shape_dist_traveled,stop_headsign,pickup_type,drop_off_type",
    "T1,06:30:00,06:30:00,AR001,1,1,0,,0,0",
    "T1,07:15:00,07:15:00,AN001,2,0,28500,,0,0",
    "T2,25:10:00,25:10:00,AR002,1,1,0,,0,0",
    "T2,25:50:00,25:50:00,AN001,2,0,29100,,0,0",
  ].join("\n"),

  "calendar.txt": [
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
    "S1,0,0,0,0,0,0,0,20260812,20260901",
    "S2,0,0,0,0,0,0,0,20260812,20260901",
  ].join("\n"),

  "calendar_dates.txt": [
    "service_id,date,exception_type",
    "S1,20260812,1",
    "S1,20260813,1",
    "S2,20260812,2",
  ].join("\n"),

  "shapes.txt": [
    "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled",
    "SH1,43.4634,11.8766,1,0",
    "SH1,43.5000,11.9500,2,12000",
    "SH1,43.5417,12.0556,3,28500",
    "SH2,43.4725,11.8743,1,0",
    "SH2,43.5417,12.0556,2,29100",
  ].join("\n"),

  "feed_info.txt": [
    "feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version,feed_contact_email,feed_contact_url,auto-feed_version",
    '"Autolinee Toscane",https://www.at-bus.it/,it,20260812,20260901,,,,',
  ].join("\n"),
};

/** A fixture file reduced to its header line — a feed with no data rows. */
export function fixtureHeaderOnly(file: keyof typeof FIXTURE_FILES): string {
  return FIXTURE_FILES[file].split("\n")[0] ?? "";
}

/** Squares around the fixture stops, mirroring the openpolis property names. */
export const FIXTURE_COMUNI = {
  type: "FeatureCollection",
  features: [
    comuneSquare("Arezzo", "051002", 11.8, 43.4, 11.95, 43.5),
    comuneSquare("Anghiari", "051001", 12.0, 43.5, 12.1, 43.6),
  ],
};

function comuneSquare(
  name: string,
  istat: string,
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
) {
  return {
    type: "Feature",
    properties: { name, com_istat_code: istat },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ],
      ],
    },
  };
}

export interface Fixture {
  readonly dir: string;
  readonly zipPath: string;
  readonly comuniPath: string;
}

/** Writes the fixture feed as a real zip so the importer runs its true code path. */
export async function createFixtureFeed(
  overrides: Readonly<Record<string, string | null>> = {},
): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "dovebus-fixture-"));
  await mkdir(dir, { recursive: true });

  const files: Record<string, string> = { ...FIXTURE_FILES };
  for (const [name, content] of Object.entries(overrides)) {
    if (content === null) delete files[name];
    else files[name] = content;
  }

  const zipPath = join(dir, "gtfs.zip");
  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(files)) {
    zip.addBuffer(Buffer.from(`${content}\n`, "utf8"), name);
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(zipPath));

  const comuniPath = join(dir, "comuni.geojson");
  await writeFile(comuniPath, JSON.stringify(FIXTURE_COMUNI), "utf8");

  return { dir, zipPath, comuniPath };
}
