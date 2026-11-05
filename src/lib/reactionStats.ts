// Reaction's rules and numbers, kept apart from the DOM so they can be tested: the modes, how a press is judged,
// the summary of a set of rounds, the stored bests per mode and the short history of past sets.

export const ROUNDS = 5;
/** Faster than any human can react to a signal: a press this quick was a guess, so it is a false start. */
export const MIN_MS = 100;

export const MODES = ["classic", "gonogo", "choice", "sound"] as const;
export type Mode = (typeof MODES)[number];
export const isMode = (v: unknown): v is Mode => typeof v === "string" && (MODES as readonly string[]).includes(v);

export type Side = "left" | "right";

export type Outcome =
  | { kind: "ok"; ms: number }
  /** Pressed while still waiting; `byMs` is how long before the signal was due. */
  | { kind: "early"; byMs: number }
  /** Pressed after the signal but under MIN_MS, or before it could have reached the screen (`ms` null). */
  | { kind: "tooFast"; ms: number | null }
  /** Go/No-Go: pressed on the decoy. */
  | { kind: "decoy" }
  /** Choice: pressed the wrong side. */
  | { kind: "wrongSide" };

export interface Press {
  phase: "waiting" | "go" | "nogo";
  /** Timestamp of the press, on the same clock as `goAt` and `dueAt`. */
  stamp: number;
  /** When the go signal was first visible or audible, or null if that moment has not been stamped yet. */
  goAt: number | null;
  /** When the signal was scheduled to appear (used to say how early a press during the wait was). */
  dueAt: number;
  side?: Side;
  want?: Side;
}

export function judge(p: Press): Outcome {
  if (p.phase === "waiting") return { kind: "early", byMs: Math.max(0, Math.round(p.dueAt - p.stamp)) };
  if (p.phase === "nogo") return { kind: "decoy" };
  const ms = p.goAt === null ? null : Math.round(p.stamp - p.goAt);
  if (ms === null || ms < MIN_MS) return { kind: "tooFast", ms };
  if (p.want && p.side !== p.want) return { kind: "wrongSide" };
  return { kind: "ok", ms };
}

export interface Summary {
  mean: number;
  median: number;
  /** Population standard deviation: how much the rounds of this one set spread. */
  sd: number;
  best: number;
}

export function summarise(times: readonly number[]): Summary {
  if (!times.length) return { mean: 0, median: 0, sd: 0, best: 0 };
  const n = times.length;
  const mean = times.reduce((a, b) => a + b, 0) / n;
  const sorted = [...times].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const sd = Math.sqrt(times.reduce((a, t) => a + (t - mean) ** 2, 0) / n);
  return { mean: Math.round(mean), median: Math.round(median), sd: Math.round(sd), best: sorted[0] };
}

export type Bests = Record<Mode, number>;

/**
 * Best average per mode (lower is better, 0 = none yet). `legacy` is the single best kept before modes existed;
 * every set then was a Classic set, so it seeds Classic and is never lost.
 */
export function readBests(stored: unknown, legacy: number | null): Bests {
  const out = Object.fromEntries(MODES.map((m) => [m, 0])) as Bests;
  if (stored && typeof stored === "object") {
    for (const m of MODES) {
      const n = Number((stored as Record<string, unknown>)[m]);
      if (Number.isFinite(n) && n >= MIN_MS) out[m] = Math.round(n);
    }
  }
  if (legacy && legacy >= MIN_MS && (!out.classic || legacy < out.classic)) out.classic = Math.round(legacy);
  return out;
}

export interface HistoryEntry {
  mode: Mode;
  mean: number;
  sd: number;
  /** Mistakes during the set: false starts, decoys hit and wrong sides. */
  misses: number;
}

export const HISTORY_PER_MODE = 10;

/** Stored history, cleaned: unknown modes and junk dropped, at most HISTORY_PER_MODE per mode, oldest first. */
export function readHistory(stored: unknown): HistoryEntry[] {
  if (!Array.isArray(stored)) return [];
  const clean = stored.flatMap((e): HistoryEntry[] => {
    if (!e || typeof e !== "object") return [];
    const { mode, mean, sd, misses } = e as Record<string, unknown>;
    if (!isMode(mode) || !Number.isFinite(mean) || (mean as number) < MIN_MS) return [];
    return [{ mode, mean: Math.round(mean as number), sd: Math.round(Number(sd) || 0), misses: Math.max(0, Math.round(Number(misses) || 0)) }];
  });
  return trim(clean);
}

export function pushHistory(list: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return trim([...list, entry]);
}

function trim(list: HistoryEntry[]): HistoryEntry[] {
  const kept: HistoryEntry[] = [];
  const seen: Record<string, number> = {};
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i].mode;
    seen[m] = (seen[m] ?? 0) + 1;
    if (seen[m] <= HISTORY_PER_MODE) kept.push(list[i]);
  }
  return kept.reverse();
}
