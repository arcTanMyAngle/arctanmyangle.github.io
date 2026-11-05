import { describe, expect, test } from "bun:test";
import { dayKey, makeRow, multFor, PASSABLE, seedFrom } from "../src/components/laneRush.ts";
import { BOSS_HP, formatTime, gradeFor, phaseFor, practiceHp, readMonolithBests, recordMonolith } from "../src/components/monolith.ts";
import { MISSIONS, castRay, compactFoes, mapProblems, medalFor, medalGap, missionScore, parseGrid, pickSpawns, readMissionBests, recordMission, validMap } from "../src/components/ironLine.ts";
import { rng } from "../src/lib/gameShell.ts";

describe("Lane Rush rows", () => {
  // Lanes a runner can move between after a row, given the tram (if any) that row left behind.
  const groupsFor = (cart) => (cart === 1 ? [[0], [2]] : cart === 0 ? [[1, 2]] : cart === 2 ? [[0, 1]] : [[0, 1, 2]]);

  test("every reachable group keeps a way through, across many seeded runs", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      let open = [0, 1, 2];
      let cart = -1;
      for (let i = 0; i < 400; i++) {
        const row = makeRow(r, i / 300, open, cart);
        expect(row.cells).toHaveLength(3);
        expect(row.open.length).toBeGreaterThan(0);
        for (const l of row.open) expect(PASSABLE[row.cells[l]]).toBe(true);
        for (const g of groupsFor(cart)) {
          if (g.some((l) => open.includes(l))) expect(g.some((l) => row.open.includes(l))).toBe(true);
        }
        if (cart !== -1) expect(row.cells.includes("cart")).toBe(false);
        open = row.open;
        cart = row.cells.indexOf("cart");
      }
    }
  });

  test("the opening stretch has no gates or trams", () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const { cells } = makeRow(r, 0.05, [0, 1, 2]);
      expect(cells.includes("high")).toBe(false);
      expect(cells.includes("cart")).toBe(false);
    }
  });

  test("a tight follow-up row never blocks a lane the row before left open", () => {
    const sets = [[0], [1], [2], [0, 1], [1, 2], [0, 2], [0, 1, 2]];
    for (let seed = 1; seed <= 30; seed++) {
      const r = rng(seed);
      for (const prev of sets) {
        for (const d of [0.4, 0.7, 1]) {
          const row = makeRow(r, d, prev, -1, { tight: true });
          for (const l of prev) {
            expect(row.cells[l]).toBe("none");
            expect(row.open).toContain(l);
          }
          expect(row.cells.includes("cart")).toBe(false);
        }
      }
    }
  });
});

describe("Lane Rush scoring and daily run", () => {
  test("the coin multiplier steps up every eight in a chain and stops at x4", () => {
    expect([0, 7, 8, 15, 16, 24, 80].map(multFor)).toEqual([1, 1, 2, 2, 3, 4, 4]);
  });

  test("the daily seed is the same all day and changes the next day", () => {
    const a = dayKey(new Date(2026, 10, 2, 0, 5));
    const b = dayKey(new Date(2026, 10, 2, 23, 55));
    const c = dayKey(new Date(2026, 10, 3, 0, 5));
    expect(a).toBe("2026-11-02");
    expect(b).toBe(a);
    expect(seedFrom(a)).toBe(seedFrom(b));
    expect(seedFrom(a)).not.toBe(seedFrom(c));
    expect(seedFrom(a)).toBe(seedFrom("2026-11-02"));
    expect(Number.isInteger(seedFrom(a)) && seedFrom(a) >= 0).toBe(true);
  });
});

