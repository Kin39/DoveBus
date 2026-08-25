/**
 * The pageview counter: one request per page load, to a GoatCounter running on
 * DoveBus' own VPS.
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
 * Where the counter lives, or nothing at all.
 *
 * Same reasoning as `VITE_API_BASE`: a deploy fact, read from the environment
 * at build time. Left unset — which is every build that is not the deploy — the
 * constant folds to `undefined`, the branch below is dead, and the whole module
 * is dropped by the bundler. That is not a hope: `assertCounterAgreesWithCsp`
 * in `vite.config.ts` reads the built chunks back and fails if a counter is in
 * the bundle when the header does not name it, or the other way round.
 */
const STATS_BASE: string | undefined = import.meta.env.VITE_STATS_BASE;

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
 * Taken from upstream's filter, and it earns its place here rather than being
 * trimmed: `192.168.` is how this project is checked from a phone — see the LAN
 * address in `client/.env` — and without this line every developer's afternoon
 * would land in the published numbers.
 */
const PRIVATE_HOST =
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

/** The four ways a browser admits to being driven, as upstream checks them. */
function looksAutomated(): boolean {
  const anyWindow = window as unknown as Record<string, unknown>;
  const anyDocument = document as unknown as Record<string, unknown>;
  if (anyWindow.callPhantom || anyWindow._phantom || anyWindow.phantom) return true;
  if (anyWindow.__nightmare) return true;
  if (anyDocument.__selenium_unwrapped || anyDocument.__webdriver_evaluate) return true;
  return navigator.webdriver === true;
}

/** The page, read once. The only function here that touches a global. */
function readPage(): PageFacts {
  return {
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null,
    hostname: location.hostname,
    protocol: location.protocol,
    referrer: document.referrer,
    title: document.title,
    screenWidth: window.screen?.width ?? 0,
    visibility: document.visibilityState,
    inFrame: window.location !== window.parent.location,
    automated: looksAutomated(),
    privacyControl: (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true,
  };
}

/**
 * Sends the request, by whichever of the two routes the CSP allows.
 *
 * `sendBeacon` first: it survives the page being closed, which a page someone
 * reads for four seconds at a bus stop very often is. It POSTs, so the header
 * that has to allow it is `connect-src`. When it is unavailable or refused the
 * fallback is a one-pixel image, which `img-src` allows instead — both origins
 * are in `deploy-headers.ts` for this reason, and dropping either would leave a
 * browser that silently never counts.
 */
function send(url: string): void {
  if (navigator.sendBeacon?.(url)) return;

  const pixel = new Image();
  pixel.src = url;
}

/**
 * Counts this page, once, when it is actually on screen.
 *
 * A page opened in a background tab is counted when the reader gets to it, not
 * when the browser fetched it — otherwise a restored session of nine tabs is
 * nine readers who read nothing.
 */
function countPageview(): void {
  const facts = readPage();

  const refusal = reasonNotToCount(facts);
  if (refusal !== null) return;

  const query = pageviewQuery(facts, Math.random().toString(36).slice(2, 7));
  if (query === null) {
    console.warn("This page has no countable canonical path — the pageview was not counted.");
    return;
  }

  send(`${STATS_BASE}/count?${query}`);
}

if (STATS_BASE) {
  if (document.visibilityState === "visible") {
    countPageview();
  } else {
    const whenVisible = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", whenVisible);
      countPageview();
    };
    document.addEventListener("visibilitychange", whenVisible);
  }
}
