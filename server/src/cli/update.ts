/**
 * Brings the API machine up to date with `main`, or says why it did not.
 *
 *   npm run update            act
 *   npm run update -- --dry   decide and report, change nothing
 *
 * Run every fifteen minutes by `dovebus-update.timer`, as the `dovebus` user,
 * whose only extra right is `sudo systemctl restart dovebus-api` (DEPLOY.md,
 * "Updating the app"). The decisions are `planUpdate` in `src/update/plan.ts`;
 * this file gathers the facts, carries out the one action, and reports it to
 * healthchecks (`HC_VPS_UPDATE_URL`): success for every healthy round, failure
 * for anything a person has to look at. Healthchecks emails on the change of
 * state, so a failure that persists for days is one email, not a hundred.
 *
 * A deploy is checked against `/healthz` for up to three minutes and rolled
 * back if it made the API worse — or if any step after the fast-forward threw,
 * since the checkout would otherwise be ahead of the API it claims to be. The
 * rolled-back commit is remembered and not retried. If the rollback does not
 * bring the API back either, a halt file stops every later round until a person
 * removes it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { API_PORT, DATA_DIR, DOWNLOAD_DIR, USER_AGENT } from "../config.js";
import { logger } from "../logger.js";
import {
  changedFiles,
  fastForwardTo,
  fetchOrigin,
  fileAt,
  gitIn,
  isAncestor,
  isDirty,
  resetHardTo,
  revParse,
} from "../update/git.js";
import {
  type CiStatus,
  ciStatusFromRuns,
  type Health,
  judgeHealth,
  planUpdate,
  repoSlugFromRemote,
  schemaChanged,
  shouldRollback,
  type UpdateAction,
  type UpdateFacts,
} from "../update/plan.js";

const DRY_RUN = process.argv.includes("--dry");
const REPO_DIR = resolve(import.meta.dirname, "../../..");
const BRANCH = "main";
const HALT_FILE = resolve(DATA_DIR, "update.halt");
/** The sha of the last commit deployed and rolled back. */
const REJECTED_FILE = resolve(DATA_DIR, "update.rejected");
/** `<sha> <first seen ms>` while a commit waits for CI. */
const WAITING_FILE = resolve(DATA_DIR, "update.waiting");
const IMPORT_LOCK = resolve(DOWNLOAD_DIR, "import.lock");
const CONFIG_PATH = "server/src/config.ts";
const HEALTH_URL = `http://127.0.0.1:${API_PORT}/healthz`;
/** The API is `degraded` for about a minute after a restart; three is a fault. */
const HEALTH_DEADLINE_MS = 180_000;
const HEALTH_POLL_MS = 10_000;
const HTTP_TIMEOUT_MS = 15_000;
/** How long a restart waits for a running import to finish before going ahead. */
const IMPORT_WAIT_MS = 15 * 60_000;
const IMPORT_POLL_MS = 30_000;

const git = gitIn(REPO_DIR);

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

/** Same rule as `util/lock.ts`: a live pid holds the lock, and EPERM is alive. */
function importRunning(): boolean {
  const pid = Number(readText(IMPORT_LOCK));
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForImport(): Promise<void> {
  const deadline = Date.now() + IMPORT_WAIT_MS;
  while (importRunning() && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, IMPORT_POLL_MS));
  }
}

function ciWaitedMs(remote: string): number {
  const [sha, since] = (readText(WAITING_FILE) ?? "").split(" ");
  return sha === remote && Number(since) > 0 ? Date.now() - Number(since) : 0;
}

/** Remembers when `remote` started waiting for CI; forgets it once it is not waiting. */
function trackCiWait(action: UpdateAction, remote: string): void {
  const waiting = action.kind === "wait-ci" || action.kind === "ci-stuck";
  if (!waiting) {
    rmSync(WAITING_FILE, { force: true });
  } else if (!(readText(WAITING_FILE) ?? "").startsWith(`${remote} `)) {
    writeFileSync(WAITING_FILE, `${remote} ${Date.now()}\n`);
  }
}

async function ciStatus(sha: string): Promise<CiStatus> {
  const slug = repoSlugFromRemote(git(["config", "remote.origin.url"]));
  const url = `https://api.github.com/repos/${slug}/actions/runs?head_sha=${sha}&event=push`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return ciStatusFromRuns(response.ok ? await response.json() : null);
  } catch {
    return "pending";
  }
}

async function gatherFacts(): Promise<UpdateFacts> {
  fetchOrigin(git, BRANCH);
  const head = revParse(git, "HEAD");
  const remote = revParse(git, `origin/${BRANCH}`);
  const ahead = head !== remote;
  return {
    halted: existsSync(HALT_FILE),
    dirty: isDirty(git),
    rejected: readText(REJECTED_FILE) === remote,
    ciWaitedMs: ciWaitedMs(remote),
    head,
    remote,
    fastForward: ahead ? isAncestor(git, head, remote) : true,
    changedFiles: ahead ? changedFiles(git, head, remote) : [],
    ci: ahead ? await ciStatus(remote) : "success",
    dbVersionChanged:
      ahead && schemaChanged(fileAt(git, head, CONFIG_PATH), fileAt(git, remote, CONFIG_PATH)),
    importRunning: importRunning(),
  };
}

async function health(): Promise<Health> {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    return judgeHealth(await response.text());
  } catch {
    return judgeHealth(null);
  }
}

