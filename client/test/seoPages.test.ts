import { describe, expect, test } from "vitest";
import {
  assertEveryLineHasAParent,
  buildPages,
  type ComunePage,
  INDEX_PATH,
  type IndexPage,
  type LineData,
  type LinePage,
  type LineSummary,
  missingFromData,
  type PublishedList,
} from "../seo/pages.js";

function line(slug: string, comune: string, trips: number): LineSummary {
  const [shortName = slug] = slug.split("-");
  return {
    routeId: `R-${slug}`,
    shortName,
    longName: `${comune} ${shortName}`,
    comune,
    comuneSlug: comune.toLowerCase().replace(/\s+/g, "-"),
    slug,
    comuni: [comune],
    trips,
    lengthKm: 12,
    directions: [
      {
        directionId: 0,
        headsign: "CAPOLINEA",
        trips,
        first: "05:30",
        last: "21:30",
        headwayMinutes: 20,
        stops: ["UNA", "DUE", "TRE"],
        itineraries: 1,
        coverage: 1,
      },
    ],
  };
}

function data(...lines: LineSummary[]): LineData {
  return {
    feed: {
      startDate: "20260918",
      endDate: "20261008",
      sha1: "abc",
      importedAt: "2026-09-18T04:36:00.000Z",
    },
    referenceDate: "20260918",
    minimumTrips: 70,
    generatedAt: "2026-09-18T15:48:00.000Z",
    lines,
  };
}

function publish(...slugs: string[]): PublishedList {
  return {
    released: 1,
    lines: slugs.map((slug) => ({
      slug,
      routeId: `R-${slug}`,
      shortName: slug.split("-")[0] ?? slug,
      group: 1,
    })),
  };
}

const pagesOf = (kind: "line" | "comune", pages: readonly unknown[]) =>
  (pages as ReadonlyArray<{ kind: string }>).filter((page) => page.kind === kind);

