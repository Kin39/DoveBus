import { describe, expect, test } from "vitest";
import {
  explainStatus,
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  INDEXNOW_KEY_PATH,
  indexNowKeyFile,
  indexNowSubmission,
  MAX_URLS_PER_SUBMISSION,
  sitemapUrls,
} from "../indexnow.js";

const SITE = "https://dovebus.it";

describe("the IndexNow key", () => {
  /**
   * The protocol's own alphabet and bounds. A key outside them is rejected at
   * verification — which happens after the submission is accepted, so the error
   * arrives as silence rather than as a response code.
   */
  test("is inside the protocol's alphabet and length", () => {
    expect(INDEXNOW_KEY).toMatch(/^[a-zA-Z0-9-]{8,128}$/);
  });

  test("is published as a file named after itself, and containing itself", () => {
    // The file name *is* the key: the engine derives the URL it fetches from the
    // key in the payload, so these two cannot be allowed to drift apart.
    const file = indexNowKeyFile();
    expect(file.fileName).toBe(`${INDEXNOW_KEY}.txt`);
    expect(file.source).toBe(INDEXNOW_KEY);
    expect(INDEXNOW_KEY_PATH).toBe(`/${file.fileName}`);
  });

  test("is written with no trailing newline", () => {
    // The file's whole content is compared against the key. A newline is the
    // kind of thing a formatter adds silently and a 403 reports days later.
    expect(indexNowKeyFile().source).not.toMatch(/\s$/);
  });
});

describe("the submission", () => {
  test("names the host, the key and where the key can be read", () => {
    const body = indexNowSubmission(SITE, [`${SITE}/`]);
    expect(body.host).toBe("dovebus.it");
    expect(body.key).toBe(INDEXNOW_KEY);
    expect(body.keyLocation).toBe(`${SITE}${INDEXNOW_KEY_PATH}`);
    expect(body.urlList).toEqual([`${SITE}/`]);
  });

  /**
   * The rejection this prevents is the one worth preventing: `422` names no
   * offending URL, so a single foreign entry fails the whole batch with nothing
   * to go on. The realistic way it happens is a sitemap built with one
   * `SITE_URL` being submitted under another.
   */
  test("refuses a URL on a different host", () => {
    expect(() => indexNowSubmission(SITE, [`${SITE}/`, "https://dovebus.netlify.app/"])).toThrow(
      /not on dovebus\.it/,
    );
  });

  test("refuses a URL that is not https", () => {
    expect(() => indexNowSubmission(SITE, ["http://dovebus.it/"])).toThrow(/not https/);
  });

  test("refuses something that is not a URL at all", () => {
    expect(() => indexNowSubmission(SITE, ["/mappa/"])).toThrow(/not a URL/);
  });

  test("refuses an empty list rather than posting one", () => {
    // An empty sitemap is a broken deploy, not a deploy with nothing new in it.
    expect(() => indexNowSubmission(SITE, [])).toThrow(/empty/);
  });

  test("refuses more URLs than the protocol accepts", () => {
    const many = Array.from({ length: MAX_URLS_PER_SUBMISSION + 1 }, (_, i) => `${SITE}/p${i}`);
    expect(() => indexNowSubmission(SITE, many)).toThrow(/exceeds/);
  });

  test("submits to the shared endpoint, not to one engine", () => {
    // The engines forward submissions to each other and ask not to be sent the
    // same URLs twice; naming Bing here would be both.
    expect(INDEXNOW_ENDPOINT).toBe("https://api.indexnow.org/indexnow");
  });
});

describe("reading the deployed sitemap", () => {
  test("takes the URL list from <loc>, in order", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://dovebus.it/</loc>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://dovebus.it/mappa/</loc>
    <priority>0.9</priority>
  </url>
</urlset>`;
    expect(sitemapUrls(xml)).toEqual(["https://dovebus.it/", "https://dovebus.it/mappa/"]);
  });

  test("finds nothing in a sitemap with no entries", () => {
    expect(
      sitemapUrls('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'),
    ).toEqual([]);
  });
});

describe("the response codes", () => {
  /**
   * 202 is reported apart from 200 on purpose: it means the submission was
   * taken but the key has not been read yet, which is the one success code that
   * can still turn into nothing at all.
   */
  test("separate the two ways a submission is accepted", () => {
    expect(explainStatus(200)).toBe("accepted");
    expect(explainStatus(202)).toMatch(/pending/);
  });

  test("explain each documented refusal", () => {
    expect(explainStatus(400)).toMatch(/malformed/);
    expect(explainStatus(403)).toMatch(/key file/);
    expect(explainStatus(422)).toMatch(/host/);
    expect(explainStatus(429)).toMatch(/rate limited/);
    expect(explainStatus(500)).toBe("unexpected response");
  });
});
