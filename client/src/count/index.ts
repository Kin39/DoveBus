/**
 * The counter, as it runs in a page: read the browser once, decide, send once.
 *
 * Imported for its effect by `site/site.ts` and by `main.ts`. Everything worth
 * testing is in `counter.ts` next door; what is left here is the four lines that
 * touch a global and the one that puts a request on the wire.
 */

import { type PageFacts, pageviewQuery, reasonNotToCount } from "./counter.js";

/**
 * Where the counter lives, or nothing at all.
 *
 * Same reasoning as `VITE_API_BASE`: a deploy fact, read from the environment
 * at build time. Left unset — which is every build that is not the deploy — the
 * constant folds to `undefined`, the branch at the bottom is dead, and both this
 * module and `counter.ts` are dropped by the bundler. That is not a hope:
 * `assertCounterAgreesWithCsp` in `vite.config.ts` reads the built chunks back
 * and fails if a counter is in the bundle when the header does not name it, or
 * the other way round.
 */
const STATS_BASE: string | undefined = import.meta.env.VITE_STATS_BASE;

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

/**
 * Counting must never be able to take the page down with it.
 *
 * This module runs at import time and is the **first** import in `main.ts`, so
 * an exception here does not merely lose a pageview: ES modules propagate a
 * failed evaluation to everything that imported them, and the whole map is
 * behind that import. Measured rather than reasoned about — a `throw` planted
 * in `readPage` was enough to leave `/mappa/` with no canvas at all, while the
 * only thing actually broken was a visit counter.
 *
 * So a counter that cannot count says so and gets out of the way. This does not
 * hide anything: `headers-check.ts` fails a run on any console error, and a
 * `console.warn` here is one refusal away from the eye anyway.
 */
function countQuietly(): void {
  try {
    countPageview();
  } catch (error) {
    console.warn("The pageview counter failed and was skipped.", error);
  }
}

if (STATS_BASE) {
  if (document.visibilityState === "visible") {
    countQuietly();
  } else {
    const whenVisible = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", whenVisible);
      countQuietly();
    };
    document.addEventListener("visibilitychange", whenVisible);
  }
}
