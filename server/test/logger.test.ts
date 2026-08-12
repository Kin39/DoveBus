import { afterEach, describe, expect, test, vi } from "vitest";
import { formatBytes, formatDuration, logger } from "../src/logger.js";

afterEach(() => vi.restoreAllMocks());

describe("logger", () => {
  test("writes one structured line per call to the right stream", () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    logger.info("import started", { table: "stop_times" });
    logger.warn("feed expired");
    logger.error("swap failed", { path: "/data/gtfs.db" });

    expect(out).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(2);
    const line = String(out.mock.calls[0]?.[0]);
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T.+ INFO import started \{"table":"stop_times"\}\n$/);
    expect(String(err.mock.calls[0]?.[0])).toContain("WARN feed expired");
  });
});

describe("formatBytes", () => {
  test("reports megabytes, switching to gigabytes past 1000 MB", () => {
    expect(formatBytes(125_017_286)).toBe("125.0 MB");
    expect(formatBytes(1_250_000_000)).toBe("1.25 GB");
  });
});

describe("formatDuration", () => {
  test("reports seconds under a minute and minutes above", () => {
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(185_000)).toBe("3m 5s");
  });
});
