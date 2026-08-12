import { readFileSync, rmSync } from "node:fs";
import Database from "better-sqlite3";

export type Db = Database.Database;

const SCHEMA_SQL = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const INDEXES_SQL = readFileSync(new URL("./indexes.sql", import.meta.url), "utf8");

/** Sampling cap for ANALYZE — full stats on 12M rows are not worth the minutes. */
const ANALYSIS_LIMIT = 1000;

/**
 * Fresh staging database with the schema applied and no indexes yet.
 * Any leftover file from a crashed import is removed first: a staging DB is
 * disposable by definition, and resuming a partial one would corrupt row counts.
 */
export function createStagingDatabase(path: string): Db {
  rmSync(path, { force: true });
  rmSync(`${path}-journal`, { force: true });
  const db = new Database(path);
  applyImportPragmas(db);
  db.exec(SCHEMA_SQL);
  return db;
}

export function openDatabase(path: string, options: { readonly: boolean }): Db {
  return new Database(path, { readonly: options.readonly, fileMustExist: options.readonly });
}

/**
 * Import-time durability tradeoff: the staging file is rebuilt from scratch on
 * failure, so fsync-per-transaction and rollback journals buy nothing and cost
 * most of the import's wall time.
 */
export function applyImportPragmas(db: Db): void {
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -262144"); // 256 MB page cache
}

export function createIndexes(db: Db): void {
  db.exec(INDEXES_SQL);
}

/**
 * Give the planner statistics for the origin→destination self-join, which is the
 * one query where a bad plan turns 34 rows into a table scan.
 */
export function analyzeDatabase(db: Db): void {
  db.pragma(`analysis_limit = ${ANALYSIS_LIMIT}`);
  db.exec("ANALYZE");
}
