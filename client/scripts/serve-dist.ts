/**
 * Serves `client/dist` locally **with the headers the host will send**.
 *
 *   npm run preview:headers
 *
 * `vite preview` serves the built files but knows nothing about `_headers`, so
 * the one part of the deploy that can silently break the site — a
 * Content-Security-Policy that forbids something the app actually loads — was
 * unobservable until it was live. This reads the emitted `_headers` file rather
 * than a copy of its rules, so what is measured here is the artifact that ships.
 *
 * Deliberately not a general static server: no compression, no caching, no
 * range requests. It exists to be looked at through a browser console.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const DIST = resolve(import.meta.dirname, "..", "dist");
const PORT = Number(process.env.PORT ?? 5290);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".woff2": "font/woff2",
};

/** `_headers` in Netlify's form: a path pattern, then indented `Key: value` lines. */
function readHeaderRules(): ReadonlyArray<readonly [RegExp, Record<string, string>]> {
  const path = join(DIST, "_headers");
  if (!existsSync(path)) throw new Error(`no ${path} — run the build first`);

  const rules: Array<readonly [RegExp, Record<string, string>]> = [];
  let current: Record<string, string> | null = null;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    if (!line.startsWith(" ")) {
      current = {};
      rules.push([new RegExp(`^${line.trim().replaceAll("*", ".*")}$`), current]);
      continue;
    }
    const separator = line.indexOf(":");
    if (current && separator > 0) {
      current[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  return rules;
}

const rules = readHeaderRules();

createServer((request, response) => {
  const urlPath = new URL(request.url ?? "/", "http://localhost").pathname;
  const relative = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, relative);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");

  if (!file.startsWith(DIST) || !existsSync(file)) {
    response.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }

  const headers: Record<string, string> = {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
  };
  for (const [pattern, values] of rules) {
    if (pattern.test(urlPath)) Object.assign(headers, values);
  }

  response.writeHead(200, headers);
  createReadStream(file).pipe(response);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`dist served with deploy headers on http://localhost:${PORT}`);
});
