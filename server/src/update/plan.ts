/**
 * What the API machine should do about new commits on `main`, decided from
 * facts alone.
 *
 * The VPS used to be updated by hand, which in practice meant it ran days
 * behind. This is the decision half of the updater (`npm run update`): every
 * input is gathered elsewhere and handed in, so each branch below is a test
 * rather than something found out on the production machine.
 *
 * The order is the policy. Nothing is touched before CI has passed for that
 * exact commit; a schema change is never deployed unattended, because it needs
 * an import *before* the restart and has happened once; and a halt file, left
 * by a rollback that itself failed, stops everything until a person removes it.
 * A commit that was deployed and rolled back is remembered and never retried:
 * without that, a bad commit would be deployed, judged and undone every round.
 */

export type CiStatus = "success" | "pending" | "failure";

export interface UpdateFacts {
  /** A previous round's rollback failed; a person must look first. */
  readonly halted: boolean;
  /** Tracked files modified on the machine: a reset would destroy the edit. */
  readonly dirty: boolean;
  /** `remote` is the commit an earlier round deployed and rolled back. */
  readonly rejected: boolean;
  /** How long `remote` has been waiting for a CI verdict, in ms. */
  readonly ciWaitedMs: number;
  readonly head: string;
  /** `origin/main` after the fetch. */
  readonly remote: string;
  /** `head` is an ancestor of `remote`: nobody has committed on the machine. */
  readonly fastForward: boolean;
  readonly changedFiles: readonly string[];
  readonly ci: CiStatus;
  readonly dbVersionChanged: boolean;
  /** The daily refresh, or the API's own, holds `import.lock`. */
  readonly importRunning: boolean;
}

export type UpdateAction =
  | { readonly kind: "halted" }
  | { readonly kind: "up-to-date" }
  | { readonly kind: "dirty" }
  | { readonly kind: "diverged" }
  | { readonly kind: "rejected" }
  | { readonly kind: "wait-ci" }
  | { readonly kind: "ci-stuck" }
  | { readonly kind: "ci-failed" }
  | { readonly kind: "schema-change" }
  | { readonly kind: "import-running" }
  | { readonly kind: "fast-forward" }
  | { readonly kind: "deploy"; readonly installDependencies: boolean };

/** Files whose change means the running API is not what the checkout says. */
function touchesServer(file: string): boolean {
  return file.startsWith("server/") || isManifest(file);
}

function isManifest(file: string): boolean {
  return file === "package-lock.json" || file.endsWith("package.json");
}

/**
 * How long a commit may wait for CI before the wait itself is the problem.
 * CI takes about two minutes; an hour means GitHub is refusing this machine
 * (a rate limit, a private repository, a disabled workflow) and the updater
 * has silently stopped updating.
 */
export const CI_PATIENCE_MS = 60 * 60_000;

export function planUpdate(facts: UpdateFacts): UpdateAction {
  if (facts.halted) return { kind: "halted" };
  if (facts.dirty) return { kind: "dirty" };
  if (facts.head === facts.remote) return { kind: "up-to-date" };
  if (!facts.fastForward) return { kind: "diverged" };
  if (facts.rejected) return { kind: "rejected" };
  if (facts.ci === "pending") {
    return facts.ciWaitedMs > CI_PATIENCE_MS ? { kind: "ci-stuck" } : { kind: "wait-ci" };
  }
  if (facts.ci === "failure") return { kind: "ci-failed" };
  if (!facts.changedFiles.some(touchesServer)) return { kind: "fast-forward" };
  if (facts.dbVersionChanged) return { kind: "schema-change" };
  if (facts.importRunning) return { kind: "import-running" };
  return { kind: "deploy", installDependencies: facts.changedFiles.some(isManifest) };
}

interface WorkflowRun {
  readonly name?: unknown;
  readonly status?: unknown;
  readonly conclusion?: unknown;
}

/**
 * CI's verdict from `GET /repos/{repo}/actions/runs?head_sha=…`.
 *
 * Only the workflow named `CI` counts: the IndexNow wait runs on the same push
 * and can fail for reasons that say nothing about the server (a slow Netlify
 * deploy). Anything unreadable is `pending` — an answer this machine cannot
 * parse must never be mistaken for a pass.
 */
export function ciStatusFromRuns(response: unknown): CiStatus {
  const runs = (response as { workflow_runs?: unknown } | null)?.workflow_runs;
  if (!Array.isArray(runs)) return "pending";
  const ci = (runs as WorkflowRun[]).find((run) => run.name === "CI");
  if (ci === undefined || ci.status !== "completed") return "pending";
  return ci.conclusion === "success" ? "success" : "failure";
}

/** `DB_VERSION` as written in `server/src/config.ts`, or `null` if it is not there. */
export function dbVersionOf(configSource: string): number | null {
  const match = /export const DB_VERSION = (\d+);/.exec(configSource);
  return match ? Number(match[1]) : null;
}

/**
 * Whether the schema version differs between two versions of `config.ts`.
 * Unreadable on either side counts as changed: if the constant moves or is
 * renamed, the updater must stop and ask rather than assume nothing changed.
 */
export function schemaChanged(before: string | null, after: string | null): boolean {
  const old = dbVersionOf(before ?? "");
  const next = dbVersionOf(after ?? "");
  return old === null || next === null || old !== next;
}

export type Health = "ok" | "degraded" | "stale-schema" | "down";

/** Reads a `/healthz` body; `null` means it could not be fetched at all. */
export function judgeHealth(body: string | null): Health {
  if (body === null) return "down";
  let parsed: { success?: unknown; data?: { status?: unknown; feed?: { staleSchema?: unknown } } };
  try {
    parsed = JSON.parse(body);
  } catch {
    return "down";
  }
  if (parsed.success !== true || parsed.data === undefined) return "down";
  if (parsed.data.feed?.staleSchema === true) return "stale-schema";
  return parsed.data.status === "ok" ? "ok" : "degraded";
}

/**
 * Whether the deploy made things worse.
 *
 * Judged against the health *before* it: an API already `degraded` by the
 * regional feed must not have every deploy rolled back for a fault it did not
 * cause — but it must still not be allowed to go down.
 */
export function shouldRollback(before: Health, after: Health): boolean {
  if (after === "ok") return false;
  if (before === "ok") return true;
  return after === "down" || after === "stale-schema";
}

/** `owner/name` from the clone's `origin` URL. */
export function repoSlugFromRemote(url: string): string {
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url.trim());
  if (!match) throw new Error(`origin is not a GitHub repository: ${url}`);
  return `${match[1]}/${match[2]}`;
}
