#!/usr/bin/env bun
// Post-build budget gate (PLAN §4): for every page in dist/, sums the gzipped size of
// what a first load fetches — the HTML, its stylesheets, its module scripts plus their
// static imports, inline scripts and local images — and fails when a page is over:
//   A-PERF-01  first-party JS ≤ 150 KiB per route
//   A-PERF-02  initial page weight ≤ 500 KiB, the Welcome page (/) ≤ 150 KiB
// Dynamic `import()` chunks load on interaction, so they don't count.
//
//   bun scripts/check-budgets.mjs [--dist dir]

import { gzipSync } from "node:zlib";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const KIB = 1024;
export const BUDGETS = { js: 150 * KIB, page: 500 * KIB, welcome: 150 * KIB };

const gz = (buf) => gzipSync(buf, { level: 9 }).length;

/** Local URLs a page fetches on load, split into scripts and everything else. */
export function pageRefs(html) {
  const scripts = new Set();
  const other = new Set();
  const local = (u) => u && u.startsWith("/") && !u.startsWith("//");
  for (const m of html.matchAll(/<script\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)) if (local(m[1])) scripts.add(m[1]);
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const rel = /\srel\s*=\s*["']?([^"'>]+)/i.exec(m[1])?.[1] ?? "";
    const href = /\shref\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1];
    if (!local(href)) continue;
    if (/\bmodulepreload\b/.test(rel)) scripts.add(href);
    else if (/\b(stylesheet|preload)\b/.test(rel)) other.add(href);
  }
  for (const m of html.matchAll(/<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)) if (local(m[1])) other.add(m[1]);
  return { scripts, other };
}

/** Inline executable script bodies (data blocks like JSON-LD aren't JS). */
export function inlineScripts(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/i.test(m[1])) continue;
    const type = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(m[1])?.[1]?.toLowerCase();
    if (type && type !== "module" && type !== "text/javascript") continue;
    out.push(m[2]);
  }
  return out;
}

/** Relative specifiers of static imports in a built module (`import(...)` is skipped). */
export function staticImports(js) {
  const out = new Set();
  for (const m of js.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[\w*{}\s,$]+from\s*)?["'](\.{1,2}\/[^"']+)["']/g)) out.add(m[1]);
  return out;
}

/** Measures one page. `read(urlPath)` returns a Buffer or null. */
export async function measurePage(html, read) {
  const { scripts, other } = pageRefs(html);
  let js = inlineScripts(html).reduce((n, s) => n + gz(Buffer.from(s)), 0);
  const seen = new Set();
  const queue = [...scripts];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const buf = await read(url);
    if (!buf) continue;
    js += gz(buf);
    for (const spec of staticImports(buf.toString("utf8"))) {
      queue.push(new URL(spec, `https://x${url}`).pathname);
    }
  }
  let rest = gz(Buffer.from(html));
  for (const url of other) {
    const buf = await read(url);
    if (buf) rest += gz(buf);
  }
  return { js, page: js + rest };
}

/** Returns failure messages for one page's measurement. */
export function overBudget(route, { js, page }, budgets = BUDGETS) {
  const fails = [];
  const pageMax = route === "/" ? budgets.welcome : budgets.page;
  if (js > budgets.js) fails.push(`${route}: JS ${kib(js)} > ${kib(budgets.js)} (A-PERF-01)`);
  if (page > pageMax) fails.push(`${route}: page ${kib(page)} > ${kib(pageMax)} (A-PERF-02)`);
  return fails;
}

const kib = (n) => `${(n / KIB).toFixed(1)} KiB`;

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await htmlFiles(path)));
    } else if (entry.name.endsWith(".html")) {
      out.push(path);
    }
  }
  return out;
}

async function main() {
  const distArg = process.argv.indexOf("--dist");
  const dist = distArg > -1 ? process.argv[distArg + 1] : fileURLToPath(new URL("../dist/", import.meta.url));
  if (!existsSync(dist)) {
    console.error(`[budgets] ${dist} not found — run bun run build first.`);
    process.exit(1);
  }
  const read = async (url) => {
    const path = join(dist, decodeURIComponent(url));
    return existsSync(path) ? readFile(path) : null;
  };
  const fails = [];
  for (const file of (await htmlFiles(dist)).sort()) {
    const rel = relative(dist, file).split(sep).join("/");
    const route = rel === "index.html" ? "/" : `/${dirname(rel) === "." ? rel : `${dirname(rel)}/`}`;
    const m = await measurePage(await readFile(file, "utf8"), read);
    console.log(`  ${route.padEnd(22)} JS ${kib(m.js).padStart(10)}   page ${kib(m.page).padStart(10)}`);
    fails.push(...overBudget(route, m));
  }
  if (fails.length) {
    console.error(`[budgets] over budget:\n  ${fails.join("\n  ")}`);
    process.exit(1);
  }
  console.log("[budgets] all pages within budget.");
}

if (import.meta.main) await main();
