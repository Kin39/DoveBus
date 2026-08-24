import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
// The headers the built site is served with, kept in their own module: they are
// a deploy artifact with rules of their own, and unlike the rest of this file
// they can be unit tested — which is where the three measurements behind them
// are written down as assertions rather than as comments alone.
import { deployHeadersFile } from "./deploy-headers";
// `canonical`, Open Graph, the JSON-LD, `robots.txt`, `sitemap.xml` and the
// domain printed inside the share card all have to name the same origin. It is
// resolved in one module so they cannot disagree — see `site-url.ts`.
import { SITE_URL } from "./site-url";

/**
 * Where an abuse or privacy request should land. Same reasoning as `SITE_URL`.
 *
 * The default is the address that actually receives mail, not a plausible one on
 * the site's own domain: `ciao@dovebus.it` was a placeholder and no mailbox was
 * ever created for it, so a build without the environment variable would have
 * published — in the footer, the privacy page and the `Organization` markup — an
 * address that silently swallows anything sent to it.
 */
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "dovebusapp@gmail.com";

/** The API base the client falls back to, mirrored from `src/api/client.ts`. */
const DEFAULT_API_BASE = "http://localhost:3200";

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

/** The same day in the reader's own register: `2026-08-22` → "22 agosto 2026". */
function spelledOut(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/**
 * `%PRIVACY_UPDATED%` → the ISO day for `datetime` and `dateModified`;
 * `%PRIVACY_UPDATED_TEXT%` → the same day spelled out, in the page's language.
 *
 * The spelled-out form is per language and the ISO form is not, which is the
 * whole reason this is built per page rather than once: a date is the same fact
 * in both documents and two different sentences.
 */
function updatedTokens(locale: string): readonly (readonly [string, string])[] {
  return Object.entries(UPDATED).flatMap(([name, iso]) => [
    [`%${name}_UPDATED_TEXT%`, spelledOut(iso, locale)],
    [`%${name}_UPDATED%`, iso],
  ]);
}

/** The two languages the site is published in, and how each writes a date. */
const LOCALE = { it: "it-IT", en: "en-GB" } as const;
type Language = keyof typeof LOCALE;

/**
 * Every indexable URL, as the pair of pages that say the same thing.
 *
 * Trailing slash throughout, including `/mappa/`: the pages are directories on
 * disk, so this is the form the host serves without a redirect, and it is the
 * form that stays true if the site ever moves off Netlify.
 *
 * One table, four consumers: the sitemap, the `hreflang` block on every page,
 * the assertion that a page's own `canonical` names the URL it is served at, and
 * the language switcher's "stay on this page" link. Those four disagreeing is
 * the classic way a bilingual site tells a crawler that two pages are
 * translations of each other and then links them to something else — so they are
 * not four lists.
 *
 * **English slugs are English**, not `/en/mappa/`. A prefix alone would have made
 * the pairing trivial to compute and left every English URL carrying an Italian
 * word to a reader who came looking for an English one.
 */
const PAGES = [
  { it: "/", en: "/en/", priority: "1.0" },
  { it: "/mappa/", en: "/en/map/", priority: "0.9" },
  { it: "/come-funziona/", en: "/en/how-it-works/", priority: "0.7" },
  { it: "/fonte-dati/", en: "/en/data-source/", priority: "0.6" },
  { it: "/privacy/", en: "/en/privacy/", priority: "0.4" },
] as const;

const CLIENT_ROOT = import.meta.dirname;

/** The URL path a source file is served at: `.../en/map/index.html` → `/en/map/`. */
function pagePathOf(filename: string): string {
  const relative = filename.slice(CLIENT_ROOT.length).replaceAll("\\", "/");
  return relative.replace(/index\.html$/, "").replace(/^\/?/, "/");
}

function languageOf(path: string): Language {
  return path.startsWith("/en/") ? "en" : "it";
}

/**
 * The reciprocal `hreflang` block for one page, plus `x-default`.
 *
 * `x-default` is the Italian page, and that is a statement rather than a
 * default: this is a map of Tuscan buses, the reader with no stated preference
 * is far more likely to be in Tuscany than not, and the English pages exist for
 * the visitor who chooses them.
 */
function hreflangFor(page: (typeof PAGES)[number]): string {
  return [
    `<link rel="alternate" hreflang="it" href="${SITE_URL}${page.it}" />`,
    `<link rel="alternate" hreflang="en" href="${SITE_URL}${page.en}" />`,
    `<link rel="alternate" hreflang="x-default" href="${SITE_URL}${page.it}" />`,
  ].join("\n    ");
}

/**
 * How each language names the other one, and calls the act of switching.
 *
 * The link is labelled in the language it leads to and carries `lang` to match,
 * so a screen reader pronounces "English" in English on an Italian page instead
 * of reading it as an Italian word. The sentence is the accessible name and
 * nothing else: a `title` carrying the same words is announced a second time as
 * the description, by some screen reader and browser pairs. That is also why the visible label is the
 * two-letter code: it is the one form that is legible at 320 px, inside a 44 px
 * round button on the map, and to a reader who does not read the page they are
 * currently on.
 */
const LANGSWITCH = {
  it: { code: "IT", label: "Leggi questa pagina in italiano" },
  en: { code: "EN", label: "Read this page in English" },
} as const;

/**
 * The link to the same page in the other language.
 *
 * The destination comes from `PAGES`, so it is always *this* page's twin and
 * never the home page — being thrown back to the top of the site is the usual
 * way a language switch loses the reader's place. Two languages means a toggle
 * rather than a menu: no dropdown, no focus trap, no script.
 *
 * It is markup rather than behaviour on purpose. The four content pages ship no
 * JavaScript at all, and the map page's switch has to work before its 1.1 MB
 * bundle has finished loading — a language control that needs the app to be
 * running is a control that is missing exactly when a lost reader reaches for it.
 */
function langswitchFor(page: (typeof PAGES)[number], language: Language, variant: string): string {
  const other: Language = language === "it" ? "en" : "it";
  const { code, label } = LANGSWITCH[other];
  const className = variant === "map" ? "mapctl__button langswitch" : "langswitch";
  return (
    `<a class="${className}" href="${page[other]}" lang="${other}" hreflang="${other}"` +
    ` aria-label="${label}">` +
    `<svg class="langswitch__globe" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<circle cx="12" cy="12" r="8.4" /><path d="M3.6 12h16.8M12 3.6c4.6 5 4.6 11.8 0 16.8` +
    `M12 3.6c-4.6 5-4.6 11.8 0 16.8" /></svg>` +
    `<span class="langswitch__code">${code}</span></a>`
  );
}

const PARTIALS_DIR = resolve(import.meta.dirname, "partials");
const PARTIAL_TOKEN = /<!--@partial:([a-z-]+)-->/g;
const HREFLANG_TOKEN = "<!--@hreflang-->";
const LANGSWITCH_TOKEN = /<!--@langswitch:(map|nav)-->/g;

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
      handler(html, ctx) {
        const path = pagePathOf(ctx.filename);
        const language = languageOf(path);
        const page = PAGES.find((candidate) => candidate[language] === path);

        let expanded = html
          .replaceAll(PARTIAL_TOKEN, (_match, name: string) => {
            // Each language has its own partials, and there is no falling back
            // to the other one: a missing English footer would otherwise ship an
            // English page carrying Italian chrome and an Italian licence line,
            // which is the failure this whole mechanism exists to prevent.
            const file = resolve(PARTIALS_DIR, language, `${name}.html`);
            if (!file.startsWith(PARTIALS_DIR)) throw new Error(`partial escapes dir: ${name}`);
            try {
              return readFileSync(file, "utf8").trim();
            } catch {
              throw new Error(`missing partial: partials/${language}/${name}.html`);
            }
          })
          .replaceAll("%SITE_URL%", SITE_URL)
          .replaceAll("%CONTACT_EMAIL%", CONTACT_EMAIL);

        // `_TEXT%` before `%`, so the longer token is never eaten by the shorter.
        for (const [token, value] of updatedTokens(LOCALE[language])) {
          expanded = expanded.replaceAll(token, value);
        }

        if (page) {
          expanded = expanded
            .replaceAll(HREFLANG_TOKEN, hreflangFor(page))
            .replaceAll(LANGSWITCH_TOKEN, (_match, variant: string) =>
              langswitchFor(page, language, variant),
            );
        }
        assertPairing(path, page, expanded);
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
 * Three things a bilingual page must get right, checked rather than remembered.
 *
 * A page in `PAGES` has to declare the `hreflang` pair — a translated page that
 * does not point at its twin is invisible as a translation — and its `canonical`
 * has to name the URL it is actually served at. Both are one careless copy away
 * from being wrong, and neither is visible on the rendered page: this is exactly
 * the class of fault that ships and sits there. A page *not* in `PAGES` (none
 * today) is left alone rather than guessed at.
 */
function assertPairing(path: string, page: (typeof PAGES)[number] | undefined, html: string): void {
  if (!page) return;
  if (html.includes(HREFLANG_TOKEN)) throw new Error(`hreflang left unexpanded: ${path}`);
  if (!html.includes('rel="alternate" hreflang="en"')) {
    throw new Error(`page declares no hreflang pair: ${path} — add <!--@hreflang--> to its head`);
  }
  // Every page with a twin says so to a social card as well as to a crawler.
  // This one was missed by hand on `/mappa/` alone — the one page that writes
  // its own head instead of pulling in the shared partial — and nothing failed,
  // which is the argument for checking it here rather than remembering it.
  if (!/og:locale:alternate/.test(html)) {
    throw new Error(`page declares no og:locale:alternate: ${path}`);
  }
  // A page a reader cannot leave in their own language is a page that has an
  // English twin and no way to reach it.
  if (!html.includes('langswitch"')) {
    throw new Error(`page offers no language switch: ${path} — add <!--@langswitch:nav-->`);
  }
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  if (canonical !== `${SITE_URL}${path}`) {
    throw new Error(`canonical is ${canonical ?? "missing"}, page is served at ${path}`);
  }
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

      // Both languages, each as its own URL: an alternate is a page in its own
      // right, and a sitemap listing only one half of every pair asks a crawler
      // to find the other half by luck.
      //
      // **No `<lastmod>`.** It used to be the build date, on every URL, on every
      // deploy — including the deploys that changed nothing on that page. That is
      // the opposite of what the field is for, and a sitemap whose `lastmod` is
      // always today is one a crawler learns to ignore. Omitting it says nothing;
      // stamping it said something false. Two pages carry an `UPDATED` constant
      // and three do not, so the honest per-page date does not exist to write.
      const urls = PAGES.flatMap((page) =>
        (["it", "en"] as const).map(
          (language) =>
            `  <url>\n    <loc>${SITE_URL}${page[language]}</loc>\n` +
            `    <priority>${page.priority}</priority>\n  </url>`,
        ),
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
 * Emits `client/dist/_headers`, and refuses to emit one that lies.
 *
 * Generated rather than committed because the CSP has to name the API's origin,
 * and that origin is a build input: a hand-written copy would be correct on the
 * machine it was written on and would block every request on the deploy that
 * moved the API. What the file *says* lives in `deploy-headers.ts`.
 */
function deployHeaders(apiOrigin: string): Plugin {
  return {
    name: "dovebus:deploy-headers",
    apply: "build",
    generateBundle(_options, bundle) {
      assertCspReachesTheApi(bundle, apiOrigin);
      this.emitFile({ type: "asset", fileName: "_headers", source: deployHeadersFile(apiOrigin) });
    },
  };
}

/**
 * The one failure this file cannot report on its own: a `connect-src` naming an
 * API the bundle does not call.
 *
 * The address is baked into the JavaScript at build time, and the header is
 * built beside it — from the same variable, but through a different code path.
 * If those two ever drift the site does not misbehave subtly: every request is
 * blocked and the map is empty. So the built code is read back and asked whether
 * the origin the header allows is the one it dials. §11.9's lesson, applied
 * before rather than after: an assertion that cannot fail proves nothing.
 */
function assertCspReachesTheApi(
  bundle: Record<string, { type: string; code?: string }>,
  apiOrigin: string,
): void {
  const callers = Object.values(bundle).filter(
    (chunk) => chunk.type === "chunk" && chunk.code?.includes("/api/vehicles"),
  );
  if (callers.length === 0) {
    throw new Error("no chunk calls /api/vehicles — connect-src cannot be checked against it");
  }
  for (const chunk of callers) {
    if (!chunk.code?.includes(apiOrigin)) {
      throw new Error(
        `connect-src allows ${apiOrigin}, but the built bundle calls somewhere else — ` +
          "set VITE_API_BASE for the build rather than only for the header",
      );
    }
  }
}

/**
 * Port 5280 is fixed by the plan so it never collides with another project on
 * 5173, and `strictPort` makes a collision fail loudly instead of silently
 * hopping to 5281 — the screenshot loop and `VITE_API_BASE` both assume the
 * address they were told.
 */
export default defineConfig(({ mode }) => {
  // `loadEnv`, not `process.env`: the bundle's API address comes from the `.env`
  // files Vite reads, so a header built from the shell's environment would name
  // an origin the code never calls — which is a CSP that blocks the whole app.
  const env = loadEnv(mode, CLIENT_ROOT, "VITE_");
  const apiOrigin = new URL(env.VITE_API_BASE ?? DEFAULT_API_BASE).origin;

  return {
    plugins: [siteConstants(), crawlerFiles(), deployHeaders(apiOrigin)],
    server: { port: 5280, strictPort: true },
    preview: { port: 5280, strictPort: true },
    build: {
      target: "es2022",
      /**
       * **Off.** `true` emitted `dist/assets/index-*.js.map` — 2,462,968 bytes of
       * original TypeScript, published beside the bundle it explains. Nothing
       * consumes them: there is no error tracking wired to this site, so the only
       * reader was whoever went looking. `"hidden"` is the setting to reach for the
       * day something does need them.
       */
      sourcemap: false,
      rollupOptions: {
        /**
         * Five entry points, each with its own bundle. The point of the split is
         * that **the four content pages must not import `maplibre-gl`** — the map
         * costs 1.1 MB of JS, and a visitor arriving cold from a search result
         * should not pay it to read a paragraph. Check it in the build output
         * rather than assuming it: only the `mappa` chunk may be large.
         */
        input: {
          landing: resolve(CLIENT_ROOT, "index.html"),
          mappa: resolve(CLIENT_ROOT, "mappa/index.html"),
          comeFunziona: resolve(CLIENT_ROOT, "come-funziona/index.html"),
          fonteDati: resolve(CLIENT_ROOT, "fonte-dati/index.html"),
          privacy: resolve(CLIENT_ROOT, "privacy/index.html"),
          enLanding: resolve(CLIENT_ROOT, "en/index.html"),
          enMap: resolve(CLIENT_ROOT, "en/map/index.html"),
          enHowItWorks: resolve(CLIENT_ROOT, "en/how-it-works/index.html"),
          enDataSource: resolve(CLIENT_ROOT, "en/data-source/index.html"),
          enPrivacy: resolve(CLIENT_ROOT, "en/privacy/index.html"),
        },
      },
    },
  };
});
