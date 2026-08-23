import { afterEach, describe, expect, test } from "vitest";
import { DICTIONARIES, resolveLanguage } from "../src/i18n/index.js";
import type { Strings } from "../src/i18n/strings.js";

/** Every leaf in a dictionary, as `path → what is there`. */
function shapeOf(value: unknown, path = ""): Map<string, string> {
  const shape = new Map<string, string>();
  if (typeof value === "function") {
    shape.set(path, `function/${value.length}`);
    return shape;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const [key, kind] of shapeOf(item, `${path}[${index}]`)) shape.set(key, kind);
    });
    return shape;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      for (const [inner, kind] of shapeOf(child, path === "" ? key : `${path}.${key}`)) {
        shape.set(inner, kind);
      }
    }
    return shape;
  }
  shape.set(path, typeof value);
  return shape;
}

/** Every leaf that is a string, as `[prefixed path, value]`. */
function stringsIn(value: unknown, path: string): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => stringsIn(child, `${path}.${key}`));
}

describe("the dictionaries", () => {
  const { it: italian, en: english } = DICTIONARIES;

  test("have exactly the same shape, path for path", () => {
    // The compiler already checks the fields `Strings` names. It cannot check
    // the ones it does not: `callout.occupancy` is keyed by the feed's enum and
    // `credits.links` is a list, so a language could quietly carry one fewer of
    // either and typecheck clean. This is the check for those.
    const italianShape = shapeOf(italian);
    const englishShape = shapeOf(english);

    expect([...englishShape.keys()].sort()).toEqual([...italianShape.keys()].sort());
    for (const [path, kind] of italianShape) expect(englishShape.get(path)).toBe(kind);
  });

  test("say something at every one of those paths", () => {
    const blanks = [...stringsIn(italian, "it"), ...stringsIn(english, "en")].filter(
      ([, value]) => value.trim() === "",
    );
    expect(blanks).toEqual([]);
  });

  test("agree on the enum the feed sends, not just on its own words", () => {
    expect(Object.keys(english.callout.occupancy).sort()).toEqual(
      Object.keys(italian.callout.occupancy).sort(),
    );
  });

  test("point at their own pages", () => {
    for (const link of italian.credits.links) expect(link.href.startsWith("/en/")).toBe(false);
    for (const link of english.credits.links) expect(link.href.startsWith("/en/")).toBe(true);
  });

  test("write the day the Italian way round in both languages", () => {
    // Not an oversight: this page is read next to Italian signs and Italian
    // timetables, and `08/12` must mean the same day on both.
    const both: Strings[] = [italian, english];
    for (const strings of both) expect(strings.search.dayPlaceholder).toMatch(/^(gg|dd)\//);
  });
});

describe("resolveLanguage", () => {
  const original = Reflect.get(globalThis, "document");

  afterEach(() => {
    if (original === undefined) Reflect.deleteProperty(globalThis, "document");
    else Reflect.set(globalThis, "document", original);
  });

  function pretendPageIs(lang: string): void {
    Reflect.set(globalThis, "document", { documentElement: { lang } });
  }

  test("reads the language the document was served as", () => {
    pretendPageIs("en");
    expect(resolveLanguage()).toBe("en");
    pretendPageIs("en-GB");
    expect(resolveLanguage()).toBe("en");
    pretendPageIs("it");
    expect(resolveLanguage()).toBe("it");
  });

  test("falls back to the original language, never to a guess", () => {
    pretendPageIs("");
    expect(resolveLanguage()).toBe("it");
    pretendPageIs("de-DE");
    expect(resolveLanguage()).toBe("it");
  });

  test("does not need a DOM to answer", () => {
    Reflect.deleteProperty(globalThis, "document");
    expect(resolveLanguage()).toBe("it");
  });
});
