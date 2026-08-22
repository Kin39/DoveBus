/*
 * The entry point for the landing page and the three trust pages.
 *
 * It has no behaviour, and that is deliberate: everything these pages do — the
 * FAQ that opens, the header that sticks, the ageing band that sweeps — is done
 * by HTML and CSS, so the pages are complete before any script runs and stay
 * complete if one never does. The file exists only so Vite has something to
 * hash the stylesheet and the font onto.
 *
 * **It must never import `maplibre-gl`, directly or transitively.** That is the
 * entire reason the build was split: the map is 1.1 MB of JavaScript, and a
 * visitor arriving cold from a search result should not download it to read a
 * paragraph. If this file ever grows an import from `../map/`, the split has
 * quietly stopped working.
 */

// The `wdth` build rather than the default `wght` one: the display type here is
// the wordmark's device at 5rem — a roman question against a condensed stamp —
// and the stamp is the width axis at 75%, not a second typeface.
import "@fontsource-variable/instrument-sans/wdth.css";
import "../styles/tokens.css";
import "../styles/brand.css";
import "../styles/site.css";
