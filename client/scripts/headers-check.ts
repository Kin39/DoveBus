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
 *
 * Two more things are asked of every page, both about the counter. It must have
 * counted — silence there is the same "measured nothing" fault as a map with no
 * tiles — and it must have left **nothing** in the browser: no cookie, no
 * `localStorage` key, no `sessionStorage` key. That last one is the privacy
 * page's plainest promise, and this is the only place it is checked by asking
 * the browser rather than by reading the source.
 */

/**
 * The two refusals that are the host's doing rather than a finding.
 *
 * Netlify injects a script into every page it serves — the heads-up display for
 * logged-in teammates — and that script tries to run inline code and to inject
 * an inline stylesheet. This CSP blocks both, which is the correct outcome: it
 * is a widget the page never asked for. Checked, not assumed — neither the
 * served HTML nor the local build contains an inline `<script>` or `<style>`, so
 * both arrive at runtime and both come from `/.netlify/scripts/hud`.
 *
 * Ignored by the **hash of each exact snippet**, not by "inline is fine". The
 * browser reports the hash it would need in order to allow it, so this allowlist
 * names two specific pieces of code: the day Netlify changes what it injects,
 * the hash changes and the check goes red again — which is what should happen,
 * because something new is being put into the pages.
 */
const NETLIFY_HUD_HASHES = [
  "sha256-mTJ4cJaTm2Gw95GeXEpZdvEEY9ybh6FZu1bwcNE7QlY=", // the inline script it runs
  "sha256-3y5TlF5zG6/2W5bLJcFMMnGWSDYZMPAJMXGh07elcnY=", // the inline style it injects
] as const;

/** Is this console line one of those two, and nothing else? */
function isNetlifyHud(text: string): boolean {
  return NETLIFY_HUD_HASHES.some((hash) => text.includes(hash));
}

import { chromium } from "playwright";
import { PRIVATE_HOST } from "../src/count/counter.js";

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
  /** Requests to the pageview counter, whichever route they took. */
  readonly beacons: number;
  /** Anything the page left behind in the browser. Must always be empty. */
  readonly storage: readonly string[];
}

/**
 * Is this run pointed at the deployed site, or at a build on this machine?
 *
 * It decides one assertion. The counter refuses to count a private address —
 * that is the rule that keeps an afternoon of development out of the published
 * numbers — so against a local preview no beacon is *supposed* to fire, and
 * demanding one would be demanding the counter misbehave. Against the real
 * host, silence means the CSP blocked it, and that must fail.
 *
 * The list comes from `PRIVATE_HOST` itself rather than being written out again
 * here. Two copies had already drifted: this one was missing the `172.16/12`
 * range, so a check run from a LAN on those addresses would have demanded a
 * beacon the counter is right to withhold, and failed with a message about the
 * CSP.
 */
const AGAINST_THE_DEPLOY = !PRIVATE_HOST.test(new URL(BASE).hostname);

/**
 * True when every inline thing this page was refused was the host's.
 *
 * Its own predicate so the exemption cannot quietly widen: the console errors it
 * reads have already had the two known hashes filtered out, so one *unexplained*
 * inline refusal left standing makes this false and the violations count again.
 */
function onlyTheHostWasRefusedInline(consoleErrors: readonly string[]): boolean {
  return consoleErrors.every((error) => !error.toLowerCase().includes("inline"));
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
    if (message.type() === "error" && !isNetlifyHud(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  // Counted at the network layer rather than from `performance`, because the
  // beacon is a POST and the fallback is an image: the two routes look nothing
  // alike to the page, and identical from here.
  let beacons = 0;
  page.on("request", (request) => {
    if (request.url().includes("/count?")) beacons++;
  });

  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const isMap = path.endsWith("/mappa/") || path.endsWith("/map/");
  if (isMap) {
    await page.waitForSelector(".maplibregl-canvas", { timeout: 15_000 });
    await page.waitForTimeout(MAP_SETTLE_MS);
  }

  const outcome: PageOutcome = {
    path,
    // The paired `securitypolicyviolation` event carries no hash, so the same two
    // refusals are recognised by what they blocked — inline, on a page whose only
    // unexplained inline refusals are none. The console lines above identify them.
    violations: (
      await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations)
    ).filter(
      (violation) =>
        !(
          (violation === "script-src <- inline" || violation === "style-src <- inline") &&
          onlyTheHostWasRefusedInline(consoleErrors)
        ),
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
    beacons,
    // The privacy page's flattest claim — "no cookies, and not the browser's
    // local storage either: close the tab and nothing is left behind" — asked
    // of the browser rather than of the source. It is the claim most likely to
    // be quietly falsified by a dependency, and the only one that can be
    // checked here for the cost of three lines.
    storage: await page.evaluate(() => {
      const left: string[] = [];
      if (document.cookie !== "") left.push(`cookie: ${document.cookie}`);
      for (const [name, store] of [
        ["localStorage", localStorage],
        ["sessionStorage", sessionStorage],
      ] as const) {
        for (let i = 0; i < store.length; i++) left.push(`${name}: ${store.key(i)}`);
      }
      return left;
    }),
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
    // Same reasoning one line up, for the counter: a page that counted nothing
    // has not proved the CSP allows counting, it has proved nothing at all.
    ...(AGAINST_THE_DEPLOY && outcome.beacons === 0 ? ["the page counted no pageview"] : []),
    ...outcome.storage.map((left) => `left behind in the browser — ${left}`),
  ];
  if (problems.length > 0) failed++;

  console.log(
    `${problems.length === 0 ? "ok  " : "FAIL"} ${outcome.path.padEnd(18)} ` +
      `tiles=${outcome.tiles} apiCalls=${outcome.vehicleCalls} counted=${outcome.beacons}`,
  );
  for (const problem of problems) console.log(`       ${problem}`);
}

console.log(
  failed === 0
    ? `\n${outcomes.length} pages served with the deploy headers: nothing blocked.`
    : `\n${failed} of ${outcomes.length} pages have problems.`,
);
process.exitCode = failed === 0 ? 0 : 1;
