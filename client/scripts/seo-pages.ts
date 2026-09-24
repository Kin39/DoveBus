/**
 * Writes the line, comune and index pages the build then compiles.
 *
 *   npm run seo-pages
 *
 * Two steps rather than one, and the seam is deliberate. `seo-data` in the
 * server workspace reads the 1.5 GB timetable and writes `seo/lines.json`;
 * this reads that committed file and writes HTML. Only the first needs the
 * database, so only the first cannot run on Netlify — which is why the build
 * runs this one and not that one, and why what Netlify publishes is built from
 * a file a person has read in a diff.
 *
 * The pages are written into `linea/`, `comune/` and `linee/` under the client
 * root, where Vite picks them up as ordinary entry points: they get the
 * partials, the site constants, the hashed stylesheet and — the point — the
 * same `assertPairing` check on their canonical as the hand-written pages. They
 * are gitignored, because they are derived from two files that are not.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readLineData, readPublishedList, SEO_DIRECTORIES } from "../seo/load.js";
import { assertEveryLineHasAParent, buildPages, missingFromData } from "../seo/pages.js";
import { renderPage } from "../seo/render.js";

const CLIENT_ROOT = resolve(import.meta.dirname, "..");

const data = readLineData();
const published = readPublishedList();

const retired = missingFromData(data, published);
const pages = buildPages(data, published);
assertEveryLineHasAParent(pages);

// Cleared rather than overwritten: a slug removed from the published list has
// to stop being built, and a stale file left behind would keep appearing in the
// output while having vanished from the sitemap — a page nothing links to and
// nothing lists, which is the worst of both.
for (const directory of SEO_DIRECTORIES) {
  rmSync(resolve(CLIENT_ROOT, directory), { recursive: true, force: true });
}

for (const page of pages) {
  const file = resolve(CLIENT_ROOT, `.${page.path}index.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderPage(page, data), "utf8");
}

const byKind = new Map<string, number>();
for (const page of pages) byKind.set(page.kind, (byKind.get(page.kind) ?? 0) + 1);

console.log(
  `seo-pages — ${pages.length} pagine: ` +
    [...byKind.entries()].map(([kind, count]) => `${count} ${kind}`).join(", "),
);
console.log(`  feed ${data.feed.startDate}–${data.feed.endDate}, giorno ${data.referenceDate}`);

if (retired.length > 0) {
  // Not a failure: a line can genuinely stop running. It is printed because the
  // page has just disappeared from the sitemap, and that is a decision — keep
  // it, or redirect it — rather than something to discover in Search Console
  // six weeks later.
  console.warn(
    `  ${retired.length} pagine pubblicate non sono più nei dati e non sono state generate:`,
  );
  for (const entry of retired) {
    console.warn(`    /linea/${entry.slug}/ (route ${entry.routeId}, linea ${entry.shortName})`);
  }
  console.warn("  decidi se ritirarle con un 301 o rimetterle nel feed prima di pubblicare.");
}
