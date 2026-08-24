/**
 * Which browser origins may read the API, and what one request is told.
 *
 * `@fastify/cors` answers this for the JSON routes. The SSE route cannot use it:
 * it hijacks the reply and writes its own headers, so the two have to agree by
 * sharing one parser rather than by being kept in step by eye. They did not
 * agree — the stream wrote the *configured string* into
 * `access-control-allow-origin`, so the moment the deploy moved off `*` to a
 * whitelist of two origins the header became `https://a,https://b`, a value
 * every browser rejects. It failed closed, which is why nothing noticed: the
 * stream would simply have stopped working for every allowed origin at once.
 */
export type AllowedOrigins = "*" | readonly string[];

/** `"*"`, or the comma-separated list `DOVEBUS_CORS_ORIGIN` carries. */
export function parseAllowedOrigins(configured: string): AllowedOrigins {
  const trimmed = configured.trim();
  if (trimmed === "*") return "*";

  const origins = trimmed
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  // An empty setting would parse to "allow nobody", which fails closed and so is
  // not a hole — but it is indistinguishable from a typo, and the symptom is the
  // site working everywhere except in a browser. Say so at startup instead.
  if (origins.length === 0) {
    throw new Error('DOVEBUS_CORS_ORIGIN is empty — use "*" to allow every origin, or list them');
  }
  return origins;
}

/**
 * The `access-control-allow-origin` value for one request, or `null` to send no
 * header at all — which is how a disallowed origin is refused, since an empty or
 * mismatched value would be a wrong answer rather than no answer.
 *
 * A whitelist reflects the caller's own origin back, the way `@fastify/cors`
 * does: the header names exactly one origin, so it can only ever be the one that
 * asked.
 */
export function allowOriginFor(
  allowed: AllowedOrigins,
  requestOrigin: string | undefined,
): string | null {
  if (allowed === "*") return "*";
  if (requestOrigin === undefined) return null;
  return allowed.includes(requestOrigin) ? requestOrigin : null;
}