describe("buildPages", () => {
  test("publishes only what the list names, not every candidate", () => {
    // The threshold proposes 102 candidates; the list is what goes out, so a new
    // edition of the feed cannot make a page appear on its own and walk around
    // the staged rollout.
    const all = data(line("32-firenze", "Firenze", 102), line("c3-firenze", "Firenze", 168));
    const pages = buildPages(all, publish("32-firenze"));
    expect(pagesOf("line", pages).map((page) => (page as LinePage).path)).toEqual([
      "/linea/32-firenze/",
    ]);
  });

  test("emits only the batches that have been released", () => {
    // The whole staged rollout hangs on this. Without it the first deploy
    // publishes every batch at once, which is exactly what publishing in
    // batches exists to avoid — and it would look perfectly fine.
    const all = data(line("32-firenze", "Firenze", 102), line("c3-firenze", "Firenze", 168));
    const published: PublishedList = {
      released: 1,
      lines: [
        { slug: "32-firenze", routeId: "R-32-firenze", shortName: "32", group: 1 },
        { slug: "c3-firenze", routeId: "R-c3-firenze", shortName: "c3", group: 2 },
      ],
    };
    expect(pagesOf("line", buildPages(all, published)).map((p) => (p as LinePage).path)).toEqual([
      "/linea/32-firenze/",
    ]);
    expect(
      pagesOf("line", buildPages(all, { ...published, released: 2 })).map(
        (p) => (p as LinePage).path,
      ),
    ).toHaveLength(2);
  });

  test("an unreleased page that vanished from the feed is not a withdrawal", () => {
    const all = data(line("32-firenze", "Firenze", 102));
    const published: PublishedList = {
      released: 1,
      lines: [
        { slug: "32-firenze", routeId: "R-32-firenze", shortName: "32", group: 1 },
        { slug: "99-mai-uscita", routeId: "R-99", shortName: "99", group: 2 },
      ],
    };
    expect(missingFromData(all, published)).toEqual([]);
  });

  test("gives a comune a page once it owns two lines", () => {
    const all = data(line("32-firenze", "Firenze", 102), line("c3-firenze", "Firenze", 168));
    const pages = buildPages(all, publish("32-firenze", "c3-firenze"));
    const comuni = pagesOf("comune", pages) as ComunePage[];
    expect(comuni.map((page) => page.path)).toEqual(["/comune/firenze/"]);
    expect(comuni[0]?.lines.map((l) => l.slug)).toEqual(["c3-firenze", "32-firenze"]);
  });

  test("does not give a comune a page for a single line", () => {
    // A hub with one link is not a hub. The line keeps its page and hangs off
    // the index instead.
    const all = data(line("1-vinci", "Vinci", 72));
    const pages = buildPages(all, publish("1-vinci"));
    expect(pagesOf("comune", pages)).toEqual([]);
    expect((pagesOf("line", pages)[0] as LinePage).parentPath).toBeNull();
  });

  test("a line whose comune has a page points at it", () => {
    const all = data(line("32-firenze", "Firenze", 102), line("c3-firenze", "Firenze", 168));
    const pages = buildPages(all, publish("32-firenze", "c3-firenze"));
    for (const page of pagesOf("line", pages) as LinePage[]) {
      expect(page.parentPath).toBe("/comune/firenze/");
    }
  });

  test("the index lists every published line, whether or not its comune has a page", () => {
    const all = data(
      line("32-firenze", "Firenze", 102),
      line("c3-firenze", "Firenze", 168),
      line("1-vinci", "Vinci", 72),
    );
    const pages = buildPages(all, publish("32-firenze", "c3-firenze", "1-vinci"));
    const index = pages.find((page) => page.kind === "index") as IndexPage;
    expect(index.path).toBe(INDEX_PATH);
    expect(index.comuni.map((entry) => entry.comune)).toEqual(["Firenze", "Vinci"]);
    expect(index.comuni.find((entry) => entry.comune === "Vinci")?.path).toBeNull();
    expect(index.comuni.find((entry) => entry.comune === "Firenze")?.path).toBe("/comune/firenze/");
  });

  test("skips a published slug the data no longer has, and says which", () => {
    const all = data(line("32-firenze", "Firenze", 102));
    const published = publish("32-firenze", "99-ritirata");
    expect(pagesOf("line", buildPages(all, published))).toHaveLength(1);
    expect(missingFromData(all, published).map((entry) => entry.slug)).toEqual(["99-ritirata"]);
  });

  test("orders comuni by how many lines they own, then by name", () => {
    const all = data(
      line("1-arezzo", "Arezzo", 80),
      line("2-arezzo", "Arezzo", 80),
      line("1-bologna", "Bologna", 80),
      line("2-bologna", "Bologna", 80),
      line("3-bologna", "Bologna", 80),
    );
    const pages = buildPages(
      all,
      publish("1-arezzo", "2-arezzo", "1-bologna", "2-bologna", "3-bologna"),
    );
    expect((pagesOf("comune", pages) as ComunePage[]).map((page) => page.comune)).toEqual([
      "Bologna",
      "Arezzo",
    ]);
  });

  test("nothing published is no pages but still an index", () => {
    // An index of nothing is not worth publishing either, but it must not throw:
    // the build reports an empty release rather than crashing on one.
    const pages = buildPages(data(), publish());
    expect(pagesOf("line", pages)).toEqual([]);
    expect(pagesOf("comune", pages)).toEqual([]);
    expect(pages.find((page) => page.kind === "index")).toBeDefined();
  });
});

describe("assertEveryLineHasAParent", () => {
  test("accepts a set where every line hangs off something", () => {
    const all = data(line("32-firenze", "Firenze", 102), line("c3-firenze", "Firenze", 168));
    expect(() =>
      assertEveryLineHasAParent(buildPages(all, publish("32-firenze", "c3-firenze"))),
    ).not.toThrow();
  });

  test("refuses a set with no index, which is how a line becomes an orphan", () => {
    const all = data(line("1-vinci", "Vinci", 72));
    const pages = buildPages(all, publish("1-vinci")).filter((page) => page.kind !== "index");
    expect(() => assertEveryLineHasAParent(pages)).toThrow(/linee/);
  });

  test("refuses a line pointing at a comune page that is not being built", () => {
    const orphan: LinePage = {
      kind: "line",
      path: "/linea/32-firenze/",
      line: line("32-firenze", "Firenze", 102),
      parentPath: "/comune/firenze/",
    };
    const index: IndexPage = { kind: "index", path: INDEX_PATH, comuni: [] };
    expect(() => assertEveryLineHasAParent([index, orphan])).toThrow(/comune\/firenze/);
  });
});
