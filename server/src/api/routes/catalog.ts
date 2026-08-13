import type { FastifyInstance } from "fastify";
import { DEFAULT_COMUNE_LIMIT, searchComuni } from "../../query/comuni.js";
import { DEFAULT_ROUTE_LIMIT, searchRoutes } from "../../query/routes.js";
import type { ApiContext } from "../context.js";
import { ok } from "../envelope.js";
import { parseLimit, readQuery } from "../params.js";

/** Autocomplete is typed into, so the ceiling is a dropdown's worth, not a page's. */
const MAX_SUGGESTIONS = 100;

/** The two autocompletes the search panel is built on: comuni (mode 2) and lines (mode 1). */
export function registerCatalogRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get("/comuni", (request) => {
    const query = readQuery(request.query);
    return ok({
      comuni: searchComuni(ctx.db(), {
        ...(query.q === undefined ? {} : { q: query.q }),
        limit: parseLimit(query.limit, { fallback: DEFAULT_COMUNE_LIMIT, max: MAX_SUGGESTIONS }),
      }),
    });
  });

  app.get("/routes", (request) => {
    const query = readQuery(request.query);
    return ok({
      routes: searchRoutes(ctx.db(), {
        ...(query.q === undefined ? {} : { q: query.q }),
        limit: parseLimit(query.limit, { fallback: DEFAULT_ROUTE_LIMIT, max: MAX_SUGGESTIONS }),
      }),
    });
  });
}
