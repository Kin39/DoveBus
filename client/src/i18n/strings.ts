import type { FreshnessBucket } from "../api/types.js";

/**
 * Every word the interface says, and the shape both languages must fill.
 *
 * Written as a type rather than as a flat map of keys because the compiler is
 * then the thing that catches a missing translation: a dictionary that omits a
 * sentence does not compile, and one that keeps a sentence nobody uses any more
 * is a field with no reader. There is no `t("some.key")` and no fallback to
 * Italian — a fallback is how half a page ends up in the wrong language without
 * anyone noticing.
 *
 * Anything with a number or a name in it is a **function**, never a template
 * with a placeholder: Italian and English disagree about plurals, about where
 * the preposition goes, and about whether a unit takes a space. Handing each
 * dictionary the numbers and letting it write its own sentence is the only
 * version of this that stays honest as more of them are added.
 *
 * What is deliberately *not* here: stop names, line codes and headsigns, which
 * come from the operator's own feed and are Italian in both languages, and the
 * names on the map, which the basemap resolves through `name:it` regardless of
 * who is reading. A bus stop is not translated, it is asked for by name.
 */
export interface Strings {
  /** BCP 47 tag for the document, `Intl`, and the `hreflang` this page is. */
  readonly locale: string;
  /** The path prefix this language's pages live under: `""` for Italian. */
  readonly prefix: string;

  readonly freshness: Readonly<Record<FreshnessBucket, string>>;

  readonly age: {
    readonly unknown: string;
    readonly now: string;
    readonly seconds: (value: number) => string;
    readonly minutes: (value: number) => string;
    readonly hours: (value: number) => string;
  };

  readonly meter: {
    /** The whole readout, for a screen reader that cannot see the bar. */
    readonly label: (freshness: string, age: string) => string;
  };

  readonly delay: {
    readonly cancelled: string;
    readonly onTime: string;
    readonly early: (minutes: number) => string;
    readonly late: (minutes: number) => string;
  };

  readonly duration: {
    readonly minutes: (value: number) => string;
    readonly hoursMinutes: (hours: number, minutes: number) => string;
  };

  readonly search: {
    readonly modes: string;
    readonly tabOd: string;
    readonly tabLine: string;
    readonly origin: string;
    readonly originPlaceholder: string;
    readonly destination: string;
    readonly destinationPlaceholder: string;
    readonly swap: string;
    readonly line: string;
    readonly linePlaceholder: string;
    readonly day: string;
    readonly dayPlaceholder: string;
    readonly from: string;
    readonly to: string;
    readonly clockPlaceholder: string;
    readonly submit: string;
    readonly noLine: string;
    readonly noComune: string;
  };

  readonly results: {
    readonly back: string;
    readonly today: string;
    /** `23/08` — the day of a search that is not about today. */
    readonly shortDate: (day: string, month: string) => string;
    readonly window: (when: string, from: string, to: string) => string;
    readonly count: (total: number) => string;
    readonly firstCount: (total: number) => string;
    readonly emptyTitle: string;
    readonly emptyHint: string;
    readonly running: string;
    readonly runningTitle: string;
    readonly rowLabel: (row: {
      readonly line: string;
      readonly departure: string;
      readonly origin: string;
      readonly arrival: string;
      readonly destination: string;
    }) => string;
  };

  readonly trip: {
    readonly back: string;
    readonly unknownDestination: string;
    readonly stops: string;
    readonly noBus: string;
    readonly noBusHint: string;
    readonly notRunningToday: string;
    readonly stopOf: (index: number, total: number) => string;
    readonly reconnecting: string;
    readonly estimateMetres: (metres: number) => string;
    readonly estimateKilometres: (kilometres: string) => string;
    readonly trail: string;
    readonly trailWithPoints: (points: number) => string;
  };

  readonly callout: {
    readonly label: string;
    readonly close: string;
    readonly vehicle: (label: string) => string;
    readonly inService: string;
    readonly outOfService: string;
    readonly follow: string;
    readonly occupancy: Readonly<Record<string, string>>;
  };

  readonly credits: {
    readonly data: string;
    readonly boundaries: (basemap: string) => string;
    readonly basemap: { readonly openfreemap: string; readonly carto: string };
    /** Shown until the style settles and the real basemap is known. */
    readonly basemapUnknown: string;
    /** The raster style's own attribution control, which takes HTML. */
    readonly attributionHtml: string;
    readonly nav: string;
    readonly links: readonly { readonly href: string; readonly text: string }[];
  };

  readonly errors: {
    readonly generic: string;
    readonly offline: string;
    readonly unreachable: string;
    readonly badResponse: string;
    readonly badService: string;
    readonly unscheduledTrip: string;
    readonly rateLimited: string;
  };
}
