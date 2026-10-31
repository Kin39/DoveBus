import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  changedFiles,
  fastForwardTo,
  fetchOrigin,
  fileAt,
  type Git,
  gitIn,
  isAncestor,
  isDirty,
  resetHardTo,
  revParse,
} from "../src/update/git.js";

/**
 * Three real repositories: a bare `origin`, a `dev` clone that pushes, and a
 * `vps` clone that the updater would run in.
 */
let root: string;
let dev: Git;
let vps: Git;

function commit(git: Git, dir: string, file: string, contents: string): string {
  writeFileSync(join(dir, file), contents);
  git(["add", file]);
  git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", `change ${file}`]);
  return revParse(git, "HEAD");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dovebus-update-"));
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", join(root, "origin")]);
  execFileSync("git", ["clone", "--quiet", join(root, "origin"), join(root, "dev")], {
    stdio: "ignore",
  });
  dev = gitIn(join(root, "dev"));
  dev(["checkout", "--quiet", "-b", "main"]);
  commit(dev, join(root, "dev"), "config.ts", "export const DB_VERSION = 2;\n");
  dev(["push", "--quiet", "origin", "main"]);
  execFileSync("git", ["clone", "--quiet", join(root, "origin"), join(root, "vps")], {
    stdio: "ignore",
  });
  vps = gitIn(join(root, "vps"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the updater's git operations, on real repositories", () => {
  test("sees a new commit on origin, what it changed, and fast-forwards to it", () => {
    const before = revParse(vps, "HEAD");
    const pushed = commit(dev, join(root, "dev"), "server.ts", "new\n");
    dev(["push", "--quiet", "origin", "main"]);

    fetchOrigin(vps, "main");
    const remote = revParse(vps, "origin/main");
    expect(remote).toBe(pushed);
    expect(isAncestor(vps, before, remote)).toBe(true);
    expect(changedFiles(vps, before, remote)).toEqual(["server.ts"]);

    fastForwardTo(vps, remote);
    expect(revParse(vps, "HEAD")).toBe(pushed);
  });

  test("reads a file at either commit, so a DB_VERSION bump can be seen before deploying", () => {
    const before = revParse(vps, "HEAD");
    commit(dev, join(root, "dev"), "config.ts", "export const DB_VERSION = 3;\n");
    dev(["push", "--quiet", "origin", "main"]);
    fetchOrigin(vps, "main");

    expect(fileAt(vps, before, "config.ts")).toContain("DB_VERSION = 2");
    expect(fileAt(vps, "origin/main", "config.ts")).toContain("DB_VERSION = 3");
    expect(fileAt(vps, "origin/main", "missing.ts")).toBeNull();
  });

  test("detects a checkout that has diverged, and refuses to fast-forward it", () => {
    commit(vps, join(root, "vps"), "local.txt", "edited on the machine\n");
    commit(dev, join(root, "dev"), "server.ts", "new\n");
    dev(["push", "--quiet", "origin", "main"]);
    fetchOrigin(vps, "main");

    const head = revParse(vps, "HEAD");
    const remote = revParse(vps, "origin/main");
    expect(isAncestor(vps, head, remote)).toBe(false);
    expect(() => fastForwardTo(vps, remote)).toThrow();
    expect(revParse(vps, "HEAD")).toBe(head);
  });

  test("lists both sides of a file moved out of server/, so the move still counts", () => {
    execFileSync("mkdir", ["-p", join(root, "dev", "server"), join(root, "dev", "client")]);
    commit(dev, join(root, "dev"), "server/x.ts", "code\n");
    dev(["push", "--quiet", "origin", "main"]);
    fetchOrigin(vps, "main");
    fastForwardTo(vps, "origin/main");
    const before = revParse(vps, "HEAD");
    dev(["mv", "server/x.ts", "client/x.ts"]);
    dev(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "move"]);
    dev(["push", "--quiet", "origin", "main"]);
    fetchOrigin(vps, "main");

    expect(changedFiles(vps, before, "origin/main")).toEqual(["client/x.ts", "server/x.ts"]);
  });

  test("sees a modified tracked file, and ignores untracked ones", () => {
    expect(isDirty(vps)).toBe(false);
    writeFileSync(join(root, "vps", "untracked.txt"), "cache\n");
    expect(isDirty(vps)).toBe(false);
    writeFileSync(join(root, "vps", "config.ts"), "edited on the machine\n");
    expect(isDirty(vps)).toBe(true);
  });

  test("rolls back to the recorded commit after a deploy", () => {
    const before = revParse(vps, "HEAD");
    commit(dev, join(root, "dev"), "server.ts", "broken\n");
    dev(["push", "--quiet", "origin", "main"]);
    fetchOrigin(vps, "main");
    fastForwardTo(vps, "origin/main");

    resetHardTo(vps, before);
    expect(revParse(vps, "HEAD")).toBe(before);
    expect(fileAt(vps, "HEAD", "server.ts")).toBeNull();
  });
});
