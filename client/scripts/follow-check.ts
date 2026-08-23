import { type ConsoleMessage, chromium, type Page } from "playwright";

/**
 * The following check.
 *
 * A rider who has opened a trip and zoomed in on their bus must keep seeing it,
 * and the stops list under the live readout must not move while they read it.
 * Neither of those is visible in a screenshot — the first is a gap of seconds
 * between two frames, the second is a jump that happens roughly every nine — so
 * they get a script that watches instead of a shot that samples.
 *
 * It runs against the real API and the real feed, like `shots.ts`: the failure
 * this exists to catch was caused by the difference between where a bus last
 * *reported* and where its marker is *drawn*, and a fixture has no such
 * difference in it.
 *
 *   npm run follow-check
 *
 * Exits 1 on a regression. If no bus anywhere in Tuscany is currently running a
 * trip the timetable knows about — which happens at night — it says so and exits
 * 0: there is nothing to follow, and that is not the frontend's fault.
 */

const APP_URL = process.env.FOLLOW_CHECK_URL ?? "http://localhost:5280/mappa/";
const API_BASE = process.env.API_BASE ?? "http://localhost:3200";

/** Zoom at which the viewport (~1.4 km) is narrower than a two-minute advance. */
const ZOOM = 16;

/** Long enough to span at least two fleet refreshes, which run every 30 s. */
const WATCH_MS = 80_000;
const SAMPLE_MS = 1_000;

/** A list that moves by more than this under a reader has moved. */
const STILLNESS_TOLERANCE_PX = 1;

interface Sample {
  readonly followedDrawn: boolean;
  readonly stopsTop: number;
}

/** As much of MapLibre as this script touches through `window.__map`. */
interface MapHandle {
  isStyleLoaded(): boolean;
  getSource(id: string): object | undefined;
  queryRenderedFeatures(options: { layers: string[] }): {
    properties: Record<string, unknown> | null;
  }[];
  jumpTo(options: { center: [number, number]; zoom: number }): void;
}

interface DevWindow {
  __map: MapHandle;
  __drawn?: GeoJSON.FeatureCollection;
}

async function main(): Promise<void> {
  const target = await findFollowableLine();
  if (!target) {
    console.log("SKIPPED — no live trip currently matches the loaded timetable.");
    return;
  }
  console.log(`Following line ${target.line} (trip ${target.tripId})`);

  const browser = await chromium.launch({ args: ["--lang=it-IT"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "it-IT",
    timezoneId: "Europe/Rome",
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  try {
    const opened = await openRunningTrip(page, target.line);
    if (!opened) {
      console.log(`SKIPPED — line ${target.line} listed no running trip in the app.`);
      return;
    }

    const key = await watchTheDrawnFleet(page);
    if (!key) {
      console.error("FAIL — the trip opened but no bus is marked as followed.");
      process.exitCode = 1;
      return;
    }

    await zoomOnto(page, key);
    const samples = await watch(page, key);
    report(samples, consoleErrors);
  } finally {
    await browser.close();
  }
}

/** A live bus whose trip the loaded timetable actually describes. */
async function findFollowableLine(): Promise<{ line: string; tripId: string } | null> {
  const response = await fetch(`${API_BASE}/api/vehicles?bbox=9.5,42.2,12.5,44.5`);
  const body = (await response.json()) as {
    data?: { vehicles?: { tripId: string | null; line: string | null }[] };
  };
  const candidates = (body.data?.vehicles ?? []).filter((v) => v.tripId && v.line);

  const date = new Date();
  const serviceDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;

  // About one live bus in eight carries a `trip_id` the published timetable does
  // not contain, and those cannot be opened at all — so the line is chosen by
  // asking, not by hoping.
  for (const candidate of candidates.slice(0, 40)) {
    const trip = await fetch(
      `${API_BASE}/api/trip/${encodeURIComponent(candidate.tripId ?? "")}?date=${serviceDate}`,
    );
    if (trip.ok) return { line: candidate.line ?? "", tripId: candidate.tripId ?? "" };
  }
  return null;
}

/** Drives the search the way a rider would, and opens the run marked "in viaggio". */
async function openRunningTrip(page: Page, line: string): Promise<boolean> {
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => (window as unknown as { __map?: MapHandle }).__map?.isStyleLoaded(),
    null,
    { timeout: 20_000 },
  );
  // The fleet has to land before the list can flag anything as running.
  await page.waitForTimeout(2_500);

  await page.click('.tabs__tab[data-mode="line"]');
  await page.fill("#input-line", line);
  await page.fill("#input-from", "05:00");
  await page.fill("#input-to", "23:59");
  await page.click(".cta");
  await page.waitForSelector("#results-list li", { timeout: 15_000 });

  const running = page.locator("#results-list li.trip", { has: page.locator(".trip__live") });
  if ((await running.count()) === 0) return false;

  await running.first().locator("button").click();
  await page.waitForSelector(".tripview .stops__list li");
  await page.waitForTimeout(2_000);
  return true;
}

/**
 * Taps the source the vehicle layer writes to, and returns the followed key.
 *
 * Reading the drawn feature collection rather than the rendered frame is the
 * whole point: a marker outside the viewport is legitimately not rendered, while
 * a marker missing from the collection has been *deleted*, which is the defect.
 */
async function watchTheDrawnFleet(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const dev = window as unknown as DevWindow;
    const source = dev.__map.getSource("vehicles") as
      | { setData: (data: GeoJSON.FeatureCollection) => unknown }
      | undefined;
    if (!source) return null;

    const original = source.setData.bind(source);
    source.setData = (data: GeoJSON.FeatureCollection) => {
      dev.__drawn = data;
      return original(data);
    };
    const drawn = dev.__map.queryRenderedFeatures({ layers: ["vehicles-dot"] });
    const followed = drawn.find((feature) => feature.properties?.selected === true);
    return (followed?.properties?.key as string | undefined) ?? null;
  });
}

