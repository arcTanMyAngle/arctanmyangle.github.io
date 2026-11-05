import { describe, expect, test } from "bun:test";
import { HISTORY_PER_MODE, MIN_MS, judge, pushHistory, readBests, readHistory, summarise } from "../src/lib/reactionStats.ts";

describe("reaction judging", () => {
  const go = { phase: "go", stamp: 1250, goAt: 1000, dueAt: 1000 };

  test("a press during the wait is early, by how long before the signal was due", () => {
    expect(judge({ phase: "waiting", stamp: 700, goAt: null, dueAt: 1000 })).toEqual({ kind: "early", byMs: 300 });
    expect(judge({ phase: "waiting", stamp: 1003, goAt: null, dueAt: 1000 })).toEqual({ kind: "early", byMs: 0 });
  });

  test("a clean press after the signal is timed", () => {
    expect(judge(go)).toEqual({ kind: "ok", ms: 250 });
  });

  test("faster than humans react, or before the signal was stamped, is a false start", () => {
    expect(judge({ ...go, stamp: 1000 + MIN_MS - 1 })).toEqual({ kind: "tooFast", ms: MIN_MS - 1 });
    expect(judge({ ...go, goAt: null })).toEqual({ kind: "tooFast", ms: null });
    expect(judge({ ...go, stamp: 1000 + MIN_MS }).kind).toBe("ok");
  });

  test("hitting the decoy is a mistake", () => {
    expect(judge({ ...go, phase: "nogo" })).toEqual({ kind: "decoy" });
  });

  test("choice needs the right side", () => {
    expect(judge({ ...go, want: "left", side: "right" })).toEqual({ kind: "wrongSide" });
    expect(judge({ ...go, want: "left", side: "left" })).toEqual({ kind: "ok", ms: 250 });
    // A guess that lands too fast is a false start whichever side it hit.
    expect(judge({ ...go, stamp: 1050, want: "left", side: "right" }).kind).toBe("tooFast");
  });
});

describe("reaction summary", () => {
  test("an empty set is all zeros", () => {
    expect(summarise([])).toEqual({ mean: 0, median: 0, sd: 0, best: 0 });
  });

  test("mean, median, spread and fastest", () => {
    expect(summarise([200, 300, 250, 400, 350])).toEqual({ mean: 300, median: 300, sd: 71, best: 200 });
    expect(summarise([200, 300])).toEqual({ mean: 250, median: 250, sd: 50, best: 200 });
  });
});

describe("reaction bests", () => {
  test("empty storage gives zero everywhere", () => {
    expect(readBests(null, null)).toEqual({ classic: 0, gonogo: 0, choice: 0, sound: 0 });
  });

  test("the old single best seeds Classic and is never lost", () => {
    expect(readBests(null, 240).classic).toBe(240);
    expect(readBests({ classic: 220 }, 240).classic).toBe(220);
    expect(readBests({ classic: 260 }, 240).classic).toBe(240);
    expect(readBests(null, 240).gonogo).toBe(0);
  });

  test("junk and impossible values are ignored", () => {
    expect(readBests({ classic: "x", gonogo: 40, choice: 312.6, bogus: 200 }, 50)).toEqual({
      classic: 0,
      gonogo: 0,
      choice: 313,
      sound: 0,
    });
  });
});

describe("reaction history", () => {
  test("junk is dropped and fields are cleaned", () => {
    expect(readHistory("nope")).toEqual([]);
    expect(
      readHistory([null, { mode: "bogus", mean: 300 }, { mode: "classic", mean: 40 }, { mode: "choice", mean: 301.4, sd: "x" }]),
    ).toEqual([{ mode: "choice", mean: 301, sd: 0, misses: 0 }]);
  });

  test("each mode keeps its own last ten, oldest first", () => {
    let list = [];
    for (let i = 0; i < HISTORY_PER_MODE + 3; i++) list = pushHistory(list, { mode: "classic", mean: 200 + i, sd: 0, misses: 0 });
    list = pushHistory(list, { mode: "sound", mean: 180, sd: 5, misses: 1 });
    const classic = list.filter((h) => h.mode === "classic");
    expect(classic.length).toBe(HISTORY_PER_MODE);
    expect(classic[0].mean).toBe(203);
    expect(classic.at(-1).mean).toBe(212);
    expect(list.at(-1)).toEqual({ mode: "sound", mean: 180, sd: 5, misses: 1 });
    expect(readHistory(list)).toEqual(list);
  });
});
