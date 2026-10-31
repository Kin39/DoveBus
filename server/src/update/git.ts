import { execFileSync } from "node:child_process";

/**
 * The few git operations the updater needs, each one plain `git` against a
 * checkout. Kept apart from the decisions in `plan.ts` so they can be run
 * against real repositories in a test: fast-forward, divergence and rollback
 * are exactly the cases where a mocked git would agree with whatever it was
 * told.
 */

export type Git = (args: readonly string[]) => string;

/** Runs git in `dir`, returning trimmed stdout and throwing on a non-zero exit. */
export function gitIn(dir: string): Git {
  return (args) =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

export function fetchOrigin(git: Git, branch: string): void {
  git(["fetch", "--quiet", "origin", branch]);
}

export function revParse(git: Git, ref: string): string {
  return git(["rev-parse", "--verify", `${ref}^{commit}`]);
}

/** True when `ancestor` is reachable from `descendant` — a fast-forward is possible. */
export function isAncestor(git: Git, ancestor: string, descendant: string): boolean {
  try {
    git(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every path the change touches. `--no-renames`, because a rename is reported
 * under its new name only, and moving a file *out of* `server/` must still count
 * as a server change; `-z`, because git quotes paths with unusual characters,
 * and a quoted `"server/…"` would not start with `server/`.
 */
export function changedFiles(git: Git, from: string, to: string): readonly string[] {
  return git(["diff", "--name-only", "--no-renames", "-z", from, to])
    .split("\0")
    .filter((path) => path !== "");
}

/** Tracked files modified in the working tree. Untracked ones are ignored. */
export function isDirty(git: Git): boolean {
  return git(["status", "--porcelain", "--untracked-files=no"]) !== "";
}

/** A file's contents at a commit, or `null` if it does not exist there. */
export function fileAt(git: Git, ref: string, path: string): string | null {
  try {
    return git(["show", `${ref}:${path}`]);
  } catch {
    return null;
  }
}

export function fastForwardTo(git: Git, ref: string): void {
  git(["merge", "--ff-only", "--quiet", ref]);
}

export function resetHardTo(git: Git, ref: string): void {
  git(["reset", "--hard", "--quiet", ref]);
}
