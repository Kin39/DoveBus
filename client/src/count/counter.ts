/**
 * What a pageview counter should send, and who should not be counted — as pure
 * functions over plain values. The half that touches a browser is `index.ts`.
 *
 * Split that way for two reasons. These are the two decisions worth testing, and
 * they are testable only if importing them starts nothing. And `PRIVATE_HOST`
 * below has a second reader — `scripts/headers-check.ts`, which must agree with
 * this file about what counts as somebody's own machine, and would import a
 * running counter if this module had one.
 *
 * **Why this is not GoatCounter's own `count.js`.** That file is ISC-licensed
 * and could have been vendored, but it reads `localStorage` on every page load
 * to check an opt-out flag, and writes to it when the URL ends in
 * `#toggle-goatcounter`. The privacy page promises "it does not use the
 * browser's local storage either: close the tab and nothing is left behind",
 * and a script that writes a key when someone follows a link with a fragment on
 * the end makes that promise false. Removing those four lines was possible;
 * rewriting the forty that remain — measured at 0.6 kB gzipped against 2.4 kB
 * for the trimmed original — was cheaper, testable with the rest of the suite,
 * and means every field on the wire is one this file chose to send.
 *
 * The wire format is GoatCounter's: a `GET /count` with query parameters. See
 * `handlers/count.go` upstream.
 *
 * **What is deliberately never sent** is the query string. Upstream sends it
 * twice — as `q`, and glued onto the path — and the path *is* stored, with only
 * known ad-tracking parameters stripped. Today no DoveBus URL carries a query
 * string: a search puts the line and the two comuni in the query of the *API*
 * request, and the address bar never changes. This file is what keeps that true
 * the day someone adds a shareable `?linea=14` link, because the path it sends
 * comes from the page's own `canonical` and is rejected outright if it carries
 * a `?` or a `#`.
 */

/**
 * Everything the counter needs to know about the page, as plain values.
 *
 * A structure rather than reaching for `document` and `navigator` inline, so
 * the two decisions worth checking — whether to count at all, and what to put
 * on the wire — are pure functions with tests, and the only untested part left
 * is the four lines that read the browser.
 */
export interface PageFacts {
  /** The `href` of `<link rel="canonical">`, or null when the page has none. */
  readonly canonical: string | null;
  readonly hostname: string;
  readonly protocol: string;
  readonly referrer: string;
  readonly title: string;
  readonly screenWidth: number;
  /** `document.visibilityState`. */
  readonly visibility: string;
  /** True when the page is not the top-level document. */
  readonly inFrame: boolean;
  /** True when the browser announces itself as automated. */
  readonly automated: boolean;
  /** `navigator.globalPrivacyControl`. */
  readonly privacyControl: boolean;
}

/**
 * Addresses that are somebody's own machine rather than the deployed site.
 *
 * Exported because `scripts/headers-check.ts` needs the same list: it demands a
 * beacon from every page when it runs against the deploy, and must not demand
 * one when it runs against an address this file refuses to count. Two hand-kept
 * copies of that list would disagree the first time one of them was extended,
 * and the check would fail for a reason that looks nothing like its cause.
 *
 * Taken from upstream's filter, and it earns its place here rather than being
 * trimmed: `192.168.` is how this project is checked from a phone — see the LAN
 * address in `client/.env` — and without this line every developer's afternoon
 * would land in the published numbers.
 */
export const PRIVATE_HOST =
  /(localhost$|^127\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\.|^192\.168\.|^0\.0\.0\.0$)/;

/**
 * The reason this pageview should not be counted, or null to count it.
 *
 * Returns the reason rather than a boolean so a failing test says which rule
 * fired, and so `countPageview` can put it in a console warning instead of
 * failing silently — a counter that quietly does nothing is indistinguishable
 * from a counter that is broken.
 */
export function reasonNotToCount(facts: PageFacts): string | null {
  // Global Privacy Control. Nothing here needs consent, so this is not a legal
  // obligation being discharged: it is the one signal a reader can send that
  // says "do not count me", and it replaces the `localStorage` opt-out this
  // file exists to remove. Honoured before anything else, so a reader who sends
  // it is not counted even on a page that would otherwise qualify.
  if (facts.privacyControl) return "global privacy control";
  if (facts.visibility === "prerender") return "prerendered, not read";
  if (facts.inFrame) return "framed";
  if (facts.protocol === "file:") return "opened from disk";
  if (PRIVATE_HOST.test(facts.hostname)) return "a private address, not the site";
  return null;
}

/**
 * The path to count, taken from the page's own `canonical`, or null.
 *
 * `canonical` rather than `location.pathname` for one reason: `assertPairing`
 * in `vite.config.ts` already fails the build if a page's `canonical` is not
 * the URL it is served at. So this reads a value that is checked, and reads it
 * from the one place in the page that cannot pick up a query string, a
 * fragment, or a tracking parameter along the way.
 *
 * Anything that is not a bare path is refused rather than cleaned up. Trimming
 * a query string off would work today and would be the wrong shape: it would
 * mean this function has an opinion about which parameters are safe to keep,
 * which is exactly the judgement upstream makes and gets wrong.
 */
export function countablePath(canonical: string | null): string | null {
  if (canonical === null || canonical === "") return null;
  let url: URL;
  try {
    url = new URL(canonical);
  } catch {
    return null;
  }
  if (url.search !== "" || url.hash !== "") return null;
  if (!url.pathname.startsWith("/")) return null;
  return url.pathname;
}

/**
 * The query string of the `GET /count`, or null when there is nothing to send.
 *
 * `rnd` is a cache-buster: browsers do not always honour the `Cache-Control` on
 * the response, and a cached counting request is a pageview that never arrives.
 *
 * The referrer is sent; the title is sent; the screen's width is sent. Those
 * three are what the dashboard shows, and the privacy page names all three.
 * Nothing else on `PageFacts` reaches the wire.
 */
export function pageviewQuery(facts: PageFacts, random: string): string | null {
  const path = countablePath(facts.canonical);
  if (path === null) return null;

  const parameters = new URLSearchParams();
  parameters.set("p", path);
  if (facts.title !== "") parameters.set("t", facts.title);
  if (facts.referrer !== "") parameters.set("r", facts.referrer);
  if (facts.screenWidth > 0) parameters.set("s", String(facts.screenWidth));
  // Upstream's four codes for a browser that says it is being driven. The
  // server keeps these out of every aggregate — see `cron/hit_count.go` — which
  // is what stops `npm run headers-check` from counting as seven readers.
  if (facts.automated) parameters.set("b", "153");
  parameters.set("rnd", random);
  return parameters.toString();
}
