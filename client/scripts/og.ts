import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { SITE_HOST } from "../site-url";

/**
 * Renders `scripts/og.html` to `public/og-image.png` at exactly 1200×630.
 *
 * The card cannot be cropped from the existing icons — every one of them is
 * square (16/32/180/192/512) — so it has to be produced, and producing it from
 * HTML rather than in an image editor means the wording, the colours and the
 * band's thresholds stay editable and stay in sync with the site.
 *
 * `deviceScaleFactor` stays at 1 on purpose: 1200×630 are the dimensions the
 * `og:image:width` / `og:image:height` tags declare, and a 2× render would make
 * those tags lie about the file.
 */
const TEMPLATE = fileURLToPath(new URL("og.html", import.meta.url));

/**
 * The template is rendered through a transient sibling rather than through
 * `page.setContent()`.
 *
 * `og.html` pulls the variable font from `node_modules` by **relative** path,
 * and `setContent` resolves relative URLs against `about:blank` — the font
 * would 404 and the card would ship set in a fallback face, which is the exact
 * failure the `document.fonts.ready` wait below exists to prevent. A file in
 * the same directory resolves identically to the original. It is removed in
 * `finally`, and gitignored in case a crash gets there first.
 */
const STAGED = fileURLToPath(new URL(".og.staged.html", import.meta.url));
const OUTPUT = fileURLToPath(new URL("../public/og-image.png", import.meta.url));

const TOKEN = "%SITE_HOST%";

const template = await readFile(TEMPLATE, "utf8");
// A renamed token would silently rasterise the literal `%SITE_HOST%` into the
// card, and nobody re-reads a PNG. Fail here instead.
if (!template.includes(TOKEN)) throw new Error(`scripts/og.html no longer contains ${TOKEN}`);
await writeFile(STAGED, template.replaceAll(TOKEN, SITE_HOST), "utf8");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(STAGED).href, { waitUntil: "networkidle" });
  // The card is one webfont away from rendering in a fallback face, and a
  // fallback face silently ships a card set in the wrong type.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUTPUT, type: "png" });
  console.log(`og-image.png written to ${OUTPUT} (domain: ${SITE_HOST})`);
} finally {
  await browser.close();
  await rm(STAGED, { force: true });
}
