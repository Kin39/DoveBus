/**
 * IndexNow: telling the search engines a URL changed, instead of waiting.
 *
 * A crawler normally finds a change by coming back to look. On a site with no
 * inbound links it comes back rarely, because nothing ever points it here —
 * which is the state this site is in and the reason nothing was indexed for the
 * first week. IndexNow inverts it: the site announces the URL, and Bing, Yandex,
 * Seznam and Naver pull it. **Google does not participate** — it ran a trial and
 * never adopted the protocol — so this is not a substitute for Search Console,
 * it is the other half. Bing also answers for DuckDuckGo, Copilot and ChatGPT's
 * search, which is more reach than its market share suggests.
 *
 * Like `deploy-headers.ts` this is a deploy artifact in its own module rather
 * than inline in `vite.config.ts`, for the same reason: it has rules that can be
 * asserted, and a Vite config cannot be unit tested.
 */

/**
 * The key that proves the submission came from whoever controls the site.
 *
 * **Committed on purpose — this is not a secret.** The protocol's whole
 * verification step is that the same key is readable by anyone at
 * `https://<host>/<key>.txt`; a key hidden from the repository would still be
 * published by the build. What it must be is *stable*: a submission is verified
 * when the engine gets round to crawling, not when it is accepted, so a key
 * regenerated per build would invalidate every submission still in flight.
 *
 * 32 hex characters, inside the protocol's 8–128 and its [a-zA-Z0-9-] alphabet.
 */
export const INDEXNOW_KEY = "0f7ef924e59486ba6a070b6ede2b14aa";

/**
 * The neutral endpoint, which forwards to every participating engine.
 *
 * Deliberately not `bing.com/indexnow` and deliberately only one: the
 * participating engines share submissions with each other, and the protocol
 * asks submitters not to send the same URLs to several endpoints. One host is
 * both the documented behaviour and one fewer thing to be wrong.
 */
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** The path the key file is published at: the key itself, plus `.txt`. */
export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;

/** What the build writes into the publish directory, alongside `robots.txt`. */
export function indexNowKeyFile(): { readonly fileName: string; readonly source: string } {
  // No trailing newline. The file's entire content is compared against the key,
  // and the specification describes it as the key, not as a line containing it.
  return { fileName: `${INDEXNOW_KEY}.txt`, source: INDEXNOW_KEY };
}

/** The submission payload, per the protocol's bulk form. */
export interface IndexNowSubmission {
  readonly host: string;
  readonly key: string;
  readonly keyLocation: string;
  readonly urlList: readonly string[];
}

/** The protocol's own ceiling on one request. Nowhere near reachable today. */
export const MAX_URLS_PER_SUBMISSION = 10_000;

/**
 * Builds the submission, and refuses to build one that would be rejected.
 *
 * Every check here mirrors a documented failure response, because the endpoint
 * answers `422` for a host mismatch with no indication of *which* URL was
 * foreign — a rejection that is far cheaper to prevent than to diagnose. The
 * host mismatch is the realistic one: the URL list is read from the deployed
 * sitemap, and a sitemap built with the wrong `SITE_URL` would otherwise be
 * submitted for a domain this key does not cover.
 */
export function indexNowSubmission(siteUrl: string, urls: readonly string[]): IndexNowSubmission {
  const host = new URL(siteUrl).host;

  if (urls.length === 0) throw new Error("nothing to submit: the URL list is empty");
  if (urls.length > MAX_URLS_PER_SUBMISSION) {
    throw new Error(`${urls.length} URLs exceeds the protocol's ${MAX_URLS_PER_SUBMISSION}`);
  }

  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`not a URL: ${url}`);
    }
    if (parsed.host !== host) {
      throw new Error(`${url} is not on ${host} — the key covers one host, and this is not it`);
    }
    if (parsed.protocol !== "https:") {
      throw new Error(`${url} is not https`);
    }
  }

  return {
    host,
    key: INDEXNOW_KEY,
    // Stated explicitly rather than left to the default. The default *is* the
    // root, so this changes nothing today — but if the key ever moves, a
    // submission that named its location keeps working and one that relied on
    // the default fails verification silently, days later, with no error to read.
    keyLocation: `${siteUrl}${INDEXNOW_KEY_PATH}`,
    urlList: [...urls],
  };
}

/** What a response code means, in the words of the protocol. */
export function explainStatus(status: number): string {
  switch (status) {
    case 200:
      return "accepted";
    case 202:
      return "accepted — key validation pending";
    case 400:
      return "bad request: the payload was malformed";
    case 403:
      return "forbidden: the key file did not verify";
    case 422:
      return "unprocessable: a URL does not belong to the submitted host";
    case 429:
      return "rate limited: too many submissions";
    default:
      return "unexpected response";
  }
}

/**
 * The `<loc>` values of a sitemap, in document order.
 *
 * A regex rather than an XML parser on purpose: the input is this repository's
 * own generated sitemap, whose exact shape is asserted a few lines away in
 * `vite.config.ts`, and adding a parser dependency to read a file we also write
 * buys nothing. It would be the wrong call for an arbitrary third-party sitemap.
 */
export function sitemapUrls(xml: string): readonly string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1] ?? "");
}
