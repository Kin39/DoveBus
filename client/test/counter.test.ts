import { describe, expect, test } from "vitest";
import {
  countablePath,
  type PageFacts,
  pageviewQuery,
  reasonNotToCount,
} from "../src/count/counter.js";

/** A reader on the deployed site, on the privacy page, with nothing unusual. */
const SITE = "https://dovebus.it";

const READER: PageFacts = {
  canonical: "https://dovebus.it/privacy/",
  origin: SITE,
  hostname: "dovebus.it",
  protocol: "https:",
  referrer: "https://www.google.com/",
  title: "Privacy — DoveBus non ti chiede niente",
  screenWidth: 390,
  visibility: "visible",
  inFrame: false,
  automated: false,
  privacyControl: false,
};

/** The same reader, with one fact changed. */
function reader(changed: Partial<PageFacts>): PageFacts {
  return { ...READER, ...changed };
}

/** The parameters of a counting request, parsed back out of the query string. */
function sent(facts: PageFacts): URLSearchParams {
  const query = pageviewQuery(facts, "abc12");
  if (query === null) throw new Error("expected this pageview to be countable");
  return new URLSearchParams(query);
}

describe("the path a pageview is counted against", () => {
  test("is the page's own canonical path", () => {
    expect(countablePath("https://dovebus.it/come-funziona/", SITE)).toBe("/come-funziona/");
    expect(countablePath("https://dovebus.it/", SITE)).toBe("/");
    expect(countablePath("https://dovebus.it/en/map/", SITE)).toBe("/en/map/");
  });

  /**
   * The rule the privacy page is held to: "a successful search leaves no trace".
   *
   * The terms of a search live in the query string of the *API* request, and the
   * address bar never changes — so there is nothing to leak today. This is the
   * check that keeps it that way the day someone adds a shareable link, because
   * GoatCounter stores the path it is given **with its query string attached**
   * (`hit.go`, `cleanPath` strips only known ad-tracking parameters). A path
   * carrying anything at all is refused outright rather than cleaned up:
   * deciding which parameters are safe to keep is exactly the judgement that
   * would eventually keep the wrong one.
   */
  test("is refused entirely when it carries a query string", () => {
    expect(countablePath("https://dovebus.it/mappa/?linea=14", SITE)).toBeNull();
    expect(countablePath("https://dovebus.it/mappa/?da=Firenze&a=Prato", SITE)).toBeNull();
    expect(countablePath("https://dovebus.it/mappa/?utm_source=x", SITE)).toBeNull();
  });

  test("is refused when it carries a fragment", () => {
    expect(countablePath("https://dovebus.it/mappa/#toggle-goatcounter", SITE)).toBeNull();
  });

  /**
   * A copy of the site — a deploy preview, an archive, somebody's mirror —
   * serves production's `canonical` from a different origin. Previews are built
   * without a counter at all, so this is the second lock rather than the first;
   * it is the one that does not depend on remembering to leave an environment
   * variable empty.
   */
  test("is refused when the page is served from somewhere else", () => {
    expect(
      countablePath("https://dovebus.it/mappa/", "https://deploy-preview-7.netlify.app"),
    ).toBeNull();
    expect(countablePath("https://dovebus.it/mappa/", "http://localhost:5290")).toBeNull();
  });

  test("is nothing at all when the page has no canonical to read", () => {
    expect(countablePath(null, SITE)).toBeNull();
    expect(countablePath("", SITE)).toBeNull();
    expect(countablePath("not a url", SITE)).toBeNull();
  });
});

describe("what a counting request carries", () => {
  test("the path, the title, the referrer, the screen's width and a cache-buster", () => {
    const parameters = sent(READER);

    expect(parameters.get("p")).toBe("/privacy/");
    expect(parameters.get("t")).toBe("Privacy — DoveBus non ti chiede niente");
    expect(parameters.get("r")).toBe("https://www.google.com/");
    expect(parameters.get("s")).toBe("390");
    expect(parameters.get("rnd")).toBe("abc12");
  });

  /**
   * The negative half of the same promise, and the one worth spelling out: the
   * upstream script sends `location.search` as a `q` parameter *as well as*
   * gluing it onto the path. This one has no `q` to send, and no route by which
   * a search term could reach the wire.
   */
  test("never a query string, under any name", () => {
    const parameters = sent(READER);

    expect(parameters.get("q")).toBeNull();
    expect([...parameters.keys()].sort()).toEqual(["p", "r", "rnd", "s", "t"]);
  });

  test("nothing at all when the path is not countable", () => {
    expect(
      pageviewQuery(reader({ canonical: "https://dovebus.it/mappa/?linea=14" }), "abc12"),
    ).toBeNull();
  });

  test("marks a driven browser, so a headers check does not count as a reader", () => {
    // The server keeps `b` > 0 out of every aggregate — see `cron/hit_count.go`.
    expect(sent(reader({ automated: true })).get("b")).toBe("153");
  });

  test("omits what the page did not have, rather than sending it empty", () => {
    const parameters = sent(reader({ referrer: "", title: "", screenWidth: 0 }));

    expect(parameters.has("r")).toBe(false);
    expect(parameters.has("t")).toBe(false);
    expect(parameters.has("s")).toBe(false);
  });
});

describe("who is not counted", () => {
  test("a reader on the deployed site is", () => {
    expect(reasonNotToCount(READER)).toBeNull();
  });

  /**
   * The opt-out, and the only one there is.
   *
   * Removing GoatCounter's own opt-out — a `localStorage` key — is the reason
   * this module exists at all, so the replacement has to work, and it has to be
   * honoured before every other rule.
   */
  test("a reader who sends Global Privacy Control is not", () => {
    expect(reasonNotToCount(reader({ privacyControl: true }))).toBe("global privacy control");
  });

  test("a page the browser guessed at rather than one anybody read", () => {
    expect(reasonNotToCount(reader({ visibility: "prerender" }))).toBe("prerendered, not read");
  });

  test("a page embedded in somebody else's", () => {
    expect(reasonNotToCount(reader({ inFrame: true }))).toBe("framed");
  });

  test("a page opened from disk", () => {
    expect(reasonNotToCount(reader({ protocol: "file:", hostname: "" }))).toBe("opened from disk");
  });

  /**
   * The LAN address matters as much as `localhost`: `client/.env` points the dev
   * build at `192.168.1.115` so the site can be opened from a phone, and without
   * this line every afternoon of checking would land in the published numbers.
   */
  test("anybody on a private address, which is how this site is developed", () => {
    for (const hostname of ["localhost", "127.0.0.1", "192.168.1.115", "10.0.0.4", "172.20.1.1"]) {
      expect(reasonNotToCount(reader({ hostname }))).toBe("a private address, not the site");
    }
  });

  test("but a public address that merely looks private is", () => {
    // 172.32 is outside the private range; a regex anchored carelessly would
    // swallow it, and with it a real reader.
    expect(reasonNotToCount(reader({ hostname: "172.32.1.1" }))).toBeNull();
  });
});
