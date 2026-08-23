import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { SITE_HOST } from "../site-url";
import { DICTIONARIES, type Language } from "../src/i18n/index.js";

/**
 * Renders `scripts/og.html` to one share card per language, at exactly 1200×630.
 *
 * The card cannot be cropped from the existing icons — every one of them is
 * square (16/32/180/192/512) — so it has to be produced, and producing it from
 * HTML rather than in an image editor means the wording, the colours and the
 * band's thresholds stay editable and stay in sync with the site.
 *
 * **One card per language, since the site became two.** The English pages spent
 * their first release pointing at the Italian card while their `og:image:alt`
 * described an English one — so every link shared to WhatsApp, Slack or
 * LinkedIn showed a reader who had chosen English a picture in Italian, and the
 * alt text translated something that had never been translated. The card is the
 * most-seen asset of a shared link and the only one nobody proof-reads, because
 * it is a picture.
 *
 * `deviceScaleFactor` stays at 1 on purpose: 1200×630 are the dimensions the
 * `og:image:width` / `og:image:height` tags declare, and a 2× render would make
 * those tags lie about the file.
 */
const TEMPLATE = fileURLToPath(new URL("og.html", import.meta.url));

/**
 * The two sentences that exist only on the card.
 *
 * The four freshness words are **not** here — they come from the dictionaries,
 * because they are also printed beside every bus on the map and the two must
 * never disagree. These two do not appear anywhere else in the product, so a
 * seventh copy of them is not a copy of anything: putting them in `Strings`
 * would ship build-time copy inside the runtime bundle and widen a type whose
 * stated job is "every word the interface says".
 */
const CARD: Readonly<Record<Language, { lead: string; answer: string; foot: string }>> = {
  it: {
    lead: "Non a che ora doveva passare il bus.",
    answer: "Dov'è adesso.",
    foot: "Ogni posizione ha un'età, ed è scritta accanto.",
  },
  en: {
    lead: "Not when the bus was due.",
    answer: "Where it is now.",
    foot: "Every position has an age, and it is written next to it.",
  },
};

/** Italian keeps the bare name; every later language is suffixed. */
function outputFor(language: Language): string {
  const name = language === "it" ? "og-image.png" : `og-image-${language}.png`;
  return fileURLToPath(new URL(`../public/${name}`, import.meta.url));
}

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

const template = await readFile(TEMPLATE, "utf8");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });

  for (const language of Object.keys(DICTIONARIES) as Language[]) {
    const { freshness } = DICTIONARIES[language];
    const card = CARD[language];
    const tokens: readonly (readonly [string, string])[] = [
      ["%CARD_LANG%", language],
      ["%CARD_LEAD%", card.lead],
      ["%CARD_ANSWER%", card.answer],
      ["%CARD_FOOT%", card.foot],
      ["%CARD_LIVE%", freshness.live],
      ["%CARD_RECENT%", freshness.recent],
      ["%CARD_DELAYED%", freshness.delayed],
      ["%CARD_STALE%", freshness.stale],
      ["%SITE_HOST%", SITE_HOST],
    ];

    let html = template;
    for (const [token, value] of tokens) {
      // A renamed token would silently rasterise the literal `%CARD_FOO%` into
      // the card, and nobody re-reads a PNG. Fail here instead.
      if (!html.includes(token)) throw new Error(`scripts/og.html no longer contains ${token}`);
      html = html.replaceAll(token, value);
    }
    await writeFile(STAGED, html, "utf8");

    const output = outputFor(language);
    await page.goto(pathToFileURL(STAGED).href, { waitUntil: "networkidle" });
    // The card is one webfont away from rendering in a fallback face, and a
    // fallback face silently ships a card set in the wrong type.
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: output, type: "png" });
    console.log(`${language}: ${output} (domain: ${SITE_HOST})`);
  }
} finally {
  await browser.close();
  await rm(STAGED, { force: true });
}
