/**
 * The public origin, resolved once for everything that has to agree on it.
 *
 * It used to live at the top of `vite.config.ts`, which was right while the
 * build was its only consumer. It is not any more: `scripts/og.ts` renders the
 * share card, and that card has the domain **printed inside the image**, bottom
 * right. A domain baked into a PNG cannot be fixed by a canonical tag — so if
 * this constant lived in two places, the day the real domain is decided
 * (§10.7) the head blocks would move and every shared link would keep showing
 * the old one, silently, in an image nobody re-reads.
 *
 * `SITE_URL` overrides it so a preview deploy can be built without editing a
 * committed file. Trailing slashes are stripped here so the callers can all
 * write `${SITE_URL}/path` without doubling one.
 */
export const SITE_URL = (process.env.SITE_URL ?? "https://dovebus.it").replace(/\/+$/, "");

/**
 * The host alone — `dovebus.it`, no scheme.
 *
 * For the places that *show* a reader a domain rather than link to it, where
 * `https://` would be noise: the foot of the share card is the only one today.
 */
export const SITE_HOST = new URL(SITE_URL).host;
