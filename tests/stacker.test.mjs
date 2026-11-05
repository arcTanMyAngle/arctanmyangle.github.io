import { describe, expect, test } from "bun:test";
import { ROWS, SPEEDS, placeRow, readBests, score, stepMs, widthForRow } from "../src/lib/stackerLogic.ts";

describe("stacker rules", () => {
  test("rows narrow as the stack climbs", () => {
    for (const s of ["easy", "normal", "hard"]) {
      expect(widthForRow(0, s)).toBe(3);
      expect(widthForRow(2, s)).toBe(3);
      expect(widthForRow(3, s)).toBe(2);
      expect(widthForRow(8, s)).toBe(2);
      expect(widthForRow(9, s)).toBe(1);
    }
    expect(widthForRow(0, "impossible")).toBe(2);
    expect(widthForRow(3, "impossible")).toBe(2);
    expect(widthForRow(4, "impossible")).toBe(1);
    expect(widthForRow(ROWS - 1, "impossible")).toBe(1);
  });

  test("each row is faster than the one below, and speeds are ordered", () => {
    for (const s of SPEEDS) {
      for (let r = 1; r < ROWS; r++) expect(stepMs(r, s)).toBeLessThan(stepMs(r - 1, s));
    }
    for (let r = 0; r < ROWS; r++) {
      expect(stepMs(r, "easy")).toBeGreaterThan(stepMs(r, "normal"));
      expect(stepMs(r, "normal")).toBeGreaterThan(stepMs(r, "hard"));
      expect(stepMs(r, "hard")).toBeGreaterThan(stepMs(r, "impossible"));
    }
  });

  test("the bottom row keeps everything and is never perfect", () => {
    expect(placeRow(2, 3)).toEqual({ from: 2, len: 3, cut: [], perfect: false });
  });

  test("a row dropped square on the one below is perfect", () => {
    expect(placeRow(2, 3, [2, 3])).toEqual({ from: 2, len: 3, cut: [], perfect: true });
  });

  test("overhang is cut on either side", () => {
    expect(placeRow(3, 3, [2, 3])).toEqual({ from: 3, len: 2, cut: [5], perfect: false });
    expect(placeRow(0, 3, [2, 3])).toEqual({ from: 2, len: 1, cut: [0, 1], perfect: false });
  });

  test("a complete miss keeps nothing and cuts every cell", () => {
    const p = placeRow(5, 2, [0, 2]);
    expect(p.len).toBeLessThanOrEqual(0);
    expect(p.cut).toEqual([5, 6]);
    expect(p.perfect).toBe(false);
  });

  test("a perfect drop scores one extra", () => {
    expect(score(0, 0)).toBe(0);
    expect(score(10, 0)).toBe(10);
    expect(score(10, 4)).toBe(14);
  });
});

describe("stacker bests", () => {
  test("empty storage gives zero everywhere", () => {
    expect(readBests(null, null)).toEqual({ easy: 0, normal: 0, hard: 0, impossible: 0 });
  });

  test("the old single best seeds Normal", () => {
    expect(readBests(null, 9).normal).toBe(9);
    expect(readBests({ normal: 12 }, 9).normal).toBe(12);
    expect(readBests({ normal: 4 }, 9).normal).toBe(9);
  });

  test("junk in storage is ignored", () => {
    expect(readBests({ easy: "x", hard: -3, impossible: 5.6, bogus: 99 }, null)).toEqual({
      easy: 0,
      normal: 0,
      hard: 0,
      impossible: 6,
    });
    expect(readBests("nope", null).easy).toBe(0);
  });
});
