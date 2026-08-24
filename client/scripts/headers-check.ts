/**
 * Loads every built page **through the deploy headers** and fails on anything
 * the Content-Security-Policy blocked.
 *
 *   npm run preview:headers   # in one shell
 *   npm run headers-check     # in another
 *
 * A CSP is the one piece of deploy config whose mistakes are invisible in the
 * build and total in production: a missing origin does not degrade the map, it
 * empties it. And it cannot be reviewed by reading, because what a page loads at
 * runtime — a worker made from a blob, a font, a style attribute, a tile server
 * the basemap falls back to — is not the list of origins written in the source.
 *
 * So the pages are driven, and the browser is asked what it refused. Every
 * `securitypolicyviolation` and every console error counts as a failure; the
 * map pages additionally have to have fetched tiles and called the API, since a
 * page that loaded nothing violates nothing.
 */
import { chromium } from "playwright";

const BASE = process.env.HEADERS_BASE ?? "http://localhost:5290";

/** One of each kind: the landing, the app, a content page, and both languages. */
const PAGES = [
  "/",
  "/mappa/",
  "/come-funziona/",
  "/fonte-dati/",
  "/privacy/",
  "/en/",
  "/en/map/",
] as const;

/** Long enough for the basemap to load its style, its tiles and one fleet poll. */
const MAP_SETTLE_MS = 6000;

interface PageOutcome {
  readonly path: string;
  readonly violations: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly tiles: number;
  readonly vehicleCalls: number;
}

async function visit(browser: Awaited<ReturnType<typeof chromium.launch>>, path: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];

  // Registered before the document runs, so a violation during load is caught:
  // by the time a test could ask, the console entry is all that would be left.
  await page.addInitScript(() => {
    const bucket: string[] = [];
    (window as unknown as { __violations: string[] }).__violations = bucket;
    document.addEventListener("securitypolicyviolation", (event) => {
      bucket.push(`${event.violatedDirective} <- ${event.blockedURI}`);
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const isMap = path.endsWith("/mappa/") || path.endsWith("/map/");
  if (isMap) {
    await page.waitForSelector(".maplibregl-canvas", { timeout: 15_000 });
    await page.waitForTimeout(MAP_SETTLE_MS);
  }

  const outcome: PageOutcome = {
    path,
    violations: await page.evaluate(
      () => (window as unknown as { __violations: string[] }).__violations,
    ),
    consoleErrors,
    tiles: await page.evaluate(
      () =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name.includes("openfreemap") || entry.name.includes("cartocdn"))
          .length,
    ),
    vehicleCalls: await page.evaluate(
      () =>
        performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/api/"))
          .length,
    ),
  };
  await context.close();
  return outcome;
}

const browser = await chromium.launch();
const outcomes: PageOutcome[] = [];
try {
  for (const path of PAGES) outcomes.push(await visit(browser, path));
} finally {
  await browser.close();
}

let failed = 0;
for (const outcome of outcomes) {
  const isMap = outcome.path.endsWith("/mappa/") || outcome.path.endsWith("/map/");
  const problems = [
    ...outcome.violations.map((violation) => `blocked: ${violation}`),
    ...outcome.consoleErrors.map((error) => `console: ${error}`),
    // A page that loaded nothing cannot have been blocked, so silence on the map
    // pages is not a pass — it is the check having measured nothing.
    ...(isMap && outcome.tiles === 0 ? ["the basemap loaded no tiles at all"] : []),
    ...(isMap && outcome.vehicleCalls === 0 ? ["the page never called the API"] : []),
  ];
  if (problems.length > 0) failed++;

  console.log(
    `${problems.length === 0 ? "ok  " : "FAIL"} ${outcome.path.padEnd(18)} ` +
      `tiles=${outcome.tiles} apiCalls=${outcome.vehicleCalls}`,
  );
  for (const problem of problems) console.log(`       ${problem}`);
}

console.log(
  failed === 0
    ? `\n${outcomes.length} pages served with the deploy headers: nothing blocked.`
    : `\n${failed} of ${outcomes.length} pages have problems.`,
);
process.exitCode = failed === 0 ? 0 : 1;
