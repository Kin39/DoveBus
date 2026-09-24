/**
 * The addresses the line and comune pages are published at.
 *
 * `/linea/32-firenze/` and `/comune/firenze/`. The line's number comes first
 * because that is the order the searches arrive in — "percorso linea 32
 * firenze" — and the comune is always present, never only when it is needed to
 * tell two lines apart.
 *
 * **Always, because the feed grows.** Between the 20260824 edition and the
 * 20260917 one the number of routes went from 768 to 946: a line that is
 * unambiguous today can acquire a namesake in another province at any
 * republication, and an address that has been indexed is expensive to change
 * and cheap to have written long in the first place. 83 of the 776 line names
 * already serve between two and nine different comuni — 1, 2, 3, 4, 5, 6, 8, 9,
 * 10, 12, 20, 21, 32 among them, which are precisely the numbers people search.
 */

/**
 * A name reduced to the characters an address may carry.
 *
 * Measured against the whole feed rather than guessed: the only non-alphanumeric
 * characters in any of the 776 line names are the space (58), `/` (11), `+` (6)
 * and `-` (1), and the longest name is nine characters. Comune names add
 * accents and apostrophes. All of them collapse to a single hyphen.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `("32", "Firenze")` → `"32-firenze"`. */
export function lineSlug(shortName: string, comune: string): string {
  return `${slugify(shortName)}-${slugify(comune)}`;
}

/** `"Bagno a Ripoli"` → `"bagno-a-ripoli"`. */
export function comuneSlug(comune: string): string {
  return slugify(comune);
}

/** What a slug was minted for, so a clash can name both sides of itself. */
export interface SlugOwner {
  readonly slug: string;
  readonly routeId: string;
  readonly shortName: string;
  readonly comune: string;
}

/**
 * Refuses a set of slugs in which two different lines claim one address.
 *
 * This cannot be resolved by a rule, which is why it throws instead of
 * disambiguating. Reducing a name to an address is lossy — `1` and `1+` both
 * slugify to `1`, and those are two real Prato lines — so a clash is a question
 * about which line keeps the plain address and what the other one is called.
 * That is an editorial decision with a published URL attached to it, and a
 * generator that answered it by appending a number would answer it differently
 * on a different day.
 *
 * It does not fire on today's feed: across all 946 routes the pair (comune,
 * line name) is unique, and so are the 946 slugs it produces. The check exists
 * for the edition where that stops being true, which arrives without notice.
 */
export function assertUniqueSlugs(owners: readonly SlugOwner[]): void {
  const seen = new Map<string, SlugOwner>();
  for (const owner of owners) {
    const existing = seen.get(owner.slug);
    if (existing !== undefined) {
      throw new Error(
        `two lines want /linea/${owner.slug}/: ` +
          `"${existing.shortName}" in ${existing.comune} (route ${existing.routeId}) and ` +
          `"${owner.shortName}" in ${owner.comune} (route ${owner.routeId}) — ` +
          "one of them needs a different address, and which one is an editorial call",
      );
    }
    seen.set(owner.slug, owner);
  }
}

/** A line as it was when its address was published: the record a slug is frozen against. */
export interface PublishedLine {
  readonly slug: string;
  readonly routeId: string;
  /** The line's number *at publication*. A change here is what invalidates the slug. */
  readonly shortName: string;
}

/**
 * Refuses to rebuild a published page whose line is no longer the line it names.
 *
 * The slug is frozen at publication and never recomputed, because the comune a
 * route is mostly in does drift — 34 of the 729 routes shared by two editions
 * changed theirs, Siena's 104 becoming Sovicille's — and an address that
 * followed the data would rewrite itself under a reader and throw away
 * everything a search engine had learned about it.
 *
 * Freezing is only safe while `route_id` keeps its meaning. Measured across
 * those 729 shared ids, not one changed its `route_short_name` or its
 * `route_long_name`, so no published address has ever pointed at the wrong
 * line. Two editions are not a guarantee, and the failure would be silent — the
 * page would render, correctly formatted, about a different bus — so it is
 * checked on every build instead of trusted.
 *
 * A line that has simply stopped running is *not* this error: it is handled by
 * the caller, which decides between keeping the page and retiring it.
 */
export function assertFrozenSlugsStillFit(
  published: readonly PublishedLine[],
  current: ReadonlyMap<string, string>,
): void {
  for (const page of published) {
    const shortName = current.get(page.routeId);
    if (shortName === undefined) continue;
    if (shortName !== page.shortName) {
      throw new Error(
        `/linea/${page.slug}/ was published for line "${page.shortName}" (route ${page.routeId}), ` +
          `but that route is now line "${shortName}" — the feed reused the id. ` +
          "Retire the page or republish it at a new address; do not let it change under its readers",
      );
    }
  }
}
