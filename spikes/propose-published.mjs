/**
 * Proposes a published list from the generated candidates.
 *
 *   node spikes/propose-published.mjs > client/seo/published.json
 *
 * A proposal, not the thing itself: `client/seo/published.json` is hand-kept
 * and committed, because the address of a page is frozen at publication and the
 * rollout goes out in small groups. This exists so the first list did not have
 * to be typed by hand, and so a later widening can be drafted the same way and
 * then read in a diff before anything ships.
 *
 * Lines are grouped by comune, comuni ordered by how many lines they own, and
 * groups filled to roughly equal size — so a group is a coherent release ("the
 * Florence lines") rather than an arbitrary slice, and so the comune pages,
 * which are derived from whichever lines are published, come out whole rather
 * than half-populated.
 */
import { readFileSync } from "node:fs";

/** Roughly how many line pages go out at once. A young domain, staged on purpose. */
const GROUP_SIZE = 27;

/**
 * Candidates deliberately left out of the first rollout.
 *
 * Both are named after a place rather than numbered, which makes their address
 * read as a stutter — `/linea/certaldo-certaldo/` — and both are the only two
 * candidates whose shape does not yield a plausible length. Excluded by the
 * owner's decision on 2026-09-19, not by a rule.
 */
const EXCLUDED = new Set(["certaldo-certaldo", "montenero-livorno"]);

const data = JSON.parse(readFileSync("client/seo/lines.json", "utf8"));

/**
 * A line with no publishable route in either direction is left out.
 *
 * Its runs follow too many different itineraries for any one of them to stand
 * for the line — Prato's 207 spreads 24 of them over one direction, the busiest
 * touching 42 of the 252 stops it serves — so its page would have no route to
 * show. What would be left is two terminus names and a link to the map, which
 * is the thin page the whole anti-doorway argument promised not to publish.
 * They stay candidates in `lines.json` and come back when there is something
 * honest to put on them.
 */
function hasARoute(line) {
  return line.directions.some((direction) => direction.stops.length > 0);
}

const withoutRoute = [];
const byComune = new Map();
for (const line of data.lines) {
  if (EXCLUDED.has(line.slug)) continue;
  if (!hasARoute(line)) {
    withoutRoute.push(line.slug);
    continue;
  }
  const list = byComune.get(line.comune);
  if (list === undefined) byComune.set(line.comune, [line]);
  else list.push(line);
}

const comuni = [...byComune.entries()].sort(
  (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
);

const lines = [];
let group = 1;
let inGroup = 0;
for (const [, owned] of comuni) {
  // A comune is never split across groups: its page is built from whichever of
  // its lines are published, and half a comune would ship a hub missing half
  // its links and then quietly gain them a week later.
  if (inGroup > 0 && inGroup + owned.length > GROUP_SIZE) {
    group += 1;
    inGroup = 0;
  }
  for (const line of [...owned].sort((a, b) => b.trips - a.trips)) {
    lines.push({
      slug: line.slug,
      routeId: line.routeId,
      shortName: line.shortName,
      group,
    });
  }
  inGroup += owned.length;
}

// `released` starts at 1: the first batch, and only that one. Raising it is how
// a later batch goes live — a one-line diff, a deploy and an IndexNow ping.
process.stdout.write(`${JSON.stringify({ released: 1, lines }, null, 2)}\n`);

const counts = new Map();
for (const line of lines) counts.set(line.group, (counts.get(line.group) ?? 0) + 1);
process.stderr.write(
  `proposte ${lines.length} pagine-linea in ${counts.size} gruppi: ` +
    `${[...counts.entries()].map(([g, n]) => `gruppo ${g} = ${n}`).join(", ")}\n`,
);
process.stderr.write(`escluse a mano: ${[...EXCLUDED].join(", ")}\n`);
process.stderr.write(
  `escluse per mancanza di un percorso rappresentativo (${withoutRoute.length}): ${withoutRoute.join(", ")}\n`,
);