describe("Monolith", () => {
  test("phases split HP into thirds", () => {
    expect(phaseFor(BOSS_HP, BOSS_HP)).toBe(1);
    expect(phaseFor(BOSS_HP * 0.67, BOSS_HP)).toBe(1);
    expect(phaseFor(BOSS_HP * 0.5, BOSS_HP)).toBe(2);
    expect(phaseFor(BOSS_HP * 0.2, BOSS_HP)).toBe(3);
    expect(phaseFor(0, BOSS_HP)).toBe(3);
  });

  test("grades reward clean, quick and Hard clears", () => {
    expect(gradeFor(60_000, 0, false)).toBe("S");
    expect(gradeFor(60_000, 2, false)).toBe("A");
    expect(gradeFor(60_000, 3, false)).toBe("B");
    expect(gradeFor(60_000, 8, false)).toBe("C");
    expect(gradeFor(60_000, 1, false)).toBe("A");
    expect(gradeFor(60_000, 1, true)).toBe("S");
    expect(gradeFor(150_000, 0, false)).toBe("B");
  });

  test("times format as m:ss.s", () => {
    expect(formatTime(0)).toBe("0:00.0");
    expect(formatTime(5_250)).toBe("0:05.3");
    expect(formatTime(83_400)).toBe("1:23.4");
    expect(formatTime(-10)).toBe("0:00.0");
  });

  test("bests start empty for both difficulties", () => {
    const empty = { ms: 0, grade: "", phase: 0 };
    expect(readMonolithBests(null, null)).toEqual({ normal: empty, hard: empty });
  });

  test("the old single best time seeds Normal and is never lost", () => {
    expect(readMonolithBests(null, 95_000).normal).toEqual({ ms: 95_000, grade: "", phase: 3 });
    const stored = { normal: { ms: 120_000, grade: "B", phase: 3 }, hard: { ms: 0, grade: "", phase: 2 } };
    expect(readMonolithBests(stored, 95_000).normal.ms).toBe(95_000);
    expect(readMonolithBests(stored, 130_000).normal.ms).toBe(120_000);
    expect(readMonolithBests(stored, 130_000).hard).toEqual({ ms: 0, grade: "", phase: 2 });
  });

  test("junk in storage is ignored", () => {
    const b = readMonolithBests({ normal: { ms: "fast", grade: "Z", phase: 9 }, hard: 4 }, Number.NaN);
    expect(b.normal).toEqual({ ms: 0, grade: "", phase: 0 });
    expect(b.hard).toEqual({ ms: 0, grade: "", phase: 0 });
    expect(readMonolithBests(null, 3).normal.ms).toBe(0);
  });

  test("a loss records the furthest phase but no time", () => {
    const fresh = { ms: 0, grade: "", phase: 0 };
    expect(recordMonolith(fresh, { won: false, ms: 40_000, grade: "", phase: 2 })).toEqual({ ms: 0, grade: "", phase: 2 });
    const far = { ms: 0, grade: "", phase: 3 };
    expect(recordMonolith(far, { won: false, ms: 40_000, grade: "", phase: 1 }).phase).toBe(3);
  });

  test("a win improves the best time and best grade separately", () => {
    const prev = { ms: 90_000, grade: "B", phase: 3 };
    expect(recordMonolith(prev, { won: true, ms: 100_000, grade: "A", phase: 3 })).toEqual({ ms: 90_000, grade: "A", phase: 3 });
    expect(recordMonolith(prev, { won: true, ms: 80_000, grade: "C", phase: 3 })).toEqual({ ms: 80_000, grade: "B", phase: 3 });
    expect(recordMonolith({ ms: 0, grade: "", phase: 1 }, { won: true, ms: 70_000, grade: "S", phase: 3 })).toEqual({ ms: 70_000, grade: "S", phase: 3 });
  });

  test("practice starts at the top of each phase", () => {
    expect(practiceHp(1)).toBe(BOSS_HP);
    expect(phaseFor(practiceHp(2), BOSS_HP)).toBe(2);
    expect(phaseFor(practiceHp(3), BOSS_HP)).toBe(3);
    expect(phaseFor(practiceHp(2) + 1, BOSS_HP)).toBe(1);
  });
});

