import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { refreshFeed } from "../src/feed/refresh.js";
import type { DownloadResult } from "../src/gtfs/download.js";
import { acquireLock } from "../src/util/lock.js";
import { createFixtureFeed, type Fixture, fixtureHeaderOnly } from "./helpers/fixtureFeed.js";

/**
 * Stands in for the HTTP download: copies a local file and hashes it exactly as
 * the real downloader does, so change detection is exercised for real.
 */
function localDownloader(sources: Readonly<Record<string, string>>) {
  const calls: string[] = [];
  const download = async (url: string, destination: string): Promise<DownloadResult> => {
    calls.push(url);
    const source = sources[url];
    if (!source) throw new Error(`unexpected download URL in test: ${url}`);
    await copyFile(source, destination);
    const bytes = await readFile(source);
    return {
      path: destination,
      bytes: bytes.length,
      sha1: createHash("sha1").update(bytes).digest("hex"),
      etag: null,
      lastModified: null,
      contentType: "application/zip",
    };
  };
  return { download, calls };
}

describe("refreshFeed", () => {
  let fixture: Fixture;
  let workDir: string;
  let livePath: string;
  let stagingPath: string;
  const GTFS_URL = "https://example.test/gtfs";
  const COMUNI_URL = "https://example.test/comuni.geojson";

  beforeEach(async () => {
    fixture = await createFixtureFeed();
    workDir = await mkdtemp(join(tmpdir(), "dovebus-refresh-"));
    livePath = join(workDir, "gtfs.db");
    stagingPath = join(workDir, "gtfs.new.db");
  });

  afterEach(async () => {
    await rm(fixture.dir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  });

  const run = (
    overrides: Partial<Parameters<typeof refreshFeed>[0]> = {},
    sources: Readonly<Record<string, string>> = {
      [GTFS_URL]: fixture.zipPath,
      [COMUNI_URL]: fixture.comuniPath,
    },
  ) => {
    const downloader = localDownloader(sources);
    return {
      downloader,
      outcome: refreshFeed({
        gtfsUrl: GTFS_URL,
        comuniGeoJsonUrl: COMUNI_URL,
        comuniGeoJsonPath: join(workDir, "comuni.geojson"),
        livePath,
        stagingPath,
        downloadDir: join(workDir, "tmp"),
        today: "20260812",
        download: downloader.download,
        ...overrides,
      }),
    };
  };

  test("imports and publishes on first run", async () => {
    const { outcome } = run();
    const result = await outcome;

    expect(result.imported).toBe(true);
    expect(result.reason).toBe("no-database");
    expect(existsSync(livePath)).toBe(true);
    expect(result.result?.rowCounts.stops).toBe(6);
    expect(result.validity).toMatchObject({ expired: false, daysRemaining: 20 });
  });

  test("fetches the comuni boundaries only when not already cached", async () => {
    const first = run();
    await first.outcome;
    expect(first.downloader.calls).toContain(COMUNI_URL);

    const second = run({ force: true });
    await second.outcome;
    expect(second.downloader.calls).not.toContain(COMUNI_URL);
  });

  test("skips the import when the feed is byte-identical", async () => {
    await run().outcome;
    const before = await stat(livePath);

    const result = await run().outcome;
    expect(result.imported).toBe(false);
    expect(result.reason).toBe("unchanged");
    expect(result.result).toBeNull();
    expect((await stat(livePath)).mtimeMs).toBe(before.mtimeMs);
  });

  test("re-imports when the published feed changed", async () => {
    await run().outcome;

    const changed = await createFixtureFeed({
      "calendar_dates.txt": [
        "service_id,date,exception_type",
        "S1,20260812,1",
        "S1,20260813,1",
        "S1,20260814,1",
        "S2,20260812,2",
      ].join("\n"),
    });
    const result = await run({}, { [GTFS_URL]: changed.zipPath, [COMUNI_URL]: changed.comuniPath })
      .outcome;

    expect(result.imported).toBe(true);
    expect(result.reason).toBe("feed-changed");
    expect(result.result?.rowCounts.calendar_dates).toBe(4);
    await rm(changed.dir, { recursive: true, force: true });
  });

  test("re-imports on demand even when nothing changed", async () => {
    await run().outcome;
    const result = await run({ force: true }).outcome;
    expect(result.imported).toBe(true);
    expect(result.reason).toBe("forced");
  });

  test("reports an expired timetable instead of silently serving it", async () => {
    await run().outcome;
    const result = await run({ today: "20260915" }).outcome;

    expect(result.imported).toBe(false);
    expect(result.validity).toMatchObject({ expired: true, daysRemaining: -14 });
  });

  test("leaves the live database untouched when the new feed is unusable", async () => {
    await run().outcome;
    const good = await readFile(livePath);

    const broken = await createFixtureFeed({
      "stops.txt": fixtureHeaderOnly("stops.txt"), // header only
    });
    await expect(
      run({}, { [GTFS_URL]: broken.zipPath, [COMUNI_URL]: broken.comuniPath }).outcome,
    ).rejects.toThrow(/failed verification/);

    expect(await readFile(livePath)).toEqual(good);
    await rm(broken.dir, { recursive: true, force: true });
  });

  test("removes the downloaded feed once the run finishes", async () => {
    await run().outcome;
    expect(existsSync(join(workDir, "tmp", "gtfs-download.zip"))).toBe(false);
  });

  test("refuses to run while another import holds the lock", async () => {
    mkdirSync(join(workDir, "tmp"), { recursive: true });
    const lock = acquireLock(join(workDir, "tmp", "import.lock"));
    await expect(run().outcome).rejects.toThrow(/already running/);
    lock.release();
  });

  test("releases the lock even when the run fails", async () => {
    const broken = await createFixtureFeed({
      "stops.txt": fixtureHeaderOnly("stops.txt"),
    });
    await expect(
      run({}, { [GTFS_URL]: broken.zipPath, [COMUNI_URL]: broken.comuniPath }).outcome,
    ).rejects.toThrow();

    expect(existsSync(join(workDir, "tmp", "import.lock"))).toBe(false);
    await rm(broken.dir, { recursive: true, force: true });
  });

  test("discards downloaded boundaries that cannot be parsed", async () => {
    const junk = join(fixture.dir, "junk.geojson");
    await writeFile(junk, "<html>404</html>", "utf8");
    const comuniPath = join(workDir, "comuni.geojson");

    await expect(
      run({ comuniGeoJsonPath: comuniPath }, { [GTFS_URL]: fixture.zipPath, [COMUNI_URL]: junk })
        .outcome,
    ).rejects.toThrow(/comuni boundaries are unusable/);
    // Not left behind to poison every later run.
    expect(existsSync(comuniPath)).toBe(false);
  });
});
