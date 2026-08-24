import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { USER_AGENT } from "../config.js";

/**
 * Ceiling on a downloaded feed. The consolidated GTFS zip is ~125 MB and the
 * comuni boundaries ~10 MB, so this is generous headroom rather than a limit
 * anything real approaches. It exists for the same reason `RT_MAX_BODY_BYTES`
 * does: the URLs are hardcoded constants and unreachable from client input, so
 * this is not an exposed path — it is the guarantee that a compromised or
 * misbehaving upstream cannot fill the disk that also holds the live database.
 */
export const DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024;

export interface DownloadOptions {
  readonly maxBytes?: number;
}

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
export async function downloadTo(
  url: string,
  destination: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const maxBytes = options.maxBytes ?? DOWNLOAD_MAX_BYTES;
  await mkdir(dirname(destination), { recursive: true });

  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`download failed: ${url} responded ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error(`download failed: ${url} returned an empty body`);
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(
      `download failed: ${url} announced ${declared} bytes, over the ${maxBytes} cap`,
    );
  }

  const hash = createHash("sha1");
  let bytes = 0;
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    bytes += chunk.length;
    // A `content-length` is a claim, not a promise: the cap has to hold against
    // a body that simply keeps arriving.
    if (bytes > maxBytes) {
      source.destroy(new Error(`download failed: ${url} exceeded the ${maxBytes} byte cap`));
    }
  });

  try {
    await pipeline(source, createWriteStream(destination));
  } catch (error) {
    // Half a feed on disk is worse than none: the next run would find a file
    // where it expects a complete download.
    await rm(destination, { force: true });
    throw error;
  }

  return {
    path: destination,
    bytes,
    sha1: hash.digest("hex"),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    contentType: response.headers.get("content-type"),
  };
}
