/**
 * The response headers Netlify serves the built site with — `client/dist/_headers`.
 *
 * Its own module, next to `site-url.ts` and for the same kind of reason: this is
 * a deploy artifact with rules of its own, and the build config is not the place
 * to reason about them. Being a plain function of the API's origin also makes it
 * the one part of the build that can be **unit tested**, which is where the
 * measurements behind three of these directives are written down as assertions
 * rather than only as comments.
 *
 * The origins listed are the ones the code actually loads: the vector basemap,
 * its raster fallback, the API, and — on the deploy alone — the pageview
 * counter. Nothing else is fetched at runtime; the fonts are bundled, and
 * `dati.toscana.it` and `openstreetmap.org` are links a reader follows, not
 * resources a page loads.
 */

/** Everything the map loads from somewhere that is not this origin. */
export const TILE_ORIGINS = [
  "https://tiles.openfreemap.org",
  "https://a.basemaps.cartocdn.com",
  "https://b.basemaps.cartocdn.com",
  "https://c.basemaps.cartocdn.com",
] as const;

/**
 * The Content-Security-Policy, for a site whose API lives at `apiOrigin` and
 * whose pageview counter, if it has one, lives at `statsOrigin`.
 *
 * Three of these are here because a browser said so, not because a document
 * recommended them — see `scripts/headers-check.ts`, which drives every built
 * page through the real header and fails on anything blocked.
 *
 * `statsOrigin` is optional and its absence is the normal case: only the deploy
 * sets `VITE_STATS_BASE`. When it is absent the counter is not in the bundle
 * either, and `assertCounterAgreesWithCsp` fails the build if those two ever
 * disagree — a header naming a counter that was tree-shaken away, or a counter
 * shipped to a page whose header will block it.
 */
export function contentSecurityPolicy(apiOrigin: string, statsOrigin?: string): string {
  // Two directives, not one. The counter sends its pageview with
  // `navigator.sendBeacon`, which is a POST and so needs `connect-src`, and
  // falls back to a one-pixel `Image` when the beacon is unavailable or
  // refused, which needs `img-src`. Allowing only the first would leave every
  // browser without `sendBeacon` silently uncounted — the failure mode that
  // looks exactly like nobody visiting.
  const stats = statsOrigin === undefined ? "" : ` ${statsOrigin}`;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    // The landing page sets a `--w` custom property per freshness band segment,
    // which is a style *attribute*. Measured by removing it: the band renders at
    // zero width. Allowed on its own rather than by opening `style-src`, so an
    // injected `<style>` block still has nowhere to land.
    "style-src-attr 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob: ${TILE_ORIGINS.join(" ")}${stats}`,
    `connect-src 'self' ${apiOrigin} ${TILE_ORIGINS.join(" ")}${stats}`,
    // MapLibre decodes tiles off the main thread in a worker it creates from a
    // blob. Without this the map does not draw at all.
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Only when the API is already `https`, which a deployed one always is.
    //
    // Measured, not assumed: with a build pointed at an `http` API on the LAN —
    // how the site is checked from a phone — this directive upgraded the request
    // to `https` and `connect-src` then blocked it, because a private address is
    // not "potentially trustworthy" the way `localhost` is. Emitting it
    // unconditionally would have made the deploy artifact impossible to verify
    // locally *and* would have been the CSP's only failure mode nobody could see
    // until it was live. A build aimed at an `http` API is not a deploy.
    ...(apiOrigin.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** The whole file, in Netlify's form: a path pattern, then indented headers. */
export function deployHeadersFile(apiOrigin: string, statsOrigin?: string): string {
  return [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  X-Frame-Options: DENY",
    // Nothing here asks for a sensor, a camera or a location — §11.4 removed the
    // one control that implied otherwise — so every one of them is denied.
    "  Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()",
    "  Strict-Transport-Security: max-age=31536000; includeSubDomains",
    `  Content-Security-Policy: ${contentSecurityPolicy(apiOrigin, statsOrigin)}`,
    "",
    // Hashed filenames: the content cannot change without the name changing, so
    // a year is not a risk, it is the point of the hash.
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n");
}
