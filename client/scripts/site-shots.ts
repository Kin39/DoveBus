import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type ConsoleMessage, chromium, type Page } from "playwright";

/**
 * The screenshot loop for the content pages.
 *
 * A sibling of `shots.ts`, kept separate for one practical reason: that script
 * drives the map against the live API, so it needs a running backend and it
 * takes minutes. These four pages talk to nobody, so this runs offline in
 * seconds — and a check that is cheap to run is a check that actually gets run.
 *
 * Same viewports as the plan mandates, same assertions a picture cannot make.
 *
 *   npm run site-shots              every page, every viewport
 *   npm run site-shots -- 375x812   one viewport
 */

const BASE_URL = process.env.SHOTS_URL ?? "http://localhost:5280";
const OUT_DIR = resolve(import.meta.dirname, "../shots-site");

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** Every round, per the plan. 375×812 is the primary target. */
const VIEWPORTS: readonly Viewport[] = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x812", width: 375, height: 812 },
  { name: "393x852", width: 393, height: 852 },
  { name: "414x896", width: 414, height: 896 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1280x800", width: 1280, height: 800 },
];

const PAGES = [
  { name: "1-landing", path: "/" },
  { name: "2-come-funziona", path: "/come-funziona/" },
  { name: "3-fonte-dati", path: "/fonte-dati/" },
  { name: "4-privacy", path: "/privacy/" },
] as const;

interface Findings {
  readonly viewport: string;
  readonly page: string;
  readonly horizontalScroll: number;
  readonly smallTargets: readonly string[];
  readonly overflowing: readonly string[];
  readonly consoleErrors: readonly string[];
  readonly headProblems: readonly string[];
}

const SMALL_TARGET_LIMIT = 44;

async function main(): Promise<void> {
  const only = process.argv[2];
  const viewports = only ? VIEWPORTS.filter((v) => v.name === only) : VIEWPORTS;
  if (viewports.length === 0) {
    console.error(
      `unknown viewport "${only}" — try one of: ${VIEWPORTS.map((v) => v.name).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ args: ["--lang=it-IT"] });
  const findings: Findings[] = [];

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        isMobile: viewport.width < 720,
        hasTouch: viewport.width < 720,
        locale: "it-IT",
        timezoneId: "Europe/Rome",
      });
      const page = await context.newPage();

      const consoleErrors: string[] = [];
      page.on("console", (message: ConsoleMessage) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(String(error)));

      for (const target of PAGES) {
        consoleErrors.length = 0;
        await page.goto(`${BASE_URL}${target.path}`, { waitUntil: "networkidle" });
        // The display type is the whole design: shooting before the variable
        // font lands would photograph the fallback face.
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(250);

        await page.screenshot({
          path: resolve(OUT_DIR, `${viewport.name}-${target.name}.png`),
          fullPage: true,
        });

        findings.push({
          viewport: viewport.name,
          page: target.path,
          consoleErrors: [...consoleErrors],
          headProblems: await auditHead(page, target.path),
          ...(await auditLayout(page)),
        });
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  await report(findings);
}

/** The things a picture cannot tell you. */
async function auditLayout(
  page: Page,
): Promise<Pick<Findings, "horizontalScroll" | "smallTargets" | "overflowing">> {
  return await page.evaluate((limit) => {
    const horizontalScroll = Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    /*
     * Standalone controls must clear 44 px. Links set in running prose are
     * exempt — WCAG 2.5.8 exempts inline targets explicitly, because the only
     * way to enlarge a link inside a sentence is to wreck the leading of the
     * sentence around it.
     *
     * The test is `display: inline`, which is exactly the line this design
     * draws: every navigation link, pill and button here is `inline-flex` or
     * `flex` on purpose, and every prose link is left inline. Without the
     * exemption the report is forty lines of noise per page, and a real
     * regression hides in it.
     */
    const smallTargets: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>("a[href], button, summary")) {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (getComputedStyle(node).display === "inline") continue;
      if (box.height < limit) {
        const id = node.id ? `#${node.id}` : node.className || node.tagName.toLowerCase();
        smallTargets.push(`${id} ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
    }

    /*
     * An element wider than the viewport is what causes a page to scroll
     * sideways, and it is the failure a long Tuscan comune name or an unbroken
     * URL produces first. Catching the element is more useful than catching the
     * symptom, since the symptom names no culprit.
     */
    const overflowing: string[] = [];
    const width = document.documentElement.clientWidth;
    for (const node of document.querySelectorAll<HTMLElement>("body *")) {
      const box = node.getBoundingClientRect();
      if (box.width > width + 1 || box.right > width + 1) {
        const id = node.id ? `#${node.id}` : node.className || node.tagName.toLowerCase();
        overflowing.push(`${id} → ${Math.round(box.right)}px`);
      }
    }

    return {
      horizontalScroll,
      smallTargets: [...new Set(smallTargets)],
      overflowing: [...new Set(overflowing)].slice(0, 6),
    };
  }, SMALL_TARGET_LIMIT);
}

