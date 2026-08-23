import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type ConsoleMessage, chromium, type Page } from "playwright";

/**
 * The screenshot loop.
 *
 * The frontend is built by looking at it, not by building it and checking at the
 * end — so this is a committed script rather than ad-hoc tooling: the owner can
 * rerun the exact same check, and it survives into later phases.
 *
 * It shoots the *states*, not just the landing page, against the real API and
 * the real data — Tuscan comune names run long, a busy viewport is hundreds of
 * buses, and a delay badge can read "+139 min". Fixtures would hide exactly the
 * overflow this loop exists to catch.
 *
 *   npm run shots              every viewport, every state
 *   npm run shots -- 375x812   one viewport
 */

/** The map lives at `/mappa/`; `/` is the landing page, which this does not shoot. */
const APP_URL = process.env.SHOTS_URL ?? "http://localhost:5280/mappa/";
const OUT_DIR = resolve(import.meta.dirname, "../shots");

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** Every round, per the plan. 375×812 is the primary target. */
const VIEWPORTS: readonly Viewport[] = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x812", width: 375, height: 812 },
  { name: "393x852", width: 393, height: 852 },
  { name: "414x896", width: 414, height: 896 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
];

/** Assertions a screenshot cannot make, checked in the same run. */
interface Findings {
  readonly viewport: string;
  readonly state: string;
  readonly horizontalScroll: number;
  readonly smallTargets: readonly string[];
  readonly consoleErrors: readonly string[];
  /** Set when the state could not be driven to at all. */
  readonly unreachable?: string;
}

const SMALL_TARGET_LIMIT = 44;

