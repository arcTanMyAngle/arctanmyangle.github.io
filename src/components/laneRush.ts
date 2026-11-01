// Lane Rush: an original three-lane night runner on a pseudo-3D road, drawn on a 2D canvas. No image or audio files:
// sky, road, rider and props are drawn here; sounds come from src/lib/sfx.ts. Only makeRow() is pure (and tested).

import { startCanvasLoop } from "../lib/canvasLoop";
import { STORAGE_KEYS, readNumber, writeNumber } from "../lib/clientState";
import { buzz, createShell, onSwipe, rng } from "../lib/gameShell";
import { noise, tone, unlockAudio } from "../lib/sfx";

export const LANE_X = [-1.25, 0, 1.25];
export type Cell = "none" | "low" | "high" | "block" | "cart";
export const PASSABLE: Record<Cell, boolean> = { none: true, low: true, high: true, block: false, cart: false };

/**
 * One row of obstacles across the three lanes. `prevOpen` are the lanes a runner can be in after the previous row and
 * `cartLane` is the lane a tram from the previous row still fills (-1 for none); nobody can cross a tram. Every group
 * of lanes a runner can reach keeps at least one lane they can get through on foot, by jumping or by sliding.
 */
export function makeRow(
  r: () => number,
  difficulty: number,
  prevOpen: number[],
  cartLane = -1
): { cells: Cell[]; open: number[] } {
  const diff = Math.max(0, Math.min(1, difficulty));
  const cells: Cell[] = ["none", "none", "none"];
  const groups = cartLane === 1 ? [[0], [2]] : cartLane === 0 ? [[1, 2]] : cartLane === 2 ? [[0, 1]] : [[0, 1, 2]];
  const keep = new Set<number>();
  for (const g of groups) if (g.some((l) => prevOpen.includes(l))) keep.add(g[Math.floor(r() * g.length)]);
  if (keep.size === 0) keep.add(groups[0][Math.floor(r() * groups[0].length)]);
  const gates = diff > 0.08;
  let cart = cartLane === -1 && diff > 0.2;
  for (let l = 0; l < 3; l++) {
    const k = r();
    if (keep.has(l)) {
      cells[l] = k < 0.55 - diff * 0.2 ? "none" : k < 0.8 || !gates ? "low" : "high";
      continue;
    }
    if (r() > 0.45 + diff * 0.45) continue;
    if (cart && k < 0.12 + diff * 0.12) {
      cells[l] = "cart";
      cart = false;
    } else if (k < 0.45) cells[l] = "block";
    else if (k < 0.75 || !gates) cells[l] = "low";
    else cells[l] = "high";
  }
  return { cells, open: [0, 1, 2].filter((l) => PASSABLE[cells[l]]) };
}

type Kind = Exclude<Cell, "none">;
interface Obs { kind: Kind; lane: number; d: number; len: number; w: number; y0: number; y1: number; dead: boolean }
interface Coin { x: number; y: number; d: number; pull: boolean; dead: boolean }
interface Pow { kind: "magnet" | "shield"; x: number; d: number; dead: boolean }
interface Part { x: number; y: number; d: number; vx: number; vy: number; vd: number; life: number; max: number; c: string; s: number }
interface Item { z: number; t: number; i: number }

const DIMS: Record<Kind, { len: number; w: number; y0: number; y1: number }> = {
  low: { len: 0.35, w: 1.05, y0: 0, y1: 0.6 },
  high: { len: 0.3, w: 1.1, y0: 1.0, y1: 1.65 },
  block: { len: 1, w: 1.05, y0: 0, y1: 1.6 },
  cart: { len: 7, w: 1.12, y0: 0, y1: 1.9 },
};
const CAM_BACK = 3;
const FAR = 90;
const NEAR = 0.45;
const ROAD = 2.05;
const STAND = 1.5;
const CROUCH = 0.55;
const JUMP_H = 1.55;
const MAGNET_S = 8;
const MAGNET_R = 12;
const DIFF_DIST = 3200;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function glowSprite(rgb: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},0.9)`);
  gr.addColorStop(0.35, `rgba(${rgb},0.35)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}