/**
 * The SEO head block, checked rather than assumed.
 *
 * Every one of these has failed silently on some site at some point: a canonical
 * copied from another page, a description duplicated across a section, a title
 * long enough to be truncated in a result. They cost nothing to assert here and
 * they are invisible in a screenshot.
 */
async function auditHead(page: Page, path: string): Promise<readonly string[]> {
  // No named inner functions in here: esbuild rewrites them with a `__name`
  // helper that does not exist in the page, and the evaluate throws.
  const head = await page.evaluate(() => ({
    title: document.title,
    description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? "",
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? "",
    ogTitle: document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content ?? "",
    ogUrl: document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content ?? "",
    ogImage: document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content ?? "",
    h1: [...document.querySelectorAll("h1")].map((n) => n.textContent?.trim() ?? ""),
    lang: document.documentElement.lang,
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map(
      (n) => n.textContent ?? "",
    ),
  }));

  const problems: string[] = [];
  if (!head.title) problems.push("no <title>");
  else if (head.title.length > 65) problems.push(`title ${head.title.length} chars (>65)`);
  if (!head.description) problems.push("no meta description");
  else if (head.description.length > 165) {
    problems.push(`description ${head.description.length} chars (>165)`);
  }
  if (!head.canonical.endsWith(path)) problems.push(`canonical does not end in ${path}`);
  if (!head.ogUrl.endsWith(path)) problems.push(`og:url does not end in ${path}`);
  if (!head.ogTitle) problems.push("no og:title");
  if (!head.ogImage.endsWith("/og-image.png")) problems.push("no og:image");
  if (head.h1.length !== 1) problems.push(`${head.h1.length} <h1> elements`);
  if (head.lang !== "it") problems.push(`lang="${head.lang}"`);
  if (head.jsonLd.length === 0) problems.push("no JSON-LD");
  for (const block of head.jsonLd) {
    try {
      JSON.parse(block);
    } catch (error) {
      problems.push(`JSON-LD does not parse: ${String(error)}`);
    }
    if (block.includes("%SITE_URL%")) problems.push("JSON-LD has an unsubstituted %SITE_URL%");
  }
  return problems;
}

async function report(findings: readonly Findings[]): Promise<void> {
  const lines: string[] = ["# Site screenshot round", ""];
  let problems = 0;

  for (const finding of findings) {
    const issues: string[] = [];
    if (finding.horizontalScroll > 0) {
      issues.push(`horizontal scroll: ${finding.horizontalScroll}px`);
    }
    if (finding.overflowing.length > 0) {
      issues.push(`wider than the viewport: ${finding.overflowing.join(", ")}`);
    }
    if (finding.smallTargets.length > 0) {
      issues.push(`targets under ${SMALL_TARGET_LIMIT}px: ${finding.smallTargets.join(", ")}`);
    }
    if (finding.consoleErrors.length > 0) {
      issues.push(`console: ${finding.consoleErrors.join(" | ")}`);
    }
    if (finding.headProblems.length > 0) {
      issues.push(`head: ${finding.headProblems.join(", ")}`);
    }
    if (issues.length === 0) continue;
    problems += issues.length;
    lines.push(`## ${finding.viewport} · ${finding.page}`, ...issues.map((i) => `- ${i}`), "");
  }

  if (problems === 0) lines.push("No findings. Clean round.");
  const text = lines.join("\n");
  await writeFile(resolve(OUT_DIR, "REPORT.md"), `${text}\n`, "utf8");

  console.log(`\n${text}\n`);
  console.log(`${findings.length} shots → ${OUT_DIR}`);
  if (problems > 0) process.exitCode = 1;
}

await main();