async function main(): Promise<void> {
  const only = process.argv[2];
  const viewports = only ? VIEWPORTS.filter((v) => v.name === only) : VIEWPORTS;
  if (viewports.length === 0) {
    console.error(
      `unknown viewport "${only}" — try one of: ${VIEWPORTS.map((v) => v.name).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  // Italian throughout — though not, as this comment used to claim, because it
  // makes the native date and time controls render the way a Tuscan rider's
  // phone does. It never did: Chromium drew `01:45 PM` and `08/23/2026` under
  // `--lang=it-IT`, under `locale: "it-IT"`, and with `lang="it-IT"` on the
  // element, and the rounds shot that for weeks without anyone reading it. The
  // fields are ours now, for exactly that reason. The locale still decides the
  // number and date formatting the page's own code asks `Intl` for.
  const browser = await chromium.launch({ args: ["--lang=it-IT"] });
  const findings: Findings[] = [];

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        isMobile: viewport.width < 720,
        hasTouch: viewport.width < 720,
        locale: "it-IT",
        timezoneId: "Europe/Rome",
      });
      const page = await context.newPage();

      const consoleErrors: string[] = [];
      page.on("console", (message: ConsoleMessage) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(String(error)));

      for (const state of STATES) {
        consoleErrors.length = 0;
        await page.goto(APP_URL, { waitUntil: "networkidle" });
        await settle(page);

        // A state that cannot be reached is itself a finding — and the round
        // still has to photograph everything else, so it is recorded and the
        // shot is taken of whatever is on screen.
        let unreachable: string | null = null;
        try {
          await state.enter(page);
        } catch (error) {
          unreachable =
            error instanceof Error ? (error.message.split("\n")[0] ?? "failed") : String(error);
        }

        await page.screenshot({ path: resolve(OUT_DIR, `${viewport.name}--${state.name}.png`) });
        findings.push({
          viewport: viewport.name,
          state: state.name,
          ...(await audit(page)),
          consoleErrors: consoleErrors.filter(
            (text) => !(state.expectedConsole ?? []).some((pattern) => pattern.test(text)),
          ),
          ...(unreachable === null ? {} : { unreachable }),
        });
        process.stdout.write(
          `  ${viewport.name} · ${state.name}${unreachable ? "  ⚠ unreachable" : ""}\n`,
        );
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  await report(findings);
}

interface State {
  readonly name: string;
  enter(page: Page): Promise<void>;
  /**
   * Console noise this state is *supposed* to produce, so the round does not
   * report the app correctly handling a case as a defect. Anything not listed
   * here still fails the round.
   */
  readonly expectedConsole?: readonly RegExp[];
}

/** A dropped network is the point of the offline state, not a defect in it. */
const OFFLINE_NOISE = [/ERR_INTERNET_DISCONNECTED/i, /Failed to fetch/i];

/**
 * About one live bus in thirty carries a `trip_id` the published timetable does
 * not contain (extra service). The API answering 404 there is correct, and the
 * interface explains it rather than failing — so the 404 is expected traffic.
 */
const TRIP_NOT_PUBLISHED = [/status of 404/i];

/**
 * The states worth looking at. Most of the risk lives here rather than in the
 * first paint.
 */
const STATES: readonly State[] = [
  {
    name: "01-map",
    async enter(page) {
      await page.waitForTimeout(1200);
    },
  },
  {
    name: "02-search-full",
    async enter(page) {
      await openSheet(page);
    },
  },
  {
    name: "03-autocomplete",
    async enter(page) {
      await openSheet(page);
      await page.fill("#input-comune-a", "castel");
      await page.waitForSelector("#list-comune-a .combo__option", { timeout: 5000 });
      await page.waitForTimeout(250);
    },
  },
  {
    name: "04-tab-line",
    async enter(page) {
      await openSheet(page);
      await page.click('.tabs__tab[data-mode="line"]');
      await page.fill("#input-line", "SI3");
      await page.waitForSelector("#list-line .combo__option", { timeout: 5000 });
      await page.waitForTimeout(250);
    },
  },
  {
    name: "05-results",
    async enter(page) {
      await runOdSearch(page, "Arezzo", "Anghiari");
    },
  },
  {
    name: "06-results-long",
    async enter(page) {
      // A deliberately long-named pair: the overflow case the loop exists for.
      await runOdSearch(page, "Castelnuovo di Val di Cecina", "Pomarance");
    },
  },
  {
    name: "07-results-empty",
    async enter(page) {
      await runOdSearch(page, "Anghiari", "Capraia Isola");
    },
  },
  {
    name: "08-trip-live",
    expectedConsole: TRIP_NOT_PUBLISHED,
    async enter(page) {
      await followRunningBus(page);
      await page.waitForTimeout(1800);
    },
  },
  {
    name: "09-trip-scheduled",
    async enter(page) {
      await runOdSearch(page, "Arezzo", "Anghiari");
      await openTrip(page);
      await page.waitForTimeout(1200);
    },
  },
  {
    name: "10-trip-scrolled",
    expectedConsole: TRIP_NOT_PUBLISHED,
    async enter(page) {
      await followRunningBus(page);
      await openSheet(page);
      await page.evaluate(() => {
        document.querySelector("#sheet-scroll")?.scrollTo(0, 320);
      });
      await page.waitForTimeout(600);
    },
  },
  {
    name: "11-vehicle-callout",
    async enter(page) {
      await page.waitForTimeout(1500);
      await clickAnyVehicle(page);
      await page.waitForTimeout(900);
    },
  },
  {
    /**
     * One continuous session, no reload.
     *
     * Every other state starts from a fresh `goto`, which is exactly why this
     * round of the loop reported 72 clean shots over a button that died on the
     * *second* search: a control detached from the DOM mid-flow stayed disabled,
     * and nothing here ever performed two actions in a row. Playwright refuses
     * to click a disabled button, so the regression shows up as an unreachable
     * state rather than as a picture nobody reads carefully.
     */
    name: "12-journey",
    expectedConsole: TRIP_NOT_PUBLISHED,
    async enter(page) {
      await runOdSearch(page, "Arezzo", "Anghiari");
      await page.click("#results-back");
      await page.waitForSelector("#search-form", { timeout: 5_000 });

      await page.click('.tabs__tab[data-mode="line"]');
      await page.fill("#input-line", "11");
      await page.fill("#input-from", "00:00");
      await page.fill("#input-to", "23:59");
      // The click that used to be impossible.
      await page.click(".cta", { timeout: 5_000 });
      await page.waitForSelector(".triplist", { timeout: 15_000 });

      await openTrip(page);
      await page.click(".tripview .viewhead__back");
      await page.waitForSelector(".triplist", { timeout: 5_000 });
      await page.waitForTimeout(500);
    },
  },
  {
    name: "13-offline",
    expectedConsole: OFFLINE_NOISE,
    async enter(page) {
      await page.waitForTimeout(1200);
      // The rider-on-a-moving-bus case: the map must keep its last good fleet
      // and say plainly that it is no longer being confirmed.
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      await page.waitForTimeout(400);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(2500);
      await page.context().setOffline(false);
    },
  },
];

async function openSheet(page: Page): Promise<void> {
  // Desktop has no handle: the sheet is a fixed column there.
  const handle = page.locator("#sheet-handle");
  if (await handle.isVisible()) {
    await handle.click();
    await page.waitForTimeout(200);
    const detent = await page.getAttribute("#sheet", "data-detent");
    if (detent !== "full") {
      await handle.click();
      await page.waitForTimeout(200);
    }
  }
  await page.waitForTimeout(300);
}

async function runOdSearch(page: Page, from: string, to: string): Promise<void> {
  await openSheet(page);
  await page.fill("#input-comune-a", from);
  await page.fill("#input-comune-b", to);
  // Widen the window so the shot is about layout, not about the time of day.
  await page.fill("#input-from", "00:00");
  await page.fill("#input-to", "23:59");
  await page.click(".cta");
  await page.waitForSelector(".triplist", { timeout: 15_000 });
  await page.waitForTimeout(700);
}

async function openTrip(page: Page): Promise<void> {
  const target = page.locator(".trip__button").first();
  if ((await target.count()) === 0) return;
  await target.click();
  await page.waitForSelector(".tripview .status", { timeout: 15_000 });
}

/**
 * Opens the live view on a bus that is genuinely moving right now.
 *
 * Picking a row out of a timetable search would usually land on a run that has
 * already finished — and the live view is exactly where the freshness meter, the
 * trail and the delay badge live, so shooting the empty case every round would
 * miss the states this loop exists to check.
 */
async function followRunningBus(page: Page): Promise<void> {
  await clickAnyVehicle(page);
  const follow = page.locator(".callout .cta");

  if ((await follow.count()) > 0) {
    await follow.click();
    try {
      await page.waitForSelector(".tripview .status", { timeout: 8_000 });
      return;
    } catch {
      // The bus is real but its `trip_id` is not in the published timetable —
      // about one live run in thirty. Fall through to the timetable path.
    }
  }

  // Also the 05:00 case, and the quiet-corner case: no bus was tappable at all.
  await runOdSearch(page, "Arezzo", "Anghiari");
  await openTrip(page);
}

/**
 * Zooms to Florence — the densest viewport in the region at any hour — and taps
 * an actual marker.
 *
 * The tap point is resolved from the rendered layer rather than guessed at, so
 * the shot does not depend on where the buses happen to be today; only markers
 * carrying a `trip_id` are considered, since those are the ones a rider can
 * actually follow.
 */
async function clickAnyVehicle(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __map: { jumpTo(o: unknown): void } }).__map.jumpTo({
      center: [11.2558, 43.7696],
      zoom: 12.5,
    });
  });
  await page.waitForTimeout(2600);

  const point = await page.evaluate(() => {
    const map = (
      window as unknown as {
        __map: {
          queryRenderedFeatures(
            o: unknown,
          ): { properties: Record<string, unknown>; geometry: { coordinates: [number, number] } }[];
          project(c: [number, number]): { x: number; y: number };
        };
      }
    ).__map;

    // Keep clear of the top bar and the sheet, both of which sit over the map.
    const reachable = map
      .queryRenderedFeatures({ layers: ["vehicles-dot"] })
      .map((feature) => ({ feature, point: map.project(feature.geometry.coordinates) }))
      .filter(({ point }) => point.y > 110 && point.y < window.innerHeight * 0.55);

    const followable = reachable.find(({ feature }) => feature.properties.line) ?? reachable[0];
    return followable ? followable.point : null;
  });

  if (!point) return;
  await page.mouse.click(Math.round(point.x), Math.round(point.y));
  await page.waitForTimeout(700);
}

async function settle(page: Page): Promise<void> {
  await page.waitForSelector("#sheet", { timeout: 15_000 });
  await page.waitForTimeout(800);
}

/** The things a picture cannot tell you. */
async function audit(page: Page): Promise<Omit<Findings, "viewport" | "state" | "consoleErrors">> {
  return await page.evaluate((limit) => {
    const horizontalScroll = Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    const smallTargets: string[] = [];
    const interactive = document.querySelectorAll<HTMLElement>(
      "button:not([hidden]), a[href], input, [role='option']",
    );
    for (const node of interactive) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.width < limit || box.height < limit) {
        const id = node.id ? `#${node.id}` : node.className || node.tagName.toLowerCase();
        smallTargets.push(`${id} ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
    }
    return { horizontalScroll, smallTargets: [...new Set(smallTargets)] };
  }, SMALL_TARGET_LIMIT);
}

async function report(findings: readonly Findings[]): Promise<void> {
  const lines: string[] = ["# Screenshot round", ""];
  let problems = 0;

  for (const finding of findings) {
    const issues: string[] = [];
    if (finding.horizontalScroll > 0) {
      issues.push(`horizontal scroll: ${finding.horizontalScroll}px`);
    }
    if (finding.smallTargets.length > 0) {
      issues.push(`targets under ${SMALL_TARGET_LIMIT}px: ${finding.smallTargets.join(", ")}`);
    }
    if (finding.consoleErrors.length > 0) {
      issues.push(`console: ${finding.consoleErrors.join(" | ")}`);
    }
    if (finding.unreachable) issues.push(`state unreachable: ${finding.unreachable}`);
    if (issues.length === 0) continue;
    problems += issues.length;
    lines.push(`## ${finding.viewport} · ${finding.state}`, ...issues.map((i) => `- ${i}`), "");
  }

  if (problems === 0) lines.push("No findings. Clean round.");
  const text = lines.join("\n");
  await writeFile(resolve(OUT_DIR, "REPORT.md"), `${text}\n`, "utf8");

  console.log(`\n${text}\n`);
  console.log(`${findings.length} shots → ${OUT_DIR}`);
  if (problems > 0) process.exitCode = 1;
}

await main();
