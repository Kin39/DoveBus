import { existsSync, statSync } from "node:fs";
import { DB_RELOAD_CHECK_MS } from "../config.js";
import { logger } from "../logger.js";
import { type Db, openDatabase } from "./index.js";

export interface DbHandleOptions {
  /** How often the file is re-stat'ed for a swap. 0 checks on every read. */
  readonly checkIntervalMs?: number;
}

export interface DbHandle {
  /** The current connection, reopened first if the file was republished. */
  db(): Db;
  /** Increments on every reopen — caches key off it instead of watching files themselves. */
  readonly generation: number;
  readonly path: string;
  close(): void;
}

/**
 * A read-only connection that survives the refresh job publishing a new database.
 *
 * An import builds a staging file and `rename(2)`s it over the live one, which is
 * atomic but leaves existing connections pinned to the *old* inode — they would
 * keep serving last week's timetable forever, with nothing looking broken. This
 * notices the new inode and reopens.
 *
 * A missing file is never fatal: during the rename there is an instant where the
 * path does not resolve, and the already-open connection is still perfectly
 * readable. Downgrading that to an outage would be self-inflicted.
 */
export function openDbHandle(path: string, options: DbHandleOptions = {}): DbHandle {
  const checkIntervalMs = options.checkIntervalMs ?? DB_RELOAD_CHECK_MS;

  if (!existsSync(path)) {
    throw new Error(`no database at ${path} — run "npm run import" to build one`);
  }

  let connection = openDatabase(path, { readonly: true });
  let identity = fileIdentity(path);
  let generation = 1;
  let lastCheckMs = Date.now();

  function reopenIfSwapped(): void {
    const now = Date.now();
    if (now - lastCheckMs < checkIntervalMs) return;
    lastCheckMs = now;

    const current = fileIdentity(path);
    if (current === null || current === identity) return;

    const previous = connection;
    connection = openDatabase(path, { readonly: true });
    identity = current;
    generation++;
    previous.close();
    logger.info("reopened database after swap", { path, generation });
  }

  return {
    db(): Db {
      reopenIfSwapped();
      return connection;
    },
    get generation(): number {
      return generation;
    },
    path,
    close(): void {
      connection.close();
    },
  };
}

/** Inode plus size: a rename changes the inode, and a same-inode rebuild changes the size. */
function fileIdentity(path: string): string | null {
  try {
    const stat = statSync(path);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}
