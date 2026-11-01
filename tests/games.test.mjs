import { describe, expect, test } from "bun:test";
import { makeRow, PASSABLE } from "../src/components/laneRush.ts";
import { BOSS_HP, formatTime, gradeFor, phaseFor } from "../src/components/monolith.ts";
import { MISSIONS, castRay, mapProblems, missionScore, parseGrid, validMap } from "../src/components/ironLine.ts";
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
