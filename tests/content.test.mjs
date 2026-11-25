import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildSnapshot, SNAPSHOT_PATH } from "../scripts/snapshot-content.mjs";
import { hasPublished, published, publishedBySlug } from "../src/lib/content/index.ts";

const row = (over = {}) => ({
  kind: "game",
  slug: "stacker",
  sort_order: 1,
  published_at: "2026-11-25T12:00:00Z",
  data: { slug: "stacker", title: "Stacker", blurb: "Stack it.", adapter: "site-module", module: "stacker" },
  ...over,
});

describe("committed snapshot", () => {
  test("is the empty v1 snapshot until M2 publishes something", () => {
    const text = readFileSync(SNAPSHOT_PATH, "utf8");
    expect(JSON.parse(text)).toEqual({ version: 1, items: [] });
  });

  test("every section reads as empty, so every content section stays hidden", () => {
    for (const k of ["game", "lab", "project", "opening", "tab", "about"]) {
      expect(published(k)).toEqual([]);
      expect(hasPublished(k)).toBe(false);
    }
    expect(publishedBySlug("game", "stacker")).toBeUndefined();
  });
});

describe("buildSnapshot", () => {
  test("valid rows become a sorted snapshot", () => {
    const rows = [
      row({ slug: "b", sort_order: 2, data: { ...row().data, slug: "b" } }),
      row({ slug: "a", sort_order: 2, data: { ...row().data, slug: "a" } }),
      row({ slug: "z", sort_order: 1, data: { ...row().data, slug: "z" } }),
      row({
        kind: "opening",
        slug: "italian",
        data: { slug: "italian", name: "Italian", side: "White", variations: [{ name: "Main", pgn: "1.e4 e5 2.Nf3 Nc6 3.Bc4" }] },
      }),
    ];
    const r = buildSnapshot(rows);
    expect(r.errors).toBeUndefined();
    expect(r.snapshot.items.map((i) => `${i.kind}/${i.slug}`)).toEqual(["game/z", "game/a", "game/b", "opening/italian"]);
    expect(buildSnapshot([...rows].reverse())).toEqual(r);
  });

  test("the loader reads a fixture snapshot by kind and slug", () => {
    const { snapshot } = buildSnapshot([row(), row({ slug: "reaction", sort_order: 0, data: { ...row().data, slug: "reaction", module: "reaction" } })]);
    expect(published("game", snapshot).map((i) => i.slug)).toEqual(["reaction", "stacker"]);
    expect(publishedBySlug("game", "stacker", snapshot)?.data.title).toBe("Stacker");
    expect(hasPublished("lab", snapshot)).toBe(false);
  });

  test.each([
    ["an unknown kind", row({ kind: "blog" })],
    ["a row whose data breaks its contract", row({ data: { ...row().data, adapter: "embed" } })],
    ["a source-link-only project", row({ kind: "project", slug: "p", data: { slug: "p", title: "P", blurb: "b", sourceUrl: "https://github.com/x/y" } })],
    ["an unsafe URL", row({ data: { ...row().data, sourceUrl: "https://127.0.0.1/" } })],
    ["a slug mismatch", row({ slug: "other" })],
    ["a missing sort order", row({ sort_order: null })],
    ["a bad published_at", row({ published_at: "soon" })],
    ["a null row", null],
  ])("rejects %s, and one bad row rejects the whole snapshot", (_, bad) => {
    const r = buildSnapshot([row({ slug: "ok", data: { ...row().data, slug: "ok" } }), bad]);
    expect(r.snapshot).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test("rejects duplicates and non-array responses", () => {
    expect(buildSnapshot([row(), row()]).errors?.[0]).toContain("duplicate");
    expect(buildSnapshot({ message: "JWT expired" }).errors).toEqual(["response is not an array"]);
  });
});
