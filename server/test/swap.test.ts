import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/index.js";
import { databaseSizeBytes, swapDatabase, verifyDatabase } from "../src/feed/swap.js";
import { importFeed } from "../src/gtfs/import.js";
import { createFixtureFeed, type Fixture } from "./helpers/fixtureFeed.js";

describe("verifyDatabase / swapDatabase", () => {
  let fixture: Fixture;
  let livePath: string;
  let stagingPath: string;

  beforeEach(async () => {
    fixture = await createFixtureFeed();
    livePath = join(fixture.dir, "gtfs.db");
    stagingPath = join(fixture.dir, "gtfs.new.db");
  });

  afterEach(async () => {
    await rm(fixture.dir, { recursive: true, force: true });
  });

  const buildStaging = () =>
    importFeed({
      zipPath: fixture.zipPath,
      comuniGeoJsonPath: fixture.comuniPath,
      dbPath: stagingPath,
      source: { sha1: "abc", etag: null, bytes: 1 },
    });

  test("accepts a complete build", async () => {
    await buildStaging();
    const verification = verifyDatabase(stagingPath);
    expect(verification.ok).toBe(true);
    expect(verification.problems).toEqual([]);
    expect(verification.rowCounts.stop_times).toBe(4);
  });

  test("rejects a database that is missing", () => {
    const verification = verifyDatabase(join(fixture.dir, "absent.db"));
    expect(verification.ok).toBe(false);
    expect(verification.problems[0]).toMatch(/not found/);
  });

  test("rejects a database with an empty required table", async () => {
    await buildStaging();
    const db = openDatabase(stagingPath, { readonly: false });
    db.exec("DELETE FROM stop_times");
    db.close();

    const verification = verifyDatabase(stagingPath);
    expect(verification.ok).toBe(false);
    expect(verification.problems).toContain('table "stop_times" is empty');
  });

  test("renames the staging database over the live one", async () => {
    await buildStaging();
    swapDatabase(stagingPath, livePath);

    expect(existsSync(stagingPath)).toBe(false);
    const db = openDatabase(livePath, { readonly: true });
    expect((db.prepare("SELECT COUNT(*) AS n FROM trips").get() as { n: number }).n).toBe(2);
    db.close();
  });

  test("replaces an existing live database in place", async () => {
    await buildStaging();
    swapDatabase(stagingPath, livePath);
    await buildStaging();
    swapDatabase(stagingPath, livePath);

    const db = openDatabase(livePath, { readonly: true });
    expect((db.prepare("SELECT COUNT(*) AS n FROM stops").get() as { n: number }).n).toBe(6);
    db.close();
  });

  test("refuses to publish a build that fails verification", async () => {
    await buildStaging();
    const db = openDatabase(stagingPath, { readonly: false });
    db.exec("DELETE FROM shapes");
    db.close();

    expect(() => swapDatabase(stagingPath, livePath)).toThrow(/failed verification/);
    expect(existsSync(livePath)).toBe(false);
  });

  test("measures the built database, and reports zero when it is absent", async () => {
    await buildStaging();
    expect(databaseSizeBytes(stagingPath)).toBeGreaterThan(0);
    expect(databaseSizeBytes(join(fixture.dir, "absent.db"))).toBe(0);
  });

  test("refuses to swap when the staging database is missing", () => {
    expect(() => swapDatabase(join(fixture.dir, "absent.db"), livePath)).toThrow(
      /staging database missing/,
    );
  });

  test("refuses a cross-directory swap, which would not be atomic", async () => {
    await buildStaging();
    const otherDir = await mkdtemp(join(tmpdir(), "dovebus-other-"));
    expect(() => swapDatabase(stagingPath, join(otherDir, "gtfs.db"))).toThrow(/same directory/);
    await rm(otherDir, { recursive: true, force: true });
  });
});
