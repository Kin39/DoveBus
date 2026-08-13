import type { FastifyInstance } from "fastify";
import { DEFAULT_LINE_TRIP_LIMIT, searchLine } from "../../query/searchLine.js";
import { DEFAULT_OD_TRIP_LIMIT, resolveComune, searchOd } from "../../query/searchOd.js";
import type { ApiContext } from "../context.js";
import { ok } from "../envelope.js";
import { HttpError } from "../errors.js";
import { parseDate, parseLimit, parseWindow, readQuery, requireParam } from "../params.js";

const MAX_TRIPS = 500;

/** The two search modes. Both answer with a trip list the live view can be opened from. */
export function registerSearchRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get("/search/line", (request) => {
    const query = readQuery(request.query);
    const date = parseDate(query.date);
    const window = parseWindow(query.from, query.to);

    const result = searchLine(ctx.db(), {
      route: requireParam("route", query.route),
      date,
      ...window,
      limit: parseLimit(query.limit, { fallback: DEFAULT_LINE_TRIP_LIMIT, max: MAX_TRIPS }),
    });
    return ok({ date, ...window, ...result });
  });

  app.get("/search/od", (request) => {
    const query = readQuery(request.query);
    const db = ctx.db();
    const from = requireComune(db, "comuneA", query.comuneA);
    const to = requireComune(db, "comuneB", query.comuneB);
    const date = parseDate(query.date);
    const window = parseWindow(query.from, query.to);

    const result = searchOd(db, {
      comuneA: from.istatCode,
      comuneB: to.istatCode,
      date,
      ...window,
      limit: parseLimit(query.limit, { fallback: DEFAULT_OD_TRIP_LIMIT, max: MAX_TRIPS }),
    });
    return ok({ date, ...window, from, to, ...result });
  });
}

/**
 * Resolves a comune before any searching happens.
 *
 * A typo must come back as "I do not know that comune", not as an empty result
 * list that reads like "no bus goes there".
 */
function requireComune(
  db: ReturnType<ApiContext["db"]>,
  name: string,
  value: string | undefined,
): { readonly istatCode: string; readonly name: string } {
  const raw = requireParam(name, value);
  const comune = resolveComune(db, raw);
  if (!comune) throw HttpError.notFound(`unknown comune: "${raw}"`);
  return comune;
}
