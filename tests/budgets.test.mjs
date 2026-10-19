import { describe, expect, test } from "bun:test";
import { BUDGETS, inlineScripts, measurePage, overBudget, pageRefs, staticImports } from "../scripts/check-budgets.mjs";

describe("pageRefs", () => {
  test("finds local scripts, modulepreloads, stylesheets and images; skips external", () => {
    const html = `
      <script type="module" src="/_astro/a.js"></script>
      <script src="https://cdn.example/x.js"></script>
      <link rel="modulepreload" href="/_astro/b.js">
      <link rel="stylesheet" href="/_astro/s.css">
      <link rel="canonical" href="https://arctanmyangle.github.io/">
      <img src="/og.png" alt="">`;
    const { scripts, other } = pageRefs(html);
    expect([...scripts]).toEqual(["/_astro/a.js", "/_astro/b.js"]);
    expect([...other]).toEqual(["/_astro/s.css", "/og.png"]);
  });

  test("counts inline module/classic scripts but not JSON-LD", () => {
    const html = `<script>a()</script><script type="module">b()</script><script type="application/ld+json">{}</script>`;
    expect(inlineScripts(html)).toEqual(["a()", "b()"]);
  });
});

describe("staticImports", () => {
  test("follows static imports and re-exports, not dynamic import()", () => {
    const js = `import{a as e}from"./x.js";import"./side.js";export{b}from"../y.js";const z=()=>import("./lazy.js");`;
    expect([...staticImports(js)].sort()).toEqual(["../y.js", "./side.js", "./x.js"]);
  });
});

describe("measurePage", () => {
  test("walks the import graph once per file", async () => {
    const files = {
      "/_astro/a.js": `import"./b.js";import"./c.js";`,
      "/_astro/b.js": `import"./c.js";`,
      "/_astro/c.js": "x".repeat(1000),
    };
    const reads = [];
    const read = async (url) => {
      reads.push(url);
      return files[url] ? Buffer.from(files[url]) : null;
    };
    const m = await measurePage(`<script type="module" src="/_astro/a.js"></script>`, read);
    expect(reads.sort()).toEqual(["/_astro/a.js", "/_astro/b.js", "/_astro/c.js"]);
    expect(m.js).toBeGreaterThan(0);
    expect(m.page).toBeGreaterThan(m.js);
  });
});

// T-M1-05: the gate must actually fail on an over-budget page.
describe("overBudget (seeded failure)", () => {
  test("passes a small page", () => {
    expect(overBudget("/lab/", { js: 10_000, page: 40_000 })).toEqual([]);
  });

  test("fails a route over the JS budget", () => {
    const fails = overBudget("/lab/", { js: BUDGETS.js + 1, page: BUDGETS.js + 1 });
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("A-PERF-01");
  });

  test("holds the Welcome page to its tighter weight budget", () => {
    const m = { js: 1000, page: BUDGETS.welcome + 1 };
    expect(overBudget("/about/", m)).toEqual([]);
    expect(overBudget("/", m)[0]).toContain("A-PERF-02");
  });

  test("fails a real measurement of a seeded oversized bundle", async () => {
    // Random bytes don't compress, so this is ~200 KiB gzipped too.
    const big = Buffer.from(crypto.getRandomValues(new Uint8Array(200 * 1024)));
    const m = await measurePage(`<script type="module" src="/_astro/big.js"></script>`, async () => big);
    expect(overBudget("/arcade/", m).join()).toContain("A-PERF-01");
  });
});