/** Polls until healthy or the deadline; returns the last health seen. */
async function settle(): Promise<Health> {
  const deadline = Date.now() + HEALTH_DEADLINE_MS;
  for (;;) {
    await new Promise((done) => setTimeout(done, HEALTH_POLL_MS));
    const now = await health();
    if (now === "ok" || Date.now() >= deadline) return now;
  }
}

function installDependencies(): void {
  execFileSync("npm", ["ci", "--omit=dev"], { cwd: REPO_DIR, stdio: "inherit" });
}

function restartApi(): void {
  // `-n`: never prompt. Without the sudoers rule this fails loudly instead of hanging.
  execFileSync("sudo", ["-n", "/usr/bin/systemctl", "restart", "dovebus-api"], {
    stdio: "inherit",
  });
}

interface Outcome {
  readonly healthy: boolean;
  readonly message: string;
}

async function deploy(facts: UpdateFacts, withDependencies: boolean): Promise<Outcome> {
  const before = await health();
  // Without a working probe there is nothing to judge the deploy by, and every
  // deploy would look like a failure and end in a halt.
  if (before === "down") {
    return { healthy: false, message: `${HEALTH_URL} does not answer — not deploying blind` };
  }
  if (importRunning()) return { healthy: true, message: "an import started — deploy postponed" };

  try {
    fastForwardTo(git, facts.remote);
  } catch (error) {
    return { healthy: false, message: `fast-forward failed, nothing changed: ${String(error)}` };
  }

  let after: Health;
  let failure = "";
  try {
    if (withDependencies) installDependencies();
    await waitForImport();
    restartApi();
    after = await settle();
  } catch (error) {
    after = "down";
    failure = ` (${String(error)})`;
  }
  if (!shouldRollback(before, after)) {
    return { healthy: true, message: `deployed ${facts.remote} (health ${before} → ${after})` };
  }
  return rollBack(facts, withDependencies, before, `${after}${failure}`);
}

async function rollBack(
  facts: UpdateFacts,
  withDependencies: boolean,
  before: Health,
  what: string,
): Promise<Outcome> {
  logger.error("deploy made the API worse — rolling back", { before, after: what, to: facts.head });
  writeFileSync(REJECTED_FILE, `${facts.remote}\n`);
  let again: Health;
  try {
    resetHardTo(git, facts.head);
    if (withDependencies) installDependencies();
    restartApi();
    again = await settle();
  } catch (error) {
    logger.error("rollback failed", { error: String(error) });
    again = "down";
  }
  if (shouldRollback(before, again)) {
    writeFileSync(
      HALT_FILE,
      `rollback to ${facts.head} left the API ${again} at ${new Date().toISOString()}\n`,
    );
    return {
      healthy: false,
      message: `deploy of ${facts.remote} left the API ${what}, and the rollback ${again} — halted, see ${HALT_FILE}`,
    };
  }
  return {
    healthy: false,
    message: `deploy of ${facts.remote} left the API ${what}; rolled back to ${facts.head} (${again}), and it will not be retried`,
  };
}

const QUIET: ReadonlySet<UpdateAction["kind"]> = new Set([
  "up-to-date",
  "wait-ci",
  "import-running",
]);
const NEEDS_A_PERSON: Readonly<Partial<Record<UpdateAction["kind"], string>>> = {
  halted: `halted by an earlier failed rollback — remove ${HALT_FILE} once fixed`,
  diverged: "the checkout has commits origin does not — someone edited on the machine",
  "ci-failed": "CI failed for the new commit — not deployed",
  "schema-change": "DB_VERSION changed — deploy by hand, importing before the restart (DEPLOY.md)",
  dirty: "tracked files are modified in the checkout — a reset would destroy them",
  rejected: "the new commit was deployed and rolled back earlier — push a fix",
  "ci-stuck": "no CI verdict for the new commit in over an hour — is GitHub reachable?",
};

async function carryOut(action: UpdateAction, facts: UpdateFacts): Promise<Outcome> {
  const problem = NEEDS_A_PERSON[action.kind];
  if (problem !== undefined) return { healthy: false, message: problem };
  if (QUIET.has(action.kind)) return { healthy: true, message: action.kind };
  if (DRY_RUN)
    return { healthy: true, message: `dry run: would ${action.kind} to ${facts.remote}` };
  if (action.kind === "fast-forward") {
    fastForwardTo(git, facts.remote);
    return { healthy: true, message: `fast-forwarded to ${facts.remote} (no server change)` };
  }
  if (action.kind === "deploy") return deploy(facts, action.installDependencies);
  return { healthy: false, message: `unhandled action ${action.kind}` };
}

async function ping(outcome: Outcome): Promise<void> {
  const url = process.env.HC_VPS_UPDATE_URL;
  if (!url) return;
  try {
    await fetch(outcome.healthy ? url : `${url}/fail`, {
      method: "POST",
      body: outcome.message,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn("healthchecks ping failed", { error: String(error) });
  }
}

let outcome: Outcome;
try {
  const facts = await gatherFacts();
  const action = planUpdate(facts);
  trackCiWait(action, facts.remote);
  outcome = await carryOut(action, facts);
  const fields = { action: action.kind, head: facts.head, remote: facts.remote, dryRun: DRY_RUN };
  if (outcome.healthy) logger.info(outcome.message, fields);
  else logger.error(outcome.message, fields);
} catch (error) {
  outcome = { healthy: false, message: `update failed: ${String(error)}` };
  logger.error(outcome.message);
}
await ping(outcome);
if (!outcome.healthy) process.exitCode = 1;
