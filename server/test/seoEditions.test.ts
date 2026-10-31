import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  compareEditions,
  type EditionCheckOptions,
  formatReport,
  type LineDataFile,
  type PublishedFile,
} from "../src/seo/editions.js";
import type { LineDirection, LineSummary } from "../src/seo/lines.js";

function direction(overrides: Partial<LineDirection> = {}): LineDirection {
  return {
    directionId: 0,
    headsign: "CAPOLINEA",
    trips: 50,
    first: "06:00",
    last: "21:00",
    headwayMinutes: 18,
    stops: ["A", "B", "C"],
    itineraries: 1,
    coverage: 1,
    ...overrides,
  };
}

function line(overrides: Partial<LineSummary> = {}): LineSummary {
  return {
    routeId: "100",
    shortName: "1",
    longName: "A - B",
    comune: "Firenze",
    comuneSlug: "firenze",
    slug: "1-firenze",
    comuni: ["Firenze"],
    trips: 100,
    lengthKm: 10,
    directions: [direction(), direction({ directionId: 1 })],
    ...overrides,
  };
}

function edition(
  lines: readonly LineSummary[],
  feed: Partial<LineDataFile["feed"]> = {},
): LineDataFile {
  return {
    feed: {
      startDate: "20261031",
      endDate: "20261120",
      sha1: "new",
      importedAt: "2026-10-31T10:00:00.000Z",
      ...feed,
    },
    referenceDate: "20261103",
    lines,
  };
}

const PREVIOUS = edition([line(), line({ routeId: "200", shortName: "2", slug: "2-firenze" })], {
  startDate: "20261008",
  endDate: "20261028",
  sha1: "old",
});

const PUBLISHED: PublishedFile = {
  released: 1,
  lines: [
    { slug: "1-firenze", routeId: "100", shortName: "1", group: 1 },
    { slug: "2-firenze", routeId: "200", shortName: "2", group: 1 },
    // Not released yet: nothing about it may block.
    { slug: "9-prato", routeId: "900", shortName: "9", group: 2 },
  ],
};

const OPTIONS: EditionCheckOptions = { today: "20261031", lastFullServiceDate: "20261117" };

function codes(next: LineDataFile, options: EditionCheckOptions = OPTIONS): readonly string[] {
  return compareEditions(PREVIOUS, next, PUBLISHED, options).blocking.map((f) => f.code);
}

