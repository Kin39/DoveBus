import { daysBetweenServiceDates } from "../util/date.js";
import type { LineSummary } from "./lines.js";
import { assertFrozenSlugsStillFit, type PublishedLine } from "./slug.js";

/**
 * Whether a new edition of the line data may replace the committed one without
 * a person reading the diff.
 *
 * By hand, each refresh was checked against a list kept in a commit message:
 * no published address leaves the data, no route id changes its line number, no
 * page loses its route. Unattended, the same list has to be code — and has to
 * stop the refresh rather than warn, because a warning in a log nobody reads is
 * how a page drops out of the sitemap with the build still green.
 *
 * Every finding here *blocks*. None of them means the new data is wrong; each
 * means a decision is needed that a scheduled job should not take on its own.
 */

/** `client/seo/lines.json`, as far as these checks read it. */
export interface LineDataFile {
  readonly feed: {
    readonly startDate: string;
    readonly endDate: string;
    readonly sha1: string;
    readonly importedAt: string;
  };
  readonly referenceDate: string;
  readonly lines: readonly LineSummary[];
}

/** `client/seo/published.json`. */
export interface PublishedFile {
  readonly released: number;
  readonly lines: ReadonlyArray<PublishedLine & { readonly group: number }>;
}

export type FindingCode =
  | "frozen-slug"
  | "page-missing"
  | "route-lost"
  | "trips-collapsed"
  | "candidates-moved"
  | "slug-reassigned"
  | "window-short"
  | "reference-outside"
  | "edition-not-started";

export interface Finding {
  readonly code: FindingCode;
  readonly message: string;
}

export interface EditionComparison {
  /** The feed is byte-identical to the committed one: there is nothing to do. */
  readonly unchanged: boolean;
  readonly blocking: readonly Finding[];
  /** Released pages whose content differs between the two editions. */
  readonly changedPages: readonly string[];
}

export interface EditionCheckOptions {
  readonly today: string;
  /** Where the new edition's service really ends; see `lastFullServiceDate`. */
  readonly lastFullServiceDate: string | null;
}

/**
 * A released line keeping less than this share of its trips is a collapse, not
 * a timetable change. Measured between editions, a line's trips move by a few
 * percent; a 40% drop is what a holiday picked as the reference day looks like.
 */
const MIN_TRIPS_KEPT = 0.6;

/** Candidates moving by more than this share mean the feed changed shape, not schedule. */
const MAX_CANDIDATES_MOVED = 0.25;

/**
 * Days of real service the new edition must still have ahead of it. The job
 * runs weekly, so less than this would let the data expire before the next run
 * could replace it.
 */
const MIN_DAYS_AHEAD = 7;

export function compareEditions(
  previous: LineDataFile,
  next: LineDataFile,
  published: PublishedFile,
  options: EditionCheckOptions,
): EditionComparison {
  if (previous.feed.sha1 === next.feed.sha1) {
    // Nothing to replace — but a feed that stopped being republished leaves the
    // committed snapshot running out with every weekly run reporting success.
    // The window is still checked, so the expiry is announced a week ahead.
    const expiring = windowFindings(next, options).filter((f) => f.code === "window-short");
    return { unchanged: true, blocking: expiring, changedPages: [] };
  }

  const released = published.lines.filter((entry) => entry.group <= published.released);
  const blocking: Finding[] = [
    ...frozenSlugFindings(published, next),
    ...releasedPageFindings(released, previous, next),
    ...candidateFindings(previous, next),
    ...windowFindings(next, options),
  ];

  const before = new Map(previous.lines.map((line) => [line.slug, line]));
  const after = new Map(next.lines.map((line) => [line.slug, line]));
  const changedPages = released
    .filter((entry) => {
      const old = before.get(entry.slug);
      const current = after.get(entry.slug);
      return old && current && JSON.stringify(old) !== JSON.stringify(current);
    })
    .map((entry) => entry.slug);

  return { unchanged: false, blocking, changedPages };
}

/** B1 — every published route id still carries the number its address was minted for. */
function frozenSlugFindings(published: PublishedFile, next: LineDataFile): Finding[] {
  const current = new Map(next.lines.map((line) => [line.routeId, line.shortName]));
  return published.lines.flatMap((entry) => {
    try {
      assertFrozenSlugsStillFit([entry], current);
      return [];
    } catch (error) {
      return [{ code: "frozen-slug" as const, message: (error as Error).message }];
    }
  });
}