export function mount(root: HTMLElement): { destroy(): void } {
  const cg = root.querySelector<HTMLElement>("[data-cg]");
  const canvas = cg?.querySelector<HTMLCanvasElement>("[data-canvas]");
  if (!cg || !canvas) return { destroy() {} };
  const elScore = root.querySelector<HTMLElement>("[data-score]");
  const elBest = root.querySelector<HTMLElement>("[data-best]");
  const elCoins = root.querySelector<HTMLElement>("[data-coins]");
  const reduced = () => document.documentElement.dataset.motion === "reduced";

  let best = readNumber(STORAGE_KEYS.laneRushBest) ?? 0;
  type State = "menu" | "run" | "paused" | "dying" | "over";
  let state: State = "menu";
  let dist = 0;
  let v = 0;
  let time = 0;
  let runT = 0;
  let lane = 1;
  let laneFrom = 1;
  let px = 0;
  let py = 0;
  let vy = 0;
  let grav = 30;
  let slideT = 0;
  let jumpBuf = 0;
  let slideBuf = false;
  let coins = 0;
  let score = 0;
  let shield = false;
  let magnetT = 0;
  let invuln = 0;
  let lastStumble = -9;
  let stumbleCool = 0;
  let shake = 0;
  let flash = 0;
  let dyingT = 0;
  let tumble = 0;
  let nextRow = 0;
  let prevOpen = [0, 1, 2];
  let cartLane = -1;
  let r = rng(1);
  let bestFlashed = false;
  let milestone = 500;
  let banner = "";
  let bannerT = 0;
  let chain = 0;
  let lastCoin = -9;
  let lastStat = 0;
  let camX = 0;
  const obs: Obs[] = [];
  const coinArr: Coin[] = [];
  const pows: Pow[] = [];
  const parts: Part[] = [];
  const pool: Item[] = Array.from({ length: 400 }, () => ({ z: 0, t: 0, i: 0 }));
  const order: Item[] = [];
  const streaks = Array.from({ length: 14 }, (_, i) => ({ a: 0, r: 0, side: i % 2 }));

  // Projection, recomputed on resize: screen = centre + (world - camera) * f / depth.
  let w = 1;
  let h = 1;
  let cx = 0;
  let hor = 0;
  let f = 1;
  let camH = 3;
  let camY = 3;
  let sky: HTMLCanvasElement | null = null;
  let roadGrad: CanvasGradient | string = "#140b26";
  let hazeGrad: CanvasGradient | string = "transparent";
  const glowCyan = glowSprite("60,230,255");
  const glowAmber = glowSprite("255,190,110");
  const glowPink = glowSprite("255,70,170");

  const diffAt = (d: number) => Math.min(1, d / DIFF_DIST);
  const X = (x: number, s: number) => cx + (x - camX) * s;
  const Y = (y: number, s: number) => hor + (camY - y) * s;

  function paintSky(ctx: CanvasRenderingContext2D) {
    const sw = w + 120;
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = Math.ceil(hor) + 2;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 0, hor);
    gr.addColorStop(0, "#05031a");
    gr.addColorStop(0.55, "#1d0b3d");
    gr.addColorStop(1, "#4a1055");
    g.fillStyle = gr;
    g.fillRect(0, 0, sw, c.height);
    const sr = rng(7);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + sr() * 0.6})`;
      const s = sr() < 0.1 ? 2 : 1;
      g.fillRect(sr() * sw, sr() * hor * 0.75, s, s);
    }
    // Striped sun, cut on its own canvas so the stripes don't punch holes in the sky.
    const R = Math.min(w, h) * 0.2;
    const sun = document.createElement("canvas");
    sun.width = sun.height = Math.ceil(R * 2);
    const sg = sun.getContext("2d")!;
    const sgr = sg.createLinearGradient(0, 0, 0, R * 2);
    sgr.addColorStop(0, "#ffe27a");
    sgr.addColorStop(0.55, "#ff7a59");
    sgr.addColorStop(1, "#ff2e93");
    sg.fillStyle = sgr;
    sg.beginPath();
    sg.arc(R, R, R, 0, Math.PI * 2);
    sg.fill();
    sg.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 6; i++) {
      const y = R * (1.05 + i * 0.16);
      sg.fillRect(0, y, R * 2, 1.5 + i * 1.6);
    }
    g.save();
    g.globalAlpha = 0.9;
    g.drawImage(glowPink, sw / 2 - R * 2.2, hor * 0.92 - R * 2.2 - R * 0.3, R * 4.4, R * 4.4);
    g.restore();
    g.drawImage(sun, sw / 2 - R, hor * 0.92 - R * 1.3);
    // Skyline.
    let x = 0;
    while (x < sw) {
      const bw = 14 + sr() * 38;
      const bh = hor * (0.05 + sr() * (Math.abs(x - sw / 2) < R * 1.2 ? 0.07 : 0.17));
      g.fillStyle = "#0d0722";
      g.fillRect(x, hor - bh, bw, bh + 2);
      g.fillStyle = "rgba(255,210,120,0.55)";
      for (let wy = hor - bh + 4; wy < hor - 3; wy += 6)
        for (let wx = x + 3; wx < x + bw - 3; wx += 5) if (sr() < 0.18) g.fillRect(wx, wy, 2, 2);
      x += bw + 1;
    }
    sky = c;
    roadGrad = ctx.createLinearGradient(0, hor, 0, h);
    roadGrad.addColorStop(0, "#2a1440");
    roadGrad.addColorStop(0.25, "#170c2c");
    roadGrad.addColorStop(1, "#0d0819");
    hazeGrad = ctx.createLinearGradient(0, hor - h * 0.05, 0, hor + h * 0.16);
    hazeGrad.addColorStop(0, "rgba(255,60,160,0)");
    hazeGrad.addColorStop(0.3, "rgba(255,60,160,0.28)");
    hazeGrad.addColorStop(1, "rgba(255,60,160,0)");
  }

  let ctxRef: CanvasRenderingContext2D | null = null;
  function resize(width: number, height: number) {
    w = width;
    h = height;
    cx = w / 2;
    hor = h * 0.36;
    f = Math.min(w * 0.75, h * 0.62);
    camH = ((h * 0.84 - hor) * CAM_BACK) / f;
    camY = camH;
    if (ctxRef) paintSky(ctxRef);
    else sky = null;
  }

  // --- World ---
  function reset() {
    dist = 0;
    v = 0;
    runT = 0;
    lane = laneFrom = 1;
    px = py = vy = 0;
    slideT = jumpBuf = 0;
    slideBuf = false;
    coins = score = 0;
    shield = false;
    magnetT = invuln = stumbleCool = 0;
    lastStumble = -9;
    tumble = dyingT = 0;
    obs.length = coinArr.length = pows.length = parts.length = 0;
    prevOpen = [0, 1, 2];
    cartLane = -1;
    nextRow = 34;
    r = rng((Math.random() * 2 ** 32) >>> 0);
    bestFlashed = best === 0;
    milestone = 500;
    banner = "";
    chain = 0;
  }

  function spawnRow(d: number) {
    const diff = diffAt(d);
    const { cells, open } = makeRow(r, diff, prevOpen, cartLane);
    prevOpen = open;
    cartLane = -1;
    for (let l = 0; l < 3; l++) {
      const c = cells[l];
      if (c === "none") continue;
      obs.push({ kind: c, lane: l, d, ...DIMS[c], dead: false });
      if (c === "cart") cartLane = l;
    }
    const gap = rowGap(d);
    const free = [0, 1, 2].filter((l) => cells[l] === "none");
    const lows = [0, 1, 2].filter((l) => cells[l] === "low");
    if (free.length && r() < 0.06) {
      pows.push({ kind: r() < 0.5 ? "magnet" : "shield", x: LANE_X[free[Math.floor(r() * free.length)]], d: d + gap * 0.5, dead: false });
    } else if (lows.length && r() < 0.35) {
      const x = LANE_X[lows[Math.floor(r() * lows.length)]];
      for (let i = -3; i <= 3; i++) coinArr.push({ x, y: 0.55 + 1.05 * (1 - (i / 3.4) ** 2), d: d + i * 1.1, pull: false, dead: false });
    } else if (free.length && r() < 0.8) {
      const x = LANE_X[free[Math.floor(r() * free.length)]];
      const n = Math.min(6, Math.floor((gap - 3) / 1.4));
      for (let i = 0; i < n; i++) coinArr.push({ x, y: 0.55, d: d + 2.2 + i * 1.4, pull: false, dead: false });
    }
  }

  const targetV = (d: number) => 14 + 18 * diffAt(d);
  const rowGap = (d: number) => Math.max(9, targetV(d) * lerp(1.15, 0.62, diffAt(d)));

  function burst(x: number, y: number, d: number, n: number, colors: string[], speed = 4) {
    for (let i = 0; i < n && parts.length < 180; i++) {
      const life = 0.35 + Math.random() * 0.45;
      parts.push({
        x,
        y,
        d,
        vx: (Math.random() - 0.5) * speed * 2,
        vy: Math.random() * speed * 1.2,
        vd: (Math.random() - 0.3) * speed,
        life,
        max: life,
        c: colors[i % colors.length],
        s: 0.05 + Math.random() * 0.07,
      });
    }
  }

  function say(text: string, secs = 1.1) {
    banner = text;
    bannerT = secs;
  }

  // --- Input ---
  function move(dir: -1 | 1) {
    if (state !== "run") return;
    const to = lane + dir;
    if (to < 0 || to > 2) {
      shake = Math.max(shake, 0.08);
      return;
    }
    laneFrom = lane;
    lane = to;
    tone(520 + dir * 40, 0.05, "triangle", 0.06);
  }
  function jump() {
    if (state !== "run") return;
    jumpBuf = 0.15;
  }
  function slide() {
    if (state !== "run") return;
    if (py > 0) {
      vy = Math.min(vy, -16);
      slideBuf = true;
    } else {
      slideT = lerp(0.72, 0.52, diffAt(dist));
      noise(0.18, 0.14, 900);
    }
    jumpBuf = 0;
  }

  // --- Simulation ---
  function crash(o: Obs) {
    if (shield) {
      shield = false;
      o.dead = true;
      invuln = 1;
      shake = Math.max(shake, 0.25);
      burst(LANE_X[o.lane], 0.8, o.d, 26, ["#5ce1ff", "#ffffff", "#b39dff"], 6);
      noise(0.25, 0.3, 2400);
      tone(900, 0.2, "triangle", 0.12, 300);
      say("Shield used");
      return;
    }
    state = "dying";
    dyingT = 0;
    vy = 6;
    shake = 0.7;
    flash = 1;
    burst(px, 0.9, dist + 0.3, 40, ["#ff3d7f", "#ffd23f", "#5ce1ff", "#ffffff"], 7);
    noise(0.55, 0.45, 420, 0.6);
    tone(120, 0.5, "sawtooth", 0.18, 40);
    buzz([70, 40, 110]);
    shell.setRunning(false);
  }

  function stumble(o: Obs) {
    if (stumbleCool > 0) return;
    stumbleCool = 0.45;
    if (lane === o.lane && laneFrom !== o.lane) lane = laneFrom;
    if (time - lastStumble < 3) {
      crash(o);
      return;
    }
    lastStumble = time;
    shake = Math.max(shake, 0.3);
    burst(px, 0.6, dist, 10, ["#ffd23f", "#ffffff"], 4);
    tone(150, 0.16, "sawtooth", 0.14, 70);
    buzz(35);
    say("Careful!", 0.8);
  }

  function collect(c: Coin) {
    c.dead = true;
    coins++;
    chain = time - lastCoin < 0.45 ? Math.min(chain + 1, 10) : 0;
    lastCoin = time;
    const base = 880 * 2 ** (chain / 12);
    tone(base, 0.07, "square", 0.05, base * 1.5);
    burst(c.x, c.y, c.d, 3, ["#ffe680", "#ffffff"], 2.5);
  }

  function step(dt: number) {
    dist += v * dt;
    px += (LANE_X[lane] - px) * (1 - Math.exp(-dt * 18));
    jumpBuf -= dt;
    if (slideT > 0) slideT -= dt;
    if (py > 0 || vy > 0) {
      vy -= grav * dt;
      py += vy * dt;
      if (py <= 0) {
        py = 0;
        vy = 0;
        burst(px, 0.05, dist, 4, ["#b39dff", "#5ce1ff"], 2);
        if (slideBuf) {
          slideBuf = false;
          slideT = lerp(0.72, 0.52, diffAt(dist));
          noise(0.18, 0.14, 900);
        }
      }
    }
    if (jumpBuf > 0 && py === 0) {
      const air = lerp(0.62, 0.5, diffAt(dist));
      vy = (4 * JUMP_H) / air;
      grav = (8 * JUMP_H) / (air * air);
      py = 0.0001;
      jumpBuf = 0;
      slideT = 0;
      tone(330, 0.15, "square", 0.07, 700);
    }
    const ph = slideT > 0 ? CROUCH : STAND;

    for (const o of obs) {
      if (o.dead || o.d > dist + 0.3 || o.d + o.len < dist - 0.3) continue;
      if (Math.abs(px - LANE_X[o.lane]) >= o.w / 2 + 0.26) continue;
      if (py >= o.y1 || py + ph <= o.y0 || invuln > 0) continue;
      const frontal = lane === o.lane && dist + 0.3 - o.d < v * dt + 0.3;
      if (frontal) crash(o);
      else stumble(o);
      if (state !== "run") return;
    }

    const cy = py + ph * 0.5;
    const k = 1 - Math.exp(-dt * 14);
    for (const c of coinArr) {
      if (c.dead) continue;
      const dz = c.d - dist;
      if (magnetT > 0 && !c.pull && dz < MAGNET_R && dz > -1) c.pull = true;
      if (c.pull) {
        c.x += (px - c.x) * k;
        c.y += (cy - c.y) * k;
        c.d += (dist - c.d) * k;
      }
      if (Math.abs(c.d - dist) < 0.55 && Math.abs(c.x - px) < 0.62 && Math.abs(c.y - cy) < ph * 0.5 + 0.35) collect(c);
    }
    for (const p of pows) {
      if (p.dead || Math.abs(p.d - dist) > 0.6 || Math.abs(p.x - px) > 0.7 || py > 1.3) continue;
      p.dead = true;
      if (p.kind === "magnet") {
        magnetT = MAGNET_S;
        say("Magnet");
      } else {
        shield = true;
        say("Shield on");
      }
      tone(660, 0.14, "triangle", 0.14, 1320);
      burst(p.x, 0.9, p.d, 16, p.kind === "magnet" ? ["#ff4f9a", "#ffffff"] : ["#5ce1ff", "#ffffff"], 4);
    }
  }

  function compact<T extends { dead: boolean; d: number }>(arr: T[], behind: number, len = (_: T) => 0) {
    let j = 0;
    for (const o of arr) if (!o.dead && o.d + len(o) > behind) arr[j++] = o;
    arr.length = j;
  }

  function update(dt: number) {
    if (state === "paused") return;
    time += dt;
    shake = Math.max(0, shake - dt * 1.6);
    flash = Math.max(0, flash - dt * 4);
    bannerT -= dt;
    if (state === "run") {
      runT += dt;
      const vt = targetV(dist);
      v = runT < 0.8 ? vt * (0.35 + 0.65 * (runT / 0.8)) : vt;
      magnetT = Math.max(0, magnetT - dt);
      invuln = Math.max(0, invuln - dt);
      stumbleCool = Math.max(0, stumbleCool - dt);
      const n = Math.max(1, Math.ceil((v * dt) / 0.3));
      for (let i = 0; i < n && state === "run"; i++) step(dt / n);
      while (nextRow < dist + 72) {
        spawnRow(nextRow);
        nextRow += rowGap(nextRow);
      }
      score = Math.floor(dist * 0.5) + coins * 10;
      if (dist >= milestone) {
        say(`${milestone} m`);
        tone(880, 0.12, "triangle", 0.1, 1760);
        milestone += 500;
      }
      if (!bestFlashed && score > best) {
        bestFlashed = true;
        say("New best!");
        tone(1046, 0.25, "triangle", 0.12, 2093);
      }
      if (time - lastStat > 0.25) {
        lastStat = time;
        paintStats();
      }
    } else if (state === "dying") {
      dyingT += dt;
      v *= Math.exp(-dt * 5);
      dist += v * dt;
      vy -= 22 * dt;
      py = Math.max(0, py + vy * dt);
      tumble += dt * 9 * Math.max(0, 1 - dyingT);
      if (dyingT > 1) gameOver();
    } else if (state === "menu" && !reduced()) {
      dist += 7 * dt;
    }
    const behind = dist - CAM_BACK + NEAR - 0.5;
    compact(obs, behind, (o) => o.len);
    compact(coinArr, behind);
    compact(pows, behind);
    let j = 0;
    for (const p of parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y = Math.max(0, p.y + p.vy * dt);
      p.vy -= 9 * dt;
      p.d += p.vd * dt + v * dt * 0.6;
      parts[j++] = p;
    }
    parts.length = j;
    camX += (px * 0.6 - camX) * Math.min(1, dt * 8);
    camY = camH + py * 0.3;
  }

  // --- Drawing ---
  function gquad(ctx: CanvasRenderingContext2D, x0: number, x1: number, z0: number, z1: number) {
    const s0 = f / z0;
    const s1 = f / z1;
    ctx.moveTo(X(x0, s0), Y(0, s0));
    ctx.lineTo(X(x1, s0), Y(0, s0));
    ctx.lineTo(X(x1, s1), Y(0, s1));
    ctx.lineTo(X(x0, s1), Y(0, s1));
    ctx.closePath();
  }

  /** A box from x0..x1, y0..y1, world depth dn..df: front face, top and the side facing the camera. */
  function box(ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number, dn: number, df: number, front: string, top: string, side: string) {
    let zn = dn - dist + CAM_BACK;
    const zf = df - dist + CAM_BACK;
    if (zf < NEAR) return null;
    const clipped = zn < NEAR;
    if (clipped) zn = NEAR;
    const sn = f / zn;
    const sf = f / zf;
    const ax0 = X(x0, sn);
    const ax1 = X(x1, sn);
    const ay0 = Y(y0, sn);
    const ay1 = Y(y1, sn);
    const bx0 = X(x0, sf);
    const bx1 = X(x1, sf);
    const by0 = Y(y0, sf);
    const by1 = Y(y1, sf);
    if (camY > y1) {
      ctx.fillStyle = top;
      ctx.beginPath();
      ctx.moveTo(ax0, ay1);
      ctx.lineTo(ax1, ay1);
      ctx.lineTo(bx1, by1);
      ctx.lineTo(bx0, by1);
      ctx.fill();
    }
    if (camX > x1 || camX < x0) {
      const sx = camX > x1 ? ax1 : ax0;
      const sbx = camX > x1 ? bx1 : bx0;
      ctx.fillStyle = side;
      ctx.beginPath();
      ctx.moveTo(sx, ay0);
      ctx.lineTo(sx, ay1);
      ctx.lineTo(sbx, by1);
      ctx.lineTo(sbx, by0);
      ctx.fill();
    }
    if (!clipped) {
      ctx.fillStyle = front;
      ctx.fillRect(ax0, ay1, ax1 - ax0, ay0 - ay1);
    }
    return { x: ax0, y: ay1, w: ax1 - ax0, h: ay0 - ay1, s: sn, clipped };
  }

  function drawObs(ctx: CanvasRenderingContext2D, o: Obs) {
    const x = LANE_X[o.lane];
    const hw = o.w / 2;
    if (o.kind === "low") {
      const b = box(ctx, x - hw, x + hw, 0, 0.6, o.d, o.d + o.len, "#ff6b2d", "#ffb37a", "#a63a14");
      if (!b || b.clipped) return;
      ctx.fillStyle = "#1a0d16";
      const sw = b.w / 7;
      for (let i = 0; i < 7; i += 2) {
        ctx.beginPath();
        ctx.moveTo(b.x + i * sw, b.y + b.h);
        ctx.lineTo(b.x + (i + 1) * sw, b.y + b.h);
        ctx.lineTo(b.x + (i + 1.6) * sw, b.y + b.h * 0.25);
        ctx.lineTo(b.x + (i + 0.6) * sw, b.y + b.h * 0.25);
        ctx.fill();
      }
      ctx.fillStyle = "#fff1c4";
      ctx.fillRect(b.x, b.y, b.w, Math.max(1, b.h * 0.12));
    } else if (o.kind === "high") {
      box(ctx, x - hw, x - hw + 0.09, 0, 1.65, o.d, o.d + o.len, "#3b3f5e", "#555b80", "#262940");
      box(ctx, x + hw - 0.09, x + hw, 0, 1.65, o.d, o.d + o.len, "#3b3f5e", "#555b80", "#262940");
      const b = box(ctx, x - hw, x + hw, 1.0, 1.65, o.d, o.d + o.len, "#7c4dff", "#b39dff", "#4a2bb0");
      if (!b || b.clipped) return;
      ctx.fillStyle = "#5ce1ff";
      ctx.fillRect(b.x, b.y + b.h * 0.86, b.w, Math.max(1.5, b.h * 0.14));
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      const cw = b.h * 0.5;
      for (let i = 0; i < 3; i++) {
        const mx = b.x + b.w * (0.3 + i * 0.2);
        ctx.beginPath();
        ctx.moveTo(mx - cw * 0.35, b.y + b.h * 0.25);
        ctx.lineTo(mx + cw * 0.35, b.y + b.h * 0.25);
        ctx.lineTo(mx, b.y + b.h * 0.65);
        ctx.fill();
      }
    } else if (o.kind === "block") {
      const b = box(ctx, x - hw, x + hw, 0, 1.6, o.d, o.d + o.len, "#18264a", "#2f4377", "#0f1830");
      if (!b || b.clipped) return;
      const ins = b.w * 0.1;
      ctx.strokeStyle = "#ff3da8";
      ctx.lineWidth = Math.max(1.5, b.w * 0.05);
      ctx.strokeRect(b.x + ins, b.y + ins, b.w - ins * 2, b.h - ins * 2);
      ctx.beginPath();
      ctx.moveTo(b.x + ins, b.y + ins);
      ctx.lineTo(b.x + b.w - ins, b.y + b.h - ins);
      ctx.moveTo(b.x + b.w - ins, b.y + ins);
      ctx.lineTo(b.x + ins, b.y + b.h - ins);
      ctx.stroke();
    } else {
      box(ctx, x - hw, x + hw, 0.12, 1.9, o.d, o.d + o.len, "#2c3658", "#8790ab", "#232b48");
      // Lit windows along the visible side.
      if (camX > x + hw || camX < x - hw) {
        const sx = camX > x + hw ? x + hw : x - hw;
        ctx.fillStyle = "#ffd36e";
        for (let i = 0; i < 5; i++) {
          const z0 = o.d + 0.6 + i * 1.3 - dist + CAM_BACK;
          const z1 = z0 + 0.9;
          if (z0 < NEAR) continue;
          const s0 = f / z0;
          const s1 = f / z1;
          ctx.beginPath();
          ctx.moveTo(X(sx, s0), Y(1.05, s0));
          ctx.lineTo(X(sx, s0), Y(1.6, s0));
          ctx.lineTo(X(sx, s1), Y(1.6, s1));
          ctx.lineTo(X(sx, s1), Y(1.05, s1));
          ctx.fill();
        }
      }
      const z = o.d - dist + CAM_BACK;
      if (z < NEAR) return;
      const s = f / z;
      const fx = X(x - hw, s);
      const fw = o.w * s;
      ctx.fillStyle = "#0a0f22";
      ctx.fillRect(fx + fw * 0.12, Y(1.75, s), fw * 0.76, 0.5 * s);
      ctx.fillStyle = "#ff3da8";
      ctx.fillRect(fx, Y(0.32, s), fw, 0.06 * s);
      for (const hx of [x - hw + 0.22, x + hw - 0.22]) {
        const gx = X(hx, s);
        const gy = Y(0.55, s);
        ctx.drawImage(glowAmber, gx - 0.7 * s, gy - 0.7 * s, 1.4 * s, 1.4 * s);
        ctx.fillStyle = "#fff6dc";
        ctx.beginPath();
        ctx.arc(gx, gy, 0.09 * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#11152a";
      ctx.fillRect(fx, Y(0.12, s), fw, 0.12 * s);
    }
  }

  function drawCoin(ctx: CanvasRenderingContext2D, c: Coin, z: number) {
    const s = f / z;
    const sx = X(c.x, s);
    const sy = Y(c.y, s);
    const rr = 0.26 * s;
    const sp = Math.abs(Math.cos(time * 5 + c.d * 0.7));
    ctx.fillStyle = "#c98a00";
    ctx.beginPath();
    ctx.ellipse(sx, sy, rr * (0.18 + sp * 0.82), rr, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.ellipse(sx, sy, rr * (0.1 + sp * 0.62), rr * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    if (sp > 0.5) {
      ctx.fillStyle = "#fff6c0";
      ctx.fillRect(sx - rr * 0.12 * sp, sy - rr * 0.45, rr * 0.24 * sp, rr * 0.9);
    }
  }

  function drawPow(ctx: CanvasRenderingContext2D, p: Pow, z: number) {
    const s = f / z;
    const sx = X(p.x, s);
    const sy = Y(0.9 + Math.sin(time * 4) * 0.08, s);
    const rr = 0.36 * s;
    ctx.drawImage(p.kind === "magnet" ? glowPink : glowCyan, sx - rr * 2.4, sy - rr * 2.4, rr * 4.8, rr * 4.8);
    ctx.fillStyle = "rgba(10,6,24,0.85)";
    ctx.strokeStyle = p.kind === "magnet" ? "#ff4f9a" : "#5ce1ff";
    ctx.lineWidth = Math.max(1.5, rr * 0.14);
    ctx.beginPath();
    if (p.kind === "shield") for (let i = 0; i < 6; i++) ctx.lineTo(sx + Math.cos(i * 1.047 + 0.52) * rr, sy + Math.sin(i * 1.047 + 0.52) * rr);
    else ctx.arc(sx, sy, rr, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = Math.max(2, rr * 0.22);
    ctx.lineCap = "round";
    ctx.beginPath();
    if (p.kind === "magnet") {
      ctx.arc(sx, sy - rr * 0.05, rr * 0.42, 0, Math.PI);
      ctx.moveTo(sx - rr * 0.42, sy - rr * 0.05);
      ctx.lineTo(sx - rr * 0.42, sy - rr * 0.45);
      ctx.moveTo(sx + rr * 0.42, sy - rr * 0.05);
      ctx.lineTo(sx + rr * 0.42, sy - rr * 0.45);
    } else {
      ctx.moveTo(sx, sy - rr * 0.5);
      ctx.lineTo(sx, sy + rr * 0.5);
      ctx.moveTo(sx - rr * 0.4, sy - rr * 0.1);
      ctx.lineTo(sx + rr * 0.4, sy - rr * 0.1);
    }
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  function drawRider(ctx: CanvasRenderingContext2D) {
    const s = f / CAM_BACK;
    const gx = X(px, s);
    const gy = Y(0, s);
    // Shadow stays on the road.
    ctx.fillStyle = `rgba(0,0,0,${0.45 - Math.min(0.3, py * 0.15)})`;
    ctx.beginPath();
    ctx.ellipse(gx, gy, 0.5 * s * (1 - py * 0.12), 0.11 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(gx, Y(py, s));
    ctx.scale(s, s);
    ctx.rotate((LANE_X[lane] - px) * 0.28 + tumble);
    const crouch = slideT > 0 ? 0.42 : 1;
    const run = state === "run" ? Math.sin(time * 16) : 0;
    // Board with its glow.
    ctx.drawImage(glowCyan, -0.75, -0.35, 1.5, 0.6);
    ctx.fillStyle = "#0f1730";
    ctx.beginPath();
    ctx.roundRect(-0.46, -0.13, 0.92, 0.12, 0.06);
    ctx.fill();
    ctx.fillStyle = "#3ce6ff";
    ctx.fillRect(-0.4, -0.03, 0.8, 0.03);
    ctx.scale(1, crouch);
    // Legs.
    ctx.fillStyle = "#23263d";
    ctx.fillRect(-0.21, -0.68 - run * 0.03, 0.14, 0.56);
    ctx.fillRect(0.07, -0.68 + run * 0.03, 0.14, 0.56);
    ctx.fillStyle = "#f4f4f6";
    ctx.fillRect(-0.23, -0.2, 0.18, 0.08);
    ctx.fillRect(0.05, -0.2, 0.18, 0.08);
    // Arms.
    ctx.strokeStyle = "#ff3d7f";
    ctx.lineWidth = 0.11;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-0.25, -1.08);
    ctx.lineTo(-0.42, -0.78 + run * 0.06);
    ctx.moveTo(0.25, -1.08);
    ctx.lineTo(0.42, -0.78 - run * 0.06);
    ctx.stroke();
    ctx.lineCap = "butt";
    // Jacket and pack.
    ctx.fillStyle = "#ff3d7f";
    ctx.beginPath();
    ctx.roundRect(-0.27, -1.17, 0.54, 0.55, 0.12);
    ctx.fill();
    ctx.fillStyle = "#2d1b4e";
    ctx.beginPath();
    ctx.roundRect(-0.19, -1.1, 0.38, 0.38, 0.07);
    ctx.fill();
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(-0.19, -0.86, 0.38, 0.05);
    // Helmet.
    ctx.fillStyle = "#eef0f6";
    ctx.beginPath();
    ctx.arc(0, -1.31, 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff3d7f";
    ctx.fillRect(-0.035, -1.48, 0.07, 0.34);
    ctx.restore();
    if (shield) {
      const a = 0.35 + Math.sin(time * 6) * 0.1;
      ctx.strokeStyle = `rgba(92,225,255,${a})`;
      ctx.lineWidth = Math.max(2, s * 0.04);
      ctx.beginPath();
      ctx.ellipse(gx, Y(py + (slideT > 0 ? 0.35 : 0.75), s), 0.62 * s, (slideT > 0 ? 0.45 : 0.9) * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawWorld(ctx: CanvasRenderingContext2D) {
    if (!sky) paintSky(ctx);
    ctx.drawImage(sky!, -60 - camX * f * 0.03, 0);
    ctx.fillStyle = "#07030f";
    ctx.fillRect(0, hor, w, h - hor);

    const sF = f / FAR;
    const zN = 0.8;
    const sN = f / zN;
    // Ground grid.
    ctx.strokeStyle = "rgba(255,60,170,0.26)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = -36; gx <= 36; gx += 2.6) {
      if (Math.abs(gx) < ROAD + 0.5) continue;
      ctx.moveTo(X(gx, sF), Y(0, sF));
      ctx.lineTo(X(gx, sN), Y(0, sN));
    }
    for (let d = Math.ceil((dist - CAM_BACK + zN) / 5) * 5; d < dist + FAR - CAM_BACK; d += 5) {
      const y = Y(0, f / (d - dist + CAM_BACK));
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Road, bands, lane dashes and glowing rails.
    ctx.fillStyle = roadGrad;
    ctx.beginPath();
    gquad(ctx, -ROAD, ROAD, zN, FAR);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    ctx.beginPath();
    for (let d = Math.floor((dist - CAM_BACK) / 8) * 8; d < dist + FAR - CAM_BACK; d += 8) {
      const z0 = Math.max(zN, d - dist + CAM_BACK);
      const z1 = d + 4 - dist + CAM_BACK;
      if (z1 > z0) gquad(ctx, -ROAD, ROAD, z0, Math.min(FAR, z1));
    }
    ctx.fill();
    const dash = (half: number) => {
      ctx.beginPath();
      for (const lx of [-0.625, 0.625])
        for (let d = Math.floor((dist - CAM_BACK) / 4.5) * 4.5; d < dist + FAR - CAM_BACK; d += 4.5) {
          const z0 = Math.max(zN, d - dist + CAM_BACK);
          const z1 = d + 2 - dist + CAM_BACK;
          if (z1 > z0) gquad(ctx, lx - half, lx + half, z0, Math.min(FAR, z1));
        }
      ctx.fill();
    };
    ctx.fillStyle = "rgba(60,230,255,0.16)";
    dash(0.14);
    ctx.fillStyle = "#5ce1ff";
    dash(0.035);
    for (const side of [-1, 1]) {
      const rx = side * ROAD;
      ctx.fillStyle = "rgba(255,61,168,0.16)";
      ctx.beginPath();
      ctx.moveTo(X(rx, sN), Y(0, sN));
      ctx.lineTo(X(rx, sN), Y(0.32, sN));
      ctx.lineTo(X(rx, sF), Y(0.32, sF));
      ctx.lineTo(X(rx, sF), Y(0, sF));
      ctx.fill();
      ctx.strokeStyle = "#ff3da8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(rx, sN), Y(0.32, sN));
      ctx.lineTo(X(rx, sF), Y(0.32, sF));
      ctx.stroke();
    }
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, hor - h * 0.05, w, h * 0.21);

    // Street lamps, far to near.
    ctx.strokeStyle = "#2c2546";
    for (let d = Math.ceil((dist + FAR - CAM_BACK - 2) / 15) * 15 - 15; d > dist - CAM_BACK + 1; d -= 15) {
      const z = d - dist + CAM_BACK;
      const s = f / z;
      ctx.globalAlpha = Math.min(1, (FAR - z) / 18);
      ctx.lineWidth = Math.max(1, 0.08 * s);
      for (const side of [-1, 1]) {
        const lx = side * 2.85;
        const hx = side * 2.25;
        ctx.beginPath();
        ctx.moveTo(X(lx, s), Y(0, s));
        ctx.lineTo(X(lx, s), Y(3.3, s));
        ctx.lineTo(X(hx, s), Y(3.35, s));
        ctx.stroke();
        ctx.drawImage(glowAmber, X(hx, s) - 1.1 * s, Y(3.3, s) - 1.1 * s, 2.2 * s, 2.2 * s);
        ctx.drawImage(glowAmber, X(side * 1.6, s) - 1.4 * s, Y(0, s) - 0.25 * s, 2.8 * s, 0.5 * s);
      }
    }
    ctx.globalAlpha = 1;

    // Objects and the rider, far to near.
    let n = 0;
    const add = (z: number, t: number, i: number) => {
      if (z < NEAR - 7.5 || z > FAR || n >= pool.length) return;
      const it = pool[n++];
      it.z = z;
      it.t = t;
      it.i = i;
    };
    for (let i = 0; i < obs.length; i++) add(obs[i].d - dist + CAM_BACK, 0, i);
    for (let i = 0; i < coinArr.length; i++) add(coinArr[i].d - dist + CAM_BACK, 1, i);
    for (let i = 0; i < pows.length; i++) add(pows[i].d - dist + CAM_BACK, 2, i);
    if (state !== "menu") add(CAM_BACK - 0.01, 3, 0);
    order.length = 0;
    for (let i = 0; i < n; i++) order.push(pool[i]);
    order.sort((a, b) => b.z - a.z);
    for (const it of order) {
      ctx.globalAlpha = Math.min(1, (FAR - it.z) / 18);
      if (it.t === 0) drawObs(ctx, obs[it.i]);
      else if (it.t === 3) {
        ctx.globalAlpha = invuln > 0 && Math.floor(time * 14) % 2 ? 0.45 : 1;
        drawRider(ctx);
      } else if (it.z >= NEAR) {
        if (it.t === 1) drawCoin(ctx, coinArr[it.i], it.z);
        else drawPow(ctx, pows[it.i], it.z);
      }
    }
    ctx.globalAlpha = 1;
    for (const p of parts) {
      const z = p.d - dist + CAM_BACK;
      if (z < NEAR) continue;
      const s = f / z;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.c;
      const ps = Math.max(1.5, p.s * s);
      ctx.fillRect(X(p.x, s) - ps / 2, Y(p.y, s) - ps / 2, ps, ps);
    }
    ctx.globalAlpha = 1;
  }

  function drawStreaks(ctx: CanvasRenderingContext2D, dt: number) {
    const amt = Math.min(1, Math.max(0, (v - 19) / 12));
    if (amt <= 0 || reduced()) return;
    const vx = cx - camX * f * 0.3;
    const maxR = Math.hypot(w, h);
    ctx.strokeStyle = `rgba(255,255,255,${0.16 * amt})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const st of streaks) {
      st.r += dt * (300 + st.r * 3.2);
      if (st.r > maxR || st.r === 0) {
        st.a = (st.side ? 0 : Math.PI) + (Math.random() - 0.5) * 1.3;
        st.r = 40 + Math.random() * maxR * 0.3;
      }
      const c = Math.cos(st.a);
      const sn = Math.sin(st.a);
      ctx.moveTo(vx + c * st.r, hor + sn * st.r);
      ctx.lineTo(vx + c * (st.r + 30 + st.r * 0.2), hor + sn * (st.r + 30 + st.r * 0.2));
    }
    ctx.stroke();
  }

  function drawHud(ctx: CanvasRenderingContext2D) {
    if (state === "menu") return;
    const fs = Math.round(Math.max(18, Math.min(30, w * 0.065)));
    const pad = 14;
    const text = (t: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = "left") => {
      ctx.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = align;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(t, x + 1.5, y + 1.5);
      ctx.fillStyle = color;
      ctx.fillText(t, x, y);
    };
    ctx.textBaseline = "top";
    text(String(score), pad, pad, fs, "#ffffff");
    const cy = pad + fs * 1.25;
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(pad + fs * 0.3, cy + fs * 0.32, fs * 0.28, 0, Math.PI * 2);
    ctx.fill();
    text(String(coins), pad + fs * 0.75, cy, Math.round(fs * 0.62), "#ffe680");
    text(`${Math.floor(dist)} m`, w - pad, pad, Math.round(fs * 0.62), "#d9d4ff", "right");
    let iy = pad + fs * 0.95;
    if (magnetT > 0) {
      text("MAGNET", w - pad, iy, Math.round(fs * 0.45), "#ff7ab5", "right");
      ctx.fillStyle = "#ff4f9a";
      ctx.fillRect(w - pad - 70 * (magnetT / MAGNET_S), iy + fs * 0.55, 70 * (magnetT / MAGNET_S), 3);
      iy += fs * 0.85;
    }
    if (shield) text("SHIELD", w - pad, iy, Math.round(fs * 0.45), "#5ce1ff", "right");
    if (bannerT > 0 && banner) {
      ctx.globalAlpha = Math.min(1, bannerT * 3);
      ctx.textBaseline = "middle";
      text(banner, cx, h * 0.24, Math.round(fs * 1.15), "#ffffff", "center");
      ctx.globalAlpha = 1;
    }
    if (state === "run" && runT < 3 && dist < 60) {
      ctx.globalAlpha = Math.max(0, Math.min(1, 3 - runT));
      ctx.textBaseline = "middle";
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      text(coarse ? "Swipe to switch lanes · up jump · down slide" : "← → lanes · ↑ jump · ↓ slide", cx, h * 0.93, Math.round(fs * 0.5), "#e9e6ff", "center");
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function frame(ctx: CanvasRenderingContext2D, info: { dt: number }) {
    ctxRef = ctx;
    const dt = Math.min(info.dt / 1000, 0.05);
    update(dt);
    ctx.save();
    if (shake > 0 && !reduced()) ctx.translate((Math.random() - 0.5) * shake * 18, (Math.random() - 0.5) * shake * 18);
    drawWorld(ctx);
    ctx.restore();
    drawStreaks(ctx, state === "run" ? dt : 0);
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.6})`;
      ctx.fillRect(0, 0, w, h);
    }
    drawHud(ctx);
  }

  // --- Flow ---
  function paintStats() {
    if (elScore) elScore.textContent = String(score);
    if (elCoins) elCoins.textContent = String(coins);
    if (elBest) elBest.textContent = best > 0 ? String(best) : "–";
  }

  function start() {
    unlockAudio();
    reset();
    state = "run";
    shell.hide();
    shell.setRunning(true);
    shell.say("Run started.");
    tone(440, 0.1, "triangle", 0.1, 880);
  }

  function pause() {
    if (state !== "run") return;
    state = "paused";
    shell.setRunning(false);
    shell.show({ kicker: "Paused", title: `${score} points`, msg: `${Math.floor(dist)} m · ${coins} coins`, label: "Resume" });
  }

  function resume() {
    state = "run";
    shell.hide();
    shell.setRunning(true);
  }

  function gameOver() {
    state = "over";
    const isBest = score > best;
    const firstRun = best === 0;
    if (isBest) {
      best = score;
      writeNumber(STORAGE_KEYS.laneRushBest, best);
    }
    paintStats();
    shell.show({
      kicker: isBest && !firstRun ? "New best!" : "Wiped out",
      title: `${score} points`,
      msg: `${Math.floor(dist)} m · ${coins} coins\nBest ${best}`,
      label: "Run again",
      share: `I scored ${score} in Lane Rush. Beat that.`,
    });
  }

  const shell = createShell(cg, {
    onMain() {
      if (state === "paused") resume();
      else start();
    },
    onPause: pause,
  });

  const onKey = (e: KeyboardEvent) => {
    if (state !== "run" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") move(-1);
    else if (k === "ArrowRight" || k === "d" || k === "D") move(1);
    else if (k === "ArrowUp" || k === "w" || k === "W" || k === " ") jump();
    else if (k === "ArrowDown" || k === "s" || k === "S") slide();
    else return;
    e.preventDefault();
  };
  document.addEventListener("keydown", onKey);
  const offSwipe = onSwipe(canvas, (dir) => {
    if (dir === "left") move(-1);
    else if (dir === "right") move(1);
    else if (dir === "down") slide();
    else jump();
  });

  shell.show({
    kicker: "Lane Rush",
    title: "Ride the night line",
    msg: "Switch lanes, jump the barriers, slide under the gates and grab every coin. It gets faster the farther you go.",
    label: "Start run",
  });
  paintStats();
  const loop = startCanvasLoop(canvas, { essential: true, mobileFPS: 60, onFrame: frame, onResize: resize });

  return {
    destroy() {
      loop.stop();
      shell.destroy();
      offSwipe();
      document.removeEventListener("keydown", onKey);
    },
  };
}