describe("Iron Line maps", () => {
  test("there are three missions, one of each kind", () => {
    expect(MISSIONS.map((m) => m.kind)).toEqual(["intel", "uplink", "hold"]);
  });

  for (const m of MISSIONS) {
    test(`${m.name} is a valid ${m.kind} map`, () => {
      expect(mapProblems(m.rows, m.kind)).toEqual([]);
      expect(validMap(m.rows, m.kind)).toBe(true);
    });
  }

  const box = ["########", "#P....O#", "#......#", "#..E...#", "#......#", "#......#", "#.....X#", "########"];

  test("a small hand-made map passes", () => {
    expect(mapProblems(box, "intel")).toEqual([]);
  });

  test("broken maps are caught", () => {
    expect(validMap(box, "uplink")).toBe(false); // needs two objectives
    expect(validMap(box, "hold")).toBe(false); // needs none
    expect(validMap(box.map((r, i) => (i === 0 ? "###.####" : r)), "intel")).toBe(false); // hole in the border
    expect(validMap(box.map((r, i) => (i === 3 ? "#..Z...#" : r)), "intel")).toBe(false); // unknown tile
    expect(validMap(box.map((r, i) => (i === 2 ? "#.P....#" : r)), "intel")).toBe(false); // two spawns
    expect(validMap(box.map((r, i) => (i === 6 ? "#......#" : r)), "intel")).toBe(false); // no extraction
    expect(validMap([...box.slice(0, 7), "#######"], "intel")).toBe(false); // ragged row
    expect(validMap(box.slice(0, 6), "intel")).toBe(false); // too small
    const sealed = ["########", "#P..#..#", "#...#..#", "#...#O.#", "#####..#", "#......#", "#.....X#", "########"];
    expect(validMap(sealed, "intel")).toBe(false); // spawn walled off
  });
});

describe("Iron Line raycasting", () => {
  const g = parseGrid(["#####", "#...#", "#...B", "#...#", "##C##"]);

  test("parseGrid maps walls to tile ids", () => {
    expect(g.w).toBe(5);
    expect(g.h).toBe(5);
    expect(g.cells[0]).toBe(1);
    expect(g.cells[2 * 5 + 2]).toBe(0);
    expect(g.cells[2 * 5 + 4]).toBe(2);
    expect(g.cells[4 * 5 + 2]).toBe(3);
  });

  test("hits the right wall at the right distance", () => {
    const east = castRay(g, 2.5, 2.5, 1, 0);
    expect(east.side).toBe(0);
    expect(east.tile).toBe(2);
    expect(east.dist).toBeCloseTo(1.5, 9);
    expect(east.wallX).toBeCloseTo(0.5, 9);
    expect([east.mx, east.my]).toEqual([4, 2]);

    const south = castRay(g, 2.25, 2.5, 0, 1);
    expect(south.side).toBe(1);
    expect(south.tile).toBe(3);
    expect(south.dist).toBeCloseTo(1.5, 9);
    expect(south.wallX).toBeCloseTo(0.25, 9);

    const north = castRay(g, 1.5, 3.5, 0, -1);
    expect(north.tile).toBe(1);
    expect(north.dist).toBeCloseTo(2.5, 9);
  });

  test("diagonal rays give the perpendicular distance", () => {
    const s = Math.SQRT1_2;
    const hit = castRay(g, 1.5, 1.5, s, s);
    // Along (s, s) the ray reaches x = 4 after 2.5 in x, i.e. 2.5 / s along the ray; perpendicular dist is that / (1/s).
    expect(hit.dist).toBeGreaterThan(0);
    expect(hit.wallX).toBeGreaterThanOrEqual(0);
    expect(hit.wallX).toBeLessThan(1);
    const hx = 1.5 + hit.dist * s;
    const hy = 1.5 + hit.dist * s;
    expect(hit.side === 0 ? Math.round(hx) : Math.round(hy)).toBe(hit.side === 0 ? hit.mx : hit.my);
  });

  test("leaving the map counts as concrete and reuses the out object", () => {
    const open = parseGrid(["...", "...", "..."]);
    const out = { dist: 0, side: 0, tile: 0, wallX: 0, mx: 0, my: 0 };
    const hit = castRay(open, 1.5, 1.5, -1, 0, out);
    expect(hit).toBe(out);
    expect(hit.tile).toBe(1);
    expect(hit.mx).toBe(-1);
    expect(hit.dist).toBeCloseTo(1.5, 9);
  });
});

