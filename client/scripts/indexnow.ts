import {
  explainStatus,
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  INDEXNOW_KEY_PATH,
  indexNowSubmission,
  sitemapUrls,
} from "../indexnow.js";
import { SITE_URL } from "../site-url.js";

/**
 * Announces the deployed URLs to the IndexNow engines.
 *
 *   npm run indexnow            submit
 *   npm run indexnow -- --dry   check everything, send nothing
 *
 * **Run this after a deploy is live, not during the build.** That is the whole
 * reason it is a script you run rather than a Netlify build step, and the
 * ordering is not a detail: a build finishes *before* its output is published,
 * so a ping fired from the build announces URLs whose new content is not there
 * yet. The engine then fetches the old page and marks it seen — the exact
 * opposite of the intent, and invisible when it happens.
 *
 * So the script proves the deploy is live before it says anything, by reading
 * two files off the production origin: the key file, whose contents must match
 * the key being submitted, and the sitemap, which is where the URL list comes
 * from. Nothing here is hardcoded twice — add a page to `PAGES` in
 * `vite.config.ts`, deploy, and the next run submits it with no edit to make.
 *
 * Exits 1 if the site is not ready or the endpoint refuses, so it can be
 * chained after a deploy check.
 */

const DRY_RUN = process.argv.includes("--dry") || process.argv.includes("--dry-run");
const ORIGIN = process.env.INDEXNOW_ORIGIN ?? SITE_URL;
const TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  console.log(`IndexNow — ${ORIGIN}${DRY_RUN ? " (dry run)" : ""}`);

  const keyServed = await verifyKeyFile();
  if (!keyServed) {
    process.exitCode = 1;
    return;
  }

  const urls = await readSitemap();
  if (!urls) {
    process.exitCode = 1;
    return;
  }

  let submission: ReturnType<typeof indexNowSubmission>;
  try {
    submission = indexNowSubmission(ORIGIN, urls);
  } catch (error) {
    console.error(`  FAIL — ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`  submitting ${submission.urlList.length} URLs:`);
  for (const url of submission.urlList) console.log(`    ${url}`);

  if (DRY_RUN) {
    console.log("  dry run — nothing sent.");
    return;
  }

  await submit(submission);
}

/**
 * The key file has to be live, and it has to contain *this* key.
 *
 * Checked rather than assumed because the engine checks it too, only later and
 * without telling anyone: a submission whose key file is missing comes back
 * `200`, is queued, and is dropped at verification time. Reading it here turns a
 * silent no-op days from now into a failure on this line.
 */
async function verifyKeyFile(): Promise<boolean> {
  const url = `${ORIGIN}${INDEXNOW_KEY_PATH}`;
  const response = await get(url);

  if (!response) return false;
  if (!response.ok) {
    console.error(`  FAIL — key file ${url} returned ${response.status}.`);
    console.error("         The deploy carrying it is not live yet.");
    return false;
  }

  const body = (await response.text()).trim();
  if (body !== INDEXNOW_KEY) {
    console.error(`  FAIL — key file serves a different key than the one being submitted.`);
    console.error(`         served ${body.slice(0, 40)}, expected ${INDEXNOW_KEY}`);
    return false;
  }

  console.log(`  key file verified at ${INDEXNOW_KEY_PATH}`);
  return true;
}

/** The deployed sitemap is the URL list — one source of truth, already public. */
async function readSitemap(): Promise<readonly string[] | null> {
  const url = `${ORIGIN}/sitemap.xml`;
  const response = await get(url);

  if (!response) return null;
  if (!response.ok) {
    console.error(`  FAIL — ${url} returned ${response.status}.`);
    return null;
  }

  const urls = sitemapUrls(await response.text());
  if (urls.length === 0) {
    console.error(`  FAIL — ${url} lists no <loc> entries.`);
    return null;
  }

  console.log(`  sitemap lists ${urls.length} URLs`);
  return urls;
}

async function submit(body: ReturnType<typeof indexNowSubmission>): Promise<void> {
  let response: Response;
  try {
    response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`  FAIL — ${INDEXNOW_ENDPOINT} unreachable: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const explanation = explainStatus(response.status);

  // 200 and 202 both mean the submission was taken. They are reported apart
  // because 202 means the key has not been read yet, and a 202 that never turns
  // into crawling is the symptom of a key file that is unreachable in a way this
  // script's own fetch could not see — a firewall rule, a header, a CDN region.
  if (response.status === 200 || response.status === 202) {
    console.log(`  PASS — ${response.status} ${explanation}`);
    return;
  }

  console.error(`  FAIL — ${response.status} ${explanation}`);
  const detail = (await response.text()).trim();
  if (detail !== "") console.error(`         ${detail.slice(0, 400)}`);
  process.exitCode = 1;
}

/** A GET that reports its own failure rather than throwing into the top level. */
async function get(url: string): Promise<Response | null> {
  try {
    // `no-store`, because a cached 404 from an earlier run of this same script
    // would report the deploy as missing long after it went live.
    return await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    console.error(`  FAIL — ${url} unreachable: ${(error as Error).message}`);
    return null;
  }
}

await main();
