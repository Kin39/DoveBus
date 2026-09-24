import { describe, expect, test } from "vitest";
import {
  MAX_PARAM_LENGTH,
  type MapState,
  matchesComune,
  readState,
  writeState,
} from "../src/map/urlstate.js";

describe("readState", () => {
  test("reads a line, which is the address a line page links to", () => {
    expect(readState("?linea=32&comune=firenze")).toEqual({
      mode: "line",
      route: "32",
      comune: "firenze",
    });
  });

  test("a line without a comune is still a line", () => {
    // Someone shortening the URL by hand, or a link written before the line
    // pages existed. It searches, it just cannot disambiguate.
    expect(readState("?linea=C3")).toEqual({ mode: "line", route: "C3", comune: null });
  });

  test("reads a comune pair", () => {
    expect(readState("?da=arezzo&a=anghiari")).toEqual({
      mode: "od",
      comuneA: "arezzo",
      comuneB: "anghiari",
    });
  });

  test("the map's own address, with nothing on it, asks for nothing", () => {
    expect(readState("")).toBeNull();
    expect(readState("?")).toBeNull();
  });

  test("ignores parameters it does not own", () => {
    // Campaign tags and the like ride along on shared links; they must not
    // stop the search the rest of the address asks for.
    expect(readState("?utm_source=whatsapp&linea=32")).toEqual({
      mode: "line",
      route: "32",
      comune: null,
    });
    expect(readState("?utm_source=whatsapp")).toBeNull();
  });

  test("a half-written comune pair is not a search", () => {
    // Searching for "from Arezzo to anywhere" is not a question this map can
    // answer, and guessing the other half would answer a different one.
    expect(readState("?da=arezzo")).toBeNull();
    expect(readState("?a=anghiari")).toBeNull();
  });

  test("a line and a pair together: the line wins, because it is more specific", () => {
    expect(readState("?linea=32&da=arezzo&a=anghiari")).toEqual({
      mode: "line",
      route: "32",
      comune: null,
    });
  });

  test("trims, and treats whitespace as absence", () => {
    expect(readState("?linea=%2032%20")).toEqual({ mode: "line", route: "32", comune: null });
    expect(readState("?linea=%20%20")).toBeNull();
    expect(readState("?linea=32&comune=%20")).toEqual({
      mode: "line",
      route: "32",
      comune: null,
    });
  });

  test("keeps accents and spaces in a comune name", () => {
    expect(readState("?da=San%20Casciano%20in%20Val%20di%20Pesa&a=Firenze")).toEqual({
      mode: "od",
      comuneA: "San Casciano in Val di Pesa",
      comuneB: "Firenze",
    });
  });

  test("refuses a value longer than any real line or comune", () => {
    // The query string is external input and is not trusted: a megabyte pasted
    // into `?linea=` would otherwise be typed into a field and sent to the API.
    const long = "x".repeat(MAX_PARAM_LENGTH + 1);
    expect(readState(`?linea=${long}`)).toBeNull();
    expect(readState(`?da=${long}&a=firenze`)).toBeNull();
  });

  test("a value at the limit is still accepted", () => {
    const edge = "x".repeat(MAX_PARAM_LENGTH);
    expect(readState(`?linea=${edge}`)).toEqual({ mode: "line", route: edge, comune: null });
  });

  test("refuses control characters rather than putting them in a field", () => {
    expect(readState("?linea=3%002")).toBeNull();
    expect(readState("?linea=3%0A2")).toBeNull();
  });

  test("takes the first of a repeated parameter, not the last", () => {
    // `URLSearchParams.get` already does this. Pinned because the alternative —
    // a later copy silently overriding the one a person read in the link — is
    // the kind of thing that changes under a library upgrade.
    expect(readState("?linea=32&linea=99")).toEqual({
      mode: "line",
      route: "32",
      comune: null,
    });
  });

  test("reads an address that arrives without its question mark", () => {
    expect(readState("linea=32")).toEqual({ mode: "line", route: "32", comune: null });
  });
});

describe("writeState", () => {
  test("writes what readState reads", () => {
    const states: MapState[] = [
      { mode: "line", route: "32", comune: "firenze" },
      { mode: "line", route: "C3", comune: null },
      { mode: "od", comuneA: "Arezzo", comuneB: "Anghiari" },
    ];
    for (const state of states) expect(readState(writeState(state))).toEqual(state);
  });

  test("no search means a bare address, not an empty question mark", () => {
    // `/mappa/?` and `/mappa/` are the same page to a person and two strings to
    // a crawler. The canonical says `/mappa/`, so that is what the bar shows.
    expect(writeState(null)).toBe("");
  });

  test("names the line before the comune, as the pages and the queries do", () => {
    expect(writeState({ mode: "line", route: "32", comune: "firenze" })).toBe(
      "?linea=32&comune=firenze",
    );
  });

  test("escapes what has to be escaped", () => {
    expect(writeState({ mode: "od", comuneA: "Bagno a Ripoli", comuneB: "Firenze" })).toBe(
      "?da=Bagno+a+Ripoli&a=Firenze",
    );
  });

  test("a line with no comune carries no empty comune", () => {
    expect(writeState({ mode: "line", route: "32", comune: null })).toBe("?linea=32");
  });
});

describe("matchesComune", () => {
  test("a comune from the address matches the one on a trip", () => {
    expect(matchesComune("Firenze", "firenze")).toBe(true);
    expect(matchesComune("Firenze", "FIRENZE")).toBe(true);
  });

  test("ignores the accents a shared link loses", () => {
    // A name pasted out of a chat often arrives stripped of its accents, and a
    // filter that refused it would show an empty result list for a real line.
    expect(matchesComune("Peccioli", "peccioli")).toBe(true);
    expect(matchesComune("Forte dei Marmi", "forte-dei-marmi")).toBe(true);
    expect(matchesComune("Bagno a Ripoli", "bagno a ripoli")).toBe(true);
  });

  test("does not match a different comune", () => {
    expect(matchesComune("Firenze", "empoli")).toBe(false);
    expect(matchesComune("Empoli", "firenze")).toBe(false);
  });

  test("an unknown comune on a trip matches nothing", () => {
    // Stops outside Tuscany carry a null comune. They are not a wildcard.
    expect(matchesComune(null, "firenze")).toBe(false);
  });
});
