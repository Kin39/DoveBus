import { existsSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { openDatabase } from "../db/index.js";

/** Tables that must hold rows for a build to be considered usable. */
const REQUIRED_NON_EMPTY_TABLES = [
  "stops",
  "routes",
  "trips",
  "stop_times",
  "shapes",
  "calendar_dates",
  "comuni",
  // Empty, it would not fail loudly: every comune→comune search would answer
  // "no direct runs", which reads as a fact about the buses.
  "trip_comuni",
  "feed_meta",
] as const;

export interface VerificationResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly rowCounts: Readonly<Record<string, number>>;
}

/**
 * Gate before the swap: a truncated download or a feed that changed shape must
 * never replace a working database with an empty one.
 */
export function verifyDatabase(path: string): VerificationResult {
  if (!existsSync(path)) {
    return { ok: false, problems: [`database not found: ${path}`], rowCounts: {} };
  }

  const db = openDatabase(path, { readonly: true });
  try {
    const problems: string[] = [];
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") problems.push(`integrity_check returned "${String(integrity)}"`);

    const rowCounts: Record<string, number> = {};
    for (const table of REQUIRED_NON_EMPTY_TABLES) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      rowCounts[table] = row.n;
      if (row.n === 0) problems.push(`table "${table}" is empty`);
    }
    return { ok: problems.length === 0, problems, rowCounts };
  } finally {
    db.close();
  }
}

/**
 * Publishes a freshly built database by renaming it over the live one.
 *
 * rename(2) within a filesystem is atomic, so a reader either sees the whole old
 * database or the whole new one — never a half-written file. Readers holding an
 * open handle keep serving the previous inode until they reopen, which is why
 * the API must reopen its connection after a swap.
 */
export function swapDatabase(stagingPath: string, livePath: string): void {
  if (!existsSync(stagingPath)) {
    throw new Error(`cannot swap: staging database missing at ${stagingPath}`);
  }
  if (dirname(stagingPath) !== dirname(livePath)) {
    throw new Error(
      "cannot swap: staging and live databases must sit in the same directory for rename to be atomic",
    );
  }
  const verification = verifyDatabase(stagingPath);
  if (!verification.ok) {
    throw new Error(
      `cannot swap: staging database failed verification — ${verification.problems.join("; ")}`,
    );
  }
  renameSync(stagingPath, livePath);
}

export function databaseSizeBytes(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}