describe("Iron Line scoring", () => {
  test("kills, headshots and time under par", () => {
    expect(missionScore(0, 0, 100, 100)).toBe(0);
    expect(missionScore(10, 4, 80, 100)).toBe(1000 + 200 + 200);
    expect(missionScore(3, 0, 200, 100)).toBe(300);
    expect(missionScore(0, 0, 99.94, 100)).toBe(1);
  });
});

describe("Iron Line medals and bests", () => {
  test("gold needs par time, 45% accuracy and 60 damage or less", () => {
    expect(medalFor(100, 100, 45, 60)).toBe("gold");
    expect(medalFor(101, 100, 90, 0)).toBe("silver");
    expect(medalFor(100, 100, 44, 0)).toBe("silver");
    expect(medalFor(100, 100, 90, 61)).toBe("silver");
  });

  test("anything slower, sloppier or more hurt than silver is bronze", () => {
    expect(medalFor(125, 100, 30, 150)).toBe("silver");
    expect(medalFor(126, 100, 90, 0)).toBe("bronze");
    expect(medalFor(100, 100, 29, 0)).toBe("bronze");
    expect(medalFor(100, 100, 90, 151)).toBe("bronze");
  });

  test("the medal gap names only the missing conditions", () => {
    expect(medalGap(100, 100, 90, 0)).toBe("");
    expect(medalGap(110, 100, 90, 0)).toBe("Gold needs: finish under 1:40.");
    expect(medalGap(200, 100, 10, 0)).toBe("Silver needs: finish under 2:05, 30% accuracy.");
  });

  test("stored bests are cleaned to one entry per mission", () => {
    expect(readMissionBests(null)).toEqual(MISSIONS.map(() => ({ score: 0, medal: "" })));
    const got = readMissionBests([{ score: 812.4, medal: "gold" }, { score: "x", medal: "gold" }, { score: 50, medal: "platinum" }, { score: 9 }]);
    expect(got).toEqual([{ score: 812, medal: "gold" }, { score: 0, medal: "" }, { score: 50, medal: "" }]);
  });

  test("score and medal improve independently", () => {
    const a = recordMission({ score: 0, medal: "" }, 500, "bronze");
    expect(a).toEqual({ score: 500, medal: "bronze" });
    const b = recordMission(a, 300, "gold");
    expect(b).toEqual({ score: 500, medal: "gold" });
    expect(recordMission(b, 900, "silver")).toEqual({ score: 900, medal: "gold" });
  });
});

describe("Iron Line foe housekeeping", () => {
  const foe = (alive, diedAt) => ({ alive, diedAt });

  test("keeps every live foe and only the newest bodies", () => {
    const list = [foe(false, 1), foe(true, -1), foe(false, 5), foe(false, 3), foe(true, -1)];
    const out = compactFoes(list, 2);
    expect(out.filter((f) => f.alive).length).toBe(2);
    expect(out.filter((f) => !f.alive).map((f) => f.diedAt).sort()).toEqual([3, 5]);
    expect(out.indexOf(list[1])).toBeLessThan(out.indexOf(list[4]));
  });

  test("leaves a short list alone", () => {
    const list = [foe(false, 1), foe(true, -1)];
    expect(compactFoes(list, 12)).toBe(list);
  });

  test("falls back to the farthest spawn when every spawn is close", () => {
    const spawns = [[1, 1], [3, 1], [2, 4]];
    expect(pickSpawns(spawns, 1, 1, 5)).toEqual([[2, 4]]);
    expect(pickSpawns(spawns, 1, 1, 2.5)).toEqual([[2, 4]]);
    expect(pickSpawns(spawns, 1, 1, 1)).toEqual([[3, 1], [2, 4]]);
    expect(pickSpawns([], 1, 1, 5)).toEqual([]);
  });
});
