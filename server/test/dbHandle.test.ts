import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDbHandle } from "../src/db/handle.js";
import { openDatabase } from "../src/db/index.js";

function seed(path: string, value: string): void {
  const db = openDatabase(path, { readonly: false });
  db.exec("CREATE TABLE t (v TEXT)");
  db.prepare("INSERT INTO t VALUES (?)").run(value);
  db.close();
}

const read = (db: ReturnType<typeof openDatabase>): string =>
  (db.prepare("SELECT v FROM t").get() as { v: string }).v;

describe("openDbHandle", () => {
  let dir: string;
  let livePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dovebus-handle-"));
    livePath = join(dir, "gtfs.db");
    seed(livePath, "first");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("serves reads from the live database", () => {
    const handle = openDbHandle(livePath, { checkIntervalMs: 0 });
    expect(read(handle.db())).toBe("first");
    handle.close();
  });

  test("picks up a database published underneath it by the refresh job", async () => {
    const handle = openDbHandle(livePath, { checkIntervalMs: 0 });
    expect(read(handle.db())).toBe("first");

    const staging = join(dir, "gtfs.new.db");
    seed(staging, "second");
    await rename(staging, livePath);

    expect(read(handle.db())).toBe("second");
    expect(handle.generation).toBe(2);
    handle.close();
  });

  test("keeps serving the old database while a swap is mid-flight", async () => {
    const handle = openDbHandle(livePath, { checkIntervalMs: 0 });
    handle.db();
    await rm(livePath);

    // The file is gone for an instant during publication; an API that threw here
    // would turn an atomic swap into a visible outage.
    expect(read(handle.db())).toBe("first");
    expect(handle.generation).toBe(1);
    handle.close();
  });

  test("only re-checks the file once per interval", async () => {
    const handle = openDbHandle(livePath, { checkIntervalMs: 60_000 });
    handle.db();

    const staging = join(dir, "gtfs.new.db");
    seed(staging, "second");
    await rename(staging, livePath);

    expect(read(handle.db())).toBe("first");
    handle.close();
  });

  test("refuses to start without a database, naming the fix", () => {
    expect(() => openDbHandle(join(dir, "missing.db"))).toThrow(/npm run import/);
  });
});
