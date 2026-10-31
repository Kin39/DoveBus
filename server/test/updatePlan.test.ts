import { describe, expect, test } from "vitest";
import {
  ciStatusFromRuns,
  dbVersionOf,
  judgeHealth,
  planUpdate,
  repoSlugFromRemote,
  schemaChanged,
  shouldRollback,
  type UpdateFacts,
} from "../src/update/plan.js";

const FACTS: UpdateFacts = {
  halted: false,
  dirty: false,
  rejected: false,
  ciWaitedMs: 0,
  head: "aaa",
  remote: "bbb",
  fastForward: true,
  changedFiles: ["server/src/api/server.ts"],
  ci: "success",
  dbVersionChanged: false,
  importRunning: false,
};

describe("planUpdate", () => {
  test("deploys a passed commit that changes the server", () => {
    expect(planUpdate(FACTS)).toEqual({ kind: "deploy", installDependencies: false });
  });

  test("reinstalls dependencies only when the lockfile or a manifest changed", () => {
    for (const file of ["package-lock.json", "server/package.json", "package.json"]) {
      expect(planUpdate({ ...FACTS, changedFiles: [file] })).toEqual({
        kind: "deploy",
        installDependencies: true,
      });
    }
  });

  test("does nothing when there is nothing new", () => {
    expect(planUpdate({ ...FACTS, remote: "aaa", changedFiles: [] }).kind).toBe("up-to-date");
  });

  test("a halt file outranks everything, even a waiting deploy", () => {
    expect(planUpdate({ ...FACTS, halted: true }).kind).toBe("halted");
  });

  test("stops when the checkout has diverged — someone edited on the machine", () => {
    expect(planUpdate({ ...FACTS, fastForward: false }).kind).toBe("diverged");
  });

  test("waits while CI is running, and refuses a commit CI failed", () => {
    expect(planUpdate({ ...FACTS, ci: "pending" }).kind).toBe("wait-ci");
    expect(planUpdate({ ...FACTS, ci: "failure" }).kind).toBe("ci-failed");
  });

  test("a client-only commit is fast-forwarded without a restart", () => {
    const facts = { ...FACTS, changedFiles: ["client/seo/lines.json", "DEPLOY.md"] };
    expect(planUpdate(facts).kind).toBe("fast-forward");
  });

  test("never deploys a schema change: it needs an import before the restart, and a person", () => {
    expect(planUpdate({ ...FACTS, dbVersionChanged: true }).kind).toBe("schema-change");
  });

  test("skips the round while an import holds the lock", () => {
    expect(planUpdate({ ...FACTS, importRunning: true }).kind).toBe("import-running");
  });

  test("CI is consulted before anything is touched, even for a client-only commit", () => {
    const facts = { ...FACTS, ci: "failure" as const, changedFiles: ["client/x.ts"] };
    expect(planUpdate(facts).kind).toBe("ci-failed");
  });
});

describe("planUpdate — what the review found", () => {
  test("never retries a commit that was deployed and rolled back", () => {
    expect(planUpdate({ ...FACTS, rejected: true }).kind).toBe("rejected");
  });

  test("a modified tracked file stops everything, even with nothing to deploy", () => {
    expect(planUpdate({ ...FACTS, dirty: true }).kind).toBe("dirty");
    expect(planUpdate({ ...FACTS, dirty: true, remote: "aaa", changedFiles: [] }).kind).toBe(
      "dirty",
    );
  });

  test("a CI verdict that never comes is reported after an hour, not waited on for ever", () => {
    expect(planUpdate({ ...FACTS, ci: "pending", ciWaitedMs: 59 * 60_000 }).kind).toBe("wait-ci");
    expect(planUpdate({ ...FACTS, ci: "pending", ciWaitedMs: 61 * 60_000 }).kind).toBe("ci-stuck");
  });
});

