// Iron Line: an original first-person shooter in three short missions. The world is raycast (DDA walls, floor and
// ceiling casting, billboard sprites) into a small framebuffer that is scaled up crisp; the gun and HUD are drawn at
// full resolution on top. Pure helpers (maps, rays, scoring) are exported for tests; mount() wires the page.
// Design notes: docs/hub/IRON-LINE.md.

import { startCanvasLoop } from "../lib/canvasLoop";
import { STORAGE_KEYS, readNumber, writeNumber } from "../lib/clientState";
import { buzz, createShell, holdButtons, rng } from "../lib/gameShell";
import { noise, tone, unlockAudio } from "../lib/sfx";

export type MissionKind = "intel" | "uplink" | "hold";
type RGB = [number, number, number];

export interface Mission {
  name: string;
  kind: MissionKind;
  brief: string;
  /** Open sky with ridges (true) or a cast ceiling (false). */
  sky: boolean;
  /** Par time in seconds; finishing faster earns a bonus. */
  par: number;
  fog: RGB;
  fogDist: number;
  skyTop?: RGB;
  skyHz?: RGB;
  hill?: RGB;
  /** Sun direction: [world angle, elevation]. */
  sun?: [number, number];
  floor: "dirt" | "tiles" | "asphalt";
  rows: string[];
}

export const MISSIONS: Mission[] = [
  {
    name: "Breach",
    kind: "intel",
    brief:
      "Dawn raid on a hillside compound. Push through the yard, take the intel from the command hut and get out to the extraction flare.",
    sky: true,
    par: 150,
    fog: [214, 168, 140],
    fogDist: 18,
    skyTop: [58, 72, 110],
    skyHz: [236, 170, 128],
    hill: [96, 84, 96],
    sun: [-0.6, 0.12],
    floor: "dirt",
    rows: [
      "##########################",
      "#.......#.....#....R...X.#",
      "#..E....#..E..#..........#",
      "#.......C.....#...E..CC..#",
      "#..CC.......H.......C....#",
      "#..CC...#.....#..........#",
      "####.####BB.BBB####.######",
      "#.......B.......B........#",
      "#...E...B...O...B....E...#",
      "#.......B.......B..CC....#",
      "#..R.......E.............#",
      "#.......BB...BBBB....R...#",
      "#..A.................A...#",
      "###.#####...E....#####.###",
      "#.......#.......C#.......#",
      "#..P....#..CC...C#...E...#",
      "#............R...........#",
      "##########################",
    ],
  },
  {
    name: "Uplink",
    kind: "uplink",
    brief:
      "Night, inside the relay station. Plant both uplink relays (stand on each for a moment), then reach extraction before the timer runs out. Reinforcements are coming.",
    sky: false,
    par: 200,
    fog: [8, 11, 20],
    fogDist: 11,
    floor: "tiles",
    rows: [
      "############################",
      "#P....#........#.....S.....#",
      "#.....#...E....#...........#",
      "#.....B........B...E...CC..#",
      "#..A.......CC..............#",
      "#.....B........B.....O.....#",
      "###.#####B..BBBB#####..#####",
      "#.......#......#...........#",
      "#..E....#..H...#...E....R..#",
      "#.......C......C...........#",
      "#..R...........#....CC.....#",
      "#.......#..O...#...........#",
      "##.##########.######.####.##",
      "#.......S....#.......#.....#",
      "#..E.........#...E...#..E..#",
      "#.......CC.......A.........#",
      "#.X..........#.......S.....#",
      "############################",
    ],
  },
  {
    name: "Last Stand",
    kind: "hold",
    brief:
      "Dusk at the crossroads. Hold the square until the helicopter is inbound, then run for the landing zone. Ammo crates refill.",
    sky: true,
    par: 160,
    fog: [150, 84, 74],
    fogDist: 17,
    skyTop: [40, 30, 60],
    skyHz: [214, 110, 80],
    hill: [60, 40, 52],
    sun: [2.4, 0.06],
    floor: "asphalt",
    rows: [
      "##############################",
      "#S...........S..............S#",
      "#............................#",
      "#...CC.....R.......R.....CC..#",
      "#...CC.........E.........CC..#",
      "#........BBB......BBB........#",
      "#..E.....B..........B.....E..#",
      "#........B....A.....B........#",
      "#.....R.......CC.......R.....#",
      "#.............CC.............#",
      "#........B....P.....B........#",
      "#........B..........B........#",
      "#..A.....BBB......BBB.....A..#",
      "#............................#",
      "#...CC.......X...........CC..#",
      "#...CC...................CC..#",
      "#.....R.................R....#",
      "#S............S.............S#",
      "##############################",
    ],
  },
];

export interface Grid {
  w: number;
  h: number;
  /** 0 = open, 1 concrete, 2 brick, 3 crate. */
  cells: Uint8Array;
}

const WALLS = "#BC";
const LEGAL = "#BC.PEHOARSX";

export function parseGrid(rows: string[]): Grid {
  const h = rows.length;
  const w = h ? rows[0].length : 0;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y].charAt(x);
      cells[y * w + x] = ch === "" ? 1 : WALLS.indexOf(ch) + 1;
    }
  }
  return { w, h, cells };
}

/** Everything wrong with a map, as readable strings. An empty list means the map is playable. */
export function mapProblems(rows: string[], kind: MissionKind): string[] {
  const out: string[] = [];
  const h = rows.length;
  const w = h ? rows[0].length : 0;
  if (w < 8 || h < 8) out.push(`map is ${w}x${h}; it needs at least 8x8`);
  rows.forEach((r, y) => {
    if (r.length !== w) out.push(`row ${y} is ${r.length} wide, expected ${w}`);
  });
  if (out.length) return out;

  let players = 0;
  let exits = 0;
  let objectives = 0;
  let start = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y].charAt(x);
      if (!LEGAL.includes(ch)) out.push(`unknown character "${ch}" at ${x},${y}`);
      if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && !WALLS.includes(ch)) out.push(`border is open at ${x},${y}`);
      if (ch === "P") {
        players++;
        start = y * w + x;
      } else if (ch === "X") exits++;
      else if (ch === "O") objectives++;
    }
  }
  if (players !== 1) out.push(`needs exactly one P, found ${players}`);
  if (exits !== 1) out.push(`needs exactly one X, found ${exits}`);
  const want = kind === "intel" ? 1 : kind === "uplink" ? 2 : 0;
  if (objectives !== want) out.push(`${kind} needs ${want} O, found ${objectives}`);

  if (players === 1) {
    const open = (i: number) => {
      const ch = rows[(i / w) | 0].charAt(i % w);
      return !WALLS.includes(ch) && ch !== "R";
    };
    const seen = new Uint8Array(w * h);
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % w;
      for (const n of [i - 1, i + 1, i - w, i + w]) {
        if (n < 0 || n >= w * h || seen[n]) continue;
        if ((n === i - 1 && x === 0) || (n === i + 1 && x === w - 1)) continue;
        if (!open(n)) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    let lost = 0;
    for (let i = 0; i < w * h; i++) {
      if (open(i) && !seen[i]) {
        if (lost < 3) out.push(`tile ${i % w},${(i / w) | 0} can't be reached from P`);
        lost++;
      }
    }
  }
  return out;
}

export function validMap(rows: string[], kind: MissionKind): boolean {
  return mapProblems(rows, kind).length === 0;
}

export interface RayHit {
  /** Perpendicular distance (Euclidean when the direction is a unit vector). */
  dist: number;
  /** 0 = crossed a vertical grid line (x side), 1 = horizontal (y side). */
  side: 0 | 1;
  tile: number;
  /** Where along the wall face the ray landed, 0..1. */
  wallX: number;
  mx: number;
  my: number;
}

/** Grid DDA from (ox, oy) along (dx, dy) to the first wall. Off-map counts as concrete. */
export function castRay(g: Grid, ox: number, oy: number, dx: number, dy: number, out?: RayHit): RayHit {
  const hit = out ?? { dist: 0, side: 0, tile: 0, wallX: 0, mx: 0, my: 0 };
  let mx = Math.floor(ox);
  let my = Math.floor(oy);
  const ddx = dx === 0 ? 1e30 : Math.abs(1 / dx);
  const ddy = dy === 0 ? 1e30 : Math.abs(1 / dy);
  let stepX: number;
  let stepY: number;
  let sdx: number;
  let sdy: number;
  if (dx < 0) {
    stepX = -1;
    sdx = (ox - mx) * ddx;
  } else {
    stepX = 1;
    sdx = (mx + 1 - ox) * ddx;
  }
  if (dy < 0) {
    stepY = -1;
    sdy = (oy - my) * ddy;
  } else {
    stepY = 1;
    sdy = (my + 1 - oy) * ddy;
  }
  let side: 0 | 1 = 0;
  let tile = 1;
  for (let i = 0; i < 256; i++) {
    if (sdx < sdy) {
      sdx += ddx;
      mx += stepX;
      side = 0;
    } else {
      sdy += ddy;
      my += stepY;
      side = 1;
    }
    tile = mx < 0 || my < 0 || mx >= g.w || my >= g.h ? 1 : g.cells[my * g.w + mx];
    if (tile > 0) break;
  }
  const dist = side === 0 ? sdx - ddx : sdy - ddy;
  let wx = side === 0 ? oy + dist * dy : ox + dist * dx;
  wx -= Math.floor(wx);
  hit.dist = dist;
  hit.side = side;
  hit.tile = tile || 1;
  hit.wallX = wx;
  hit.mx = mx;
  hit.my = my;
  return hit;
}

export function missionScore(kills: number, heads: number, time: number, par: number): number {
  return kills * 100 + heads * 50 + Math.max(0, Math.round((par - time) * 10));
}

// ---------------------------------------------------------------------------------------------------------------
// Textures: 64x64 ABGR words. 0 = transparent; alpha byte 0xfe marks emissive texels that ignore fog.

const T = 64;
const EMISSIVE = 0xfe;
const pack = (r: number, g: number, b: number, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const TAU = Math.PI * 2;

type Glow = (r: number, g: number, b: number) => boolean;

function paint(draw: (c: CanvasRenderingContext2D, r: () => number) => void, seed: number, grain: number, glow?: Glow): Uint32Array {
  const cv = document.createElement("canvas");
  cv.width = T;
  cv.height = T;
  const c = cv.getContext("2d", { willReadFrequently: true })!;
  const r = rng(seed);
  draw(c, r);
  const d = c.getImageData(0, 0, T, T).data;
  const out = new Uint32Array(T * T);
  for (let i = 0; i < T * T; i++) {
    if (d[i * 4 + 3] < 128) continue;
    let R = d[i * 4];
    let G = d[i * 4 + 1];
    let B = d[i * 4 + 2];
    if (glow && glow(R, G, B)) {
      out[i] = pack(R, G, B, EMISSIVE);
      continue;
    }
    if (grain) {
      const n = (r() * 2 - 1) * grain;
      R = clamp(R + n, 0, 255) | 0;
      G = clamp(G + n, 0, 255) | 0;
      B = clamp(B + n, 0, 255) | 0;
    }
    out[i] = pack(R, G, B);
  }
  return out;
}

function darken(t: Uint32Array): Uint32Array {
  const o = new Uint32Array(t.length);
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (!c) continue;
    o[i] = pack((((c & 255) * 205) >> 8), ((((c >> 8) & 255) * 205) >> 8), ((((c >> 16) & 255) * 205) >> 8), c >>> 24);
  }
  return o;
}

function rect(c: CanvasRenderingContext2D, col: string, x: number, y: number, w: number, h: number) {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
}
function oval(c: CanvasRenderingContext2D, col: string, x: number, y: number, rx: number, ry: number) {
  c.fillStyle = col;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, TAU);
  c.fill();
}