/** Centres the map on the followed marker at the zoom the defect lived at. */
async function zoomOnto(page: Page, key: string): Promise<void> {
  await page.waitForTimeout(600);
  await page.evaluate(
    ({ followedKey, zoom }) => {
      const dev = window as unknown as DevWindow;
      const feature = dev.__drawn?.features.find(
        (candidate) => candidate.properties?.key === followedKey,
      );
      if (feature?.geometry.type === "Point") {
        dev.__map.jumpTo({
          center: feature.geometry.coordinates as [number, number],
          zoom,
        });
      }
    },
    { followedKey: key, zoom: ZOOM },
  );
  await page.waitForTimeout(1_500);
}

async function watch(page: Page, key: string): Promise<Sample[]> {
  const samples: Sample[] = [];
  const until = Date.now() + WATCH_MS;

  while (Date.now() < until) {
    samples.push(
      await page.evaluate((followedKey) => {
        const drawn = (window as unknown as DevWindow).__drawn;
        const stops = document.querySelector(".stops");
        return {
          followedDrawn: (drawn?.features ?? []).some(
            (feature) => feature.properties?.key === followedKey,
          ),
          stopsTop: stops ? Math.round(stops.getBoundingClientRect().top * 10) / 10 : 0,
        };
      }, key),
    );
    await page.waitForTimeout(SAMPLE_MS);
  }
  return samples;
}

function report(samples: readonly Sample[], consoleErrors: readonly string[]): void {
  const lost = samples.filter((sample) => !sample.followedDrawn).length;
  const tops = samples.map((sample) => sample.stopsTop);
  const drift = Math.max(...tops) - Math.min(...tops);

  console.log(`  followed bus drawn in ${samples.length - lost}/${samples.length} samples`);
  console.log(`  stops list moved ${drift.toFixed(1)} px over ${samples.length} samples`);
  for (const error of consoleErrors) console.log(`  console error: ${error}`);

  const failures: string[] = [];
  if (lost > 0) failures.push(`the followed bus left the map ${lost} time(s)`);
  if (drift > STILLNESS_TOLERANCE_PX) failures.push(`the stops list moved ${drift.toFixed(1)} px`);
  if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} console error(s)`);

  if (failures.length === 0) {
    console.log("PASS");
    return;
  }
  console.error(`FAIL — ${failures.join("; ")}`);
  process.exitCode = 1;
}

await main();
