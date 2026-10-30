import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PLAY_ORIGIN } from "../scripts/build-headers.mjs";
import { headersFor, parseHeaders } from "../scripts/serve-dist.mjs";
import { hostedGames, linkedGames, playUrl } from "../src/data/play.ts";

const PLAY = new URL("../play/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (...p) => readFileSync(join(PLAY, ...p), "utf8");
const rules = parseHeaders(read("_headers"));
const manifest = JSON.parse(read("games-manifest.json"));

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

describe("origin G", () => {
  test("the CSP fallback and the page fallback name the same origin", () => {
    expect(playUrl("2048")).toBe(`${DEFAULT_PLAY_ORIGIN}/g/2048/`);
  });

  test("manifest and src/data/play.ts list the same games", () => {
    expect(manifest.games.map((g) => g.slug).sort()).toEqual(hostedGames.map((g) => g.slug).sort());
    for (const g of hostedGames) {
      const m = manifest.games.find((x) => x.slug === g.slug);
      expect(m.license).toBe(g.license);
      expect(m.source).toBe(g.source);
      expect(m.commit).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test("the root rule only allows origin A to frame G", () => {
    const csp = headersFor(rules, "/").get("content-security-policy");
    expect(csp).toContain("frame-ancestors https://arctanmyangle.pages.dev https://*.arctanmyangle.pages.dev;");
  });

  for (const g of hostedGames) {
    describe(g.slug, () => {
      test("has an index.html that loads the bridge", () => {
        expect(read("g", g.slug, "index.html")).toContain('<script src="/play-bridge.js"></script>');
      });

      test("ships a dated notice of what changed from the pinned commit", () => {
        const m = manifest.games.find((x) => x.slug === g.slug);
        const notice = read("g", g.slug, "CHANGES.md");
        expect(notice).toContain(m.commit);
        expect(notice).toMatch(/Modified \d{4}-\d{2}-\d{2}/);
      });

      test("gets its own policy on top of the frame-ancestors one", () => {
        const csp = headersFor(rules, `/g/${g.slug}/`).get("content-security-policy");
        expect(csp).toContain("frame-ancestors https://arctanmyangle.pages.dev");
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("connect-src 'self'");
        expect(csp).not.toMatch(/https?:\/\/(?!(\*\.)?arctanmyangle\.pages\.dev)/);
      });

      test("loads nothing from another host", () => {
        for (const file of files(join(PLAY, "g", g.slug))) {
          if (!/\.(html|js|css)$/.test(file)) continue;
          const text = readFileSync(file, "utf8");
          expect({ file, hit: /<script[^>]+src=["']?(https?:)?\/\//i.test(text) }).toEqual({ file, hit: false });
          expect({ file, hit: /google-analytics|googletagmanager|googlesyndication|fonts\.googleapis/i.test(text) })
            .toEqual({ file, hit: false });
        }
      });
    });
  }
});

describe("linked games", () => {
  test("go out over https to the host they name", () => {
    for (const g of linkedGames) {
      const url = new URL(g.url);
      expect(url.protocol).toBe("https:");
      expect(url.host).toBe(g.host);
    }
  });
});
