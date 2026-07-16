// Pure types + normalization helpers for GitHub repo metadata.
// This file never calls fetch() — the only place allowed to hit the GitHub
// API is scripts/sync-github.mjs. Everything else (build-time page code,
// browser code) only ever reads the committed generated JSON.

export const GITHUB_USERNAME = "arcTanMyAngle";

export interface RawGitHubRepo {
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  topics?: string[];
  fork: boolean;
  archived: boolean;
  license: { spdx_id: string } | null;
  pushed_at: string;
  stargazers_count: number;
  default_branch: string;
}

export interface GeneratedRepo {
  name: string;
  description: string | null;
  htmlUrl: string;
  homepageUrl: string | null;
  language: string | null;
  topics: string[];
  fork: boolean;
  archived: boolean;
  license: string | null;
  updatedAt: string;
  stars: number;
  defaultBranch: string;
}

export interface GeneratedFile {
  generatedAt: string;
  source: "live" | "cache-fallback";
  username: string;
  repos: GeneratedRepo[];
}

export function normalizeRepo(raw: RawGitHubRepo): GeneratedRepo {
  const homepage = raw.homepage?.trim();
  const license = raw.license?.spdx_id;
  return {
    name: raw.name,
    description: raw.description,
    htmlUrl: raw.html_url,
    homepageUrl: homepage ? homepage : null,
    language: raw.language,
    topics: raw.topics ?? [],
    fork: raw.fork,
    archived: raw.archived,
    license: license && license !== "NOASSERTION" ? license : null,
    updatedAt: raw.pushed_at,
    stars: raw.stargazers_count,
    defaultBranch: raw.default_branch,
  };
}
