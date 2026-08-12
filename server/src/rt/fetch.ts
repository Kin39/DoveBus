import { USER_AGENT } from "../config.js";

/** Long enough for a slow gateway, short enough that a hung request cannot stall the loop. */
export const RT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Ceiling on a snapshot. The real feeds are ~100 KB (positions) and ~760 KB
 * (trip-updates); this is two orders of magnitude of headroom and exists only so
 * that a misbehaving upstream cannot make us buffer unbounded bytes into RAM on
 * a box that also holds a 1 GB database.
 */
export const RT_MAX_BODY_BYTES = 64 * 1024 * 1024;

export interface RtFetchResult {
  readonly body: Uint8Array;
  readonly bytes: number;
  readonly durationMs: number;
}

/**
 * Fetches one realtime snapshot.
 *
 * The feeds are GET-only (HEAD returns an empty reply) and always full datasets,
 * so there is nothing to negotiate: pull the bytes and hand them to the decoder.
 */
export async function fetchRtFeed(
  url: string,
  options: { readonly timeoutMs?: number } = {},
): Promise<RtFetchResult> {
  const startedAt = Date.now();
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/octet-stream" },
    signal: AbortSignal.timeout(options.timeoutMs ?? RT_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `realtime fetch failed: ${url} responded ${response.status} ${response.statusText}`,
    );
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RT_MAX_BODY_BYTES) {
    throw new Error(`realtime fetch failed: ${url} announced ${declared} bytes`);
  }

  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > RT_MAX_BODY_BYTES) {
    throw new Error(`realtime fetch failed: ${url} returned ${body.byteLength} bytes`);
  }
  return { body, bytes: body.byteLength, durationMs: Date.now() - startedAt };
}
