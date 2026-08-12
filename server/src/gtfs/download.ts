import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { USER_AGENT } from "../config.js";

export interface DownloadResult {
  readonly path: string;
  readonly bytes: number;
  /** SHA-1 of the downloaded bytes — the change detector for the refresh job. */
  readonly sha1: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly contentType: string | null;
}

/**
 * Streams a URL to disk while hashing it in one pass.
 *
 * The static feed is ~125 MB: buffering it to compute a hash afterwards would
 * double both the memory and the I/O for no benefit.
 */
export async function downloadTo(url: string, destination: string): Promise<DownloadResult> {
  await mkdir(dirname(destination), { recursive: true });

  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`download failed: ${url} responded ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error(`download failed: ${url} returned an empty body`);
  }

  const hash = createHash("sha1");
  let bytes = 0;
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
  });

  await pipeline(source, createWriteStream(destination));

  return {
    path: destination,
    bytes,
    sha1: hash.digest("hex"),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    contentType: response.headers.get("content-type"),
  };
}
