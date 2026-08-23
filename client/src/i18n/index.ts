import { en } from "./en.js";
import { it } from "./it.js";
import type { Strings } from "./strings.js";

export type { Strings } from "./strings.js";

/** The languages the site is published in. Italian is the original. */
export type Language = "it" | "en";

export const DICTIONARIES: Readonly<Record<Language, Strings>> = { it, en };

/**
 * Which language this document is in.
 *
 * Read from the `lang` attribute the page was served with, not from the
 * browser's preference: each language has its own URL, and the page at that URL
 * is in that language for everyone who opens it — including the crawler, which
 * has no preference, and the reader who was sent the link by someone else. A
 * page that changed language according to its visitor would make `hreflang` a
 * statement about something that is not there, and put two documents in one
 * cache entry.
 *
 * `globalThis.document` rather than `document`, so that importing a module which
 * says something to a reader does not require a DOM: the unit tests run in Node.
 */
export function resolveLanguage(): Language {
  const tag = globalThis.document?.documentElement.lang ?? "";
  return tag.toLowerCase().startsWith("en") ? "en" : "it";
}

/**
 * The words this page speaks, resolved once at start-up.
 *
 * A module-level constant rather than a lookup at each call site: the language
 * of a document cannot change while it is open, so re-deciding it thousands of
 * times a minute — the vehicle layer redraws five times a second — would be
 * work for a question whose answer is already known.
 *
 * Both dictionaries are in the bundle. Together they are a few kilobytes next to
 * the 1.1 MB of map library on this page, and the alternative — a build that
 * emits one app per language — would double every entry point to save less than
 * a rounding error of what the page already costs.
 */
export const t: Strings = DICTIONARIES[resolveLanguage()];
