import { describe, expect, test } from "vitest";
import { createStagingDatabase } from "../src/db/index.js";
import { type FeedMeta, feedValidity, readFeedMeta, writeFeedMeta } from "../src/feed/meta.js";

const BASE_META: FeedMeta = {
  feedStartDate: "20260812",
  feedEndDate: "20260901",
  importedAt: "2026-08-12T10:00:00.000Z",
  sourceEtag: 'W/"v1"',
  sourceSha1: "deadbeef",
  sourceBytes: 125_017_286,
  dbVersion: 1,
};

describe("feed_meta round trip", () => {
  test("writes and reads back the provenance record", () => {
    const db = createStagingDatabase(":memory:");
    writeFeedMeta(db, BASE_META);
    expect(readFeedMeta(db)).toEqual(BASE_META);
    db.close();
  });

  test("keeps a single row when re-imported", () => {
    const db = createStagingDatabase(":memory:");
    writeFeedMeta(db, BASE_META);
    writeFeedMeta(db, { ...BASE_META, sourceSha1: "cafe", importedAt: "2026-08-13T10:00:00.000Z" });
    const rows = db.prepare("SELECT COUNT(*) AS n FROM feed_meta").get() as { n: number };
    expect(rows.n).toBe(1);
    expect(readFeedMeta(db)?.sourceSha1).toBe("cafe");
    db.close();
  });

  test("returns null when nothing has been imported yet", () => {
    const db = createStagingDatabase(":memory:");
    expect(readFeedMeta(db)).toBeNull();
    db.close();
  });
});

describe("feedValidity", () => {
  test("counts the days left in the timetable", () => {
    expect(feedValidity(BASE_META, "20260812")).toEqual({
      expired: false,
      daysRemaining: 20,
      staleSchema: false,
    });
  });

  test("is still valid on the last day", () => {
    expect(feedValidity(BASE_META, "20260901").expired).toBe(false);
  });

  test("flags a feed served past its end date", () => {
    const validity = feedValidity(BASE_META, "20260903");
    expect(validity.expired).toBe(true);
    expect(validity.daysRemaining).toBe(-2);
  });

  test("flags a database built by an older schema version", () => {
    expect(feedValidity({ ...BASE_META, dbVersion: 0 }, "20260812").staleSchema).toBe(true);
  });

  test("does not claim expiry when the feed declares no end date", () => {
    const validity = feedValidity({ ...BASE_META, feedEndDate: null }, "20260812");
    expect(validity).toMatchObject({ expired: false, daysRemaining: null });
  });
});
