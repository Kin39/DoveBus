import type { FastifyInstance } from "fastify";
import { SERVICE_ABOUT } from "../../config.js";
import { ok } from "../envelope.js";

/** The API's front door, which until now answered 404. */
export function registerAboutRoutes(app: FastifyInstance): void {
  app.get("/", () => ok(SERVICE_ABOUT));
}