const texConcrete = (c: CanvasRenderingContext2D, r: () => number) => {
  rect(c, "#707276", 0, 0, T, T);
  for (let i = 0; i < 14; i++) rect(c, `rgba(40,40,44,${0.05 + r() * 0.12})`, r() * T, r() * T, 4 + r() * 18, 3 + r() * 12);
  rect(c, "#55575b", 0, 31, T, 2);
  rect(c, "#55575b", 0, 0, 2, T);
  rect(c, "#8a8c90", 0, 33, T, 1);
  for (const [x, y] of [[8, 8], [56, 8], [8, 56], [56, 56], [8, 40], [56, 40], [8, 24], [56, 24]]) rect(c, "#3c3e42", x - 1, y - 1, 2, 2);
  rect(c, "rgba(60,48,40,0.25)", 20, 33, 6, 30);
};
const texBrick = (c: CanvasRenderingContext2D, r: () => number) => {
  rect(c, "#5c544e", 0, 0, T, T);
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 8 : 0;
    for (let col = -1; col < 4; col++) {
      const tone = 120 + r() * 40;
      c.fillStyle = `rgb(${tone | 0},${(tone * 0.52) | 0},${(tone * 0.4) | 0})`;
      c.fillRect(col * 16 + off + 1, row * 8 + 1, 14, 6);
    }
  }
  for (let i = 0; i < 6; i++) rect(c, "rgba(30,20,16,0.22)", r() * T, r() * T, 3 + r() * 8, 2 + r() * 4);
};
const texCrate = (c: CanvasRenderingContext2D, r: () => number) => {
  rect(c, "#4a3820", 0, 0, T, T);
  for (const ox of [0, 32]) {
    for (const oy of [0, 32]) {
      rect(c, "#7c5c34", ox + 2, oy + 2, 28, 28);
      for (let p = 0; p < 4; p++) rect(c, "#6a4d2a", ox + 2, oy + 2 + p * 7, 28, 1);
      c.strokeStyle = "#5a4224";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(ox + 4, oy + 28);
      c.lineTo(ox + 28, oy + 4);
      c.stroke();
      rect(c, "#3e2e18", ox + 2, oy + 2, 28, 2);
      rect(c, "#3e2e18", ox + 2, oy + 28, 28, 2);
      rect(c, "#3e2e18", ox + 2, oy + 2, 2, 28);
      rect(c, "#3e2e18", ox + 28, oy + 2, 2, 28);
    }
  }
  rect(c, "rgba(230,200,120,0.35)", 38, 12, 16, 3);
  rect(c, "rgba(230,200,120,0.35)", 6, 46, 12, 3);
  void r;
};
const texDirt = (c: CanvasRenderingContext2D, r: () => number) => {
  rect(c, "#6e5844", 0, 0, T, T);
  for (let i = 0; i < 40; i++) oval(c, `rgba(${r() > 0.5 ? "90,70,52" : "126,104,80"},0.5)`, r() * T, r() * T, 2 + r() * 6, 1 + r() * 4);
  for (let i = 0; i < 18; i++) rect(c, "#8d7a62", r() * T, r() * T, 2, 1);
};
const texTiles = (c: CanvasRenderingContext2D, r: () => number) => {
  rect(c, "#23262c", 0, 0, T, T);
  for (const ox of [0, 32]) for (const oy of [0, 32]) rect(c, r() > 0.5 ? "#3d434d" : "#373c45", ox + 1, oy + 1, 30, 30);
  rect(c, "rgba(255,255,255,0.05)", 2, 2, 28, 2);
  rect(c, "rgba(255,255,255,0.05)", 34, 34, 28, 2);
};
const texAsphalt = (c: CanvasRenderingContext2D, r: () => number) => {
  rect(c, "#3b3b3f", 0, 0, T, T);
  for (let i = 0; i < 120; i++) rect(c, r() > 0.5 ? "#4a4a4f" : "#2d2d31", r() * T, r() * T, 1, 1);
  c.strokeStyle = "#2a2a2d";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(4, 50);
  c.lineTo(20, 44);
  c.lineTo(28, 52);
  c.lineTo(44, 46);
  c.stroke();
};
const texCeiling = (c: CanvasRenderingContext2D) => {
  rect(c, "#20242c", 0, 0, T, T);
  rect(c, "#2a2f38", 1, 1, 62, 62);
  rect(c, "#181b21", 0, 31, T, 2);
  rect(c, "#181b21", 31, 0, 2, T);
  rect(c, "#3a3528", 18, 24, 28, 16);
  rect(c, "#fff3d6", 20, 26, 24, 12);
};

// Troopers: frame 0 idle, 1 walk, 2 walk, 3 fire, 4 pain, 5 dead. The head sits above HEAD_LINE.
const HEAD_LINE = 18;
function trooper(c: CanvasRenderingContext2D, f: number, heavy: boolean) {
  const body = heavy ? "#3b3330" : "#3a4250";
  const vest = heavy ? "#57463c" : "#262b33";
  const legs = heavy ? "#2e2826" : "#2c323c";
  const helm = "#1b1f25";
  const gun = "#131518";
  if (f === 5) {
    rect(c, "#111", 2, 56, 6, 6);
    rect(c, legs, 7, 55, 20, 7);
    rect(c, body, 26, 51, 22, 11);
    rect(c, vest, 28, 52, 16, 9);
    oval(c, helm, 54, 56, 8, 6);
    rect(c, "#5a1a14", 57, 54, 3, 4);
    rect(c, gun, 16, 60, 30, 3);
    return;
  }
  const hw = heavy ? 13 : 10;
  c.save();
  if (f === 4) {
    c.translate(32, 63);
    c.rotate(-0.16);
    c.translate(-32, -63);
  }
  const lift = f === 1 || f === 2 ? 1 : 0;
  c.translate(0, -lift);
  // legs and boots
  const lA = f === 1 ? -3 : f === 2 ? 2 : 0;
  rect(c, legs, 32 - hw + 3, 38, 8, 20 + lA);
  rect(c, legs, 33, 38, 8 + (heavy ? 2 : 0), 20 - lA);
  rect(c, "#111", 32 - hw + 2, 57 + lA, 10, 6 - Math.max(0, lA));
  rect(c, "#111", 32, 57 - lA, 10 + (heavy ? 2 : 0), 6 + Math.min(0, lA));
  // torso, vest, pouches
  rect(c, body, 32 - hw, 17, hw * 2, 22);
  rect(c, vest, 32 - hw + 2, 19, hw * 2 - 4, 16);
  rect(c, "#1c2026", 32 - hw + 4, 30, 5, 5);
  rect(c, "#1c2026", 32 + hw - 9, 30, 5, 5);
  rect(c, "#1c2026", 29, 30, 6, 5);
  // arms
  rect(c, body, 32 - hw - 4, 19, 5, 13);
  rect(c, body, 32 + hw - 1, 19, 5, 13);
  // head: balaclava, helmet, visor
  rect(c, "#2a2e35", 26, 11, 12, 7);
  oval(c, helm, 32, 9, heavy ? 9 : 8, 7);
  rect(c, helm, heavy ? 23 : 24, 8, heavy ? 18 : 16, 3);
  rect(c, "#ff4433", 26, 10, 12, 3);
  if (heavy) rect(c, "#20201e", 28, 14, 8, 4);
  // weapon
  if (f === 3) {
    rect(c, gun, 26, 22, 12, 10);
    rect(c, "#2b2f36", 22, 26, 6, 5);
    rect(c, "#2b2f36", 36, 26, 6, 5);
    c.fillStyle = "#ffe080";
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const rr = i % 2 ? 4 : 9;
      c.lineTo(32 + Math.cos(a) * rr, 25 + Math.sin(a) * rr);
    }
    c.fill();
    oval(c, "#fff6d0", 32, 25, 3, 3);
  } else {
    c.strokeStyle = gun;
    c.lineWidth = heavy ? 6 : 4;
    c.beginPath();
    c.moveTo(16, 36);
    c.lineTo(48, 24);
    c.stroke();
    rect(c, gun, 30, 30, 4, heavy ? 9 : 6);
    if (heavy) oval(c, "#222428", 26, 36, 5, 5);
    rect(c, "#2b2f36", 21, 31, 6, 5);
    rect(c, "#2b2f36", 39, 25, 6, 5);
  }
  if (f === 4) rect(c, "#2b2f36", 32 + hw, 12, 5, 6);
  c.restore();
}
const trooperGlow: Glow = (r, g, b) => r > 235 && (g < 100 || (g > 200 && b > 100));

function barrelTex(c: CanvasRenderingContext2D) {
  rect(c, "#8e2a22", 14, 8, 36, 55);
  rect(c, "#b13a2e", 18, 8, 8, 55);
  rect(c, "#6e1f19", 42, 8, 8, 55);
  rect(c, "#5a1813", 14, 20, 36, 3);
  rect(c, "#5a1813", 14, 46, 36, 3);
  rect(c, "#e2b320", 14, 30, 36, 8);
  for (let i = 0; i < 5; i++) rect(c, "#1b1b1b", 16 + i * 7, 30, 3, 8);
  oval(c, "#a8342a", 32, 8, 18, 4);
  oval(c, "#4c140f", 32, 8, 14, 2.6);
}
function ammoTex(c: CanvasRenderingContext2D) {
  rect(c, "#3c4a2a", 6, 28, 52, 35);
  rect(c, "#4f6036", 8, 30, 48, 8);
  rect(c, "#2c3620", 6, 26, 52, 4);
  rect(c, "#d9b23a", 6, 44, 52, 6);
  for (let i = 0; i < 4; i++) rect(c, "#2a2a22", 14 + i * 10, 45, 5, 4);
  rect(c, "#20261a", 26, 22, 12, 5);
}
function intelTex(c: CanvasRenderingContext2D) {
  rect(c, "#1d2026", 10, 46, 44, 8);
  rect(c, "#2c3038", 12, 47, 40, 5);
  c.fillStyle = "#1a1d22";
  c.beginPath();
  c.moveTo(14, 46);
  c.lineTo(50, 46);
  c.lineTo(46, 16);
  c.lineTo(18, 16);
  c.fill();
  c.fillStyle = "#7fd8ff";
  c.beginPath();
  c.moveTo(18, 43);
  c.lineTo(46, 43);
  c.lineTo(43, 19);
  c.lineTo(21, 19);
  c.fill();
  rect(c, "#2e6f8e", 24, 24, 14, 2);
  rect(c, "#2e6f8e", 24, 29, 10, 2);
  rect(c, "#2e6f8e", 24, 34, 16, 2);
}
const intelGlow: Glow = (r, g, b) => b > 240 && g > 200 && r < 150;
function relayTex(c: CanvasRenderingContext2D, on: boolean) {
  c.strokeStyle = "#2a2d33";
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(32, 30);
  c.lineTo(14, 63);
  c.moveTo(32, 30);
  c.lineTo(50, 63);
  c.moveTo(32, 30);
  c.lineTo(32, 63);
  c.stroke();
  rect(c, "#3a3f47", 20, 22, 24, 14);
  rect(c, "#23262c", 22, 24, 20, 10);
  rect(c, "#555b66", 31, 2, 2, 20);
  oval(c, "#555b66", 32, 4, 6, 2);
  rect(c, on ? "#62ff9a" : "#6a1c16", 25, 27, 5, 4);
  rect(c, on ? "#62ff9a" : "#2a2d33", 34, 27, 5, 4);
}
const relayGlow: Glow = (r, g) => g > 240 && r < 130;
function lzTex(c: CanvasRenderingContext2D) {
  rect(c, "#3a3d42", 30, 30, 4, 34);
  oval(c, "#e9e4d4", 32, 18, 16, 16);
  oval(c, "#2f6b3a", 32, 18, 13, 13);
  rect(c, "#e9e4d4", 25, 10, 3, 16);
  rect(c, "#e9e4d4", 36, 10, 3, 16);
  rect(c, "#e9e4d4", 25, 17, 14, 3);
}
function flareTex(c: CanvasRenderingContext2D, f: number) {
  for (let i = 0; i < 6; i++) oval(c, `rgba(${200 - i * 10},${70 + i * 8},${70 + i * 8},0.6)`, 32 + (f ? 2 : -2) * (i % 2 ? 1 : -1), 50 - i * 8, 7 + i * 1.6, 6);
  oval(c, "#ff5a4a", 32, 56, 8, 6);
  oval(c, "#ffd0b0", 32, 57, 4, 3);
  rect(c, "#2a2a2a", 30, 59, 4, 5);
}
const flareGlow: Glow = (r, g) => r > 240 && g > 70;

// ---------------------------------------------------------------------------------------------------------------

interface Foe {
  x: number;
  y: number;
  hp: number;
  heavy: boolean;
  alive: boolean;
  noticed: boolean;
  react: number;
  losT: number;
  sees: boolean;
  burst: number;
  shotT: number;
  waitT: number;
  strafe: number;
  strafeT: number;
  flash: number;
  pain: number;
  fireT: number;
  walk: number;
  moving: boolean;
}

type PropKind = "barrel" | "ammo" | "intel" | "relay" | "lz" | "flare";
interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  alive: boolean;
  hp: number;
  fuse: number;
  amount: number;
  respawn: number;
  wait: number;
  prog: number;
  on: boolean;
}

interface Spr {
  x: number;
  y: number;
  z: number;
  size: number;
  tex: Uint32Array;
  depth: number;
  flash: boolean;
  pick: 0 | 1 | 2;
  foe: Foe | null;
  prop: Prop | null;
  left: number;
  top: number;
  px: number;
}

interface Part {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  col: number;
  size: number;
  grav: number;
  em: boolean;
}

const MAG = 30;
const FIRE_GAP = 0.095;
const RELOAD = 1.6;
const PR = 0.25;
const LOOK_TOUCH = 0.0065;
const STICK_R = 48;

