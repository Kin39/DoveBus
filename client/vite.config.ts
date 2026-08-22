import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * The public origin, written once.
 *
 * `canonical`, Open Graph, the JSON-LD, `robots.txt` and `sitemap.xml` all have
 * to agree on the absolute address of every page — five places to get wrong by
 * hand. They are all fed from here instead, and `SITE_URL` overrides it so a
 * preview deploy can be built without editing a committed file.
 */
const SITE_URL = (process.env.SITE_URL ?? "https://dovebus.it").replace(/\/+$/, "");

/** Where an abuse or privacy request should land. Same reasoning as `SITE_URL`. */
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "ciao@dovebus.it";

/**
 * The day a page claims as its last change, written once and rendered twice.
 *
 * Both pages promise in prose that the date they show is the date of the last
 * change, and both repeat that day as `dateModified` in their JSON-LD. Two
 * hand-kept copies of one fact in one file is the CC-BY problem again at
 * smaller scale, so it gets the same answer: one constant, two substitutions.
 *
 * `/come-funziona/` shows a date for the reader before it shows one to Google.
 * That page carries **measured numbers** — the ~120 s cadence, the 96.6% join,
 * the ~3% of runs missing from the timetable — and a measurement without a date
 * beside it does not tell you whether you are reading yesterday or two years
 * ago. Declaring the date only in the markup would have been the exact fault
 * this audit spent its time removing from the FAQ: telling a crawler something
 * the page declines to tell a person.
 *
 * **Deliberately not `process.env` and deliberately not "today".** `SITE_URL`
 * is a deploy fact and belongs in the environment; these are editorial claims
 * about when a document changed. Stamping them at build time would make every
 * rebuild announce a revision that did not happen — a livelier lie than a stale
 * date, not a fix for one. Edit them here when the page changes.
 */
const UPDATED = {
  PRIVACY: "2026-08-22",
  COME_FUNZIONA: "2026-08-22",
} as const;

/** The same day in the prose's own register: `2026-08-22` → "22 agosto 2026". */
function inItalian(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/**
 * `%PRIVACY_UPDATED%` → the ISO day for `datetime` and `dateModified`;
 * `%PRIVACY_UPDATED_IT%` → the same day spelled out for the reader.
 */
const UPDATED_TOKENS: readonly (readonly [string, string])[] = Object.entries(UPDATED).flatMap(
  ([name, iso]) => [
    [`%${name}_UPDATED_IT%`, inItalian(iso)],
    [`%${name}_UPDATED%`, iso],
  ],
);

/**
 * Every indexable URL, in canonical form.
 *
 * Trailing slash throughout, including `/mappa/`: the pages are directories on
 * disk, so this is the form the host serves without a redirect, and it is the
 * form that stays true if the site ever moves off Netlify.
 */
const PAGES = [
  { path: "/", priority: "1.0" },
  { path: "/mappa/", priority: "0.9" },
  { path: "/come-funziona/", priority: "0.7" },
  { path: "/fonte-dati/", priority: "0.6" },
  { path: "/privacy/", priority: "0.4" },
] as const;

const PARTIALS_DIR = resolve(import.meta.dirname, "partials");
const PARTIAL_TOKEN = /<!--@partial:([a-z-]+)-->/g;

/**
 * Expands `<!--@partial:name-->` and substitutes the site constants.
 *
 * Two problems, one pass. The constants are here rather than in Vite's own
 * `%VITE_FOO%` mechanism because that reads from `.env`, which is gitignored —
 * a required build constant in an uncommitted file breaks the build for anyone
 * who clones the repo.
 *
 * The partials exist because four static pages otherwise carry four copies of
 * the same header and the same footer, and one of those copies is the **CC-BY
 * attribution**, which is a licence obligation. A licence line that drifts on
 * one page out of four is the failure mode worth a build step to prevent.
 * Partials expand before the constants are substituted, so a partial can use
 * them too.
 */
function siteConstants(): Plugin {
  return {
    name: "dovebus:site-constants",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        let expanded = html
          .replaceAll(PARTIAL_TOKEN, (_match, name: string) => {
            const file = resolve(PARTIALS_DIR, `${name}.html`);
            if (!file.startsWith(PARTIALS_DIR)) throw new Error(`partial escapes dir: ${name}`);
            try {
              return readFileSync(file, "utf8").trim();
            } catch {
              // Silently leaving the comment in place would ship a page with no
              // footer and no attribution, which is the thing this exists to
              // prevent — so a missing partial fails the build instead.
              throw new Error(`missing partial: partials/${name}.html`);
            }
          })
          .replaceAll("%SITE_URL%", SITE_URL)
          .replaceAll("%CONTACT_EMAIL%", CONTACT_EMAIL);
        // `_IT%` before `%`, so the longer token is never eaten by the shorter.
        for (const [token, value] of UPDATED_TOKENS) expanded = expanded.replaceAll(token, value);
        return expanded;
      },
    },
    /** Vite watches entry HTML, not the files it pulls in. Reload on both. */
    handleHotUpdate({ file, server }) {
      if (!file.startsWith(PARTIALS_DIR)) return;
      server.hot.send({ type: "full-reload" });
      return [];
    },
  };
}

/**
 * Emits `robots.txt` and `sitemap.xml` from `PAGES`.
 *
 * Generated rather than dropped in `public/` so a page added to the build
 * cannot silently fail to appear in the sitemap.
 *
 * **No `Disallow: /api/`** — the API is a separate origin (`VITE_API_BASE`) and
 * is not under this host at all, so the rule would forbid a path that does not
 * exist here while saying nothing about the path that does.
 */
function crawlerFiles(): Plugin {
  return {
    name: "dovebus:crawler-files",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      });

      const today = new Date().toISOString().slice(0, 10);
      const urls = PAGES.map(
        ({ path, priority }) =>
          `  <url>\n    <loc>${SITE_URL}${path}</loc>\n` +
          `    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n  </url>`,
      ).join("\n");

      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source:
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
    },
  };
}

/**
 * Port 5280 is fixed by the plan so it never collides with another project on
 * 5173, and `strictPort` makes a collision fail loudly instead of silently
 * hopping to 5281 — the screenshot loop and `VITE_API_BASE` both assume the
 * address they were told.
 */
export default defineConfig({
  plugins: [siteConstants(), crawlerFiles()],
  server: { port: 5280, strictPort: true },
  preview: { port: 5280, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      /**
       * Five entry points, each with its own bundle. The point of the split is
       * that **the four content pages must not import `maplibre-gl`** — the map
       * costs 1.1 MB of JS, and a visitor arriving cold from a search result
       * should not pay it to read a paragraph. Check it in the build output
       * rather than assuming it: only the `mappa` chunk may be large.
       */
      input: {
        landing: resolve(import.meta.dirname, "index.html"),
        mappa: resolve(import.meta.dirname, "mappa/index.html"),
        comeFunziona: resolve(import.meta.dirname, "come-funziona/index.html"),
        fonteDati: resolve(import.meta.dirname, "fonte-dati/index.html"),
        privacy: resolve(import.meta.dirname, "privacy/index.html"),
      },
    },
  },
});
