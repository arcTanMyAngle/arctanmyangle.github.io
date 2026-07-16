#!/usr/bin/env bun
// Build-time script: fetches public repo metadata for GITHUB_USERNAME and
// writes normalized data to src/data/github-repos.generated.json.
//
// Resilience contract: the build must never fail just because the GitHub
// API is temporarily unavailable or rate-limited, as long as a previously
// generated (and committed) file already exists to fall back to.

import { normalizeRepo, GITHUB_USERNAME } from "../src/lib/github.ts";

const OUTPUT_PATH = new URL("../src/data/github-repos.generated.json", import.meta.url);
const API_URL = `https://api.github.com/users/${GITHUB_USERNAME}/repos?per_page=100&sort=updated`;
const REQUEST_TIMEOUT_MS = 10_000;

async function readExisting() {
  try {
    const text = await Bun.file(OUTPUT_PATH).text();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.repos) && parsed.repos.length > 0) return parsed;
    return null;
  } catch {
    return null;
  }
}

function fallbackOrFail(existing, reason) {
  if (existing) {
    console.warn(`[sync-github] ${reason} — using cached github-repos.generated.json, build will continue.`);
    process.exit(0);
  }
  console.error(`[sync-github] ${reason} — no cached data available, cannot continue.`);
  process.exit(1);
}

async function fetchRepos() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(API_URL, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const existing = await readExisting();

  let res;
  try {
    res = await fetchRepos();
  } catch (err) {
    return fallbackOrFail(existing, `network error (${err.message})`);
  }

  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if ((res.status === 403 && remaining === "0") || res.status === 429) {
      const resetTime = reset ? new Date(Number(reset) * 1000).toISOString() : "unknown";
      return fallbackOrFail(existing, `rate limited (resets ${resetTime})`);
    }
    return fallbackOrFail(existing, `GitHub API responded ${res.status}`);
  }

  let raw;
  try {
    raw = await res.json();
  } catch (err) {
    return fallbackOrFail(existing, `failed to parse response JSON (${err.message})`);
  }

  if (!Array.isArray(raw)) {
    return fallbackOrFail(existing, "unexpected API response shape");
  }

  const repos = raw
    .map(normalizeRepo)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const output = {
    generatedAt: new Date().toISOString(),
    source: "live",
    username: GITHUB_USERNAME,
    repos,
  };

  await Bun.write(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`[sync-github] wrote ${repos.length} repos (live).`);
}

main().catch((err) => {
  console.error(`[sync-github] unexpected failure: ${err.stack ?? err.message}`);
  process.exit(1);
});
