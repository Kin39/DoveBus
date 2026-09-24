/**
 * Which pages the line data turns into, and what each of them says.
 *
 * Pure: it takes the generated `lines.json` and the hand-kept list of what is
 * published, and returns page models. Everything that reads a file or writes
 * one lives in `scripts/seo-pages.ts`, so the decisions here can be tested
 * without a filesystem — and these are decisions worth testing, because their
 * failures are invisible. A page with no parent still renders; a comune page
 * listing lines it cannot link to still renders.
 */

export interface LineDirection {
  readonly directionId: number;
  readonly headsign: string | null;
  readonly trips: number;
  readonly first: string;
  readonly last: string;
  readonly headwayMinutes: number | null;
  /** Empty when the direction has no itinerary representative enough to draw. */
  readonly stops: readonly string[];
  readonly itineraries: number;
  readonly coverage: number;
}

export interface LineSummary {
  readonly routeId: string;
  readonly shortName: string;
  readonly longName: string | null;
  readonly comune: string;
  readonly comuneSlug: string;
  readonly slug: string;
  readonly comuni: readonly string[];
  readonly trips: number;
  readonly lengthKm: number | null;
  readonly directions: readonly LineDirection[];
}

export interface LineData {
  readonly feed: {
    readonly startDate: string;
    readonly endDate: string;
    readonly sha1: string;
    readonly importedAt: string;
  };
  readonly referenceDate: string;
  readonly minimumTrips: number;
  readonly generatedAt: string;
  readonly lines: readonly LineSummary[];
}

/**
 * One entry of the published list: an address, frozen to the line it was minted
 * for.
 *
 * `shortName` is recorded so the build can tell a line that moved comune — which
 * must *not* change the address — from a route id the feed has reused, which
 * must not keep it. See `assertFrozenSlugsStillFit` in the server workspace.
 */
export interface PublishedLine {
  readonly slug: string;
  readonly routeId: string;
  readonly shortName: string;
  /** Which release group this went out in. Records the staged rollout. */
  readonly group: number;
}

export interface PublishedList {
  /**
   * The highest release group that is live.
   *
   * The pages go out in small batches, because a domain three weeks old with
   * one inbound link does not get a hundred new URLs read as a hundred new
   * pages — it gets them read as a hundred pages that appeared at once. This
   * number is the whole mechanism: the list names every page and its batch, and
   * the build emits only the batches at or below this.
   *
   * Raising it by one is a one-line diff, a deploy, and a `npm run indexnow`.
   * Without it the first push would have published all three batches together,
   * which is the thing the staging exists to prevent and would have happened
   * silently, because every page would have looked right.
   */
  readonly released: number;
  readonly lines: readonly PublishedLine[];
}

/** A line page: one line, in the comune its address names. */
export interface LinePage {
  readonly kind: "line";
  readonly path: string;
  readonly line: LineSummary;
  /** The comune page that links here, when one exists. */
  readonly parentPath: string | null;
}

/** A comune page: the lines published for one comune. */
export interface ComunePage {
  readonly kind: "comune";
  readonly path: string;
  readonly comune: string;
  readonly slug: string;
  readonly lines: readonly LineSummary[];
}

/** The index: every published line, grouped by comune. It is everything's parent. */
export interface IndexPage {
  readonly kind: "index";
  readonly path: string;
  readonly comuni: ReadonlyArray<{
    readonly comune: string;
    readonly path: string | null;
    readonly lines: readonly LineSummary[];
  }>;
}

export type Page = LinePage | ComunePage | IndexPage;

export const INDEX_PATH = "/linee/";

/**
 * How many line pages a comune must own before it gets a page of its own.
 *
 * A comune page exists to be a hub: somewhere a reader lands from "mappa
 * autobus firenze" and finds the lines. A hub with one link is not a hub, it is
 * a redirect with prose around it — and the spam guidance names exactly that
 * shape, a page whose only real content funnels to the usable part of the site.
 * Comuni below this keep their lines; the lines simply hang off the index
 * instead, which is a real parent with real siblings.
 */
const MIN_LINES_FOR_COMUNE_PAGE = 2;

/**
 * Builds every page from the data and the published list.
 *
 * The comune pages are derived *from the line pages*, never ranked separately.
 * Ranking them apart is what produced the first version of this plan, where the
 * comuni were chosen by how many lines served them and the lines by how much
 * service they ran: two orderings over one set, and they disagreed. Measured on
 * the real data, 29 of 100 line pages would have had no comune page to be
 * linked from — Prato with eight of them — while four comune pages would have
 * had no line page to link to.
 */
