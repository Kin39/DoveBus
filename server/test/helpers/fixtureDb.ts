import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type Db, openDatabase } from "../../src/db/index.js";
import { importFeed } from "../../src/gtfs/import.js";
import { createFixtureFeed } from "./fixtureFeed.js";

export interface FixtureDb {
  readonly db: Db;
  readonly path: string;
  dispose(): Promise<void>;
}

/**
 * The fixture feed imported through the real importer, so the query layer is
 * tested against a database built exactly the way production builds one —
 * derived columns, comune enrichment and indexes included.
 */
export async function createFixtureDb(
  overrides: Readonly<Record<string, string | null>> = {},
): Promise<FixtureDb> {
  const fixture = await createFixtureFeed(overrides);
  const dbPath = join(fixture.dir, "gtfs.db");

  await importFeed({
    zipPath: fixture.zipPath,
    comuniGeoJsonPath: fixture.comuniPath,
    dbPath,
    source: { sha1: "fixture", etag: null, bytes: 1234 },
  });

  const db = openDatabase(dbPath, { readonly: true });
  return {
    db,
    path: dbPath,
    async dispose(): Promise<void> {
      db.close();
      await rm(fixture.dir, { recursive: true, force: true });
    },
  };
}