describe("ciStatusFromRuns", () => {
  const run = (name: string, status: string, conclusion: string | null) => ({
    name,
    status,
    conclusion,
  });

  test("reads only the CI workflow, so a failed IndexNow wait cannot block the server", () => {
    const runs = {
      workflow_runs: [run("IndexNow", "completed", "failure"), run("CI", "completed", "success")],
    };
    expect(ciStatusFromRuns(runs)).toBe("success");
  });

  test("is pending until CI has started and finished", () => {
    expect(ciStatusFromRuns({ workflow_runs: [] })).toBe("pending");
    expect(ciStatusFromRuns({ workflow_runs: [run("CI", "in_progress", null)] })).toBe("pending");
  });

  test("anything but success is a failure once CI has completed", () => {
    expect(ciStatusFromRuns({ workflow_runs: [run("CI", "completed", "cancelled")] })).toBe(
      "failure",
    );
  });

  test("an unreadable answer is pending, not success", () => {
    expect(ciStatusFromRuns(null)).toBe("pending");
    expect(ciStatusFromRuns({ message: "API rate limit exceeded" })).toBe("pending");
  });
});

describe("dbVersionOf", () => {
  test("reads the constant from config.ts", () => {
    expect(dbVersionOf("export const IMPORT = 1;\nexport const DB_VERSION = 2;\n")).toBe(2);
  });

  test("is null when the constant is missing, which counts as a change", () => {
    expect(dbVersionOf("export const OTHER = 2;")).toBeNull();
  });
});

describe("schemaChanged", () => {
  test("is a change only when the version moved", () => {
    const v = (n: number) => `export const DB_VERSION = ${n};`;
    expect(schemaChanged(v(2), v(2))).toBe(false);
    expect(schemaChanged(v(2), v(3))).toBe(true);
  });

  test("an unreadable version on either side counts as a change", () => {
    expect(schemaChanged("renamed", "renamed")).toBe(true);
    expect(schemaChanged(null, "export const DB_VERSION = 2;")).toBe(true);
  });
});

describe("judgeHealth", () => {
  const body = (status: string, staleSchema = false) =>
    JSON.stringify({ success: true, data: { status, feed: { staleSchema } } });

  test("is ok only for status ok with the schema in step", () => {
    expect(judgeHealth(body("ok"))).toBe("ok");
    expect(judgeHealth(body("degraded"))).toBe("degraded");
    expect(judgeHealth(body("ok", true))).toBe("stale-schema");
  });

  test("an unreachable or unreadable API is down", () => {
    expect(judgeHealth(null)).toBe("down");
    expect(judgeHealth("<html>bad gateway</html>")).toBe("down");
    expect(judgeHealth(JSON.stringify({ success: false }))).toBe("down");
  });
});

describe("shouldRollback", () => {
  test("rolls back a deploy that broke a healthy API", () => {
    expect(shouldRollback("ok", "down")).toBe(true);
    expect(shouldRollback("ok", "degraded")).toBe(true);
    expect(shouldRollback("ok", "stale-schema")).toBe(true);
  });

  test("keeps a deploy that is healthy afterwards", () => {
    expect(shouldRollback("ok", "ok")).toBe(false);
    expect(shouldRollback("degraded", "ok")).toBe(false);
  });

  test("does not blame a deploy for an API that was already unhealthy, unless it went down", () => {
    expect(shouldRollback("degraded", "degraded")).toBe(false);
    expect(shouldRollback("degraded", "down")).toBe(true);
  });
});

describe("repoSlugFromRemote", () => {
  test("reads owner/name from the SSH and HTTPS forms", () => {
    expect(repoSlugFromRemote("git@github.com:Kin39/DoveBus.git")).toBe("Kin39/DoveBus");
    expect(repoSlugFromRemote("https://github.com/Kin39/DoveBus")).toBe("Kin39/DoveBus");
  });

  test("refuses a remote that is not GitHub", () => {
    expect(() => repoSlugFromRemote("git@example.org:x/y.git")).toThrow(/GitHub/);
  });
});
