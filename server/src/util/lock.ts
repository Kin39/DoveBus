import { readFileSync, rmSync, writeFileSync } from "node:fs";

export interface Lock {
  release(): void;
}

/**
 * Single-host mutual exclusion for the import job.
 *
 * The daily systemd timer and a manual `npm run import` both build the same
 * staging file and rename it over the live database. Two overlapping runs would
 * interleave writes into one staging file and publish the result.
 *
 * A lock left behind by a killed process is taken over: the holder's pid is
 * recorded, and a pid that is no longer running cannot be holding anything.
 */
export function acquireLock(path: string): Lock {
  try {
    writeFileSync(path, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const holder = readHolderPid(path);
    if (holder !== null && isProcessAlive(holder)) {
      throw new Error(
        `another import is already running (pid ${holder}, lock ${path}) — refusing to run two at once`,
      );
    }
    // Stale lock from a crashed run.
    writeFileSync(path, String(process.pid));
  }

  return {
    release: () => rmSync(path, { force: true }),
  };
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "EEXIST";
}

function readHolderPid(path: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without delivering it.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
