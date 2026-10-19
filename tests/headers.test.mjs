import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildCsp, buildHeaders, inlineHashes } from "../scripts/build-headers.mjs";
import { headersFor, parseHeaders } from "../scripts/serve-dist.mjs";

const hash = (s) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

describe("inlineHashes", () => {
  test("hashes inline scripts and styles, skips src= scripts and data blocks", () => {
    const html = [
      `<script>a()</script>`,
      `<script type="module">b()</script>`,
      `<script type="module" src="/_astro/x.js"></script>`,
      `<script type="application/ld+json">{"@type":"Person"}</script>`,
      `<style>p{color:red}</style>`,
    ].join("");
    const { scripts, styles } = inlineHashes(html);
    expect([...scripts].sort()).toEqual([hash("a()"), hash("b()")].sort());
    expect([...styles]).toEqual([hash("p{color:red}")]);
  });

  test("hashes the exact body, whitespace included", () => {
    const { scripts } = inlineHashes(`<script>\n  x()\n</script>`);
    expect([...scripts]).toEqual([hash("\n  x()\n")]);
  });
});

describe("buildCsp", () => {
  const csp = buildCsp({ scripts: new Set(["'sha256-b'", "'sha256-a'"]), styles: new Set() });

  test("lists hashes sorted and keeps the origin-A directives", () => {
    expect(csp).toContain("script-src 'self' 'sha256-a' 'sha256-b'");
    expect(csp).toContain("style-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});

describe("_headers round trip", () => {
  const rules = parseHeaders(buildHeaders("default-src 'self'"));

  test("every path gets the CSP once (one policy, not two joined)", () => {
    const h = headersFor(rules, "/chess/play/");
    expect(h.get("content-security-policy")).toBe("default-src 'self'");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("cache-control")).toBeNull();
  });

  test("hashed assets are immutable", () => {
    const h = headersFor(rules, "/_astro/app.abc123.js");
    expect(h.get("cache-control")).toContain("immutable");
    expect(h.get("content-security-policy")).toBe("default-src 'self'");
  });

  test("overlapping rules join like Cloudflare", () => {
    const h = headersFor(parseHeaders("/*\n  X-A: 1\n/a/*\n  X-A: 2\n"), "/a/b");
    expect(h.get("x-a")).toBe("1, 2");
  });
});
