import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { downloadTo } from "../src/gtfs/download.js";

const PAYLOAD = Buffer.from("stop_id,stop_name\n1,AREZZO\n".repeat(500), "utf8");
const EXPECTED_SHA1 = createHash("sha1").update(PAYLOAD).digest("hex");

describe("downloadTo", () => {
  let server: Server;
  let baseUrl: string;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dovebus-download-"));
    server = createServer((request, response) => {
      if (request.url === "/feed.zip") {
        response.writeHead(200, {
          "content-type": "application/zip",
          etag: 'W/"abc"',
          "last-modified": "Wed, 12 Aug 2026 03:22:00 GMT",
        });
        response.end(PAYLOAD);
        return;
      }
      if (request.url === "/huge.zip") {
        // No content-length: the body just keeps coming, which is the case a
        // declared size cannot protect against.
        response.writeHead(200, { "content-type": "application/zip" });
        response.end(Buffer.alloc(64 * 1024));
        return;
      }
      if (request.url === "/lying.zip") {
        response.writeHead(200, { "content-length": String(1024 * 1024 * 1024) });
        response.end(PAYLOAD);
        return;
      }
      response.writeHead(404).end("nope");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  test("writes the body to disk and hashes it in one pass", async () => {
    const destination = join(dir, "nested", "feed.zip");
    const result = await downloadTo(`${baseUrl}/feed.zip`, destination);

    expect(result.bytes).toBe(PAYLOAD.length);
    expect(result.sha1).toBe(EXPECTED_SHA1);
    expect(result.etag).toBe('W/"abc"');
    expect(result.lastModified).toBe("Wed, 12 Aug 2026 03:22:00 GMT");
    expect(result.contentType).toBe("application/zip");
    expect(readFileSync(destination)).toEqual(PAYLOAD);
  });

  test("throws on a non-200 response instead of writing a broken file", async () => {
    await expect(downloadTo(`${baseUrl}/missing`, join(dir, "missing.zip"))).rejects.toThrow(
      /responded 404/,
    );
  });

  test("stops a body that keeps arriving, and leaves no half-feed behind", async () => {
    // Defence in depth: these URLs are hardcoded constants no client can reach,
    // so this guards against a compromised upstream filling the disk that also
    // holds the live database — not against a caller.
    const destination = join(dir, "huge.zip");
    await expect(
      downloadTo(`${baseUrl}/huge.zip`, destination, { maxBytes: 8 * 1024 }),
    ).rejects.toThrow(/exceeded the 8192 byte cap/);
    expect(existsSync(destination)).toBe(false);
  });

  test("refuses a download that announces more than the cap before sending it", async () => {
    const destination = join(dir, "lying.zip");
    await expect(
      downloadTo(`${baseUrl}/lying.zip`, destination, { maxBytes: 8 * 1024 }),
    ).rejects.toThrow(/announced 1073741824 bytes/);
    expect(existsSync(destination)).toBe(false);
  });
});
