import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { generate, OUT } from "../scripts/gen-contract-types.mjs";
import { isSafeUrl } from "../src/lib/content/url.ts";
import { defaultContext, isPlayV1, pgnError, validateEntry } from "../src/lib/content/validate.ts";
import { hostedGames, linkedGames } from "../src/data/play.ts";
import { chessLines, games } from "../src/data/site.ts";
import { isPlayDownMessage, isPlayMessage } from "../src/lib/players/playV1.ts";
import { siteModules } from "../src/lib/players/registry.ts";

const CONTRACTS = new URL("../contracts/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const readJson = (name) => JSON.parse(readFileSync(join(CONTRACTS, name), "utf8"));
const schemaFiles = readdirSync(CONTRACTS).filter((f) => f.endsWith(".schema.json"));
const common = readJson("common.schema.json").$defs;

const game = (over = {}) => ({
  slug: "x",
  title: "X",
  blurb: "A game.",
  adapter: "site-module",
  module: "stacker",
  ...over,
});

describe("schemas", () => {
  test("every schema compiles under strict ajv", () => {
    for (const f of schemaFiles) {
      const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false });
      addFormats(ajv);
      expect(() => ajv.compile(readJson(f))).not.toThrow();
    }
  });

  test("each schema's shared $defs match common.schema.json exactly", () => {
    for (const f of schemaFiles.filter((x) => x !== "common.schema.json")) {
      const defs = readJson(f).$defs ?? {};
      for (const [name, def] of Object.entries(defs)) {
        if (name in common) expect({ f, name, def }).toEqual({ f, name, def: common[name] });
      }
    }
  });

  test("types.generated.ts is fresh (run `bun run gen:contracts` after editing a schema)", async () => {
    expect(readFileSync(OUT, "utf8")).toBe(await generate());
  });

  test("registry site modules equal the schema's module enum", () => {
    const en = readJson("game.schema.json").properties.module.enum;
    expect(Object.keys(siteModules).sort()).toEqual([...en].sort());
  });
});

describe("isSafeUrl", () => {
  test.each([
    "https://example.com",
    "https://www.example.com/path?q=1#h",
    "https://github.com/arcTanMyAngle/repo",
    "https://a-b.co.uk/",
  ])("accepts %s", (u) => expect(isSafeUrl(u)).toBe(true));

  test.each([
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "http://example.com",
    "//example.com",
    "https://user:pw@example.com",
    "https://user@example.com",
    "https://127.0.0.1/",
    "https://10.0.0.1/x",
    "https://[::1]/",
    "https://xn--80ak6aa92e.com/",
    "https://exämple.com/",
    "https://example.com:8443/",
    "https://localhost/",
    "https://example/",
    "https://exa mple.com/",
    "https://example.com/\n",
    "HTTPS://EXAMPLE.COM",
    "",
    42,
    null,
    `https://example.com/${"a".repeat(2050)}`,
  ])("rejects %p", (u) => expect(isSafeUrl(u)).toBe(false));

  test("allowHosts: exact host, and *. means subdomains only", () => {
    expect(isSafeUrl("https://poki.com/en/g/x", { allowHosts: ["poki.com"] })).toBe(true);
    expect(isSafeUrl("https://evil.com/", { allowHosts: ["poki.com"] })).toBe(false);
    expect(isSafeUrl("https://notpoki.com/", { allowHosts: ["poki.com"] })).toBe(false);
    expect(isSafeUrl("https://games.itch.io/", { allowHosts: ["*.itch.io"] })).toBe(true);
    expect(isSafeUrl("https://itch.io/", { allowHosts: ["*.itch.io"] })).toBe(false);
    expect(isSafeUrl("https://example.com/", { allowHosts: [] })).toBe(false);
  });
});

