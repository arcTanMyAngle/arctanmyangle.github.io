#!/usr/bin/env bun
// Local stand-in for Cloudflare Pages: serves dist/ with the rules from dist/_headers
// applied, a 404.html with a real 404 status, and a 308 for a missing trailing slash.
// Lets the CSP be checked in a browser before the Pages projects exist. Not a
// production server; `_redirects` is not applied.
//
//   bun scripts/serve-dist.mjs [--port 4322]

import { stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const portArg = process.argv.indexOf("--port");
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT ?? 4322);

/** Parses Cloudflare `_headers` into [{ pattern: RegExp, headers: [name, value][] }]. */
export function parseHeaders(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      const re = raw.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      rules.push({ pattern: new RegExp(`^${re}$`), headers: [] });
    } else if (rules.length) {
      const i = raw.indexOf(":");
      rules.at(-1).headers.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]);
    }
  }
  return rules;
}

/** Cloudflare joins a header set by several matching rules with ", ". */
export function headersFor(rules, path) {
  const out = new Headers();
  for (const rule of rules) {
    if (!rule.pattern.test(path)) continue;
    for (const [name, value] of rule.headers) {
      out.set(name, out.has(name) ? `${out.get(name)}, ${value}` : value);
    }
  }
  return out;
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function main() {
  const headersFile = Bun.file(join(DIST, "_headers"));
  const rules = (await headersFile.exists()) ? parseHeaders(await headersFile.text()) : [];
  if (!rules.length) console.warn("[serve-dist] no dist/_headers — run `bun run build` first.");

  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname);
      const local = normalize(join(DIST, path));
      if (!local.startsWith(normalize(DIST))) return new Response("Bad path", { status: 400 });

      let file = null;
      if (path.endsWith("/")) {
        if (await isFile(join(local, "index.html"))) file = join(local, "index.html");
      } else if (await isFile(local)) {
        file = local;
      } else if (await isFile(join(local, "index.html"))) {
        return new Response(null, { status: 308, headers: { Location: `${path}/${url.search}` } });
      }

      const status = file ? 200 : 404;
      file ??= join(DIST, "404.html");
      const headers = headersFor(rules, path);
      const body = Bun.file(file);
      headers.set("Content-Type", body.type);
      return new Response(body, { status, headers });
    },
  });
  console.log(`[serve-dist] http://localhost:${PORT}/ (dist/ with _headers applied)`);
}

if (import.meta.main) await main();
