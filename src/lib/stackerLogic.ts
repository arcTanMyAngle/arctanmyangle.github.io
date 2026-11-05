// Stacker's rules, kept apart from the DOM so they can be tested: board size, how wide and how fast each row is per
// speed, what a placement keeps and cuts, the score and the stored bests. The game is never rigged: there is no
// forced miss near the top on any speed, Impossible included. It is only fast and narrow.

export const COLS = 7;
export const ROWS = 15;

export const SPEEDS = ["easy", "normal", "hard", "impossible"] as const;
export type Speed = (typeof SPEEDS)[number];

interface SpeedRule {
  /** Cells per second on the bottom row, and how much each row adds. */
  base: number;
  ramp: number;
  /** Widest row allowed below each step: [rows, width] pairs, then 1 above the last. */
  widths: [number, number][];
}

const RULES: Record<Speed, SpeedRule> = {
  easy: { base: 4.5 * 0.72, ramp: 0.55 * 0.72, widths: [[3, 3], [9, 2]] },
  normal: { base: 4.5, ramp: 0.55, widths: [[3, 3], [9, 2]] },
  hard: { base: 4.5 * 1.45, ramp: 0.55 * 1.45, widths: [[3, 3], [9, 2]] },
  // Starts two wide, narrows to one after four rows and speeds up faster than Hard.
  impossible: { base: 8.5, ramp: 1.15, widths: [[4, 2]] },
};

export const isSpeed = (v: unknown): v is Speed => typeof v === "string" && (SPEEDS as readonly string[]).includes(v);

/** Widest row allowed at this height (0 = bottom). */
export function widthForRow(row: number, speed: Speed): number {
  for (const [below, w] of RULES[speed].widths) if (row < below) return w;
  return 1;
}

/** Milliseconds between one-cell moves on this row. */
export function stepMs(row: number, speed: Speed): number {
  const r = RULES[speed];
  return 1000 / (r.base + row * r.ramp);
}

export interface Placement {
  /** What stays: first column and length (length 0 or less is a miss). */
  from: number;
  len: number;
  /** Columns of the moving row that hung over and fall away. */
  cut: number[];
  /** Nothing fell off, on a row that had one below it. */
  perfect: boolean;
}

/** Drop a row `width` wide at column `pos` onto `below` ([from, len], or none for the bottom row). */
export function placeRow(pos: number, width: number, below?: readonly [number, number]): Placement {
  let from = pos;
  let len = width;
  if (below) {
    from = Math.max(pos, below[0]);
    len = Math.min(pos + width, below[0] + below[1]) - from;
  }
  const cut: number[] = [];
  for (let c = pos; c < pos + width; c++) if (c < from || c >= from + Math.max(len, 0)) cut.push(c);
  return { from, len, cut, perfect: !!below && cut.length === 0 };
}

/** One point a row, one more for each perfect drop. */
export const score = (height: number, perfects: number) => height + perfects;

export type Bests = Record<Speed, number>;

/**
 * Per-speed bests from what storage holds. `legacy` is the single best height kept before speeds had their own; it
 * was set on whatever speed was chosen, Normal unless changed, so it seeds Normal and is never lost.
 */
export function readBests(stored: unknown, legacy: number | null): Bests {
  const out = Object.fromEntries(SPEEDS.map((s) => [s, 0])) as Bests;
  if (stored && typeof stored === "object") {
    for (const s of SPEEDS) {
      const n = Number((stored as Record<string, unknown>)[s]);
      if (Number.isFinite(n) && n > 0) out[s] = Math.round(n);
    }
  }
  if (legacy && legacy > out.normal) out.normal = Math.round(legacy);
  return out;
}
