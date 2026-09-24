/**
 * The search, carried in the address bar.
 *
 * Until now the map kept its whole state in memory: every search, by line or
 * between two comuni, lived at `/mappa/` and left no trace anyone could send to
 * anyone else. That is two problems at once. A rider could not share "the 32
 * right now" with a colleague, and the line pages have nowhere to point — their
 * whole reason to exist is the link that says *dov'è adesso*, and a link that
 * lands on an empty map and asks the reader to type the search again is not
 * that link.
 *
 * So one vocabulary, four parameters:
 *
 *   /mappa/?linea=32&comune=firenze     the runs of a line, in one comune
 *   /mappa/?da=arezzo&a=anghiari        direct runs between two comuni
 *
 * **Italian names on both languages' map pages.** `/en/map/` accepts `linea`
 * too rather than growing an English twin: these are identifiers in a link, not
 * prose a reader is asked to understand, and a second vocabulary would double
 * the parser, the tests, and the ways a shared link can arrive at a page that
 * does not recognise it.
 *
 * **The comune is part of the question, not decoration.** A search for "32"
 * against the live API today comes back with 22 runs of Florence's *piazzale
 * Montelungo – Antella* and 7 of *Montespertoli – Empoli*, in one list, because
 * `/search/line` matches on the line's name and the feed reuses numbers across
 * the region — 83 of 776 line names serve between two and nine different
 * comuni. The comune here is what tells those apart.
 *
 * Nothing in this module touches `<link rel="canonical">`, and nothing may: the
 * canonical is what keeps `/mappa/?linea=32` from being indexed as a page of
 * its own competing with `/linea/32-firenze/`, and it is what the pageview
 * counter reads to decide what to count. `test/urlstate.test.ts` and
 * `test/counter.test.ts` hold that line from both sides.
 */

/** A line, optionally narrowed to the comune whose line it is. */
export interface LineState {
  readonly mode: "line";
  readonly route: string;
  readonly comune: string | null;
}

/** Two comuni, in the direction they were asked in. */
export interface OdState {
  readonly mode: "od";
  readonly comuneA: string;
  readonly comuneB: string;
}

export type MapState = LineState | OdState;

/**
 * The longest a parameter may be before it is refused outright.
 *
 * The query string is external input and arrives from wherever a link has been:
 * a chat, a QR code, a crawler following something it built itself. Without a
 * ceiling, whatever it contains gets typed into a search field and forwarded to
 * the API. 64 is far above anything real — the longest comune name in the feed
 * is "San Casciano in Val di Pesa" at 27, and the longest line name is well
 * under that — and far below anything worth forwarding.
 */
export const MAX_PARAM_LENGTH = 64;

/**
 * Whether a value carries a C0 or C1 control character, which no line or comune
 * name does.
 *
 * Written as a code-point scan rather than the obvious character class, because
 * a regex that *names* control characters is what the linter forbids — rightly,
 * since almost every such regex is an accident. This one would have been
 * deliberate, but a rule worth having is not worth an exemption for one line,
 * and the loop says what it means without one.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Reads the search out of a query string, or `null` if it does not carry one.
 *
 * Accepts the string with or without its leading `?`, because it is called both
 * with `location.search` — which has one — and from tests and links which
 * often do not.
 */
export function readState(search: string): MapState | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  // A line beats a comune pair when both are present. It is the more specific
  // question, and it is the one the line pages send people here to ask.
  const route = clean(params.get("linea"));
  if (route !== null) {
    return { mode: "line", route, comune: clean(params.get("comune")) };
  }

  const comuneA = clean(params.get("da"));
  const comuneB = clean(params.get("a"));
  // Half a pair is not half a search. "From Arezzo to anywhere" is a different
  // question from the one this map answers, and filling in the other half would
  // answer it wrongly rather than decline it.
  if (comuneA === null || comuneB === null) return null;

  return { mode: "od", comuneA, comuneB };
}

/**
 * Writes the search back as a query string, `""` when there is nothing to say.
 *
 * Empty rather than `"?"`: `/mappa/` is what the canonical names and what the
 * counter counts, and a trailing question mark is the same page to a reader and
 * a second string to everything else.
 */
export function writeState(state: MapState | null): string {
  if (state === null) return "";

  const params = new URLSearchParams();
  if (state.mode === "line") {
    // Line first, comune second — the order of the pages' own addresses and of
    // the searches people actually type ("percorso linea 32 firenze").
    params.set("linea", state.route);
    if (state.comune !== null) params.set("comune", state.comune);
  } else {
    params.set("da", state.comuneA);
    params.set("a", state.comuneB);
  }
  return `?${params.toString()}`;
}

/**
 * Whether a trip's comune is the one the address asked for.
 *
 * Deliberately forgiving on everything that is not the name itself. A comune
 * arrives here from a URL that may have been through a chat window, a slug, or
 * someone's keyboard: accents get stripped, case is anyone's guess, and the
 * hyphens of a slug stand in for spaces. Refusing those would show an empty
 * result list for a line that is running — which reads as "no bus", the worst
 * available lie.
 *
 * `null` is not a wildcard. Stops outside Tuscany carry no comune, and a trip
 * whose endpoint we cannot place is not evidence that it is the one asked for.
 */
export function matchesComune(tripComune: string | null, wanted: string): boolean {
  if (tripComune === null) return false;
  return fold(tripComune) === fold(wanted);
}

/** Accent-stripped, lowercased, and with slug hyphens read as the spaces they replaced. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A parameter's value, or `null` if it is absent, blank, oversized or unprintable. */
function clean(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value === "") return null;
  if (value.length > MAX_PARAM_LENGTH) return null;
  if (hasControlCharacter(value)) return null;
  return value;
}
