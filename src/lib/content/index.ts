/**
 * Published content (PLAN §3.4, D-10), read at build time from src/data/published.snapshot.json. That file is written
 * only by scripts/snapshot-content.mjs, which validates every row first — so nothing here re-validates, and nothing
 * here talks to Supabase. Sections with zero items stay hidden (PLAN §2).
 */
import snapshotFile from "../../data/published.snapshot.json";
import type { AboutEntry, GameEntry, LabEntry, OpeningEntry, ProjectEntry, TabEntry } from "./types.generated";

export interface EntryByKind {
  game: GameEntry;
  lab: LabEntry;
  project: ProjectEntry;
  opening: OpeningEntry;
  tab: TabEntry;
  about: AboutEntry;
}
export type PublishedKind = keyof EntryByKind;

export interface PublishedItem<K extends PublishedKind = PublishedKind> {
  kind: K;
  slug: string;
  sortOrder: number;
  publishedAt: string;
  data: EntryByKind[K];
}

export interface Snapshot {
  version: 1;
  items: PublishedItem[];
}

const committed = snapshotFile as unknown as Snapshot;

/** Items of one kind, in the order the owner set (sortOrder, then slug). */
export function published<K extends PublishedKind>(kind: K, snapshot: Snapshot = committed): PublishedItem<K>[] {
  return snapshot.items
    .filter((i): i is PublishedItem<K> => i.kind === kind)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
}

export function publishedBySlug<K extends PublishedKind>(
  kind: K,
  slug: string,
  snapshot: Snapshot = committed,
): PublishedItem<K> | undefined {
  return published(kind, snapshot).find((i) => i.slug === slug);
}

/** True when a section has something to show; empty sections are left out of nav and routing. */
export function hasPublished(kind: PublishedKind, snapshot: Snapshot = committed): boolean {
  return snapshot.items.some((i) => i.kind === kind);
}
