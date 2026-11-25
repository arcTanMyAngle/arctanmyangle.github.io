#!/usr/bin/env bun
// Build-time script (PLAN §3.4, D-10): fetches the `published` table through PostgREST with the anon key, validates
// every row against its kind's contract, and writes src/data/published.snapshot.json. Pages read only that file.
//
// Resilience contract, as sync-github.mjs: with no SUPABASE_URL / SUPABASE_ANON_KEY, on any network or HTTP error,
// or when any row is invalid, the committed snapshot is kept and the script exits 0. A bad row never half-publishes:
// it's the whole new snapshot or the old one.

import { isKind, validateEntry } from "../src/lib/content/validate.ts";

export const SNAPSHOT_PATH = new URL("../src/data/published.snapshot.json", import.meta.url);
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Rows from `published` → the snapshot, or a list of problems. Pure, so tests can call it.
 * @param {unknown} rows
 * @returns {{ snapshot: { version: 1, items: object[] } } | { errors: string[] }}
 */
export function buildSnapshot(rows) {
  if (!Array.isArray(rows)) return { errors: ["response is not an array"] };
  const errors = [];
  const items = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    const where = `row ${i}${row && typeof row.slug === "string" ? ` (${row.slug})` : ""}`;
    if (!row || typeof row !== "object" || !isKind(row.kind)) {
      errors.push(`${where}: unknown kind`);
      return;
    }
    const problems = validateEntry(row.kind, row.data);
    if (problems.length) {
      errors.push(...problems.map((p) => `${where}: ${p}`));
      return;
    }
    if (row.data.slug !== row.slug) errors.push(`${where}: data.slug "${row.data.slug}" ≠ row slug`);
    const key = `${row.kind}/${row.slug}`;
    if (seen.has(key)) errors.push(`${where}: duplicate ${key}`);
    seen.add(key);
    if (!Number.isInteger(row.sort_order)) errors.push(`${where}: sort_order is not an integer`);
    if (typeof row.published_at !== "string" || Number.isNaN(Date.parse(row.published_at))) {
      errors.push(`${where}: published_at is not a date`);
    }
    items.push({
      kind: row.kind,
      slug: row.slug,
      sortOrder: row.sort_order,
      publishedAt: row.published_at,
      data: row.data,
    });
  });
  if (errors.length) return { errors };
  // Sorted, so an unchanged table writes a byte-identical file.
  items.sort((a, b) => a.kind.localeCompare(b.kind) || a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
  return { snapshot: { version: 1, items } };
}

function keep(reason) {
  console.warn(`[snapshot-content] ${reason} — keeping the committed published.snapshot.json.`);
  process.exit(0);
}

async function main() {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) return keep("SUPABASE_URL / SUPABASE_ANON_KEY not set");
  if (!base.startsWith("https://")) return keep("SUPABASE_URL is not https");

  const url = `${base}/rest/v1/published?select=kind,slug,sort_order,data,published_at`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let rows;
  try {
    const res = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return keep(`HTTP ${res.status}`);
    rows = await res.json();
  } catch (err) {
    return keep(`network error (${err.message})`);
  } finally {
    clearTimeout(timeout);
  }

  const result = buildSnapshot(rows);
  if ("errors" in result) {
    for (const e of result.errors.slice(0, 50)) console.warn(`[snapshot-content] ${e}`);
    return keep(`${result.errors.length} invalid row problem(s)`);
  }
  await Bun.write(SNAPSHOT_PATH, `${JSON.stringify(result.snapshot, null, 2)}\n`);
  console.log(`[snapshot-content] wrote ${result.snapshot.items.length} item(s).`);
}

if (import.meta.main) await main();
