import { describe, expect, test } from "vitest";
import {
  assertFrozenSlugsStillFit,
  assertUniqueSlugs,
  comuneSlug,
  lineSlug,
  slugify,
} from "../src/seo/slug.js";

describe("slugify", () => {
  test("leaves a plain line number alone", () => {
    expect(slugify("32")).toBe("32");
    expect(slugify("C3")).toBe("c3");
  });

  test("collapses the four punctuation marks the feed actually uses", () => {
    // Measured across all 776 line names: space, slash, plus, hyphen. Nothing else.
    expect(slugify("301 A")).toBe("301-a");
    expect(slugify("N/A1")).toBe("n-a1");
    expect(slugify("1+")).toBe("1");
    expect(slugify("32-F")).toBe("32-f");
  });

  test("strips the accents an Italian comune carries", () => {
    expect(comuneSlug("Forlì")).toBe("forli");
    expect(comuneSlug("Montecatini-Terme")).toBe("montecatini-terme");
    expect(comuneSlug("Bagno a Ripoli")).toBe("bagno-a-ripoli");
    expect(comuneSlug("Scarperia e San Piero")).toBe("scarperia-e-san-piero");
  });

  test("never leaves a hyphen at either end", () => {
    expect(slugify(" 32 ")).toBe("32");
    expect(slugify("+32+")).toBe("32");
    expect(slugify("--32--")).toBe("32");
  });

  test("a name made only of punctuation slugs to nothing, and says so plainly", () => {
    // No such line exists today. If one appears, an empty slug must be visible
    // to the caller as an empty string rather than quietly becoming "/linea/-firenze/".
    expect(slugify("+++")).toBe("");
  });
});

describe("lineSlug", () => {
  test("the number first, then the comune — the order the searches arrive in", () => {
    expect(lineSlug("32", "Firenze")).toBe("32-firenze");
    expect(lineSlug("C3", "Firenze")).toBe("c3-firenze");
  });

  test("the same number in two comuni is two addresses", () => {
    // The whole reason the comune is in the address: "32" is Florence's
    // piazzale Montelungo – Antella *and* Montespertoli – Empoli.
    expect(lineSlug("32", "Firenze")).not.toBe(lineSlug("32", "Empoli"));
  });
});

describe("assertUniqueSlugs", () => {
  test("says nothing when every address is claimed once", () => {
    expect(() =>
      assertUniqueSlugs([
        { slug: "32-firenze", routeId: "92", shortName: "32", comune: "Firenze" },
        { slug: "32-empoli", routeId: "82", shortName: "32", comune: "Empoli" },
      ]),
    ).not.toThrow();
  });

  test("refuses the clash a lossy slug can produce, and names both lines", () => {
    // "1" and "1+" are both real Prato lines, and both slugify to "1". No comune
    // has both today; this is what happens on the edition where one does.
    const clash = () =>
      assertUniqueSlugs([
        { slug: "1-prato", routeId: "500", shortName: "1", comune: "Prato" },
        { slug: "1-prato", routeId: "501", shortName: "1+", comune: "Prato" },
      ]);
    expect(clash).toThrow(/1-prato/);
    expect(clash).toThrow(/"1".*Prato.*route 500/s);
    expect(clash).toThrow(/"1\+".*Prato.*route 501/s);
  });
});

describe("assertFrozenSlugsStillFit", () => {
  test("accepts a published page whose route still carries its line number", () => {
    expect(() =>
      assertFrozenSlugsStillFit(
        [{ slug: "32-firenze", routeId: "92", shortName: "32" }],
        new Map([["92", "32"]]),
      ),
    ).not.toThrow();
  });

  test("accepts a page whose comune drifted — that is what freezing is for", () => {
    // Route 194's principal comune went from Montalcino to Siena between two
    // editions. The address must not follow it, and nothing here looks at it.
    expect(() =>
      assertFrozenSlugsStillFit(
        [{ slug: "114-montalcino", routeId: "194", shortName: "114" }],
        new Map([["194", "114"]]),
      ),
    ).not.toThrow();
  });

  test("refuses a page whose route now carries a different line number", () => {
    const reused = () =>
      assertFrozenSlugsStillFit(
        [{ slug: "32-firenze", routeId: "92", shortName: "32" }],
        new Map([["92", "47"]]),
      );
    expect(reused).toThrow(/32-firenze/);
    expect(reused).toThrow(/"32".*"47"/s);
  });

  test("a line that vanished from the feed is not this error", () => {
    // It may be a page to retire, but it is a decision for the caller, and it is
    // not the silent mis-addressing this check exists to catch.
    expect(() =>
      assertFrozenSlugsStillFit(
        [{ slug: "32-firenze", routeId: "92", shortName: "32" }],
        new Map(),
      ),
    ).not.toThrow();
  });
});