export function mount(root: HTMLElement): { destroy(): void } {
  const cg = root.querySelector<HTMLElement>("[data-cg]");
  const canvas = cg?.querySelector<HTMLCanvasElement>("[data-canvas]");
  if (!cg || !canvas) return { destroy() {} };
  const modeBtns = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-mode]"));
  const missionBtns = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-mission]"));
  const elScore = root.querySelector<HTMLElement>("[data-score]");
  const elBest = root.querySelector<HTMLElement>("[data-best]");
  const elCleared = root.querySelector<HTMLElement>("[data-cleared]");
  const fireBtn = cg.querySelector<HTMLElement>('[data-key="fire"]');
  const reduced = () => document.documentElement.dataset.motion === "reduced";
  const coarse = window.matchMedia("(pointer: coarse)");
  const rand = Math.random;

  // ---------- textures ----------
  const wallTex = [new Uint32Array(0), paint(texConcrete, 11, 9), paint(texBrick, 12, 8), paint(texCrate, 13, 9)];
  const wallDark = wallTex.map(darken);
  const floors = { dirt: paint(texDirt, 21, 12), tiles: paint(texTiles, 22, 5), asphalt: paint(texAsphalt, 23, 10) };
  const ceilTex = paint(texCeiling, 24, 4, (r, g) => r > 240 && g > 230);
  const soldierTex = [0, 1, 2, 3, 4, 5].map((f) => paint((c) => trooper(c, f, false), 31 + f, 6, trooperGlow));
  const heavyTex = [0, 1, 2, 3, 4, 5].map((f) => paint((c) => trooper(c, f, true), 41 + f, 6, trooperGlow));
  const barrelT = paint(barrelTex, 51, 7);
  const ammoT = paint(ammoTex, 52, 7);
  const intelT = paint(intelTex, 53, 4, intelGlow);
  const relayOff = paint((c) => relayTex(c, false), 54, 4);
  const relayOn = paint((c) => relayTex(c, true), 55, 4, relayGlow);
  const lzT = paint(lzTex, 56, 4);
  const flareT = [paint((c) => flareTex(c, 0), 57, 0, flareGlow), paint((c) => flareTex(c, 1), 58, 0, flareGlow)];

  // ---------- framebuffer ----------
  const fbCanvas = document.createElement("canvas");
  const fbCtx = fbCanvas.getContext("2d")!;
  let RW = 240;
  let RH = 135;
  let img: ImageData = fbCtx.createImageData(RW, RH);
  let buf = new Uint32Array(img.data.buffer);
  let zbuf = new Float32Array(RW);
  let ridge = new Float32Array(RW);
  let W = 0;
  let H = 0;
  let vignette: HTMLCanvasElement | null = null;
  let ctxRef: CanvasRenderingContext2D | null = null;

  // ---------- mission state ----------
  let mi = 0;
  let mission = MISSIONS[0];
  let grid: Grid = parseGrid(mission.rows);
  let flow = new Int16Array(0);
  let queue = new Int32Array(0);
  let mini: HTMLCanvasElement | null = null;
  let skyLut = new Uint32Array(256);
  let floorTex = floors.dirt;
  let foes: Foe[] = [];
  let props: Prop[] = [];
  let spawns: Array<[number, number]> = [];
  let ext = { x: 0, y: 0 };
  let extActive = false;
  let hasIntel = false;
  let planted = 0;
  let uplinkT = 0;
  let reinforceT = 0;
  let holdT = 0;
  let holdDone = false;
  let spawnT = 0;
  let flowT = 0;

  // player
  let px = 0;
  let py = 0;
  let pa = 0;
  let pitch = 0;
  let hp = 100;
  let lastHurt = -99;
  let mag = MAG;
  let reserve = 120;
  let reloadT = 0;
  let fireCD = 0;
  let adsT = 0;
  let adsLatch = false;
  let bloom = 0;
  let recoilP = 0;
  let moving = false;
  let bobPh = 0;
  let stepPh = 0;
  let lastSpread = 0;

  // stats
  let t = 0;
  let kills = 0;
  let heads = 0;
  let shots = 0;
  let hits = 0;
  let veteran = false;
  let cleared = clamp(Math.round(readNumber(STORAGE_KEYS.ironLineMission) ?? 0), 0, 3);
  let best = Math.max(0, readNumber(STORAGE_KEYS.ironLineBest) ?? 0);
  let lastScore: number | null = null;

  // fx
  let flash = 0;
  let shake = 0;
  let muzzleT = 0;
  let kickT = 0;
  let hurtT = 0;
  let hitT = 0;
  let killT = 0;
  let hurtSfxT = 0;
  let deadT = 0;
  let animT = 0;
  const arcs: Array<{ x: number; y: number; t: number }> = [];
  const popups: Array<{ text: string; t: number; col: string }> = [];
  const parts: Part[] = [];
  for (let i = 0; i < 160; i++) parts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, col: 0, size: 0.03, grav: 0, em: false });
  let partNext = 0;
  const sprPool: Spr[] = [];
  const sprs: Spr[] = [];
  const picks: Spr[] = [];
  const hitTmp: RayHit = { dist: 0, side: 0, tile: 0, wallX: 0, mx: 0, my: 0 };
  const hitTmp2: RayHit = { dist: 0, side: 0, tile: 0, wallX: 0, mx: 0, my: 0 };

  type State = "menu" | "run" | "paused" | "won" | "over";
  let state: State = "menu";

  // input
  const keys: Record<string, boolean> = {};
  const tkeys: Record<string, boolean> = {};
  let mouseFire = false;
  let mouseAim = false;
  let locked = false;
  let stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  let look: { id: number; x: number; y: number } | null = null;
  let fireLook: { id: number; x: number; y: number } | null = null;

  // ---------- sounds ----------
  const sGun = () => {
    noise(0.09, 0.35, 900, 0.7);
    tone(140, 0.08, "sawtooth", 0.12, 60);
  };
  const sFoeGun = (v: number) => {
    noise(0.07, 0.24 * v, 1300, 0.8);
    tone(170, 0.06, "sawtooth", 0.07 * v, 80);
  };
  const sWhizz = () => tone(2400, 0.12, "sine", 0.04, 600);
  const sHit = () => tone(1800, 0.04, "square", 0.05);
  const sHead = () => tone(2400, 0.06, "triangle", 0.08);
  const sBoom = () => {
    noise(0.45, 0.6, 300, 0.5);
    tone(60, 0.5, "sine", 0.4, 30);
  };
  const sPickup = () => tone(880, 0.08, "square", 0.08, 1320);
  const sHurt = () => {
    tone(180, 0.12, "sawtooth", 0.15, 90);
    buzz(40);
  };
  const sChime = () => tone(660, 0.25, "triangle", 0.15, 990);
  const sEmpty = () => tone(300, 0.03, "square", 0.05);
  const sStep = () => noise(0.04, 0.06, 500, 1);
  const sDeath = () => tone(220, 0.25, "sawtooth", 0.08, 80);

  // ---------- helpers ----------
  const fmt = (s: number) => {
    const v = Math.max(0, Math.ceil(s));
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
  };
  const solidAt = (x: number, y: number) => {
    const mx = Math.floor(x);
    const my = Math.floor(y);
    if (mx < 0 || my < 0 || mx >= grid.w || my >= grid.h) return true;
    return grid.cells[my * grid.w + mx] > 0;
  };
  const blocked = (x: number, y: number, r: number) => {
    if (solidAt(x - r, y - r) || solidAt(x + r, y - r) || solidAt(x - r, y + r) || solidAt(x + r, y + r)) return true;
    for (const b of props) {
      if (b.kind !== "barrel" || !b.alive) continue;
      const dx = x - b.x;
      const dy = y - b.y;
      if (dx * dx + dy * dy < (r + 0.3) * (r + 0.3)) return true;
    }
    return false;
  };
  const moveBody = (o: { x: number; y: number }, dx: number, dy: number, r: number) => {
    if (!blocked(o.x + dx, o.y, r)) o.x += dx;
    if (!blocked(o.x, o.y + dy, r)) o.y += dy;
  };
  const los = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) return true;
    return castRay(grid, ax, ay, dx / d, dy / d, hitTmp2).dist >= d - 0.05;
  };
  const popup = (text: string, col = "#f4f4f6") => {
    popups.unshift({ text, t: 1.6, col });
    if (popups.length > 4) popups.length = 4;
  };
  const emit = (x: number, y: number, z: number, n: number, col: number, speed: number, life: number, size: number, grav: number, em: boolean, up = 0) => {
    for (let i = 0; i < n; i++) {
      const p = parts[partNext];
      partNext = (partNext + 1) % parts.length;
      const a = rand() * TAU;
      const s = speed * (0.3 + rand() * 0.7);
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.vz = (rand() * 2 - 1) * s * 0.6 + up;
      p.life = life * (0.6 + rand() * 0.4);
      p.max = p.life;
      p.col = col;
      p.size = size * (0.7 + rand() * 0.6);
      p.grav = grav;
      p.em = em;
    }
  };

  function newFoe(x: number, y: number, heavy: boolean, alert: boolean): Foe {
    return {
      x,
      y,
      hp: heavy ? 250 : 100,
      heavy,
      alive: true,
      noticed: alert,
      react: alert ? 0.6 + rand() * 0.4 : 0,
      losT: rand() * 0.12,
      sees: false,
      burst: 0,
      shotT: 0,
      waitT: 0.3 + rand() * 0.5,
      strafe: rand() < 0.5 ? -1 : 1,
      strafeT: 0.8 + rand() * 0.8,
      flash: 0,
      pain: 0,
      fireT: 0,
      walk: rand(),
      moving: false,
    };
  }
  const newProp = (kind: PropKind, x: number, y: number, amount = 0): Prop => ({
    kind,
    x,
    y,
    alive: true,
    hp: 30,
    fuse: -1,
    amount,
    respawn: 0,
    wait: 0,
    prog: 0,
    on: false,
  });

  function buildSky() {
    const top = mission.skyTop ?? [0, 0, 0];
    const hz = mission.skyHz ?? mission.fog;
    for (let i = 0; i < 256; i++) {
      const k = Math.pow(i / 255, 0.7);
      skyLut[i] = pack(lerp(hz[0], top[0], k) | 0, lerp(hz[1], top[1], k) | 0, lerp(hz[2], top[2], k) | 0);
    }
  }

  function buildMini() {
    const c = document.createElement("canvas");
    c.width = grid.w * 4;
    c.height = grid.h * 4;
    const x2 = c.getContext("2d")!;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const v = grid.cells[y * grid.w + x];
        if (!v) continue;
        x2.fillStyle = v === 3 ? "rgba(200,170,120,0.55)" : "rgba(220,224,232,0.6)";
        x2.fillRect(x * 4, y * 4, 4, 4);
      }
    }
    mini = c;
  }

  function buildFlow() {
    flow.fill(-1);
    const gw = grid.w;
    const sx = Math.floor(px);
    const sy = Math.floor(py);
    const s = sy * gw + sx;
    flow[s] = 0;
    queue[0] = s;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % gw;
      const y = (i / gw) | 0;
      const d = flow[i] + 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (solidAt(nx, ny)) continue;
          if (dx && dy && (solidAt(x + dx, y) || solidAt(x, y + dy))) continue;
          const ni = ny * gw + nx;
          if (flow[ni] >= 0) continue;
          flow[ni] = d;
          queue[tail++] = ni;
        }
      }
    }
  }

  function loadMission(i: number) {
    mi = i;
    mission = MISSIONS[i];
    grid = parseGrid(mission.rows);
    flow = new Int16Array(grid.w * grid.h);
    queue = new Int32Array(grid.w * grid.h);
    floorTex = floors[mission.floor];
    foes = [];
    props = [];
    spawns = [];
    extActive = false;
    hasIntel = false;
    planted = 0;
    uplinkT = 0;
    reinforceT = 0;
    holdT = 0;
    holdDone = false;
    spawnT = 2;
    flowT = 0;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const ch = mission.rows[y].charAt(x);
        const cx = x + 0.5;
        const cy = y + 0.5;
        if (ch === "P") {
          px = cx;
          py = cy;
        } else if (ch === "E" || ch === "H") foes.push(newFoe(cx, cy, ch === "H", false));
        else if (ch === "O") props.push(newProp(mission.kind === "uplink" ? "relay" : "intel", cx, cy));
        else if (ch === "A") props.push({ ...newProp("ammo", cx, cy, 60), respawn: mission.kind === "hold" ? 20 : 0 });
        else if (ch === "R") props.push(newProp("barrel", cx, cy));
        else if (ch === "S") spawns.push([cx, cy]);
        else if (ch === "X") {
          ext = { x: cx, y: cy };
          if (mission.kind === "hold") props.push(newProp("lz", cx + 0.32, cy - 0.32));
          props.push({ ...newProp("flare", cx, cy), alive: false });
        }
      }
    }
    // Face down the longest sightline.
    let bestD = -1;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const d = castRay(grid, px, py, Math.cos(a), Math.sin(a), hitTmp).dist;
      if (d > bestD) {
        bestD = d;
        pa = a;
      }
    }
    pitch = 0;
    hp = 100;
    lastHurt = -99;
    mag = MAG;
    reserve = 120;
    reloadT = 0;
    fireCD = 0;
    adsT = 0;
    adsLatch = false;
    bloom = 0;
    recoilP = 0;
    t = 0;
    kills = 0;
    heads = 0;
    shots = 0;
    hits = 0;
    flash = 0;
    shake = 0;
    muzzleT = 0;
    kickT = 0;
    hurtT = 0;
    hitT = 0;
    killT = 0;
    deadT = 0;
    arcs.length = 0;
    popups.length = 0;
    for (const p of parts) p.life = 0;
    buildSky();
    buildMini();
    buildFlow();
  }

  // ---------- combat ----------
  function damagePlayer(dmg: number, sx: number, sy: number) {
    if (state !== "run") return;
    hp -= dmg;
    lastHurt = t;
    hurtT = Math.min(1, hurtT + 0.45);
    arcs.push({ x: sx, y: sy, t: 1 });
    if (arcs.length > 6) arcs.shift();
    if (!reduced()) shake = Math.min(1, shake + 0.25);
    if (hurtSfxT <= 0) {
      sHurt();
      hurtSfxT = 0.12;
    }
    if (hp <= 0) {
      hp = 0;
      lose("dead");
    }
  }

  function killFoe(f: Foe, head: boolean) {
    f.alive = false;
    f.hp = 0;
    kills++;
    if (head) heads++;
    killT = 0.3;
    sDeath();
    if (rand() < 0.6) props.push(newProp("ammo", f.x + (rand() - 0.5) * 0.2, f.y + (rand() - 0.5) * 0.2, 30));
  }

  function damageFoe(f: Foe, dmg: number, head: boolean) {
    if (!f.alive) return;
    f.hp -= dmg;
    f.flash = 0.08;
    f.pain = 0.16;
    if (!f.noticed) {
      f.noticed = true;
      f.react = 0.25;
    }
    if (f.hp <= 0) killFoe(f, head);
  }

  function explode(b: Prop) {
    b.alive = false;
    sBoom();
    flash = Math.max(flash, 1.6);
    if (!reduced()) shake = 1;
    buzz([30, 30, 60]);
    emit(b.x, b.y, 0.3, 26, pack(255, 170, 60, EMISSIVE), 3.2, 0.5, 0.09, -1.5, true, 1.2);
    emit(b.x, b.y, 0.3, 14, pack(255, 230, 150, EMISSIVE), 2, 0.3, 0.06, 0, true, 0.6);
    emit(b.x, b.y, 0.4, 14, pack(70, 66, 64), 0.9, 1.4, 0.16, -0.6, false, 0.6);
    for (const f of foes) {
      if (!f.alive) continue;
      const d = Math.hypot(f.x - b.x, f.y - b.y);
      if (d < 2.2) damageFoe(f, 150 * (1 - d / 2.2), false);
    }
    const dp = Math.hypot(px - b.x, py - b.y);
    if (dp < 2.2) damagePlayer(Math.min(60, 150 * (1 - dp / 2.2)), b.x, b.y);
    for (const o of props) {
      if (o.kind !== "barrel" || !o.alive || o === b || o.fuse >= 0) continue;
      if (Math.hypot(o.x - b.x, o.y - b.y) < 2.2) o.fuse = 0.15;
    }
  }

  const dirX = () => Math.cos(pa);
  const dirY = () => Math.sin(pa);
  const planeLen = () => 0.7 - 0.25 * smooth(adsT);

  function fire() {
    shots++;
    mag--;
    fireCD = FIRE_GAP;
    muzzleT = 0.05;
    kickT = 1;
    flash = Math.max(flash, 1);
    sGun();
    const a = smooth(adsT);
    const spread = lastSpread;
    bloom = Math.min(0.03, bloom + 0.006);
    recoilP += 0.012 * (1 - 0.5 * a);
    pa += (rand() * 2 - 1) * 0.003;
    if (!reduced()) shake = Math.min(1, shake + 0.05);

    const pl = planeLen();
    const proj = RW / 2 / pl;
    const ang = rand() * TAU;
    const rr = rand() * spread * proj;
    const ax = RW / 2 + Math.cos(ang) * rr;
    const ay = RH / 2 + Math.sin(ang) * rr;
    const col = clamp(Math.round(ax), 0, RW - 1);

    // Gunfire wakes up anyone close.
    for (const f of foes) {
      if (!f.alive || f.noticed) continue;
      const d = Math.hypot(f.x - px, f.y - py);
      if (d < 10) {
        f.noticed = true;
        f.react = 0.55 + d * 0.03;
      }
    }

    let target: Spr | null = null;
    let ty = 0;
    for (let i = picks.length - 1; i >= 0; i--) {
      const s = picks[i];
      if (s.depth >= zbuf[col] + 0.01) continue;
      if (ay < s.top || ay >= s.top + s.px) continue;
      const tyv = ((ay - s.top) * T) / s.px;
      for (const off of [0, -2, 2]) {
        const sx = ax + off;
        if (sx < s.left || sx >= s.left + s.px) continue;
        const tx = clamp(((sx - s.left) * T) / s.px, 0, T - 1) | 0;
        if (s.tex[(clamp(tyv, 0, T - 1) | 0) * T + tx]) {
          target = s;
          ty = tyv;
          break;
        }
      }
      if (target) break;
    }
    const camX = (ax - RW / 2) / (RW / 2);
    const rdx = dirX() - dirY() * pl * camX;
    const rdy = dirY() + dirX() * pl * camX;
    if (target && target.foe) {
      const f = target.foe;
      const head = ty < HEAD_LINE;
      hits++;
      hitT = 0.12;
      if (head) sHead();
      else sHit();
      const d = target.depth;
      emit(px + rdx * (d - 0.05), py + rdy * (d - 0.05), 0.5 - (ay - (RH / 2 + (pitch + recoilP) * RH)) / proj * d, 5, pack(120, 20, 18), 1.2, 0.35, 0.04, 4, false);
      damageFoe(f, head ? 34 * 2.5 : 34, head);
      if (!f.alive && head) popup("Headshot", "#ffd36b");
      return;
    }
    if (target && target.prop) {
      hits++;
      hitT = 0.12;
      sHit();
      const b = target.prop;
      b.hp -= 34;
      emit(b.x, b.y, 0.35, 6, pack(255, 200, 120, EMISSIVE), 1.6, 0.2, 0.03, 4, true);
      if (b.hp <= 0 && b.fuse < 0) b.fuse = 0.02;
      return;
    }
    // A miss: sparks on a wall, dust on the floor.
    const h = castRay(grid, px, py, rdx, rdy, hitTmp);
    const hz = RH / 2 + (pitch + recoilP) * RH;
    const lh = proj / h.dist;
    if (ay > hz + lh / 2) {
      const rowD = (0.5 * proj) / (ay + 0.5 - hz);
      emit(px + rdx * rowD, py + rdy * rowD, 0.02, 6, pack(150, 128, 100), 0.8, 0.5, 0.035, 3, false, 1);
    } else if (ay > hz - lh / 2) {
      const z = 0.5 - ((ay - hz) * h.dist) / proj;
      const d = h.dist - 0.03;
      emit(px + rdx * d, py + rdy * d, z, 5, pack(255, 220, 140, EMISSIVE), 1.6, 0.18, 0.025, 6, true);
      emit(px + rdx * d, py + rdy * d, z, 3, pack(130, 130, 130), 0.4, 0.5, 0.05, 0.5, false);
    }
  }

  function startReload() {
    if (reloadT > 0 || mag >= MAG || reserve <= 0 || state !== "run") return;
    reloadT = RELOAD;
    tone(420, 0.05, "square", 0.04);
  }

  // ---------- update ----------
  function update(dt: number) {
    t += dt;
    const vet = veteran;
    const motion = !reduced();

    // Aim and look.
    const wantAim = keys.aim || mouseAim || adsLatch;
    adsT = clamp(adsT + (wantAim && reloadT <= 0 ? dt : -dt) / 0.18, 0, 1);
    const a = smooth(adsT);
    let turn = 0;
    if (keys.turnL) turn -= 1;
    if (keys.turnR) turn += 1;
    pa += turn * 2.4 * dt * (1 - 0.4 * a);

    // Move.
    let f = 0;
    let s = 0;
    if (keys.fwd) f += 1;
    if (keys.back) f -= 1;
    if (keys.left) s -= 1;
    if (keys.right) s += 1;
    if (stick) {
      let sx = (stick.x - stick.ox) / STICK_R;
      let sy = (stick.y - stick.oy) / STICK_R;
      const m = Math.hypot(sx, sy);
      if (m > 1) {
        sx /= m;
        sy /= m;
      }
      if (m > 0.12) {
        f -= sy;
        s += sx;
      }
    }
    const fm = Math.hypot(f, s);
    if (fm > 1) {
      f /= fm;
      s /= fm;
    }
    const speed = adsT > 0.5 ? 1.8 : 3.2;
    const dX = dirX();
    const dY = dirY();
    const mx = (dX * f - dY * s) * speed * dt;
    const my = (dY * f + dX * s) * speed * dt;
    const before = { x: px, y: py };
    const pos = { x: px, y: py };
    moveBody(pos, mx, my, PR);
    px = pos.x;
    py = pos.y;
    const moved = Math.hypot(px - before.x, py - before.y);
    moving = moved > 0.4 * dt;
    if (moving) {
      bobPh += (moved / dt) * dt * 3.1;
      stepPh += moved;
      if (stepPh > 0.85) {
        stepPh = 0;
        sStep();
      }
    }

    // Touch aim assist: drift onto a soldier that is almost under the crosshair.
    if (coarse.matches) {
      let bestE = 99;
      for (const sp of picks) {
        if (!sp.foe || !sp.foe.alive) continue;
        const ex = sp.left + sp.px / 2 - RW / 2;
        if (Math.abs(ex) < 14 && Math.abs(ex) < Math.abs(bestE)) bestE = ex;
      }
      if (bestE !== 99) {
        const proj = RW / 2 / planeLen();
        pa += Math.sign(bestE) * Math.min(0.9 * dt, Math.abs(bestE) / proj);
      }
    }

    // Weapon.
    fireCD -= dt;
    bloom = Math.max(0, bloom - 0.08 * dt);
    recoilP -= recoilP * Math.min(1, 6 * dt);
    lastSpread = 0.004 + 0.022 * (1 - a) + bloom + (moving ? 0.012 * (1 - 0.7 * a) : 0);
    if (reloadT > 0) {
      reloadT -= dt;
      if (reloadT <= 0) {
        reloadT = 0;
        const take = Math.min(MAG - mag, reserve);
        mag += take;
        reserve -= take;
        tone(640, 0.05, "square", 0.05);
      }
    }
    const trigger = keys.fire || mouseFire || tkeys.fire;
    if (trigger && fireCD <= 0 && reloadT <= 0) {
      if (mag > 0) fire();
      else if (reserve > 0) startReload();
      else {
        sEmpty();
        fireCD = 0.25;
      }
    }
    if (mag === 0 && reserve > 0 && reloadT <= 0) startReload();

    // Health.
    if (t - lastHurt > (vet ? 5 : 4)) hp = Math.min(100, hp + 30 * dt);
    hurtSfxT -= dt;

    // Pickups and objectives.
    for (const o of props) {
      if (!o.alive) {
        if (o.kind === "ammo" && o.respawn > 0) {
          o.wait -= dt;
          if (o.wait <= 0) o.alive = true;
        }
        continue;
      }
      const d = Math.hypot(o.x - px, o.y - py);
      if (o.kind === "ammo" && d < 0.6 && reserve < 240) {
        reserve = Math.min(240, reserve + o.amount);
        o.alive = false;
        o.wait = o.respawn;
        sPickup();
        popup(`+${o.amount} ammo`);
      } else if (o.kind === "intel" && d < 0.7) {
        o.alive = false;
        hasIntel = true;
        extActive = true;
        sChime();
        popup("Intel secured", "#ffd36b");
        shell.say("Intel secured. Get to the extraction flare.");
      } else if (o.kind === "relay" && !o.on) {
        if (d < 1.1) o.prog += dt / 1.5;
        else o.prog = Math.max(0, o.prog - 0.5 * dt);
        if (o.prog >= 1) {
          o.on = true;
          o.prog = 1;
          planted++;
          sChime();
          if (planted >= 2) {
            extActive = true;
            uplinkT = vet ? 45 : 60;
            reinforceT = 8;
            popup("Uplink live. Get out!", "#ffd36b");
            shell.say("Both relays planted. Reach extraction before the timer runs out.");
            const n = 4 + Math.floor(rand() * 3);
            for (let i = 0; i < n; i++) spawnFoe(rand() < 0.2);
          } else {
            popup("Relay 1 of 2 planted", "#ffd36b");
            shell.say("Relay planted. One more.");
          }
        }
      } else if (o.kind === "barrel" && o.fuse >= 0) {
        o.fuse -= dt;
        if (o.fuse <= 0) explode(o);
      }
    }
    for (const o of props) if (o.kind === "flare") o.alive = extActive;

    if (mission.kind === "uplink" && planted >= 2) {
      uplinkT -= dt;
      reinforceT -= dt;
      if (reinforceT <= 0) {
        reinforceT = 8;
        if (foes.filter((e) => e.alive).length < 6) spawnFoe(rand() < 0.2);
      }
      if (uplinkT <= 0) {
        lose("traced");
        return;
      }
    }
    if (mission.kind === "hold") {
      holdT += dt;
      const dur = vet ? 100 : 90;
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = Math.max(1.8, 4.2 - 0.025 * holdT);
        if (foes.filter((e) => e.alive).length < (vet ? 7 : 5)) spawnFoe(holdT > 35 && rand() < 0.2);
      }
      if (!holdDone && holdT >= dur) {
        holdDone = true;
        extActive = true;
        sChime();
        popup("Helicopter inbound", "#ffd36b");
        shell.say("Helicopter inbound. Run for the landing zone.");
      }
    }
    if (extActive && Math.hypot(ext.x - px, ext.y - py) < 0.9) {
      win();
      return;
    }

    // Enemies.
    flowT -= dt;
    if (flowT <= 0) {
      flowT = 0.4;
      buildFlow();
    }
    for (const e of foes) updateFoe(e, dt);
    for (let i = 0; i < foes.length; i++) {
      const A = foes[i];
      if (!A.alive) continue;
      for (let j = i + 1; j < foes.length; j++) {
        const B = foes[j];
        if (!B.alive) continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.6 && d > 0.001) {
          const push = (0.6 - d) / 2;
          moveBody(A, (-dx / d) * push, (-dy / d) * push, PR);
          moveBody(B, (dx / d) * push, (dy / d) * push, PR);
        }
      }
    }

    updateFx(dt, motion);
  }

  function spawnFoe(heavy: boolean) {
    const far = spawns.filter(([x, y]) => Math.hypot(x - px, y - py) > 5);
    if (!far.length) return;
    const [x, y] = far[Math.floor(rand() * far.length)];
    foes.push(newFoe(x + (rand() - 0.5) * 0.3, y + (rand() - 0.5) * 0.3, heavy, true));
  }

  function updateFoe(e: Foe, dt: number) {
    e.flash = Math.max(0, e.flash - dt);
    e.pain = Math.max(0, e.pain - dt);
    e.fireT = Math.max(0, e.fireT - dt);
    if (!e.alive) return;
    const dx = px - e.x;
    const dy = py - e.y;
    const d = Math.hypot(dx, dy);
    e.losT -= dt;
    if (e.losT <= 0) {
      e.losT = 0.12;
      e.sees = d < 18 && los(e.x, e.y, px, py);
    }
    if (!e.noticed) {
      if (e.sees && d < (veteran ? 12 : 10)) {
        e.noticed = true;
        e.react = 0.55 + d * 0.03;
      }
      e.moving = false;
      return;
    }
    if (e.react > 0) {
      e.react -= dt;
      e.moving = false;
      return;
    }
    const spd = (e.heavy ? 1.1 : 1.6) * (e.pain > 0 ? 0.4 : 1);
    let vx = 0;
    let vy = 0;
    if (e.sees && d <= 7.5) {
      e.strafeT -= dt;
      if (e.strafeT <= 0) {
        e.strafe = -e.strafe;
        e.strafeT = 0.8 + rand() * 0.8;
      }
      const nx = dx / d;
      const ny = dy / d;
      vx = -ny * e.strafe * spd * 0.7;
      vy = nx * e.strafe * spd * 0.7;
      if (d < 3) {
        vx -= nx * spd * 0.6;
        vy -= ny * spd * 0.6;
      }
    } else {
      const gx = Math.floor(e.x);
      const gy = Math.floor(e.y);
      const here = flow[gy * grid.w + gx];
      if (here >= 0 && here <= 1) {
        vx = (dx / d) * spd;
        vy = (dy / d) * spd;
      } else {
        let bx = -1;
        let by = -1;
        let bv = here >= 0 ? here : 32767;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = gx + ox;
            const ny = gy + oy;
            if (solidAt(nx, ny)) continue;
            if (ox && oy && (solidAt(gx + ox, gy) || solidAt(gx, gy + oy))) continue;
            const v = flow[ny * grid.w + nx];
            if (v >= 0 && (v < bv || (v === bv && !(ox && oy)))) {
              bv = v;
              bx = nx;
              by = ny;
            }
          }
        }
        if (bx >= 0) {
          const tx = bx + 0.5 - e.x;
          const ty = by + 0.5 - e.y;
          const tl = Math.hypot(tx, ty) || 1;
          vx = (tx / tl) * spd;
          vy = (ty / tl) * spd;
        }
      }
    }
    const ox = e.x;
    const oy = e.y;
    moveBody(e, vx * dt, vy * dt, PR);
    const mv = Math.hypot(e.x - ox, e.y - oy);
    e.moving = mv > 0.2 * dt;
    e.walk += mv;

    // Fire in bursts.
    if (!e.sees || d > 16) {
      e.burst = 0;
      return;
    }
    if (e.burst > 0) {
      e.shotT -= dt;
      if (e.shotT <= 0) {
        e.burst--;
        e.shotT = e.heavy ? 0.09 : 0.12;
        foeShoot(e, d);
        if (e.burst === 0) e.waitT = 1 + rand() * 0.8;
      }
    } else {
      e.waitT -= dt;
      if (e.waitT <= 0) {
        e.burst = e.heavy ? 6 : 3;
        e.shotT = 0;
      }
    }
  }

  function foeShoot(e: Foe, d: number) {
    e.fireT = 0.07;
    const v = clamp(1 - d / 20, 0.15, 1);
    sFoeGun(v);
    emit(e.x, e.y, 0.58, 1, pack(255, 220, 130, EMISSIVE), 0.1, 0.06, 0.08, 0, true);
    const chance = clamp(0.56 - 0.024 * d + (veteran ? 0.1 : 0) - (moving ? 0.14 : 0), 0.1, 0.8);
    if (rand() < chance) {
      const base = e.heavy ? 7 + rand() * 3 : 8 + rand() * 3;
      damagePlayer(base * (veteran ? 1.4 : 1), e.x, e.y);
    } else if (d < 14) sWhizz();
  }

  function updateFx(dt: number, motion = !reduced()) {
    flash = Math.max(0, flash - dt * 9);
    shake = motion ? Math.max(0, shake - dt * 5) : 0;
    muzzleT = Math.max(0, muzzleT - dt);
    kickT = Math.max(0, kickT - dt * 14);
    hurtT = Math.max(0, hurtT - dt * 1.4);
    hitT = Math.max(0, hitT - dt);
    killT = Math.max(0, killT - dt);
    for (let i = arcs.length - 1; i >= 0; i--) {
      arcs[i].t -= dt;
      if (arcs[i].t <= 0) arcs.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      popups[i].t -= dt;
      if (popups[i].t <= 0) popups.splice(i, 1);
    }
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vz -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - Math.min(1, 2.5 * dt);
      p.vy *= 1 - Math.min(1, 2.5 * dt);
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.3;
      }
      if (solidAt(p.x, p.y)) {
        p.vx = 0;
        p.vy = 0;
      }
    }
  }

  // ---------- render ----------
  function render() {
    const pl = planeLen();
    const proj = RW / 2 / pl;
    const dX = dirX();
    const dY = dirY();
    const plX = -dY * pl;
    const plY = dX * pl;
    const motion = !reduced();
    const bob = motion && moving && state === "run" ? Math.sin(bobPh * 2) * 0.004 * (1 - smooth(adsT)) : 0;
    const hz = RH / 2 + (pitch + recoilP + bob) * RH + (state === "over" ? Math.min(1, deadT) * RH * 0.3 : 0);
    const fd = mission.fogDist * (1 + 0.35 * flash);
    const [fr, fg, fb] = mission.fog;
    const posZ = 0.5 * proj;
    const rd0x = dX - plX;
    const rd0y = dY - plY;
    const rd1x = dX + plX;
    const rd1y = dY + plY;
    const fogK = (d: number) => (clamp((d - 1.5) / (fd - 1.5), 0, 1) * 235) | 0;

    // Sky or ceiling, then floor.
    const hzTop = clamp(Math.ceil(hz), 0, RH);
    if (mission.sky) {
      const hill = mission.hill ?? [60, 60, 60];
      const shz = mission.skyHz ?? mission.fog;
      const nearC = pack(hill[0], hill[1], hill[2]);
      const farC = pack(lerp(hill[0], shz[0], 0.7) | 0, lerp(hill[1], shz[1], 0.7) | 0, lerp(hill[2], shz[2], 0.7) | 0);
      const span = 0.9 * RH;
      for (let x = 0; x < RW; x++) {
        const camX = (2 * x) / RW - 1;
        const a = pa + Math.atan(camX * pl);
        const mh = (q: number) => (0.07 + 0.03 * Math.sin(3 * q + 1.3) + 0.018 * Math.sin(7 * q + 0.4) + 0.008 * Math.sin(17 * q)) * proj;
        const nearTop = hz - mh(a) * 0.75;
        const farTop = hz - mh(a + 2.2) * 1.3;
        ridge[x] = Math.min(nearTop, farTop);
        for (let y = 0; y < hzTop; y++) {
          let c: number;
          if (y >= nearTop) c = nearC;
          else if (y >= farTop) c = farC;
          else c = skyLut[clamp(((hz - y) / span) * 255, 0, 255) | 0];
          buf[y * RW + x] = c;
        }
      }
      // Sun and its glow, behind the ridges.
      const sun = mission.sun;
      if (sun) {
        let rel = sun[0] - pa;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        if (Math.cos(rel) > 0.2) {
          const sx = RW / 2 + Math.tan(rel) * proj;
          const sy = hz - sun[1] * proj;
          const R = RW * 0.2;
          const core = Math.max(2, RW * 0.014);
          const x0 = Math.max(0, Math.floor(sx - R));
          const x1 = Math.min(RW, Math.ceil(sx + R));
          const y0 = Math.max(0, Math.floor(sy - R));
          for (let x = x0; x < x1; x++) {
            const yEnd = Math.min(hzTop, Math.ceil(sy + R), Math.floor(ridge[x]));
            for (let y = y0; y < yEnd; y++) {
              const d = Math.hypot(x - sx, y - sy);
              if (d >= R) continue;
              const i = y * RW + x;
              const c = buf[i];
              let k = d < core ? 1 : Math.pow(1 - d / R, 2.4) * 0.75;
              if (d < core * 1.6 && d >= core) k = Math.max(k, 0.9 - ((d - core) / (core * 0.6)) * 0.4);
              const r = lerp(c & 255, 255, k);
              const g = lerp((c >> 8) & 255, 238, k);
              const b = lerp((c >> 16) & 255, 205, k);
              buf[i] = pack(r | 0, g | 0, b | 0);
            }
          }
        }
      }
    }
    for (let y = 0; y < RH; y++) {
      const p = y + 0.5 - hz;
      const below = p > 0;
      if (!below && mission.sky) continue;
      const tex = below ? floorTex : ceilTex;
      const rowD = posZ / Math.abs(p || 0.001);
      const k = fogK(rowD);
      const mul = 256 - k;
      const frk = fr * k;
      const fgk = fg * k;
      const fbk = fb * k;
      const sx = (rowD * (rd1x - rd0x)) / RW;
      const sy = (rowD * (rd1y - rd0y)) / RW;
      let fx = px + rowD * rd0x;
      let fy = py + rowD * rd0y;
      let o = y * RW;
      for (let x = 0; x < RW; x++) {
        const c = tex[(((fy * T) & 63) << 6) | ((fx * T) & 63)];
        fx += sx;
        fy += sy;
        if (c >>> 24 === EMISSIVE) buf[o++] = c | 0xff000000;
        else buf[o++] = 0xff000000 | (((((c >> 16) & 255) * mul + fbk) >> 8) << 16) | (((((c >> 8) & 255) * mul + fgk) >> 8) << 8) | (((c & 255) * mul + frk) >> 8);
      }
    }

    // Walls.
    for (let x = 0; x < RW; x++) {
      const camX = (2 * x) / RW - 1;
      const rdx = dX + plX * camX;
      const rdy = dY + plY * camX;
      const h = castRay(grid, px, py, rdx, rdy, hitTmp);
      const dist = Math.max(h.dist, 0.05);
      zbuf[x] = dist;
      const lh = proj / dist;
      const top = hz - lh / 2;
      let tx = (h.wallX * T) | 0;
      if ((h.side === 0 && rdx > 0) || (h.side === 1 && rdy < 0)) tx = T - 1 - tx;
      const tex = h.side ? wallDark[h.tile] : wallTex[h.tile];
      const k = fogK(dist);
      const mul = 256 - k;
      const frk = fr * k;
      const fgk = fg * k;
      const fbk = fb * k;
      const y0 = Math.max(0, Math.ceil(top));
      const y1 = Math.min(RH, Math.ceil(top + lh));
      const step = T / lh;
      let tp = (y0 - top) * step;
      for (let y = y0; y < y1; y++) {
        const c = tex[((tp & 63) << 6) | tx];
        tp += step;
        buf[y * RW + x] = 0xff000000 | (((((c >> 16) & 255) * mul + fbk) >> 8) << 16) | (((((c >> 8) & 255) * mul + fgk) >> 8) << 8) | (((c & 255) * mul + frk) >> 8);
      }
    }

    // Sprites, far to near.
    sprs.length = 0;
    picks.length = 0;
    let used = 0;
    const add = (x: number, y: number, z: number, size: number, tex: Uint32Array, pick: 0 | 1 | 2, foe: Foe | null, prop: Prop | null, fl = false) => {
      const dx = x - px;
      const dy = y - py;
      const depth = dx * dX + dy * dY;
      if (depth < 0.15) return;
      if (used >= sprPool.length) sprPool.push({ x: 0, y: 0, z: 0, size: 0, tex, depth: 0, flash: false, pick: 0, foe: null, prop: null, left: 0, top: 0, px: 0 });
      const s = sprPool[used++];
      s.x = x;
      s.y = y;
      s.z = z;
      s.size = size;
      s.tex = tex;
      s.depth = depth;
      s.flash = fl;
      s.pick = pick;
      s.foe = foe;
      s.prop = prop;
      const lat = dX * dy - dY * dx;
      const sx = RW / 2 + (lat / depth) * proj;
      s.px = (size * proj) / depth;
      s.left = sx - s.px / 2;
      s.top = hz + ((0.5 - z) * proj) / depth - s.px;
      sprs.push(s);
    };
    for (const e of foes) {
      const set = e.heavy ? heavyTex : soldierTex;
      let fr2 = 0;
      if (!e.alive) fr2 = 5;
      else if (e.fireT > 0) fr2 = 3;
      else if (e.pain > 0) fr2 = 4;
      else if (e.moving) fr2 = e.walk % 0.7 < 0.35 ? 1 : 2;
      add(e.x, e.y, 0, e.heavy ? 1.05 : 0.95, set[fr2], e.alive ? 1 : 0, e, null, e.flash > 0);
    }
    for (const o of props) {
      if (!o.alive) continue;
      if (o.kind === "barrel") add(o.x, o.y, 0, 0.62, barrelT, 2, null, o);
      else if (o.kind === "ammo") add(o.x, o.y, 0, 0.5, ammoT, 0, null, o);
      else if (o.kind === "intel") add(o.x, o.y, 0.1 + Math.sin(t * 3 + animT) * 0.04, 0.5, intelT, 0, null, o);
      else if (o.kind === "relay") add(o.x, o.y, 0, 0.9, o.on && (t * 2) % 1 < 0.7 ? relayOn : relayOff, 0, null, o);
      else if (o.kind === "lz") add(o.x, o.y, 0, 0.7, lzT, 0, null, o);
      else if (o.kind === "flare") add(o.x, o.y, 0, 1, flareT[((t + animT) * 8) % 2 < 1 ? 0 : 1], 0, null, o);
    }
    sprs.sort((a, b) => b.depth - a.depth);
    for (const s of sprs) {
      drawSprite(s, fd);
      if (s.pick) picks.push(s);
    }

    // Particles.
    for (const p of parts) {
      if (p.life <= 0) continue;
      const dx = p.x - px;
      const dy = p.y - py;
      const depth = dx * dX + dy * dY;
      if (depth < 0.15) continue;
      const lat = dX * dy - dY * dx;
      const sx = RW / 2 + (lat / depth) * proj;
      const sy = hz + ((0.5 - p.z) * proj) / depth;
      const sz = Math.max(1, (p.size * proj) / depth);
      const x0 = Math.max(0, Math.round(sx - sz / 2));
      const x1 = Math.min(RW, Math.round(sx + sz / 2) + (sz < 1.5 ? 1 : 0));
      const y0 = Math.max(0, Math.round(sy - sz / 2));
      const y1 = Math.min(RH, Math.round(sy + sz / 2) + (sz < 1.5 ? 1 : 0));
      let c = p.col;
      if (!p.em) {
        const k = fogK(depth);
        const mul = 256 - k;
        c = 0xff000000 | (((((c >> 16) & 255) * mul + fb * k) >> 8) << 16) | (((((c >> 8) & 255) * mul + fg * k) >> 8) << 8) | (((c & 255) * mul + fr * k) >> 8);
      } else c = c | 0xff000000;
      for (let x = x0; x < x1; x++) {
        if (depth >= zbuf[x]) continue;
        for (let y = y0; y < y1; y++) buf[y * RW + x] = c;
      }
    }
  }

  function drawSprite(s: Spr, fd: number) {
    const size = s.px;
    if (size < 0.5) return;
    const x0 = Math.max(0, Math.ceil(s.left));
    const x1 = Math.min(RW, Math.ceil(s.left + size));
    if (x0 >= x1) return;
    const y0 = Math.max(0, Math.ceil(s.top));
    const y1 = Math.min(RH, Math.ceil(s.top + size));
    if (y0 >= y1) return;
    const [fr, fg, fb] = mission.fog;
    const k = (clamp((s.depth - 1.5) / (fd - 1.5), 0, 1) * 235) | 0;
    const mul = 256 - k;
    const frk = fr * k;
    const fgk = fg * k;
    const fbk = fb * k;
    const step = T / size;
    const tex = s.tex;
    const ty0 = (y0 - s.top) * step;
    for (let x = x0; x < x1; x++) {
      if (s.depth >= zbuf[x]) continue;
      const tx = clamp(((x - s.left) * step) | 0, 0, T - 1);
      let tp = ty0;
      for (let y = y0; y < y1; y++) {
        const c = tex[(clamp(tp | 0, 0, T - 1) << 6) | tx];
        tp += step;
        if (!c) continue;
        let out: number;
        if (s.flash) out = 0xff000000 | (((((c >> 16) & 255) * 128) >> 8) + 110) << 16 | (((((c >> 8) & 255) * 128) >> 8) + 110) << 8 | ((((c & 255) * 128) >> 8) + 110);
        else if (c >>> 24 === EMISSIVE) out = c | 0xff000000;
        else out = 0xff000000 | (((((c >> 16) & 255) * mul + fbk) >> 8) << 16) | (((((c >> 8) & 255) * mul + fgk) >> 8) << 8) | (((c & 255) * mul + frk) >> 8);
        buf[y * RW + x] = out;
      }
    }
  }

  const poly = (c: CanvasRenderingContext2D, fill: string | CanvasGradient, pts: number[]) => {
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath();
    c.fill();
  };

  function drawGun(c: CanvasRenderingContext2D) {
    const a = smooth(adsT);
    const motion = !reduced();
    const bx = motion && moving ? Math.sin(bobPh) * 7 * (1 - 0.85 * a) : 0;
    const by = motion && moving ? Math.abs(Math.cos(bobPh)) * 6 * (1 - 0.85 * a) : motion ? Math.sin(animT * 1.6) * 1.5 * (1 - a) : 0;
    const dip = reloadT > 0 ? Math.sin(Math.PI * (1 - reloadT / RELOAD)) : 0;
    const sc = lerp(H / 330, H / 196.4, a);
    const ax = lerp(0.68 * W, 0.5 * W, a) + bx * (H / 400);
    const ay = lerp(H, 1.06 * H, a) + by * (H / 400) + kickT * H * 0.035 * (1 - 0.6 * a) + dip * H * 0.32;
    c.save();
    c.translate(ax, ay);
    c.rotate(lerp(-0.32, 0, a) + dip * 0.4 - kickT * 0.03 * (1 - a));
    c.scale(sc, sc);
    const Y = (y: number) => (y > -110 ? y : -110 + (y + 110) * (1 - a));
    // Barrel, handguard and post (behind the receiver).
    poly(c, "#17191d", [-6, Y(-156), 6, Y(-156), 4.5, Y(-222), -4.5, Y(-222)]);
    poly(c, "#2a2d33", [-30, Y(-94), 30, Y(-94), 21, Y(-162), -21, Y(-162)]);
    poly(c, "#363a42", [-30, Y(-94), -24, Y(-94), -16, Y(-162), -21, Y(-162)]);
    for (let i = 0; i < 4; i++) {
      const y0 = -104 - i * 14;
      const y1 = y0 - 7;
      const w0 = 22 - i * 2;
      poly(c, "#121417", [-w0, Y(y0), -w0 + 6, Y(y0), -w0 + 6.5, Y(y1), -w0 + 0.5, Y(y1)]);
      poly(c, "#121417", [w0 - 6, Y(y0), w0, Y(y0), w0 - 0.5, Y(y1), w0 - 6.5, Y(y1)]);
    }
    poly(c, "#121417", [-2.5, Y(-158), 2.5, Y(-158), 2, Y(-180), -2, Y(-180)]);
    if (muzzleT > 0) {
      const f = 1 - 0.7 * a;
      const mx = 0;
      const my = Y(-222);
      c.save();
      c.translate(mx, my);
      c.rotate(rand() * TAU);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 40 * f);
      g.addColorStop(0, "rgba(255,250,220,1)");
      g.addColorStop(0.35, "rgba(255,200,90,0.9)");
      g.addColorStop(1, "rgba(255,120,30,0)");
      c.fillStyle = g;
      c.beginPath();
      for (let i = 0; i < 12; i++) {
        const aa = (i / 12) * TAU;
        const rr = (i % 2 ? 14 : 40) * f;
        c.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
      }
      c.fill();
      c.restore();
    }
    // Receiver.
    const g = c.createLinearGradient(-56, 0, 56, 0);
    g.addColorStop(0, "#1a1c20");
    g.addColorStop(0.42, "#353941");
    g.addColorStop(0.6, "#2a2d33");
    g.addColorStop(1, "#16181b");
    poly(c, g, [-56, 12, 56, 12, 36, -96, -36, -96]);
    poly(c, "#121417", [-36, -96, 36, -96, 38, -88, -38, -88]);
    for (let i = 0; i < 5; i++) poly(c, "#1f2226", [-33 + i * 0, -84 + i * 14, 33, -84 + i * 14, 34, -81 + i * 14, -34, -81 + i * 14]);
    poly(c, "#101114", [30, -40, 46, -40, 50, 0, 32, 0]);
    // Optic: mount, ring, tinted lens with a red dot.
    poly(c, "#17191d", [-12, -88, 12, -88, 9, -104, -9, -104]);
    c.beginPath();
    c.arc(0, -110, 16, 0, TAU);
    c.fillStyle = "rgba(120,170,200,0.12)";
    c.fill();
    c.lineWidth = 7;
    c.strokeStyle = "#141619";
    c.stroke();
    c.lineWidth = 1.2;
    c.strokeStyle = "#454b55";
    c.beginPath();
    c.arc(0, -110, 19.2, Math.PI * 1.1, Math.PI * 1.9);
    c.stroke();
    if (a > 0.05) {
      c.fillStyle = `rgba(255,50,40,${a})`;
      c.beginPath();
      c.arc(0, -110, 1.4, 0, TAU);
      c.fill();
      c.fillStyle = `rgba(255,60,50,${a * 0.25})`;
      c.beginPath();
      c.arc(0, -110, 3.2, 0, TAU);
      c.fill();
    }
    // Hands.
    c.fillStyle = "#3a382f";
    c.beginPath();
    c.ellipse(-40, lerp(-122, -50, a), 18, 13, -0.3, 0, TAU);
    c.fill();
    c.fillStyle = "#2c2a24";
    for (let i = 0; i < 3; i++) c.fillRect(-52 + i * 7, lerp(-128, -56, a), 4, 10);
    poly(c, "#2c3138", [8, 8, 46, -2, 130, 150, 40, 170]);
    c.fillStyle = "#3a382f";
    c.beginPath();
    c.ellipse(26, 2, 24, 17, 0.4, 0, TAU);
    c.fill();
    c.restore();
  }

  function hudFont(n: number) {
    return `600 ${Math.max(9, Math.round(n))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  }
  function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, col = "#f4f4f6") {
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.fillText(s, x + 1, y + 1);
    c.fillStyle = col;
    c.fillText(s, x, y);
  }

  function objectiveTarget(): { x: number; y: number } | null {
    if (mission.kind === "intel") {
      if (!hasIntel) {
        const o = props.find((p) => p.kind === "intel" && p.alive);
        return o ? { x: o.x, y: o.y } : null;
      }
      return ext;
    }
    if (mission.kind === "uplink") {
      if (planted < 2) {
        let bestO: Prop | null = null;
        let bd = 1e9;
        for (const o of props) {
          if (o.kind !== "relay" || o.on) continue;
          const d = Math.hypot(o.x - px, o.y - py);
          if (d < bd) {
            bd = d;
            bestO = o;
          }
        }
        return bestO ? { x: bestO.x, y: bestO.y } : null;
      }
      return ext;
    }
    return holdDone ? ext : null;
  }
  function objectiveText(): { s: string; urgent: boolean } {
    if (mission.kind === "intel") return { s: hasIntel ? "Reach extraction" : "Take the intel", urgent: false };
    if (mission.kind === "uplink") {
      if (planted < 2) return { s: `Plant relays ${planted}/2`, urgent: false };
      return { s: `Extract ${fmt(uplinkT)}`, urgent: uplinkT < 15 };
    }
    if (!holdDone) return { s: `Hold ${fmt((veteran ? 100 : 90) - holdT)}`, urgent: false };
    return { s: "Helicopter inbound: reach the LZ", urgent: true };
  }

  function drawHud(c: CanvasRenderingContext2D) {
    const s = clamp(Math.min(W / 820, H / 460), 0.62, 1.3);
    const cx = W / 2;
    const cy = H / 2;
    const a = smooth(adsT);
    const touch = coarse.matches;
    if (vignette) c.drawImage(vignette, 0, 0, W, H);

    // Hurt.
    const pulse = hp < 35 ? (0.18 + 0.12 * Math.sin(t * 6)) * (1 - hp / 35) : 0;
    const red = Math.min(0.55, hurtT * 0.4 + pulse);
    if (red > 0.01) {
      const g = c.createRadialGradient(cx, cy, Math.min(W, H) * 0.25, cx, cy, Math.max(W, H) * 0.7);
      g.addColorStop(0, "rgba(160,0,0,0)");
      g.addColorStop(1, `rgba(170,10,10,${red})`);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    // Damage arcs.
    c.lineCap = "round";
    for (const arc of arcs) {
      const rel = Math.atan2(arc.y - py, arc.x - px) - pa - Math.PI / 2;
      c.strokeStyle = `rgba(255,70,50,${clamp(arc.t, 0, 1) * 0.85})`;
      c.lineWidth = 6 * s;
      c.beginPath();
      c.arc(cx, cy, Math.min(W, H) * 0.26, rel - 0.32, rel + 0.32);
      c.stroke();
    }

    // Crosshair.
    if (state === "run") {
      const pl = planeLen();
      const gap = (lastSpread * W) / (2 * pl) + 4;
      const alpha = 1 - clamp(a * 1.6, 0, 1);
      if (alpha > 0.02) {
        c.strokeStyle = `rgba(244,244,246,${0.9 * alpha})`;
        c.lineWidth = 2;
        const L = 7 * s;
        c.beginPath();
        c.moveTo(cx - gap - L, cy);
        c.lineTo(cx - gap, cy);
        c.moveTo(cx + gap, cy);
        c.lineTo(cx + gap + L, cy);
        c.moveTo(cx, cy - gap - L);
        c.lineTo(cx, cy - gap);
        c.moveTo(cx, cy + gap);
        c.lineTo(cx, cy + gap + L);
        c.stroke();
        c.fillStyle = `rgba(244,244,246,${0.8 * alpha})`;
        c.fillRect(cx - 1, cy - 1, 2, 2);
      }
      if (hitT > 0 || killT > 0) {
        const kill = killT > 0;
        c.strokeStyle = kill ? "rgba(255,80,60,0.95)" : "rgba(255,255,255,0.9)";
        c.lineWidth = kill ? 3 : 2;
        const r0 = (kill ? 7 : 5) * s;
        const r1 = (kill ? 15 : 11) * s;
        c.beginPath();
        for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          c.moveTo(cx + sx * r0, cy + sy * r0);
          c.lineTo(cx + sx * r1, cy + sy * r1);
        }
        c.stroke();
      }
      // Relay ring.
      for (const o of props) {
        if (o.kind === "relay" && !o.on && o.prog > 0) {
          c.strokeStyle = "rgba(0,0,0,0.4)";
          c.lineWidth = 5 * s;
          c.beginPath();
          c.arc(cx, cy, 26 * s, 0, TAU);
          c.stroke();
          c.strokeStyle = "#62ff9a";
          c.beginPath();
          c.arc(cx, cy, 26 * s, -Math.PI / 2, -Math.PI / 2 + o.prog * TAU);
          c.stroke();
        }
      }
      // Reload bar.
      if (reloadT > 0) {
        const bw = 70 * s;
        const by = cy + 34 * s;
        c.fillStyle = "rgba(0,0,0,0.5)";
        c.fillRect(cx - bw / 2, by, bw, 4 * s);
        c.fillStyle = "#ffd36b";
        c.fillRect(cx - bw / 2, by, bw * (1 - reloadT / RELOAD), 4 * s);
      }
    }

    // Objective marker.
    const tgt = objectiveTarget();
    if (tgt && state === "run") {
      const pl = planeLen();
      const proj = RW / 2 / pl;
      const dx = tgt.x - px;
      const dy = tgt.y - py;
      const depth = dx * dirX() + dy * dirY();
      const lat = dirX() * dy - dirY() * dx;
      const hz = RH / 2 + (pitch + recoilP) * RH;
      let mx: number;
      let my: number;
      if (depth > 0.2) {
        mx = -6 + ((RW / 2 + (lat / depth) * proj) * (W + 12)) / RW;
        my = -6 + ((hz - (0.4 * proj) / depth) * (H + 12)) / RH;
      } else {
        mx = lat >= 0 ? W : 0;
        my = cy;
      }
      const pad = 24 * s;
      mx = clamp(mx, pad, W - pad);
      my = clamp(my, pad + 40 * s, H - pad - 30 * s);
      const r = 7 * s;
      c.fillStyle = "#ffd36b";
      c.strokeStyle = "rgba(0,0,0,0.6)";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(mx, my - r);
      c.lineTo(mx + r, my);
      c.lineTo(mx, my + r);
      c.lineTo(mx - r, my);
      c.closePath();
      c.stroke();
      c.fill();
      c.font = hudFont(11 * s);
      c.textAlign = "center";
      c.textBaseline = "top";
      text(c, `${Math.round(Math.hypot(dx, dy) * 2)} m`, mx, my + r + 3, "#ffd36b");
    }

    // Objective line.
    const ob = objectiveText();
    c.textAlign = "center";
    c.textBaseline = "top";
    c.font = hudFont(10 * s);
    text(c, `${mission.name.toUpperCase()}${veteran ? " · VETERAN" : ""}`, cx, 12 * s, "rgba(244,244,246,0.6)");
    c.font = hudFont(15 * s);
    text(c, ob.s, cx, 26 * s, ob.urgent ? (Math.sin(t * 8) > 0 ? "#ff8a65" : "#ffd36b") : "#f4f4f6");

    // Minimap.
    const R = 52 * s;
    const mcx = 12 * s + R;
    const mcy = 12 * s + R;
    if (mini) {
      c.save();
      c.beginPath();
      c.arc(mcx, mcy, R, 0, TAU);
      c.fillStyle = "rgba(5,6,10,0.55)";
      c.fill();
      c.clip();
      c.translate(mcx, mcy);
      c.scale(s, s);
      c.rotate(-pa - Math.PI / 2);
      c.translate(-px * 4, -py * 4);
      c.drawImage(mini, 0, 0);
      for (const e of foes) {
        if (!e.alive || !(e.noticed || e.sees)) continue;
        c.fillStyle = "#ff4433";
        c.fillRect(e.x * 4 - 2, e.y * 4 - 2, 4, 4);
      }
      for (const o of props) {
        if (!o.alive) continue;
        if (o.kind === "intel" || (o.kind === "relay" && !o.on)) {
          c.fillStyle = "#ffd36b";
          c.fillRect(o.x * 4 - 2.5, o.y * 4 - 2.5, 5, 5);
        } else if (o.kind === "ammo") {
          c.fillStyle = "#9bd06a";
          c.fillRect(o.x * 4 - 1.5, o.y * 4 - 1.5, 3, 3);
        }
      }
      if (extActive) {
        c.fillStyle = Math.sin(t * 6) > 0 ? "#62ff9a" : "#ffd36b";
        c.fillRect(ext.x * 4 - 3, ext.y * 4 - 3, 6, 6);
      }
      c.restore();
      c.strokeStyle = "rgba(244,244,246,0.25)";
      c.lineWidth = 1;
      c.beginPath();
      c.arc(mcx, mcy, R, 0, TAU);
      c.stroke();
      c.fillStyle = "#f4f4f6";
      c.beginPath();
      c.moveTo(mcx, mcy - 6 * s);
      c.lineTo(mcx + 4 * s, mcy + 4 * s);
      c.lineTo(mcx - 4 * s, mcy + 4 * s);
      c.closePath();
      c.fill();
    }

    // Health and ammo.
    const hpCol = hp > 60 ? "#f4f4f6" : hp > 35 ? "#ffd36b" : "#ff6b52";
    c.textBaseline = "alphabetic";
    if (touch) {
      const hx = 12 * s;
      const hy = mcy + R + 28 * s;
      c.textAlign = "left";
      c.font = hudFont(20 * s);
      text(c, `${Math.ceil(hp)}`, hx, hy, hpCol);
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(hx, hy + 6 * s, 80 * s, 4 * s);
      c.fillStyle = hpCol;
      c.fillRect(hx, hy + 6 * s, (80 * s * hp) / 100, 4 * s);
      c.textAlign = "right";
      c.font = hudFont(22 * s);
      const ammoY = 30 * s;
      text(c, `${mag}`, W - 12 * s - 54 * s, ammoY + 22 * s, mag <= 6 ? "#ff6b52" : "#f4f4f6");
      c.font = hudFont(12 * s);
      text(c, `/ ${reserve}`, W - 12 * s, ammoY + 22 * s, "rgba(244,244,246,0.7)");
      if (reloadT > 0) text(c, "RELOADING", W - 12 * s, ammoY + 38 * s, "#ffd36b");
    } else {
      const by = H - 18 * s;
      c.textAlign = "left";
      c.font = hudFont(11 * s);
      text(c, "HEALTH", 18 * s, by - 34 * s, "rgba(244,244,246,0.6)");
      c.font = hudFont(26 * s);
      text(c, `${Math.ceil(hp)}`, 18 * s, by - 8 * s, hpCol);
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(18 * s, by, 120 * s, 5 * s);
      c.fillStyle = hpCol;
      c.fillRect(18 * s, by, (120 * s * hp) / 100, 5 * s);
      c.textAlign = "right";
      c.font = hudFont(11 * s);
      text(c, reloadT > 0 ? "RELOADING" : mag <= 6 && reserve > 0 ? "R RELOAD" : "AMMO", W - 18 * s, by - 34 * s, reloadT > 0 || mag <= 6 ? "#ffd36b" : "rgba(244,244,246,0.6)");
      c.font = hudFont(15 * s);
      text(c, `/ ${reserve}`, W - 18 * s, by, "rgba(244,244,246,0.7)");
      c.font = hudFont(30 * s);
      text(c, `${mag}`, W - 18 * s - 70 * s, by, mag <= 6 ? "#ff6b52" : "#f4f4f6");
    }

    // Popups.
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = hudFont(14 * s);
    popups.forEach((p, i) => {
      c.globalAlpha = clamp(p.t / 0.4, 0, 1);
      text(c, p.text, cx, H * 0.68 - i * 20 * s, p.col);
    });
    c.globalAlpha = 1;

    // Touch stick.
    if (touch && state === "run") {
      const ox = stick ? stick.ox : W * 0.17;
      const oy = stick ? stick.oy : H * 0.74;
      c.strokeStyle = stick ? "rgba(244,244,246,0.45)" : "rgba(244,244,246,0.18)";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(ox, oy, STICK_R, 0, TAU);
      c.stroke();
      let kx = ox;
      let ky = oy;
      if (stick) {
        const dx = stick.x - stick.ox;
        const dy = stick.y - stick.oy;
        const m = Math.hypot(dx, dy);
        const k = m > STICK_R ? STICK_R / m : 1;
        kx += dx * k;
        ky += dy * k;
      }
      c.fillStyle = stick ? "rgba(244,244,246,0.4)" : "rgba(244,244,246,0.12)";
      c.beginPath();
      c.arc(kx, ky, 18, 0, TAU);
      c.fill();
      if (!stick && t < 6) {
        c.font = hudFont(11 * s);
        text(c, "drag to move", ox, oy - STICK_R - 10, "rgba(244,244,246,0.6)");
        text(c, "drag to look", W * 0.66, H * 0.42, "rgba(244,244,246,0.5)");
      }
    }
  }

  function draw(c: CanvasRenderingContext2D) {
    if (!W || !H) return;
    render();
    fbCtx.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = false;
    const sh = shake * 6;
    const ox = sh ? (rand() * 2 - 1) * sh : 0;
    const oy = sh ? (rand() * 2 - 1) * sh : 0;
    c.drawImage(fbCanvas, -6 + ox, -6 + oy, W + 12, H + 12);
    c.imageSmoothingEnabled = true;
    if (state !== "over") drawGun(c);
    if (state === "run" || state === "paused") drawHud(c);
    if (state === "over") {
      c.fillStyle = `rgba(120,0,0,${Math.min(0.5, deadT * 0.6)})`;
      c.fillRect(0, 0, W, H);
    }
  }

  function resize(w: number, h: number) {
    W = w;
    H = h;
    RW = clamp(Math.round(w / 2.5), 240, 400);
    RH = Math.max(60, Math.round((RW * h) / Math.max(1, w)));
    fbCanvas.width = RW;
    fbCanvas.height = RH;
    img = fbCtx.createImageData(RW, RH);
    buf = new Uint32Array(img.data.buffer);
    zbuf = new Float32Array(RW);
    ridge = new Float32Array(RW);
    picks.length = 0;
    const v = document.createElement("canvas");
    v.width = Math.max(1, Math.round(w / 2));
    v.height = Math.max(1, Math.round(h / 2));
    const vc = v.getContext("2d")!;
    const g = vc.createRadialGradient(v.width / 2, v.height / 2, Math.min(v.width, v.height) * 0.35, v.width / 2, v.height / 2, Math.hypot(v.width, v.height) / 2);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.5)");
    vc.fillStyle = g;
    vc.fillRect(0, 0, v.width, v.height);
    vignette = v;
    if (ctxRef) draw(ctxRef);
  }

  function frame(ctx: CanvasRenderingContext2D, info: { dt: number; width: number; height: number }) {
    ctxRef = ctx;
    const dt = Math.min(info.dt / 1000, 0.05);
    animT += dt;
    if (state === "run") update(dt);
    else if (state === "menu") {
      pa += 0.12 * dt;
      updateFx(dt);
    } else if (state === "over") {
      deadT += dt;
      updateFx(dt);
    } else if (state === "won") updateFx(dt);
    draw(ctx);
  }

  // ---------- pointer lock ----------
  const requestLock = () => {
    if (coarse.matches || locked) return;
    try {
      const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {
      // Refused (too soon after Escape, or no support): drag-look still works.
    }
  };
  const exitLock = () => {
    if (document.pointerLockElement === canvas) {
      try {
        document.exitPointerLock();
      } catch {
        // Nothing to undo.
      }
    }
  };
  const onLockChange = () => {
    const was = locked;
    locked = document.pointerLockElement === canvas;
    if (was && !locked && state === "run") pause();
  };
  document.addEventListener("pointerlockchange", onLockChange);

  // ---------- flow ----------
  function paintStats() {
    if (elScore) elScore.textContent = lastScore === null ? "–" : String(lastScore);
    if (elBest) elBest.textContent = best > 0 ? String(best) : "–";
    if (elCleared) elCleared.textContent = `${cleared} / 3`;
    const busy = state === "run" || state === "paused";
    const unlocked = Math.min(cleared, 2);
    for (const b of missionBtns) {
      const i = Number(b.dataset.mission);
      b.disabled = busy || i > unlocked;
      b.setAttribute("aria-pressed", String(i === mi));
    }
    for (const b of modeBtns) {
      b.disabled = busy;
      b.setAttribute("aria-pressed", String((b.dataset.mode === "veteran") === veteran));
    }
  }

  function clearKeys() {
    for (const k in keys) keys[k] = false;
    mouseFire = false;
    mouseAim = false;
  }

  function brief(i: number) {
    loadMission(i);
    state = "menu";
    shell.setRunning(false);
    paintStats();
    shell.show({ kicker: `Mission ${i + 1} of 3`, title: mission.name, msg: mission.brief, label: "Deploy" });
  }

  function start() {
    unlockAudio();
    loadMission(mi);
    state = "run";
    shell.hide();
    shell.setRunning(true);
    paintStats();
    requestLock();
    shell.say(`${mission.name} started. ${objectiveText().s}.`);
    tone(220, 0.2, "triangle", 0.08, 330);
  }

  function pause() {
    if (state !== "run") return;
    state = "paused";
    clearKeys();
    stick = null;
    look = null;
    fireLook = null;
    exitLock();
    shell.setRunning(false);
    paintStats();
    shell.show({ kicker: "Paused", title: mission.name, msg: `${objectiveText().s}. ${kills} down, ${Math.ceil(hp)} health.`, label: "Resume" });
  }

  function resume() {
    state = "run";
    shell.hide();
    shell.setRunning(true);
    paintStats();
    requestLock();
  }

  function lose(why: "dead" | "traced") {
    state = "over";
    deadT = 0;
    clearKeys();
    exitLock();
    shell.setRunning(false);
    paintStats();
    if (why === "dead") sDeath();
    else tone(300, 0.5, "sawtooth", 0.1, 90);
    const tip =
      why === "traced"
        ? "The timer starts once both relays are live. Clear a path to extraction before you plant the second one."
        : mission.kind === "hold"
          ? "Keep moving between cover; crates in the square refill your ammo."
          : "Aim down sights for a tighter spread, and step out of fire: health comes back after a few quiet seconds.";
    window.setTimeout(() => {
      if (state !== "over") return;
      shell.show({ kicker: why === "traced" ? "Uplink traced" : "Killed in action", title: "Mission failed", msg: tip, label: "Retry" });
    }, 700);
  }

  function win() {
    state = "won";
    clearKeys();
    exitLock();
    shell.setRunning(false);
    const score = Math.round(missionScore(kills, heads, t, mission.par) * (veteran ? 1.25 : 1));
    const isBest = score > best;
    if (isBest) {
      best = score;
      writeNumber(STORAGE_KEYS.ironLineBest, best);
    }
    lastScore = score;
    if (mi + 1 > cleared) {
      cleared = mi + 1;
      writeNumber(STORAGE_KEYS.ironLineMission, cleared);
    }
    paintStats();
    sChime();
    const last = mi === MISSIONS.length - 1;
    const acc = shots ? Math.round((hits / shots) * 100) : 0;
    shell.show({
      kicker: last ? "Campaign complete" : "Mission complete",
      title: mission.name,
      msg: `Score ${score}${isBest ? " · New best!" : ""}\n${kills} kills · ${heads} headshots · ${acc}% accuracy · ${fmt(t)}${veteran ? " · Veteran ×1.25" : ""}`,
      label: last ? "Play again" : "Next mission",
      share: `I cleared ${mission.name} in Iron Line with ${score} points.`,
    });
  }

  const shell = createShell(cg, {
    onMain() {
      if (state === "paused") resume();
      else if (state === "won") brief(mi + 1 < MISSIONS.length ? mi + 1 : 0);
      else start();
    },
    onPause: pause,
  });

  // ---------- input ----------
  const KEYMAP: Record<string, string> = {
    w: "fwd",
    W: "fwd",
    ArrowUp: "fwd",
    s: "back",
    S: "back",
    ArrowDown: "back",
    a: "left",
    A: "left",
    d: "right",
    D: "right",
    ArrowLeft: "turnL",
    q: "turnL",
    Q: "turnL",
    ArrowRight: "turnR",
    e: "turnR",
    E: "turnR",
    " ": "fire",
    j: "fire",
    J: "fire",
    f: "fire",
    F: "fire",
    Shift: "aim",
    k: "aim",
    K: "aim",
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (state !== "run" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      if (!e.repeat) startReload();
      return;
    }
    const name = KEYMAP[e.key];
    if (!name) return;
    e.preventDefault();
    keys[name] = true;
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const name = KEYMAP[e.key];
    if (name) keys[name] = false;
    if (e.key === "Shift") keys.aim = false;
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearKeys);

  const offHold = holdButtons(cg, tkeys, (name) => {
    if (state !== "run") return;
    if (name === "aim") adsLatch = !adsLatch;
    else if (name === "reload") startReload();
  });

  const lookBy = (dx: number, dy: number, k: number) => {
    const m = adsT > 0.5 ? 0.6 : 1;
    pa += dx * k * m;
    pitch = clamp(pitch - dy * k * m * 1.2, -0.35, 0.35);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (state !== "run") return;
    if (locked) lookBy(e.movementX, e.movementY, 0.0022);
  };
  document.addEventListener("mousemove", onMouseMove);

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
  };
  const onPtrDown = (e: PointerEvent) => {
    if (state !== "run") return;
    if (e.pointerType === "mouse") {
      if (!locked) requestLock();
      if (e.button === 0) mouseFire = true;
      else if (e.button === 2) mouseAim = true;
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const p = local(e);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer already ended (cancelled mid-gesture); nothing to capture.
    }
    if (p.x < p.w * 0.42 && !stick) stick = { id: e.pointerId, ox: p.x, oy: p.y, x: p.x, y: p.y };
    else if (!look) look = { id: e.pointerId, x: p.x, y: p.y };
  };
  const onPtrMove = (e: PointerEvent) => {
    if (state !== "run") return;
    if (e.pointerType === "mouse") {
      if (!locked && e.buttons) lookBy(e.movementX, e.movementY, 0.0035);
      return;
    }
    const p = local(e);
    if (stick && e.pointerId === stick.id) {
      stick.x = p.x;
      stick.y = p.y;
    } else if (look && e.pointerId === look.id) {
      lookBy(p.x - look.x, p.y - look.y, LOOK_TOUCH);
      look.x = p.x;
      look.y = p.y;
    }
  };
  const onPtrUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      if (e.button === 0) mouseFire = false;
      else if (e.button === 2) mouseAim = false;
      return;
    }
    if (stick && e.pointerId === stick.id) stick = null;
    if (look && e.pointerId === look.id) look = null;
  };
  const noMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener("pointerdown", onPtrDown);
  canvas.addEventListener("pointermove", onPtrMove);
  window.addEventListener("pointerup", onPtrUp);
  window.addEventListener("pointercancel", onPtrUp);
  canvas.addEventListener("contextmenu", noMenu);

  // The fire button also steers, so a thumb can shoot and track at once.
  const onFireDown = (e: PointerEvent) => {
    fireLook = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onFireMove = (e: PointerEvent) => {
    if (!fireLook || e.pointerId !== fireLook.id || state !== "run") return;
    lookBy(e.clientX - fireLook.x, e.clientY - fireLook.y, LOOK_TOUCH);
    fireLook.x = e.clientX;
    fireLook.y = e.clientY;
  };
  const onFireUp = (e: PointerEvent) => {
    if (fireLook && e.pointerId === fireLook.id) fireLook = null;
  };
  fireBtn?.addEventListener("pointerdown", onFireDown);
  fireBtn?.addEventListener("pointermove", onFireMove);
  fireBtn?.addEventListener("pointerup", onFireUp);
  fireBtn?.addEventListener("pointercancel", onFireUp);

  const onMission = (e: Event) => {
    if (state === "run" || state === "paused") return;
    const i = Number((e.currentTarget as HTMLButtonElement).dataset.mission);
    if (i > Math.min(cleared, 2)) return;
    brief(i);
  };
  const onMode = (e: Event) => {
    if (state === "run" || state === "paused") return;
    veteran = (e.currentTarget as HTMLButtonElement).dataset.mode === "veteran";
    paintStats();
    shell.say(veteran ? "Veteran: sharper enemies, harder hits, score ×1.25." : "Regular difficulty.");
  };
  for (const b of missionBtns) b.addEventListener("click", onMission);
  for (const b of modeBtns) b.addEventListener("click", onMode);

  brief(Math.min(cleared, 2));

  const loop = startCanvasLoop(canvas, { essential: true, mobileFPS: 60, onFrame: frame, onResize: resize });

  return {
    destroy() {
      loop.stop();
      shell.destroy();
      offHold();
      exitLock();
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("blur", clearKeys);
      canvas.removeEventListener("pointerdown", onPtrDown);
      canvas.removeEventListener("pointermove", onPtrMove);
      window.removeEventListener("pointerup", onPtrUp);
      window.removeEventListener("pointercancel", onPtrUp);
      canvas.removeEventListener("contextmenu", noMenu);
      fireBtn?.removeEventListener("pointerdown", onFireDown);
      fireBtn?.removeEventListener("pointermove", onFireMove);
      fireBtn?.removeEventListener("pointerup", onFireUp);
      fireBtn?.removeEventListener("pointercancel", onFireUp);
      for (const b of missionBtns) b.removeEventListener("click", onMission);
      for (const b of modeBtns) b.removeEventListener("click", onMode);
    },
  };
}
