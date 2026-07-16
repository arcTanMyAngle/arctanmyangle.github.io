import generatedData from "../data/github-repos.generated.json";
import { projectOverrides } from "../data/project-overrides";
import type { GeneratedFile, GeneratedRepo } from "./github";

export type Category =
  | "real-time-visualization"
  | "geospatial"
  | "edge-ml"
  | "games"
  | "applied-ml"
  | "web"
  | "archive"
  | "fork-experiment";

export type Status = "featured" | "active" | "archive" | "fork" | "experiment";

export type DemoType = "radar" | "signal-map" | "spectrogram" | "reaction" | "cabinet" | "scanner";

export interface DetailSections {
  whatItIs: string;
  whyItMatters: string;
  howItWorks: string;
  technicalDecisions: string;
  currentStatus: string;
  nextUpgrade: string;
}

export interface ProjectOverride {
  displayName?: string;
  descriptionOverride?: string;
  category?: Category;
  status?: Status;
  techStack?: string[];
  demoType?: DemoType;
  featuredOrder?: number;
  homepageOverride?: string;
  exclude?: boolean;
  detailSections?: DetailSections;
}

export interface Project {
  slug: string;
  repoName: string;
  displayName: string;
  description: string;
  githubUrl: string;
  homepageUrl: string | null;
  primaryLanguage: string | null;
  topics: string[];
  category: Category;
  status: Status;
  updatedAt: string;
  stars: number;
  fork: boolean;
  license: string | null;
  techStack: string[];
  demoType: DemoType | null;
  detailSections: DetailSections | null;
  featuredOrder: number | null;
}

const SITE_REPO_NAME = "arctanmyangle.github.io";
const ACTIVE_WINDOW_DAYS = 120;

const generated = generatedData as GeneratedFile;

function slugify(repoName: string): string {
  return repoName.toLowerCase();
}

function deriveCategory(repo: GeneratedRepo, override?: ProjectOverride): Category {
  // Never guess a specific category from language alone — Rust could mean
  // games or real-time-viz, and a wrong guess is worse than a generic bucket.
  // Anything more specific than this requires an explicit override.
  if (override?.category) return override.category;
  return repo.fork ? "fork-experiment" : "archive";
}

function deriveStatus(repo: GeneratedRepo, override?: ProjectOverride): Status {
  // "featured" is exclusively editorial — never derived here.
  if (override?.status) return override.status;
  if (repo.fork) return "fork";
  const daysSincePush = (Date.now() - new Date(repo.updatedAt).getTime()) / 86_400_000;
  return daysSincePush <= ACTIVE_WINDOW_DAYS ? "active" : "archive";
}

function buildProject(repo: GeneratedRepo): Project | null {
  const slug = slugify(repo.name);
  const override = projectOverrides[slug];
  if (override?.exclude) return null;

  return {
    slug,
    repoName: repo.name,
    displayName: override?.displayName ?? repo.name,
    description: override?.descriptionOverride ?? repo.description ?? "No description yet.",
    githubUrl: repo.htmlUrl,
    homepageUrl: override?.homepageOverride ?? repo.homepageUrl,
    primaryLanguage: repo.language,
    topics: repo.topics,
    category: deriveCategory(repo, override),
    status: deriveStatus(repo, override),
    updatedAt: repo.updatedAt,
    stars: repo.stars,
    fork: repo.fork,
    license: repo.license,
    // No separate /languages API calls — 18 extra requests isn't worth it
    // when flagship overrides already say more about the stack in prose.
    techStack: override?.techStack ?? (repo.language ? [repo.language] : []),
    demoType: override?.demoType ?? null,
    // A project gets the full 6-section detail layout iff detailSections is
    // present — that field's presence *is* the flag, no separate boolean.
    detailSections: override?.detailSections ?? null,
    featuredOrder: override?.featuredOrder ?? null,
  };
}

let cachedProjects: Project[] | null = null;

export function getAllProjects(): Project[] {
  if (cachedProjects) return cachedProjects;
  cachedProjects = generated.repos
    .filter((repo) => slugify(repo.name) !== slugify(SITE_REPO_NAME))
    .map(buildProject)
    .filter((p): p is Project => p !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return cachedProjects;
}

export function getFeaturedProjects(): Project[] {
  return getAllProjects()
    .filter((p) => p.status === "featured")
    .sort((a, b) => (a.featuredOrder ?? 99) - (b.featuredOrder ?? 99));
}

export function getProjectBySlug(slug: string): Project | undefined {
  return getAllProjects().find((p) => p.slug === slug);
}

export function getProjectsByCategory(category: Category): Project[] {
  return getAllProjects().filter((p) => p.category === category);
}

export function getArchiveProjects(): Project[] {
  return getAllProjects().filter((p) => p.status === "archive" || p.status === "fork");
}