describe("validateEntry", () => {
  test("a minimal site-module game passes", () => {
    expect(validateEntry("game", game())).toEqual([]);
  });

  test("game adapters are exclusive and need their field", () => {
    expect(validateEntry("game", game({ module: undefined }))).not.toEqual([]);
    expect(validateEntry("game", game({ url: "https://poki.com/x" }))).not.toEqual([]);
    expect(validateEntry("game", game({ module: "pong" }))).not.toEqual([]);
    expect(validateEntry("game", game({ extra: 1 }))).not.toEqual([]);
  });

  test("a bundle must be in play/games-manifest.json", () => {
    const b = { slug: "g", title: "G", blurb: "b", adapter: "bundle" };
    expect(validateEntry("game", { ...b, bundle: "2048" })).toEqual([]);
    expect(validateEntry("game", { ...b, bundle: "not-shipped" })[0]).toContain("games-manifest");
  });

  test("an embed host must be allowlisted", () => {
    const e = { slug: "e", title: "E", blurb: "b", adapter: "embed", url: "https://poki.com/en/g/x" };
    expect(validateEntry("game", e, { ...defaultContext, embedHosts: [] })[0]).toContain("allowed-embed-hosts");
    expect(validateEntry("game", e, { ...defaultContext, embedHosts: ["poki.com"] })).toEqual([]);
  });

  test("unsafe URLs fail even when the schema pattern lets them through", () => {
    for (const url of ["https://127.0.0.1/x", "https://xn--80ak6aa92e.com/", "https://example.com:8080/"]) {
      expect(validateEntry("game", game({ sourceUrl: url }))[0]).toContain("safe https URL");
    }
    for (const url of ["javascript:alert(1)", "http://example.com", "data:text/html,x"]) {
      expect(validateEntry("game", game({ sourceUrl: url }))).not.toEqual([]);
    }
  });

  test("a project needs runUrl or outputs; a source link alone fails", () => {
    const p = { slug: "p", title: "P", blurb: "b" };
    expect(validateEntry("project", { ...p, sourceUrl: "https://github.com/x/y" })).not.toEqual([]);
    expect(validateEntry("project", { ...p, runUrl: "https://example.com/" })).toEqual([]);
    const outputs = [{ type: "image", url: "https://example.com/a.png", alt: "A chart" }];
    expect(validateEntry("project", { ...p, outputs })).toEqual([]);
    const bad = [{ type: "image", url: "https://127.0.0.1/a.png", alt: "x" }];
    expect(validateEntry("project", { ...p, outputs: bad })[0]).toContain("outputs[0].url");
  });

  test("opening PGNs must replay", () => {
    const o = { slug: "o", name: "O", side: "White" };
    expect(validateEntry("opening", { ...o, variations: [{ name: "Main", pgn: "1.e4 e5 2.Nf3" }] })).toEqual([]);
    expect(validateEntry("opening", { ...o, variations: [{ name: "Bad", pgn: "1.e4 e4" }] })[0]).toContain("pgn");
    expect(pgnError("")).not.toBeNull();
  });

  test("lab needs experiment:true, a date and a shipped bundle", () => {
    const l = { slug: "l", title: "L", blurb: "b", bundle: "2048", experiment: true, updatedAt: "2026-11-25T00:00:00Z" };
    expect(validateEntry("lab", l)).toEqual([]);
    expect(validateEntry("lab", { ...l, experiment: false })).not.toEqual([]);
    expect(validateEntry("lab", { ...l, updatedAt: "yesterday" })).not.toEqual([]);
  });
});

describe("today's hand-written data fits the contracts", () => {
  test("hostedGames are valid bundle games", () => {
    for (const g of hostedGames) {
      const entry = {
        slug: g.slug,
        title: g.title,
        blurb: g.blurb,
        adapter: "bundle",
        bundle: g.slug,
        controls: g.controls.split(" · "),
        credit: g.credit,
        license: g.license,
        sourceUrl: g.source,
        ...(g.phoneNote ? { phoneNote: g.phoneNote } : {}),
      };
      expect({ slug: g.slug, errors: validateEntry("game", entry) }).toEqual({ slug: g.slug, errors: [] });
    }
  });

  test("first-party games are valid site-module games", () => {
    for (const g of games) {
      const entry = { slug: g.slug, title: g.title, blurb: g.blurb, adapter: "site-module", module: g.slug };
      expect({ slug: g.slug, errors: validateEntry("game", { ...entry, controls: g.controls.split(" · ") }) }).toEqual({
        slug: g.slug,
        errors: [],
      });
    }
  });

  test("chess lines are valid openings", () => {
    for (const l of chessLines) {
      const entry = { slug: l.slug, name: l.name, side: l.side, idea: l.idea, variations: [{ name: "Main", pgn: l.moves.join(" ") }] };
      expect({ slug: l.slug, errors: validateEntry("opening", entry) }).toEqual({ slug: l.slug, errors: [] });
    }
  });

  test("linked game URLs are safe", () => {
    for (const g of linkedGames) expect(isSafeUrl(g.url)).toBe(true);
  });
});

describe("play/v1", () => {
  const fixtures = [
    { v: 1, type: "ready" },
    { v: 1, type: "error", detail: "boom" },
    { v: 1, type: "exit" },
    { v: 1, type: "pause" },
    { v: 1, type: "resume" },
    { v: 1, type: "pause", detail: "x" },
    { v: 2, type: "ready" },
    { v: 1, type: "launch" },
    { v: 1, type: "ready", extra: true },
    { v: "1", type: "ready" },
    { type: "ready" },
    [1, "ready"],
    "ready",
    null,
  ];

  test.each(fixtures.map((f) => [JSON.stringify(f), f]))("guards agree with the schema: %s", (_, f) => {
    expect(isPlayMessage(f) || isPlayDownMessage(f)).toBe(isPlayV1(f));
  });

  test("up and down guards don't overlap", () => {
    expect(isPlayMessage({ v: 1, type: "pause" })).toBe(false);
    expect(isPlayDownMessage({ v: 1, type: "ready" })).toBe(false);
  });
});
