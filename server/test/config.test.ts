import { afterEach, describe, expect, test, vi } from "vitest";

/** Re-reads `config.ts` with one variable set, since it resolves at import time. */
async function loadTrustProxy(value: string | undefined): Promise<boolean | number> {
  vi.resetModules();
  vi.stubEnv("DOVEBUS_TRUST_PROXY", value);
  const config = await import("../src/config.js");
  return config.TRUST_PROXY;
}

describe("DOVEBUS_TRUST_PROXY", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("does not believe X-Forwarded-For unless a deploy says to", async () => {
    // The unsafe mode must cost a deliberate act: it used to be on by default,
    // which made every per-IP limit evadable with a header the caller writes.
    await expect(loadTrustProxy(undefined)).resolves.toBe(false);
    await expect(loadTrustProxy("")).resolves.toBe(false);
    await expect(loadTrustProxy("false")).resolves.toBe(false);
  });

  test("takes a hop count, which is the form to prefer behind Caddy", async () => {
    await expect(loadTrustProxy("1")).resolves.toBe(1);
    await expect(loadTrustProxy("2")).resolves.toBe(2);
  });

  test("still accepts the whole-chain form, spelled out", async () => {
    await expect(loadTrustProxy("true")).resolves.toBe(true);
  });

  test("refuses a value it cannot mean, rather than guessing at one", async () => {
    await expect(loadTrustProxy("yes")).rejects.toThrow(/DOVEBUS_TRUST_PROXY/);
    await expect(loadTrustProxy("0")).rejects.toThrow(/positive hop count/);
    await expect(loadTrustProxy("-1")).rejects.toThrow(/positive hop count/);
  });
});
