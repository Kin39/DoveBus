import { describe, expect, test } from "vitest";
import { allowOriginFor, parseAllowedOrigins } from "../src/api/cors.js";

describe("allowed origins", () => {
  test("reads the open default as open", () => {
    expect(parseAllowedOrigins("*")).toBe("*");
    expect(allowOriginFor("*", "https://anything.example")).toBe("*");
    expect(allowOriginFor("*", undefined)).toBe("*");
  });

  test("splits a whitelist and ignores the spacing it was written with", () => {
    expect(parseAllowedOrigins("https://a.example, https://b.example ")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  test("reflects the caller's own origin rather than the configured string", () => {
    // The §6.2b bug: the whole list was written into the header, which is not a
    // value any browser accepts — so every whitelisted origin lost the stream.
    const allowed = parseAllowedOrigins("https://a.example,https://b.example");
    expect(allowOriginFor(allowed, "https://b.example")).toBe("https://b.example");
  });

  test("refuses an empty setting rather than silently allowing nobody", () => {
    // Fails closed either way, but the symptom of the typo would be a site that
    // works everywhere except in a browser.
    expect(() => parseAllowedOrigins("")).toThrow(/DOVEBUS_CORS_ORIGIN is empty/);
    expect(() => parseAllowedOrigins("  , ,")).toThrow(/DOVEBUS_CORS_ORIGIN is empty/);
  });

  test("sends no header for an origin that is not on the list", () => {
    const allowed = parseAllowedOrigins("https://a.example");
    expect(allowOriginFor(allowed, "https://evil.example")).toBeNull();
    expect(allowOriginFor(allowed, undefined)).toBeNull();
  });
});
