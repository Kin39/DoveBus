import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { acquireLock } from "../src/util/lock.js";

describe("acquireLock", () => {
  let dir: string;
  let lockPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dovebus-lock-"));
    lockPath = join(dir, "import.lock");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("records the holder and removes the lock on release", () => {
    const lock = acquireLock(lockPath);
    expect(readFileSync(lockPath, "utf8")).toBe(String(process.pid));

    lock.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  test("refuses a second run while a live process holds the lock", () => {
    const lock = acquireLock(lockPath);
    expect(() => acquireLock(lockPath)).toThrow(/already running/);
    lock.release();
  });

  test("takes over a lock left behind by a crashed run", () => {
    // A pid that cannot be running: pid 0 is never a normal user process.
    writeFileSync(lockPath, "999999999");
    const lock = acquireLock(lockPath);
    expect(readFileSync(lockPath, "utf8")).toBe(String(process.pid));
    lock.release();
  });

  test("takes over a lock file with unreadable contents", () => {
    writeFileSync(lockPath, "not-a-pid");
    const lock = acquireLock(lockPath);
    expect(readFileSync(lockPath, "utf8")).toBe(String(process.pid));
    lock.release();
  });

  test("release is safe to call when the lock file is already gone", () => {
    const lock = acquireLock(lockPath);
    lock.release();
    expect(() => lock.release()).not.toThrow();
  });

  test("propagates errors that are not a held lock", () => {
    expect(() => acquireLock(join(dir, "missing-dir", "import.lock"))).toThrow(/ENOENT/);
  });
});
