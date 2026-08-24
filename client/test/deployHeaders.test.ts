import { describe, expect, test } from "vitest";
import { contentSecurityPolicy, deployHeadersFile, TILE_ORIGINS } from "../deploy-headers.js";

const API = "https://api.dovebus.it";

/** The directives, split back out of the one header line. */
function directives(apiOrigin: string): Map<string, string> {
  return new Map(
    contentSecurityPolicy(apiOrigin)
      .split("; ")
      .map((directive) => {
        const [name, ...values] = directive.split(" ");
        return [name ?? "", values.join(" ")] as const;
      }),
  );
}

describe("the Content-Security-Policy", () => {
  test("names the API the bundle was built to call", () => {
    expect(directives(API).get("connect-src")).toBe(`'self' ${API} ${TILE_ORIGINS.join(" ")}`);
  });

  /**
   * The three allowances below were each established by driving a real browser
   * (`scripts/headers-check.ts`) and watching what it refused. They look like
   * things a tidy-up would remove, so each is asserted with the reason it exists.
   */
  test("lets MapLibre build its tile worker from a blob", () => {
    // Without this the map does not draw at all — not degraded, absent.
    expect(directives(API).get("worker-src")).toBe("'self' blob:");
  });

  test("lets the freshness band keep its inline widths, and nothing else inline", () => {
    // The landing page sets a `--w` per segment as a style attribute; measured
    // without this directive, the band renders at zero width. Granted to
    // attributes alone, so an injected `<style>` block still has nowhere to land.
    const csp = directives(API);
    expect(csp.get("style-src-attr")).toBe("'unsafe-inline'");
    expect(csp.get("style-src")).toBe("'self'");
    expect(csp.get("script-src")).toBe("'self'");
  });

  test("upgrades insecure requests only when the API is already https", () => {
    // Emitted unconditionally it upgraded a LAN `http` API call and connect-src
    // then blocked it: a private address is not "potentially trustworthy" the
    // way localhost is, so the deploy artifact became unverifiable locally.
    expect(contentSecurityPolicy(API)).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("http://192.168.1.10:3200")).not.toContain(
      "upgrade-insecure-requests",
    );
  });

  test("closes the classic bypasses", () => {
    const csp = directives(API);
    expect(csp.get("default-src")).toBe("'self'");
    expect(csp.get("base-uri")).toBe("'self'");
    expect(csp.get("form-action")).toBe("'self'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("object-src")).toBe("'none'");
  });
});

describe("the _headers file", () => {
  test("is written in the form the host reads: a pattern, then indented headers", () => {
    const lines = deployHeadersFile(API).split("\n");
    expect(lines[0]).toBe("/*");
    expect(lines.slice(1, 7).every((line) => line.startsWith("  "))).toBe(true);
    expect(lines).toContain("/assets/*");
  });

  test("caches only what is content-addressed", () => {
    const file = deployHeadersFile(API);
    const assets = file.slice(file.indexOf("/assets/*"));
    expect(assets).toContain("Cache-Control: public, max-age=31536000, immutable");
    // The HTML must not be in that bargain: its name never changes.
    expect(file.slice(0, file.indexOf("/assets/*"))).not.toContain("Cache-Control");
  });

  test("carries the headers that have nothing to do with the CSP", () => {
    const file = deployHeadersFile(API);
    expect(file).toContain("X-Content-Type-Options: nosniff");
    expect(file).toContain("Referrer-Policy: strict-origin-when-cross-origin");
    expect(file).toContain("X-Frame-Options: DENY");
    expect(file).toContain("Strict-Transport-Security: max-age=31536000; includeSubDomains");
    expect(file).toContain("geolocation=()");
  });
});