export function buildPages(data: LineData, published: PublishedList): readonly Page[] {
  const bySlug = new Map(data.lines.map((line) => [line.slug, line]));

  // A published slug the data no longer carries is not skipped quietly: see
  // `missingFromData`, which the build calls and reports on.
  const lines = published.lines.flatMap((entry) => {
    if (entry.group > published.released) return [];
    const line = bySlug.get(entry.slug);
    return line === undefined ? [] : [line];
  });

  const byComune = new Map<string, LineSummary[]>();
  for (const line of lines) {
    const list = byComune.get(line.comune);
    if (list === undefined) byComune.set(line.comune, [line]);
    else list.push(line);
  }

  const comunePages = [...byComune.entries()]
    .filter(([, owned]) => owned.length >= MIN_LINES_FOR_COMUNE_PAGE)
    .map(([comune, owned]): ComunePage => {
      const slug = (owned[0] as LineSummary).comuneSlug;
      return {
        kind: "comune",
        path: `/comune/${slug}/`,
        comune,
        slug,
        lines: [...owned].sort((a, b) => b.trips - a.trips),
      };
    })
    .sort((a, b) => b.lines.length - a.lines.length || a.comune.localeCompare(b.comune));

  const parentByComune = new Map(comunePages.map((page) => [page.comune, page.path]));

  const linePages = lines.map(
    (line): LinePage => ({
      kind: "line",
      path: `/linea/${line.slug}/`,
      line,
      parentPath: parentByComune.get(line.comune) ?? null,
    }),
  );

  const index: IndexPage = {
    kind: "index",
    path: INDEX_PATH,
    comuni: [...byComune.entries()]
      .map(([comune, owned]) => ({
        comune,
        path: parentByComune.get(comune) ?? null,
        lines: [...owned].sort((a, b) => b.trips - a.trips),
      }))
      .sort((a, b) => b.lines.length - a.lines.length || a.comune.localeCompare(b.comune)),
  };

  return [index, ...comunePages, ...linePages];
}

/**
 * Published slugs the data no longer describes.
 *
 * A line can stop running — a seasonal variant withdrawn, a route renumbered —
 * and when it does, its page cannot be rebuilt from nothing. This reports them
 * rather than deciding: dropping the page silently would remove a URL from the
 * sitemap, which is how a site asks for a page to be deindexed, and that is not
 * a thing a build should do on its own while nobody is watching.
 */
export function missingFromData(
  data: LineData,
  published: PublishedList,
): readonly PublishedLine[] {
  const known = new Set(data.lines.map((line) => line.slug));
  // Only the batches that are live: a page that has never been published cannot
  // have been withdrawn, and reporting it would train whoever reads the build
  // log to ignore the ones that matter.
  return published.lines.filter(
    (entry) => entry.group <= published.released && !known.has(entry.slug),
  );
}

/**
 * Every published page's path, for the sitemap and for the build's own checks.
 *
 * In a stable order — the index, then the comuni, then the lines — so a
 * regeneration that changes nothing produces a byte-identical sitemap and an
 * empty diff.
 */
export function pagePaths(pages: readonly Page[]): readonly string[] {
  return pages.map((page) => page.path);
}

/**
 * Refuses a set of pages in which a line page has no parent at all.
 *
 * Every line page must be reachable by a link from somewhere, not only from the
 * sitemap. A page whose only route in is a sitemap entry is the shape search
 * engines treat as machine-made bulk, and on a domain with one inbound link it
 * is also the page that simply never gets crawled. The index is the parent of
 * last resort and it links everything, so this can only fail if the index is
 * dropped — which is exactly the regression worth catching.
 */
export function assertEveryLineHasAParent(pages: readonly Page[]): void {
  const paths = new Set(pages.map((page) => page.path));
  if (!paths.has(INDEX_PATH)) {
    throw new Error(
      `no ${INDEX_PATH} page — it is the parent of every line page that has no comune page, ` +
        "and without it those pages are reachable only from the sitemap",
    );
  }
  for (const page of pages) {
    if (page.kind !== "line") continue;
    if (page.parentPath !== null && !paths.has(page.parentPath)) {
      throw new Error(
        `${page.path} names ${page.parentPath} as its parent, but no such page is being built`,
      );
    }
  }
}
