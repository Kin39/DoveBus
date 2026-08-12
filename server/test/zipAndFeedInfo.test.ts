import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { readFeedInfo } from "../src/gtfs/feedInfo.js";
import { openZip } from "../src/gtfs/zip.js";
import { createFixtureFeed } from "./helpers/fixtureFeed.js";

const streamOf = (text: string) => Readable.from([Buffer.from(text, "utf8")]);

describe("openZip", () => {
  test("lists entries, reports sizes and streams one out", async () => {
    const fixture = await createFixtureFeed();
    const archive = await openZip(fixture.zipPath);

    expect(archive.entries).toContain("stop_times.txt");
    expect(archive.has("shapes.txt")).toBe(true);
    expect(archive.has("nothing.txt")).toBe(false);
    expect(archive.sizeOf("calendar_dates.txt")).toBeGreaterThan(0);
    expect(archive.sizeOf("nothing.txt")).toBeUndefined();

    const stream = await archive.openEntry("agency.txt");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("Autolinee Toscane");

    archive.close();
    await rm(fixture.dir, { recursive: true, force: true });
  });

  test("reads several entries from one open archive", async () => {
    const fixture = await createFixtureFeed();
    const archive = await openZip(fixture.zipPath);

    for (const name of ["stops.txt", "routes.txt", "trips.txt"]) {
      const stream = await archive.openEntry(name);
      stream.resume();
      await new Promise((resolve) => stream.on("end", resolve));
    }

    archive.close();
    await rm(fixture.dir, { recursive: true, force: true });
  });

  test("throws for an entry that is not in the archive", async () => {
    const fixture = await createFixtureFeed();
    const archive = await openZip(fixture.zipPath);
    await expect(archive.openEntry("missing.txt")).rejects.toThrow(/zip entry not found/);
    archive.close();
    await rm(fixture.dir, { recursive: true, force: true });
  });

  test("rejects a file that is not a zip", async () => {
    await expect(openZip("/nonexistent/path/gtfs.zip")).rejects.toThrow();
  });
});

describe("readFeedInfo", () => {
  test("reads the validity window", async () => {
    const info = await readFeedInfo(
      streamOf(
        "feed_publisher_name,feed_lang,feed_start_date,feed_end_date,feed_version\n" +
          '"Autolinee Toscane",it,20260812,20260901,\n',
      ),
    );
    expect(info).toEqual({
      publisherName: "Autolinee Toscane",
      feedStartDate: "20260812",
      feedEndDate: "20260901",
      feedVersion: null,
    });
  });

  test("returns nulls for a header-only file rather than failing the import", async () => {
    const info = await readFeedInfo(streamOf("feed_publisher_name,feed_start_date\n"));
    expect(info).toEqual({
      publisherName: null,
      feedStartDate: null,
      feedEndDate: null,
      feedVersion: null,
    });
  });

  test("tolerates a feed_info without the date columns", async () => {
    const info = await readFeedInfo(streamOf("feed_publisher_name\nAT\n"));
    expect(info.publisherName).toBe("AT");
    expect(info.feedEndDate).toBeNull();
  });
});
