// Central registry of localStorage keys + typed get/set helpers.
// The FOUC-prevention script in BaseLayout.astro's <head> duplicates the
// theme/reducedEffects key strings inline (it must be a blocking, non-module
// classic script, so it can't import this file) — keep them in sync if you
// change a key here.
export const STORAGE_KEYS = {
  theme: "atma:theme",
  reducedEffects: "atma:reduced-effects",
  /** Legacy single best height; read once to seed the Normal entry of stackerBests. */
  stackerBest: "atma:stacker-best",
  stackerBests: "atma:stacker-bests",
  stackerSpeed: "atma:stacker-speed",
  /** Legacy single best average; read once to seed the Classic entry of reactionBests. */
  reactionBest: "atma:reaction-best-ms",
  reactionBests: "atma:reaction-bests",
  reactionHistory: "atma:reaction-history",
  reactionMode: "atma:reaction-mode",
  chessGame: "atma:chess-game",
  chessBackup: "atma:chess-backup",
  laneRushBest: "atma:lane-rush-best",
  laneRushDaily: "atma:lane-rush-daily",
  /** Legacy single best time; read on every load to seed the Normal entry of monolithBests. */
  monolithBest: "atma:monolith-best-ms",
  monolithBests: "atma:monolith-bests",
  monolithAutoFire: "atma:monolith-autofire",
  ironLineBest: "atma:iron-line-best",
  ironLineMission: "atma:iron-line-mission",
  ironLineBests: "atma:iron-line-bests",
  gameSound: "atma:game-sound",
  skateLab: "atma:skate-lab",
} as const;

/** A stored whole number, or null when missing, unreadable or not a number. */
export function readNumber(key: string): number | null {
  const raw = readLocalStorage(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function writeNumber(key: string, n: number): void {
  writeLocalStorage(key, String(Math.round(n)));
}

/** A stored JSON value, or null when missing or unparseable. The shape is the caller's to check. */
export function readJSON<T>(key: string): T | null {
  const raw = readLocalStorage(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown): void {
  writeLocalStorage(key, JSON.stringify(value));
}

export type Theme = "dark" | "light";

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — degrade silently.
  }
}

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  writeLocalStorage(STORAGE_KEYS.theme, theme);
  document.documentElement.dataset.theme = theme;
}

export function getReducedEffects(): boolean {
  const stored = readLocalStorage(STORAGE_KEYS.reducedEffects);
  if (stored === "on") return true;
  if (stored === "off") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function setReducedEffects(reduced: boolean): void {
  writeLocalStorage(STORAGE_KEYS.reducedEffects, reduced ? "on" : "off");
  document.documentElement.dataset.motion = reduced ? "reduced" : "full";
}
