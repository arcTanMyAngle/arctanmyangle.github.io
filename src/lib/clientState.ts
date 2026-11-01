// Central registry of localStorage keys + typed get/set helpers.
// The FOUC-prevention script in BaseLayout.astro's <head> duplicates the
// theme/reducedEffects key strings inline (it must be a blocking, non-module
// classic script, so it can't import this file) — keep them in sync if you
// change a key here.
export const STORAGE_KEYS = {
  theme: "atma:theme",
  reducedEffects: "atma:reduced-effects",
  stackerBest: "atma:stacker-best",
  reactionBest: "atma:reaction-best-ms",
  chessGame: "atma:chess-game",
  chessBackup: "atma:chess-backup",
  laneRushBest: "atma:lane-rush-best",
  monolithBest: "atma:monolith-best-ms",
  ironLineBest: "atma:iron-line-best",
  ironLineMission: "atma:iron-line-mission",
  gameSound: "atma:game-sound",
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
