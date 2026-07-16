// Central registry of localStorage keys + typed get/set helpers.
// The FOUC-prevention script in BaseLayout.astro's <head> duplicates the
// shineMode/reducedEffects key strings inline (it must be a blocking, non-module
// classic script, so it can't import this file) — keep them in sync if you
// change a key here.
export const STORAGE_KEYS = {
  shineMode: "atma:shine-mode",
  reducedEffects: "atma:reduced-effects",
  reactionBestScore: "atma:reaction-best",
  lastProjectCategory: "atma:last-category",
} as const;

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

export function getShineMode(): boolean {
  return readLocalStorage(STORAGE_KEYS.shineMode) !== "off";
}

export function setShineMode(on: boolean): void {
  writeLocalStorage(STORAGE_KEYS.shineMode, on ? "on" : "off");
  document.documentElement.dataset.shine = on ? "on" : "off";
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

export function getReactionBestScore(): number | null {
  const raw = readLocalStorage(STORAGE_KEYS.reactionBestScore);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function setReactionBestScore(msAverage: number): void {
  writeLocalStorage(STORAGE_KEYS.reactionBestScore, String(Math.round(msAverage)));
}

export function getLastProjectCategory(): string | null {
  return readLocalStorage(STORAGE_KEYS.lastProjectCategory);
}

export function setLastProjectCategory(category: string): void {
  writeLocalStorage(STORAGE_KEYS.lastProjectCategory, category);
}
