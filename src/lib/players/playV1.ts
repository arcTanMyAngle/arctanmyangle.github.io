// play/v1 (PLAN §3.1): postMessage between a game page on origin G and the play frame on origin A.
// The JSON Schema is contracts/play-v1.schema.json; tests/contracts.test.mjs checks these guards against it.
// Receivers must also check the sender's origin and window; these guards only check the shape.

/** G → A. */
export type PlayMessage = { v: 1; type: "ready" | "error" | "exit"; detail?: unknown };
/** A → G. */
export type PlayDownMessage = { v: 1; type: "pause" | "resume" };

const UP = new Set(["ready", "error", "exit"]);
const DOWN = new Set(["pause", "resume"]);

function shape(d: unknown, types: Set<string>, extra: readonly string[]): boolean {
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  const m = d as Record<string, unknown>;
  if (m.v !== 1 || typeof m.type !== "string" || !types.has(m.type)) return false;
  return Object.keys(m).every((k) => k === "v" || k === "type" || extra.includes(k));
}

export function isPlayMessage(d: unknown): d is PlayMessage {
  return shape(d, UP, ["detail"]);
}

export function isPlayDownMessage(d: unknown): d is PlayDownMessage {
  return shape(d, DOWN, []);
}