describe("compareEditions", () => {
  test("passes a new edition that only moves departures", () => {
    const next = edition([
      line({ directions: [direction({ first: "05:50" }), direction({ directionId: 1 })] }),
      line({ routeId: "200", shortName: "2", slug: "2-firenze" }),
    ]);
    const result = compareEditions(PREVIOUS, next, PUBLISHED, OPTIONS);
    expect(result.blocking).toEqual([]);
    expect(result.unchanged).toBe(false);
    expect(result.changedPages).toEqual(["1-firenze"]);
  });

  test("reports an identical feed as unchanged, with nothing to check", () => {
    const result = compareEditions(PREVIOUS, { ...PREVIOUS }, PUBLISHED, OPTIONS);
    expect(result).toEqual({ unchanged: true, blocking: [], changedPages: [] });
  });

  test("B1: blocks when a published route now carries another line number", () => {
    const next = edition([
      line({ shortName: "1/", slug: "1-firenze" }),
      line({ routeId: "200", shortName: "2", slug: "2-firenze" }),
    ]);
    expect(codes(next)).toContain("frozen-slug");
  });

  test("B2: blocks when a released page has left the data, and says where its route went", () => {
    const next = edition([
      line(),
      line({ routeId: "200", shortName: "2", comune: "Bagno a Ripoli", slug: "2-bagno-a-ripoli" }),
    ]);
    const finding = compareEditions(PREVIOUS, next, PUBLISHED, OPTIONS).blocking[0];
    expect(finding?.code).toBe("page-missing");
    expect(finding?.message).toContain("2-bagno-a-ripoli");
  });

  test("B2: does not block for a page that has never been released", () => {
    expect(
      codes(edition([line(), line({ routeId: "200", shortName: "2", slug: "2-firenze" })])),
    ).toEqual([]);
  });

  test("B3: blocks when a direction that had a route has none", () => {
    const next = edition([
      line({ directions: [direction(), direction({ directionId: 1, stops: [], coverage: 0.7 })] }),
      line({ routeId: "200", shortName: "2", slug: "2-firenze" }),
    ]);
    expect(codes(next)).toEqual(["route-lost"]);
  });

  test("B3: a direction gaining a route is fine", () => {
    const previous = edition([line({ directions: [direction({ stops: [] })] })], { sha1: "old" });
    const next = edition([line({ directions: [direction()] })]);
    const published: PublishedFile = {
      released: 1,
      lines: [PUBLISHED.lines[0] as PublishedFile["lines"][number]],
    };
    expect(compareEditions(previous, next, published, OPTIONS).blocking).toEqual([]);
  });

  test("B4: blocks when a released line loses more than 40% of its trips", () => {
    const next = edition([
      line({ trips: 59 }),
      line({ routeId: "200", shortName: "2", slug: "2-firenze" }),
    ]);
    expect(codes(next)).toEqual(["trips-collapsed"]);
    const fine = edition([
      line({ trips: 60 }),
      line({ routeId: "200", shortName: "2", slug: "2-firenze" }),
    ]);
    expect(codes(fine)).toEqual([]);
  });

  test("B4: blocks when the number of candidates moves by more than a quarter", () => {
    const many = Array.from({ length: 1 }, (_, i) => line({ routeId: `x${i}`, slug: `x${i}` }));
    const next = edition([
      line(),
      line({ routeId: "200", shortName: "2", slug: "2-firenze" }),
      ...many,
    ]);
    expect(codes(next)).toEqual(["candidates-moved"]);
  });

  test("B5: blocks when the new edition's real service ends within a week", () => {
    const next = edition([line(), line({ routeId: "200", shortName: "2", slug: "2-firenze" })]);
    expect(codes(next, { today: "20261111", lastFullServiceDate: "20261117" })).toContain(
      "window-short",
    );
    expect(codes(next, { today: "20261110", lastFullServiceDate: "20261117" })).not.toContain(
      "window-short",
    );
  });

  test("B5: blocks a reference day outside the edition's real service", () => {
    const next = {
      ...edition([line(), line({ routeId: "200", shortName: "2", slug: "2-firenze" })]),
      referenceDate: "20261119",
    };
    expect(codes(next)).toContain("reference-outside");
  });

  test("B5: blocks an edition with no real service at all", () => {
    const next = edition([line(), line({ routeId: "200", shortName: "2", slug: "2-firenze" })]);
    expect(codes(next, { today: "20261031", lastFullServiceDate: null })).toContain("window-short");
  });

  test("blocks when a released address now computes to a different route of the same number", () => {
    // Route 200 ("2") drifts to Prato, and another "2" drifts into Firenze: the
    // address 2-firenze exists, route 200 still carries "2", and only the route
    // id says the page would now describe another bus.
    const next = edition([
      line(),
      line({ routeId: "200", shortName: "2", comune: "Prato", slug: "2-prato" }),
      line({ routeId: "777", shortName: "2", slug: "2-firenze" }),
    ]);
    const blocking = compareEditions(PREVIOUS, next, PUBLISHED, OPTIONS).blocking;
    expect(blocking.map((f) => f.code)).toContain("slug-reassigned");
    expect(blocking.find((f) => f.code === "slug-reassigned")?.message).toContain("route 777");
  });

  test("an unchanged feed still blocks when the committed edition is about to run out", () => {
    const result = compareEditions(PREVIOUS, { ...PREVIOUS }, PUBLISHED, {
      today: "20261112",
      lastFullServiceDate: "20261117",
    });
    expect(result.unchanged).toBe(true);
    expect(result.blocking.map((f) => f.code)).toEqual(["window-short"]);
  });

  test("blocks an edition that has not started yet", () => {
    const next = edition([line(), line({ routeId: "200", shortName: "2", slug: "2-firenze" })], {
      startDate: "20261104",
    });
    expect(codes(next)).toContain("edition-not-started");
    expect(codes(edition(next.lines, { startDate: "20261031" }))).not.toContain(
      "edition-not-started",
    );
  });

  test("reports every finding, not only the first", () => {
    const next = edition([line({ shortName: "1/", trips: 10 })]);
    expect(codes(next)).toEqual(
      expect.arrayContaining(["frozen-slug", "page-missing", "trips-collapsed"]),
    );
  });
});

describe("the committed line data", () => {
  // Golden: the file the site is built from, against itself, must be clean.
  const committed = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../client/seo/lines.json"), "utf8"),
  ) as LineDataFile;
  const published = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../client/seo/published.json"), "utf8"),
  ) as PublishedFile;

  test("passes every gate when compared with a copy of itself under a new sha1", () => {
    const next = { ...committed, feed: { ...committed.feed, sha1: "different" } };
    const result = compareEditions(committed, next, published, {
      today: committed.feed.startDate,
      lastFullServiceDate: committed.feed.endDate,
    });
    expect(result.blocking).toEqual([]);
    expect(result.changedPages).toEqual([]);
  });
});

describe("formatReport", () => {
  test("names the editions, the changed pages and every blocking finding", () => {
    const next = edition([
      line({ trips: 10 }),
      line({ routeId: "200", shortName: "2", slug: "2-firenze" }),
    ]);
    const report = formatReport(
      PREVIOUS,
      next,
      compareEditions(PREVIOUS, next, PUBLISHED, OPTIONS),
    );
    expect(report).toContain("20261008–20261028");
    expect(report).toContain("20261031–20261120");
    expect(report).toContain("trips-collapsed");
    expect(report).toContain("1-firenze");
  });

  test("says plainly when nothing blocks", () => {
    const next = edition([line(), line({ routeId: "200", shortName: "2", slug: "2-firenze" })]);
    expect(
      formatReport(PREVIOUS, next, compareEditions(PREVIOUS, next, PUBLISHED, OPTIONS)),
    ).toContain("No blocking finding");
  });
});
