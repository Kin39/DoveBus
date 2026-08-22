import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

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
const SOURCE = pathToFileURL(fileURLToPath(new URL("og.html", import.meta.url))).href;
const OUTPUT = fileURLToPath(new URL("../public/og-image.png", import.meta.url));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(SOURCE, { waitUntil: "networkidle" });
  // The card is one webfont away from rendering in a fallback face, and a
  // fallback face silently ships a card set in the wrong type.
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUTPUT, type: "png" });
  console.log(`og-image.png written to ${OUTPUT}`);
} finally {
  await browser.close();
}