/** B2, B3, B4 — what each released page would lose. */
function releasedPageFindings(
  released: PublishedFile["lines"],
  previous: LineDataFile,
  next: LineDataFile,
): Finding[] {
  const before = new Map(previous.lines.map((line) => [line.slug, line]));
  const after = new Map(next.lines.map((line) => [line.slug, line]));
  const byRoute = new Map(next.lines.map((line) => [line.routeId, line]));

  return released.flatMap((entry): Finding[] => {
    const current = after.get(entry.slug);
    if (current === undefined) {
      const moved = byRoute.get(entry.routeId);
      return [
        {
          code: "page-missing",
          message:
            `/linea/${entry.slug}/ is released but no longer in the data` +
            (moved
              ? ` — route ${entry.routeId} is now computed as ${moved.slug} (comune ${moved.comune})`
              : ` — route ${entry.routeId} is not a candidate any more`),
        },
      ];
    }
    // The slug is computed from (number, comune). A published route whose comune
    // drifted away, and another route of the same number whose comune drifted in,
    // would hand the address to a different bus while every other check passes.
    if (current.routeId !== entry.routeId) {
      return [
        {
          code: "slug-reassigned",
          message:
            `/linea/${entry.slug}/ was published for route ${entry.routeId}, ` +
            `but that address now computes to route ${current.routeId} (${current.longName ?? "no name"})`,
        },
      ];
    }
    const old = before.get(entry.slug);
    if (old === undefined) return [];

    const findings: Finding[] = old.directions
      .filter((direction) => direction.stops.length > 0)
      .filter((direction) => {
        const now = current.directions.find((d) => d.directionId === direction.directionId);
        return now === undefined || now.stops.length === 0;
      })
      .map((direction) => ({
        code: "route-lost",
        message:
          `/linea/${entry.slug}/ direction ${direction.directionId} (${direction.headsign}) ` +
          `listed ${direction.stops.length} stops and would list none — coverage ${coverageOf(current, direction.directionId)}`,
      }));

    if (current.trips < old.trips * MIN_TRIPS_KEPT) {
      findings.push({
        code: "trips-collapsed",
        message: `/linea/${entry.slug}/ runs ${current.trips} trips, down from ${old.trips}`,
      });
    }
    return findings;
  });
}

function coverageOf(line: LineSummary, directionId: number): string {
  const direction = line.directions.find((d) => d.directionId === directionId);
  return direction === undefined ? "n/a (direction gone)" : String(direction.coverage);
}

/** B4 — the candidate list as a whole. */
function candidateFindings(previous: LineDataFile, next: LineDataFile): Finding[] {
  const before = previous.lines.length;
  const moved = before === 0 ? 1 : Math.abs(next.lines.length - before) / before;
  if (moved <= MAX_CANDIDATES_MOVED) return [];
  return [
    {
      code: "candidates-moved",
      message: `candidate lines went from ${before} to ${next.lines.length}`,
    },
  ];
}

/** B5 — the new edition must have real service ahead of it, around its reference day. */
function windowFindings(next: LineDataFile, options: EditionCheckOptions): Finding[] {
  const end = options.lastFullServiceDate;
  if (end === null) {
    return [{ code: "window-short", message: "the new edition carries no real service at all" }];
  }
  const findings: Finding[] = [];
  const ahead = daysBetweenServiceDates(options.today, end) ?? -1;
  if (ahead < MIN_DAYS_AHEAD) {
    findings.push({
      code: "window-short",
      message:
        `the edition's service ends on ${end}, ${ahead} days from ${options.today} ` +
        `(it declares ${next.feed.endDate}); at least ${MIN_DAYS_AHEAD} are needed`,
    });
  }
  // An edition published ahead of its start describes a timetable that is not
  // running yet; the committed one is still the right one until then.
  if (next.feed.startDate > options.today) {
    findings.push({
      code: "edition-not-started",
      message: `the new edition starts on ${next.feed.startDate}, after today (${options.today})`,
    });
  }
  if (next.referenceDate < next.feed.startDate || next.referenceDate > end) {
    findings.push({
      code: "reference-outside",
      message: `reference day ${next.referenceDate} is outside ${next.feed.startDate}–${end}`,
    });
  }
  return findings;
}

/** The comparison as Markdown, for the pull request or the issue it opens. */
export function formatReport(
  previous: LineDataFile,
  next: LineDataFile,
  comparison: EditionComparison,
): string {
  const lines = [
    `Edition ${previous.feed.startDate}–${previous.feed.endDate} → ${next.feed.startDate}–${next.feed.endDate}`,
    `Reference day ${previous.referenceDate} → ${next.referenceDate}`,
    `Candidates ${previous.lines.length} → ${next.lines.length}`,
    `Feed sha1 ${next.feed.sha1}`,
    "",
  ];
  if (comparison.blocking.length === 0) {
    lines.push("No blocking finding.");
  } else {
    lines.push("**Blocking findings** — the committed data was left as it was:", "");
    for (const finding of comparison.blocking)
      lines.push(`- \`${finding.code}\` ${finding.message}`);
  }
  lines.push(
    "",
    comparison.changedPages.length === 0
      ? "No released page changes content."
      : `Released pages whose content changes (${comparison.changedPages.length}): ${comparison.changedPages.join(", ")}`,
  );
  return `${lines.join("\n")}\n`;
}
