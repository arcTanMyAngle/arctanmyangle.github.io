// Monolith: an original side-on boss fight. One arena, one floating stone obelisk with three phases, a hooded gunner
// with a dash and a charged beam. Logical arena is 800x450, scaled to fit; everything is drawn with canvas paths (no
// image assets). Mounted by src/pages/arcade/monolith.astro.
import { startCanvasLoop } from "../lib/canvasLoop";
import { STORAGE_KEYS, readJSON, readNumber, writeJSON } from "../lib/clientState";
import { buzz, createShell, holdButtons, rng } from "../lib/gameShell";
import { noise, tone, unlockAudio } from "../lib/sfx";

export const BOSS_HP = 560;
const W = 800;
const H = 450;
const FLOOR = 400;
const PLATS = [
  { x0: 150, x1: 290, y: 300 },
  { x0: 510, x1: 650, y: 300 },
];
const HOME_Y = 180;
const MAX_EB = 220;
const PHASE_COL = ["#5ee7ff", "#ffb347", "#ff4d5e"];

/** Boss phase for a given HP: 1 above two thirds, 2 above one third, then 3. */
export function phaseFor(hp: number, max: number): 1 | 2 | 3 {
  const f = hp / max;
  return f > 2 / 3 ? 1 : f > 1 / 3 ? 2 : 3;
}

/** Letter grade for a win: hits taken cost the most, slow clears cost a little, Hard earns a bonus. */
export function gradeFor(timeMs: number, hits: number, hard: boolean): "S" | "A" | "B" | "C" {
  const t = timeMs / 1000;
  const s = 100 - hits * 12 - Math.max(0, t - 90) * 0.5 + (hard ? 10 : 0);
  return s >= 90 ? "S" : s >= 75 ? "A" : s >= 55 ? "B" : "C";
}

export function formatTime(ms: number): string {
  const t = Math.max(0, ms) / 1000;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}

export type MonolithMode = "normal" | "hard";
export type Grade = "S" | "A" | "B" | "C";
/** Per difficulty: fastest win (0 = none), best grade ("" = none) and furthest phase reached (0 = never fought). */
export interface MonolithBest {
  ms: number;
  grade: Grade | "";
  phase: 0 | 1 | 2 | 3;
}
export type MonolithBests = Record<MonolithMode, MonolithBest>;
const GRADES: readonly Grade[] = ["S", "A", "B", "C"];
// Nobody breaks 560 HP in under ten seconds; anything faster (or over an hour) is junk, not a record.
const MIN_WIN_MS = 10_000;
const MAX_WIN_MS = 3_600_000;
const validWin = (ms: unknown): ms is number =>
  typeof ms === "number" && Number.isFinite(ms) && ms >= MIN_WIN_MS && ms <= MAX_WIN_MS;

/**
 * Cleans stored per-difficulty bests. The old single best time (from before difficulties were tracked apart) seeds
 * Normal and is never lost: if both exist, the faster one wins. A recorded win means phase 3 was reached.
 */
export function readMonolithBests(stored: unknown, legacyMs: number | null): MonolithBests {
  const clean = (v: unknown): MonolithBest => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const ms = validWin(o.ms) ? Math.round(o.ms) : 0;
    const grade = GRADES.includes(o.grade as Grade) ? (o.grade as Grade) : "";
    const phase = o.phase === 1 || o.phase === 2 || o.phase === 3 ? o.phase : 0;
    return { ms, grade: ms ? grade : "", phase: ms ? 3 : phase };
  };
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out: MonolithBests = { normal: clean(s.normal), hard: clean(s.hard) };
  if (validWin(legacyMs) && (out.normal.ms === 0 || legacyMs < out.normal.ms)) {
    out.normal.ms = Math.round(legacyMs);
    out.normal.phase = 3;
  }
  return out;
}

/** Folds one finished full run into a difficulty's bests. Grades and times improve separately. */
export function recordMonolith(prev: MonolithBest, run: { won: boolean; ms: number; grade: Grade | ""; phase: 1 | 2 | 3 }): MonolithBest {
  const next: MonolithBest = { ...prev, phase: Math.max(prev.phase, run.won ? 3 : run.phase) as MonolithBest["phase"] };
  if (run.won && validWin(run.ms)) {
    if (prev.ms === 0 || run.ms < prev.ms) next.ms = Math.round(run.ms);
    if (run.grade && (!prev.grade || GRADES.indexOf(run.grade) < GRADES.indexOf(prev.grade))) next.grade = run.grade;
  }
  return next;
}

/** Boss HP when a practice run starts at a phase: the top of that phase's band. */
export function practiceHp(phase: 1 | 2 | 3): number {
  return phase === 1 ? BOSS_HP : Math.floor((BOSS_HP * (phase === 2 ? 2 : 1)) / 3);
}

type Act = "intro" | "idle" | "bolts" | "spikes" | "slam" | "ring" | "laser" | "debris" | "spiral" | "roar" | "dead";
interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  kind: number; // 0 orb, 1 rock, 2 drone shot
}
interface PShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  col: string;
  size: number;
  grav: number;
}
interface Drone {
  ax: number;
  ay: number;
  x: number;
  y: number;
  hp: number;
  t: number;
  cd: number;
  flash: number;
}
interface Frag {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  pts: number[];
}

export function mount(root: HTMLElement): { destroy(): void } {
  const cg = root.querySelector<HTMLElement>("[data-cg]");
  const canvas = cg?.querySelector<HTMLCanvasElement>("[data-canvas]");
  if (!cg || !canvas) return { destroy() {} };
  const elTime = root.querySelector<HTMLElement>("[data-time]");
  const elBest = root.querySelector<HTMLElement>("[data-best]");
  const elGrade = root.querySelector<HTMLElement>("[data-grade]");
  const elBestGrade = root.querySelector<HTMLElement>("[data-best-grade]");
  const elReached = root.querySelector<HTMLElement>("[data-reached]");
  const modeBtns = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-mode]"));
  const phaseBtns = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-start-phase]"));
  const autoBtn = root.querySelector<HTMLButtonElement>("[data-autofire]");
  const reduced = () => document.documentElement.dataset.motion === "reduced";
  const coarse = window.matchMedia("(pointer: coarse)");

  const bests = readMonolithBests(readJSON(STORAGE_KEYS.monolithBests), readNumber(STORAGE_KEYS.monolithBest));
  let hard = false;
  const mode = (): MonolithMode => (hard ? "hard" : "normal");
  /** Phase the next run starts at; above 1 it is practice and records nothing. */
  let startPhase: 1 | 2 | 3 = 1;
  let practice = false;
  let autoFire = readJSON<boolean>(STORAGE_KEYS.monolithAutoFire) !== false;
  type State = "menu" | "run" | "paused" | "won" | "over";
  let state: State = "menu";
  let rand = rng(1);

  // View
  let w = 800;
  let h = 450;
  let sc = 1;
  let ox = 0;
  let oy = 0;
  let bg: HTMLCanvasElement | null = null;
  let ctxRef: CanvasRenderingContext2D | null = null;
  let time = 0;
  let shake = 0;
  let hitStop = 0;
  let slow = 1;
  let wonT = 0;
  let flashT = 0;

  // Input
  const keys: Record<string, boolean> = {};
  let jumpPress = false;
  let dashPress = false;
  let beamPress = false;
  let touchAim = coarse.matches;
  let mouseHeld = false;
  let mouseX = 0;
  let mouseY = 0;

  // Player
  const p = {
    x: 120,
    y: FLOOR,
    vx: 0,
    vy: 0,
    face: 1,
    ground: true,
    coyote: 0,
    buffer: 0,
    dropT: 0,
    dashT: 0,
    dashCd: 0,
    dashDir: 1,
    dashAir: true,
    inv: 0,
    hp: 5,
    maxHp: 5,
    fireCd: 0,
    ax: 1,
    ay: 0,
    meter: 0,
    beamT: 0,
    beamDx: 1,
    beamDy: 0,
    run: 0,
  };
  const scarf: Array<{ x: number; y: number; px: number; py: number }> = [];
  for (let i = 0; i < 7; i++) scarf.push({ x: 120, y: FLOOR - 20, px: 120, py: FLOOR - 20 });

  // Boss
  const b = {
    x: 680,
    y: 520,
    hx: 680,
    hy: HOME_Y,
    hp: BOSS_HP,
    phase: 1 as 1 | 2 | 3,
    act: "intro" as Act,
    last: "" as Act | "",
    t: 0,
    step: 0,
    cd: 0,
    flash: 0,
    eye: 0,
    rest: 0,
    spin: 0,
    dropping: false,
    tx: 0,
  };
  let hits = 0;
  let runMs = 0;
  let droneT = 0;
  let hitTick = 0;
  // Run stats for the end card.
  let shotsFired = 0;
  let shotsHit = 0;
  const hitsByPhase = [0, 0, 0];
  let dashes = 0;
  let beams = 0;

  const eb: Shot[] = [];
  const pb: PShot[] = [];
  const sparks: Spark[] = [];
  const drones: Drone[] = [];
  const frags: Frag[] = [];
  const spikes: Array<{ x: number; warn: number; up: number }> = [];
  const waves: Array<{ x: number; dir: number; life: number }> = [];
  const lasers: Array<{ y: number; warn: number; beam: number; from: number }> = [];
  const marks: Array<{ x: number; warn: number }> = [];
  const ghosts: Array<{ x: number; y: number; face: number; life: number }> = [];

  const bs = () => (hard ? 1.15 : 1);
  const cdMul = () => (hard ? 0.8 : 1);

  function removeAt<T>(arr: T[], i: number) {
    arr[i] = arr[arr.length - 1]!;
    arr.pop();
  }

  function fireEB(x: number, y: number, ang: number, speed: number, kind = 0, r = 7) {
    if (eb.length >= MAX_EB) return;
    eb.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r, kind });
  }

  function spark(x: number, y: number, n: number, col: string, speed = 180, size = 2.5, grav = 300) {
    if (reduced()) n = Math.ceil(n / 3);
    for (let i = 0; i < n && sparks.length < 320; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.9);
      const life = 0.25 + Math.random() * 0.4;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, col, size, grav });
    }
  }

  // ---------- setup ----------

  function reset() {
    rand = rng((Date.now() & 0xffff) + 7);
    p.x = 120;
    p.y = FLOOR;
    p.vx = p.vy = 0;
    p.face = 1;
    p.ground = true;
    p.coyote = p.buffer = p.dropT = p.dashT = p.dashCd = p.inv = p.fireCd = p.beamT = 0;
    p.dashAir = true;
    p.maxHp = hard ? 3 : 5;
    p.hp = p.maxHp;
    p.meter = 0;
    for (const s of scarf) {
      s.x = s.px = p.x;
      s.y = s.py = p.y - 20;
    }
    b.x = 680;
    b.y = 560;
    b.hx = 680;
    b.hy = HOME_Y;
    practice = startPhase > 1;
    b.hp = practiceHp(startPhase);
    b.phase = startPhase;
    b.act = "intro";
    b.last = "";
    b.t = b.step = b.flash = b.eye = b.rest = 0;
    b.cd = 0;
    b.dropping = false;
    hits = 0;
    runMs = 0;
    // A phase-2 practice run gets its drones a couple of seconds after the intro, as the roar would have spawned them.
    droneT = startPhase === 2 ? 12 : 0;
    shotsFired = shotsHit = dashes = beams = 0;
    hitsByPhase.fill(0);
    eb.length = pb.length = sparks.length = drones.length = frags.length = 0;
    spikes.length = waves.length = lasers.length = marks.length = ghosts.length = 0;
    slow = 1;
    wonT = 0;
    flashT = 0;
    shake = 0;
    hitStop = 0;
    jumpPress = dashPress = beamPress = false;
  }

  // ---------- boss ----------

  const POOLS: Record<1 | 2 | 3, Act[]> = {
    1: ["bolts", "spikes", "bolts", "spikes"],
    2: ["slam", "ring", "bolts", "slam", "ring"],
    3: ["laser", "debris", "spiral", "slam", "laser", "ring"],
  };

  function nextAct() {
    const pool = POOLS[b.phase].filter((a) => a !== b.last);
    const a = pool[Math.floor(rand() * pool.length)]!;
    b.act = a;
    b.last = a;
    b.t = 0;
    b.step = 0;
  }

  function endAct() {
    b.act = "idle";
    b.cd = (b.phase === 1 ? 1.1 : b.phase === 2 ? 0.9 : 0.7) * cdMul();
    b.eye = 0;
    // Drift to the side away from the player now and then so the fight moves around.
    if (rand() < 0.45 || Math.abs(b.hx - p.x) < 160) b.hx = p.x < W / 2 ? 680 : 120;
    b.hy = HOME_Y;
  }

  function eyePos() {
    return { x: b.x, y: b.y - 28 };
  }

  function aimAtPlayer(fx: number, fy: number) {
    return Math.atan2(p.y - 14 - fy, p.x - fx);
  }

  function spawnDrones() {
    drones.length = 0;
    for (const [ax, ay] of [
      [250, 110],
      [550, 120],
    ] as const) {
      drones.push({ ax, ay, x: b.x, y: b.y, hp: 25, t: rand() * 6, cd: 1.2 + rand(), flash: 0 });
    }
    droneT = 0;
  }

  function bossUpdate(dt: number) {
    b.t += dt;
    b.flash = Math.max(0, b.flash - dt);
    b.spin += dt * (0.6 + b.phase * 0.35);
    const bob = Math.sin(time * 1.7) * 9;
    const glide = (k: number) => {
      b.x += (b.hx - b.x) * Math.min(1, k * dt);
      b.y += (b.hy + bob - b.y) * Math.min(1, k * dt);
    };

    switch (b.act) {
      case "intro": {
        b.hx = 680;
        b.hy = HOME_Y;
        glide(1.8);
        if (b.t > 1.8) {
          b.act = "idle";
          b.cd = 0.6;
        }
        break;
      }
      case "idle": {
        glide(2.4);
        b.cd -= dt;
        if (b.cd <= 0) nextAct();
        break;
      }
      case "roar": {
        glide(2);
        if (b.t < 1.2) shake = Math.max(shake, 3);
        if (b.t > 1.25) {
          b.phase = phaseFor(b.hp, BOSS_HP);
          if (b.phase === 2) spawnDrones();
          endAct();
          b.cd = 0.5;
        }
        break;
      }
      case "bolts": {
        glide(2.4);
        b.eye = Math.min(1, b.t / 0.5);
        const volleys = b.phase === 3 ? 4 : 3;
        while (b.step < volleys && b.t >= 0.5 + b.step * 0.25) {
          const e = eyePos();
          const a = aimAtPlayer(e.x, e.y);
          const spread = (18 * Math.PI) / 180;
          for (const k of [-1, 0, 1]) fireEB(e.x, e.y, a + k * spread, 230 * bs());
          tone(520, 0.08, "square", 0.05, 260);
          b.step++;
        }
        if (b.t > 0.5 + volleys * 0.25 + 0.2) endAct();
        break;
      }
      case "spikes": {
        glide(2.4);
        if (b.step === 0) {
          const start = b.x < W / 2 ? 30 : W - 30;
          const towards = start < W / 2 ? 1 : -1;
          for (let i = 0; i < 9; i++) {
            const x = start + towards * (40 + i * 88);
            if (x < 10 || x > W - 10) continue;
            spikes.push({ x, warn: 0.55 + i * 0.12 * (hard ? 0.85 : 1), up: 0.25 });
          }
          b.eye = 1;
          tone(140, 0.4, "sawtooth", 0.06, 90);
          b.step = 1;
        }
        if (b.t > 0.6) endAct();
        break;
      }
      case "slam": {
        if (b.step === 0) {
          // Rise and track the player.
          b.tx = Math.max(60, Math.min(W - 60, p.x));
          b.x += (b.tx - b.x) * Math.min(1, 7 * dt);
          b.y += (90 - b.y) * Math.min(1, 7 * dt);
          b.eye = Math.min(1, b.t / 0.6);
          if (b.t > 0.6) {
            b.step = 1;
            b.t = 0;
            tone(90, 0.35, "sawtooth", 0.08, 220);
          }
        } else if (b.step === 1) {
          b.x += (Math.random() - 0.5) * 2;
          if (b.t > 0.35) {
            b.step = 2;
            b.t = 0;
            b.dropping = true;
          }
        } else if (b.step === 2) {
          b.y += 1400 * dt;
          if (b.y + 90 >= FLOOR) {
            b.y = FLOOR - 90;
            b.dropping = false;
            b.step = 3;
            b.t = 0;
            b.rest = 0.6;
            shake = Math.max(shake, 12);
            noise(0.45, 0.5, 220, 0.6);
            tone(60, 0.4, "sine", 0.3, 30);
            buzz(40);
            spark(b.x, FLOOR, 22, "#c9c2b8", 260, 3, 600);
            const sp = 360 * bs();
            waves.push({ x: b.x - 36, dir: -sp, life: 3 }, { x: b.x + 36, dir: sp, life: 3 });
          }
        } else {
          b.rest -= dt;
          b.eye = 0.2;
          if (b.rest <= 0) {
            b.hx = b.x < W / 2 ? 120 : 680;
            if (Math.abs(b.hx - p.x) < 140) b.hx = b.hx === 120 ? 680 : 120;
            endAct();
          }
        }
        break;
      }
      case "ring": {
        glide(2.4);
        b.eye = Math.min(1, b.t / 0.3);
        while (b.step < 2 && b.t >= 0.3 + b.step * 0.5) {
          const n = hard ? 16 : 12;
          const off = b.step * (Math.PI / n) + rand() * 0.2;
          for (let i = 0; i < n; i++) fireEB(b.x, b.y, off + (i / n) * Math.PI * 2, 170 * bs(), 0, 8);
          tone(330, 0.15, "triangle", 0.08, 660);
          b.step++;
        }
        if (b.t > 1.2) endAct();
        break;
      }
      case "laser": {
        if (b.step === 0) {
          b.hx = p.x < W / 2 ? 720 : 80;
          b.hy = 200;
          const low = rand() < 0.5;
          const from = b.hx;
          lasers.push({ y: low ? 378 : 290, warn: 1.1, beam: 0.45, from });
          if (hard) lasers.push({ y: low ? 290 : 378, warn: 1.8, beam: 0.45, from });
          tone(880, 0.6, "sine", 0.05, 1320);
          b.step = 1;
        }
        glide(4);
        b.eye = 1;
        if (b.t > (hard ? 2.4 : 1.7)) endAct();
        break;
      }
      case "debris": {
        glide(2.4);
        if (b.step === 0) {
          const n = hard ? 9 : 7;
          marks.push({ x: Math.max(20, Math.min(W - 20, p.x)), warn: 0.6 });
          for (let i = 1; i < n; i++) marks.push({ x: 20 + rand() * (W - 40), warn: 0.6 + i * 0.09 });
          shake = Math.max(shake, 5);
          noise(0.6, 0.25, 160, 0.5);
          b.step = 1;
        }
        if (b.t > 1.2) endAct();
        break;
      }
      case "spiral": {
        b.hx = W / 2;
        b.hy = 150;
        glide(3);
        b.eye = 1;
        if (b.t > 0.4) {
          const k = Math.floor((b.t - 0.4) / 0.07);
          while (b.step <= k && b.t < 2.6) {
            const a = b.step * 0.37;
            fireEB(b.x, b.y, a, 160 * bs(), 0, 6);
            fireEB(b.x, b.y, a + Math.PI, 160 * bs(), 0, 6);
            if (b.step % 4 === 0) tone(660 + (b.step % 12) * 20, 0.04, "square", 0.025);
            b.step++;
          }
        }
        if (b.t > 2.8) {
          b.hx = p.x < W / 2 ? 680 : 120;
          endAct();
        }
        break;
      }
      case "dead":
        break;
    }

    // Phase change: roar, clear the screen, then come back meaner.
    if (b.act !== "roar" && b.act !== "dead" && b.act !== "intro" && phaseFor(b.hp, BOSS_HP) > b.phase && !b.dropping) {
      b.act = "roar";
      b.t = 0;
      b.eye = 1;
      b.rest = 0;
      for (const s of eb) spark(s.x, s.y, 2, PHASE_COL[b.phase - 1]!, 80, 2, 0);
      eb.length = 0;
      spikes.length = lasers.length = marks.length = 0;
      tone(110, 1.1, "sawtooth", 0.12, 40);
      noise(1, 0.3, 300, 0.5);
      buzz([30, 40, 30]);
      if (b.hy > HOME_Y) b.hy = HOME_Y;
    }

    // Drones (phase 2)
    if (b.phase === 2 && b.act !== "roar") {
      droneT += dt;
      if (drones.length === 0 && droneT > 14) spawnDrones();
    }
    for (let i = drones.length - 1; i >= 0; i--) {
      const d = drones[i]!;
      d.t += dt;
      d.flash = Math.max(0, d.flash - dt);
      const tx = d.ax + Math.cos(d.t * 0.9) * 70;
      const ty = d.ay + Math.sin(d.t * 1.7) * 22;
      d.x += (tx - d.x) * Math.min(1, 3 * dt);
      d.y += (ty - d.y) * Math.min(1, 3 * dt);
      if (b.act === "roar") continue;
      d.cd -= dt;
      if (d.cd <= 0) {
        d.cd = hard ? 1.3 : 1.6;
        fireEB(d.x, d.y, aimAtPlayer(d.x, d.y), 250 * bs(), 2, 6);
        tone(1200, 0.05, "square", 0.03, 700);
      }
      if (b.phase === 3) {
        d.hp = 0;
      }
      if (d.hp <= 0) {
        spark(d.x, d.y, 18, "#ffb347", 220, 3, 200);
        noise(0.25, 0.3, 900);
        removeAt(drones, i);
      }
    }
  }

  function damageBoss(n: number, x: number, y: number) {
    if (b.act === "roar" || b.act === "intro" || b.act === "dead") {
      spark(x, y, 1, "#9aa3b5", 120, 2, 0);
      return;
    }
    const mult = b.act === "slam" && b.step === 3 ? 1.5 : 1;
    b.hp -= n * mult;
    b.flash = 0.05;
    p.meter = Math.min(1, p.meter + 0.012 * n);
    hitTick -= 1;
    if (hitTick <= 0) {
      hitTick = 3;
      tone(1500 + Math.random() * 200, 0.025, "square", 0.025);
    }
    if (b.hp <= 0) bossDie();
  }

  function bossDie() {
    b.hp = 0;
    b.act = "dead";
    state = "won";
    wonT = 0;
    slow = 0.3;
    flashT = 0.25;
    shake = 16;
    shell.setRunning(false);
    for (const s of eb) spark(s.x, s.y, 1, "#fff", 60, 2, 0);
    eb.length = 0;
    spikes.length = waves.length = lasers.length = marks.length = drones.length = 0;
    // Shatter the obelisk into tumbling chunks.
    for (let i = 0; i < 34; i++) {
      const fx = b.x + (Math.random() - 0.5) * 60;
      const fy = b.y + (Math.random() - 0.5) * 170;
      const pts: number[] = [];
      const n = 3 + Math.floor(Math.random() * 3);
      const rad = 6 + Math.random() * 12;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + Math.random() * 0.5;
        pts.push(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      const a = Math.atan2(fy - b.y, fx - b.x);
      const v = 120 + Math.random() * 380;
      frags.push({ x: fx, y: fy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, rot: 0, vr: (Math.random() - 0.5) * 10, pts });
    }
    spark(b.x, b.y, 50, PHASE_COL[2]!, 420, 3, 200);
    noise(1.2, 0.6, 180, 0.5);
    tone(80, 1.4, "sawtooth", 0.25, 25);
    buzz([60, 40, 120]);
  }

  // ---------- player ----------

  function hurt() {
    if (p.inv > 0 || p.dashT > 0 || p.beamT > 0 || state !== "run") return;
    p.hp--;
    hits++;
    hitsByPhase[b.phase - 1]!++;
    p.inv = 1.2;
    hitStop = 0.09;
    shake = Math.max(shake, 9);
    buzz(70);
    noise(0.25, 0.4, 500);
    tone(200, 0.25, "sawtooth", 0.14, 60);
    spark(p.x, p.y - 14, 14, "#ff8a65", 200, 2.5, 400);
    if (p.hp <= 0) lose();
  }

  // Nearest live target: the boss, or a drone that is clearly closer.
  function target(): [number, number] {
    let tx = b.x;
    let ty = b.y;
    let bd = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
    for (const d of drones) {
      const dd = (d.x - p.x) ** 2 + (d.y - p.y) ** 2;
      if (dd < bd * 0.6) {
        bd = dd;
        tx = d.x;
        ty = d.y;
      }
    }
    return [tx, ty];
  }

  function aimAt(dx: number, dy: number) {
    const l = Math.hypot(dx, dy) || 1;
    p.ax = dx / l;
    p.ay = dy / l;
    if (Math.abs(dx) > 4) p.face = dx > 0 ? 1 : -1;
  }

  function aim() {
    if (touchAim && !mouseHeld) {
      const [tx, ty] = target();
      aimAt(tx - p.x, ty - (p.y - 14));
      return;
    }
    if (mouseHeld) {
      aimAt(mouseX - p.x, mouseY - (p.y - 14));
      return;
    }
    const hx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const vy = keys.up ? -1 : keys.down && !p.ground ? 1 : 0;
    if (vy === 0) {
      // Straight shots bend toward a target ahead within ~40 degrees, so the floating boss is hittable from the floor.
      const [tx, ty] = target();
      const dx = tx - p.x;
      const dy = ty - (p.y - 14);
      if (dx * p.face > 0 && Math.abs(dy) < Math.abs(dx) * 0.84) {
        const l = Math.hypot(dx, dy) || 1;
        p.ax = dx / l;
        p.ay = dy / l;
      } else {
        p.ax = p.face;
        p.ay = 0;
      }
    } else if (hx === 0) {
      p.ax = 0;
      p.ay = vy;
    } else {
      p.ax = hx * Math.SQRT1_2;
      p.ay = vy * Math.SQRT1_2;
    }
  }

  function playerUpdate(dt: number) {
    const move = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    p.inv = Math.max(0, p.inv - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.dropT = Math.max(0, p.dropT - dt);
    p.buffer = Math.max(0, p.buffer - dt);
    if (jumpPress) p.buffer = 0.1;
    if (p.ground) {
      p.coyote = 0.08;
      p.dashAir = true;
    } else p.coyote = Math.max(0, p.coyote - dt);

    if (dashPress && p.dashCd <= 0 && p.beamT <= 0 && (p.ground || p.dashAir)) {
      p.dashT = 0.16;
      p.dashCd = 0.45;
      dashes++;
      p.dashDir = move || p.face;
      p.face = p.dashDir;
      if (!p.ground) p.dashAir = false;
      noise(0.12, 0.18, 2400, 1.2);
    }

    if (p.beamT > 0) {
      p.beamT -= dt;
      p.vx = 0;
      p.vy = 0;
      beamHit(dt);
    } else if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashDir * 560;
      p.vy = 0;
      if (Math.random() < 0.6) ghosts.push({ x: p.x, y: p.y, face: p.face, life: 0.18 });
    } else {
      p.vx = move * 230;
      if (move && (mouseHeld || !touchAim)) p.face = move;
      const rising = p.vy < 0;
      p.vy += 1500 * dt * (rising && !keys.jump ? 2.4 : 1);
      if (p.vy > 900) p.vy = 900;
    }

    if (p.buffer > 0 && p.coyote > 0 && p.beamT <= 0) {
      const onPlat = p.ground && p.y < FLOOR - 1;
      if (keys.down && onPlat) {
        p.dropT = 0.22;
        p.ground = false;
      } else {
        p.vy = -560;
        p.dashT = 0;
        tone(300, 0.08, "triangle", 0.06, 520);
      }
      p.buffer = 0;
      p.coyote = 0;
      p.ground = false;
    }

    if (beamPress && p.meter >= 1 && p.beamT <= 0) {
      p.meter = 0;
      p.beamT = 1.1;
      beams++;
      aim();
      // The beam locks to the aim direction when fired.
      p.beamDx = p.ax;
      p.beamDy = p.ay;
      if (Math.abs(p.ax) > 0.1) p.face = p.ax > 0 ? 1 : -1;
      p.dashT = 0;
      shake = Math.max(shake, 6);
      tone(140, 1.1, "sawtooth", 0.12, 420);
      noise(1.1, 0.25, 1600, 0.4);
      buzz(50);
    }

    const ny = p.y + p.vy * dt;
    let landed = false;
    if (p.vy >= 0) {
      if (ny >= FLOOR) {
        p.y = FLOOR;
        landed = true;
      } else if (p.dropT <= 0) {
        for (const pl of PLATS) {
          if (p.y <= pl.y + 0.5 && ny >= pl.y && p.x > pl.x0 - 6 && p.x < pl.x1 + 6) {
            p.y = pl.y;
            landed = true;
            break;
          }
        }
      }
    }
    if (landed) {
      if (!p.ground && p.vy > 300) spark(p.x, p.y, 4, "#9aa3b5", 80, 2, 200);
      p.vy = 0;
      p.ground = true;
    } else {
      p.y = ny;
      p.ground = false;
    }
    p.x = Math.max(12, Math.min(W - 12, p.x + p.vx * dt));
    p.run += Math.abs(p.vx) * dt;

    // Shooting
    p.fireCd -= dt;
    const shooting = (touchAim && autoFire) || keys.shoot || mouseHeld;
    if (shooting && p.fireCd <= 0 && p.beamT <= 0 && p.dashT <= 0) {
      aim();
      p.fireCd = 0.115;
      const j = (Math.random() - 0.5) * 0.05;
      const c = Math.cos(j);
      const s = Math.sin(j);
      const dx = p.ax * c - p.ay * s;
      const dy = p.ax * s + p.ay * c;
      const gx = p.x + p.ax * 14;
      const gy = p.y - 14 + p.ay * 12;
      if (pb.length < 48) {
        pb.push({ x: gx, y: gy, vx: dx * 700, vy: dy * 700, life: 1.3 });
        shotsFired++;
      }
      if (Math.random() < 0.5) noise(0.03, 0.05, 3200, 1);
    } else if (!shooting || p.dashT > 0) aim();

    // Scarf: verlet chain from the neck, blown back from the way you move.
    const nx = p.x - p.face * 3;
    const nyk = p.y - 21;
    scarf[0]!.x = nx;
    scarf[0]!.y = nyk;
    for (let i = 1; i < scarf.length; i++) {
      const s = scarf[i]!;
      const vx = (s.x - s.px) * 0.9;
      const vy = (s.y - s.py) * 0.9;
      s.px = s.x;
      s.py = s.y;
      s.x += vx - p.face * 18 * dt - p.vx * 0.002;
      s.y += vy + 40 * dt * dt * 60 + Math.sin(time * 9 + i) * 0.25;
    }
    for (let k = 0; k < 2; k++) {
      for (let i = 1; i < scarf.length; i++) {
        const a = scarf[i - 1]!;
        const s = scarf[i]!;
        const dx = s.x - a.x;
        const dy = s.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const diff = (d - 4.5) / d;
        s.x -= dx * diff;
        s.y -= dy * diff;
      }
    }
  }

  function beamHit(dt: number) {
    const gx = p.x;
    const gy = p.y - 14;
    const half = 20;
    const dps = 50;
    const ux = p.beamDx;
    const uy = p.beamDy;
    // Distance from a point to the beam's ray, or Infinity if it is behind the gun.
    const off = (x: number, y: number) => {
      const t = (x - gx) * ux + (y - gy) * uy;
      return t < -10 ? Infinity : Math.abs((x - gx) * uy - (y - gy) * ux);
    };
    // The obelisk counts as a short vertical segment: test its nearest point to the beam line.
    let best = Infinity;
    let hy = b.y;
    for (let y = b.y - 80; y <= b.y + 80; y += 20) {
      const d = off(b.x, y);
      if (d < best) {
        best = d;
        hy = y;
      }
    }
    if (best < half + 26) damageBoss(dps * dt, b.x - ux * 24, hy);
    for (const d of drones) if (off(d.x, d.y) < half + 14) d.hp -= 40 * dt;
    for (let i = eb.length - 1; i >= 0; i--) {
      const s = eb[i]!;
      if (off(s.x, s.y) < half + s.r) removeAt(eb, i);
    }
    if (Math.random() < 0.5) spark(gx + ux * 20, gy + uy * 20, 1, "#ffd0b8", 120, 2, 0);
  }

  function hitsPlayerRect(x0: number, y0: number, x1: number, y1: number) {
    return p.x + 6 > x0 && p.x - 6 < x1 && p.y > y0 && p.y - 24 < y1;
  }

  function worldUpdate(dt: number) {
    // Player shots
    for (let i = pb.length - 1; i >= 0; i--) {
      const s = pb[i]!;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      let dead = s.life <= 0 || s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20;
      if (!dead && b.act !== "dead") {
        const wTop = (s.y - (b.y - 90)) / 180;
        const halfW = 22 + 14 * Math.max(0, Math.min(1, wTop));
        if (s.y > b.y - 90 && s.y < b.y + 90 && Math.abs(s.x - b.x) < halfW) {
          damageBoss(1, s.x, s.y);
          spark(s.x, s.y, 2, "#ffd0b8", 140, 2, 0);
          shotsHit++;
          dead = true;
        }
      }
      if (!dead) {
        for (const d of drones) {
          if ((s.x - d.x) ** 2 + (s.y - d.y) ** 2 < 16 * 16) {
            d.hp--;
            d.flash = 0.05;
            shotsHit++;
            p.meter = Math.min(1, p.meter + 0.008);
            spark(s.x, s.y, 2, "#ffd0b8", 140, 2, 0);
            dead = true;
            break;
          }
        }
      }
      if (dead) removeAt(pb, i);
    }

    // Enemy shots
    for (let i = eb.length - 1; i >= 0; i--) {
      const s = eb[i]!;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.kind === 1 && s.y > FLOOR - s.r) {
        spark(s.x, FLOOR - 2, 6, "#8f8678", 160, 2.5, 500);
        removeAt(eb, i);
        continue;
      }
      if (s.x < -40 || s.x > W + 40 || s.y < -60 || s.y > H + 40) {
        removeAt(eb, i);
        continue;
      }
      const cx = Math.max(p.x - 5, Math.min(p.x + 5, s.x));
      const cy = Math.max(p.y - 22, Math.min(p.y - 2, s.y));
      if ((s.x - cx) ** 2 + (s.y - cy) ** 2 < s.r * s.r && p.inv <= 0 && p.dashT <= 0 && p.beamT <= 0) {
        removeAt(eb, i);
        hurt();
        if (state !== "run") return;
      }
    }

    // Spikes
    for (let i = spikes.length - 1; i >= 0; i--) {
      const s = spikes[i]!;
      if (s.warn > 0) {
        s.warn -= dt;
        if (s.warn <= 0) noise(0.08, 0.12, 700, 1);
      } else {
        s.up -= dt;
        if (hitsPlayerRect(s.x - 13, FLOOR - 66, s.x + 13, FLOOR)) hurt();
        if (s.up <= 0) removeAt(spikes, i);
      }
    }
    // Shockwaves
    for (let i = waves.length - 1; i >= 0; i--) {
      const wv = waves[i]!;
      wv.x += wv.dir * dt;
      wv.life -= dt;
      if (hitsPlayerRect(wv.x - 12, FLOOR - 24, wv.x + 12, FLOOR)) hurt();
      if (wv.life <= 0 || wv.x < -30 || wv.x > W + 30) removeAt(waves, i);
    }
    // Lasers
    for (let i = lasers.length - 1; i >= 0; i--) {
      const l = lasers[i]!;
      if (l.warn > 0) {
        l.warn -= dt;
        if (l.warn <= 0) {
          shake = Math.max(shake, 6);
          tone(90, 0.45, "sawtooth", 0.14, 70);
          noise(0.45, 0.3, 900, 0.4);
        }
      } else {
        l.beam -= dt;
        if (hitsPlayerRect(0, l.y - 11, W, l.y + 11)) hurt();
        if (l.beam <= 0) removeAt(lasers, i);
      }
    }
    // Debris markers
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i]!;
      m.warn -= dt;
      if (m.warn <= 0) {
        if (eb.length < MAX_EB) eb.push({ x: m.x, y: -24, vx: 0, vy: 700 * bs(), r: 11, kind: 1 });
        removeAt(marks, i);
      }
    }
    // Boss body contact
    if (b.act !== "dead" && b.act !== "intro" && hitsPlayerRect(b.x - 26, b.y - 80, b.x + 26, b.y + 82)) hurt();
  }

  function fxUpdate(dt: number) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]!;
      s.life -= dt;
      if (s.life <= 0) {
        removeAt(sparks, i);
        continue;
      }
      s.vy += s.grav * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    for (let i = ghosts.length - 1; i >= 0; i--) {
      ghosts[i]!.life -= dt;
      if (ghosts[i]!.life <= 0) removeAt(ghosts, i);
    }
    for (const f of frags) {
      f.vy += 700 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      if (f.y > FLOOR - 4 && f.vy > 0) {
        f.y = FLOOR - 4;
        f.vy *= -0.3;
        f.vx *= 0.6;
        f.vr *= 0.5;
      }
    }
  }

  // ---------- frame ----------

  function frame(ctx: CanvasRenderingContext2D, info: { dt: number }) {
    ctxRef = ctx;
    const real = Math.min(info.dt / 1000, 0.05);
    time += real;
    shake = Math.max(0, shake - real * 30);
    flashT = Math.max(0, flashT - real);

    if (state === "run" || state === "won") {
      if (hitStop > 0) hitStop -= real;
      else {
        const dt = real * slow;
        if (state === "run") {
          runMs += real * 1000;
          playerUpdate(dt);
          if (state === "run") bossUpdate(dt);
          if (state === "run") worldUpdate(dt);
        } else {
          wonT += real;
          slow = Math.min(1, 0.3 + wonT * 0.4);
          playerUpdate(dt);
          if (wonT > 2.2 && wonT - real <= 2.2) finishWin();
        }
        fxUpdate(dt);
      }
      jumpPress = dashPress = beamPress = false;
    } else if (state === "menu") {
      // Idle attract: the monolith hovers in the background.
      b.y += (HOME_Y + Math.sin(time * 1.7) * 9 - b.y) * Math.min(1, real * 2);
      b.spin += real;
      fxUpdate(real);
    }
    draw(ctx);
  }

  function draw(ctx: CanvasRenderingContext2D) {
    if (bg) ctx.drawImage(bg, 0, 0, w, h);
    else {
      ctx.fillStyle = "#0b0a14";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.save();
    if (shake > 0 && !reduced()) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.translate(ox, oy);
    ctx.scale(sc, sc);

    drawGround(ctx);
    drawHazardsBack(ctx);
    if (b.act !== "dead") drawBoss(ctx);
    drawDrones(ctx);
    drawPlayer(ctx);
    drawShots(ctx);
    drawHazardsFront(ctx);
    drawFx(ctx);
    ctx.restore();

    if (flashT > 0 && !reduced()) {
      ctx.fillStyle = `rgba(255,255,255,${(flashT / 0.25) * 0.7})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (p.inv > 0.9 && state === "run") {
      ctx.fillStyle = `rgba(255,40,60,${(p.inv - 0.9) * 0.6})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (state !== "menu") drawHud(ctx);
    if (b.act === "intro" && state === "run") drawTitleCard(ctx, b.t);
  }

  function drawGround(ctx: CanvasRenderingContext2D) {
    const left = -ox / sc;
    const right = (w - ox) / sc;
    const bottom = (h - oy) / sc;
    ctx.fillStyle = "#16131f";
    ctx.fillRect(left, FLOOR, right - left, bottom - FLOOR);
    ctx.fillStyle = "#2a2436";
    ctx.fillRect(left, FLOOR, right - left, 3);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(left / 64) * 64; x < right; x += 64) {
      ctx.moveTo(x, FLOOR + 3);
      ctx.lineTo(x - 18, bottom);
    }
    ctx.stroke();
    for (const pl of PLATS) {
      ctx.fillStyle = "#231e2e";
      ctx.fillRect(pl.x0, pl.y, pl.x1 - pl.x0, 14);
      ctx.fillStyle = "#3a3348";
      ctx.fillRect(pl.x0, pl.y, pl.x1 - pl.x0, 3);
      ctx.fillStyle = PHASE_COL[b.phase - 1]!;
      ctx.globalAlpha = 0.35 + Math.sin(time * 2) * 0.1;
      ctx.fillRect(pl.x0 + 8, pl.y + 7, pl.x1 - pl.x0 - 16, 2);
      ctx.globalAlpha = 1;
      // Hanging chains
      ctx.strokeStyle = "#2a2436";
      ctx.beginPath();
      ctx.moveTo(pl.x0 + 14, pl.y + 14);
      ctx.lineTo(pl.x0 + 22, pl.y + 34);
      ctx.moveTo(pl.x1 - 14, pl.y + 14);
      ctx.lineTo(pl.x1 - 24, pl.y + 30);
      ctx.stroke();
    }
  }

  function drawHazardsBack(ctx: CanvasRenderingContext2D) {
    // Laser telegraphs
    for (const l of lasers) {
      if (l.warn > 0) {
        const a = 0.25 + 0.25 * Math.sin(time * 30);
        ctx.fillStyle = `rgba(255,77,94,${a})`;
        ctx.fillRect(0, l.y - 1.5, W, 3);
        ctx.fillStyle = "rgba(255,77,94,0.08)";
        ctx.fillRect(0, l.y - 11, W, 22);
      }
    }
    // Debris columns
    for (const m of marks) {
      const a = 0.12 + 0.12 * Math.sin(time * 26);
      ctx.fillStyle = `rgba(255,179,71,${a})`;
      ctx.fillRect(m.x - 11, 0, 22, FLOOR);
      ctx.fillStyle = "rgba(255,179,71,0.6)";
      ctx.fillRect(m.x - 12, FLOOR - 3, 24, 3);
    }
    // Spike warnings
    for (const s of spikes) {
      if (s.warn > 0) {
        const a = 0.35 + 0.35 * Math.sin(time * 28);
        ctx.fillStyle = `rgba(94,231,255,${a})`;
        ctx.fillRect(s.x - 13, FLOOR - 3, 26, 3);
        ctx.fillStyle = "rgba(94,231,255,0.25)";
        for (let k = -1; k <= 1; k++) ctx.fillRect(s.x + k * 8 - 1, FLOOR - 8 - Math.random() * 4, 2, 4);
      }
    }
    // Slam shadow
    if (b.act === "slam" && b.step < 3) {
      const k = Math.max(0, Math.min(1, 1 - (FLOOR - (b.y + 90)) / 300));
      ctx.fillStyle = `rgba(255,77,94,${0.15 + k * 0.35})`;
      ctx.beginPath();
      ctx.ellipse(b.x, FLOOR, 40 + k * 10, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.act !== "dead") {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(b.x, FLOOR + 1, 34 - Math.min(20, (FLOOR - b.y) / 20), 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHazardsFront(ctx: CanvasRenderingContext2D) {
    for (const s of spikes) {
      if (s.warn > 0) continue;
      const k = Math.min(1, (0.25 - s.up) / 0.05 + 0.2);
      const ht = 66 * Math.min(1, k);
      ctx.fillStyle = "#cfe9f2";
      ctx.beginPath();
      ctx.moveTo(s.x - 13, FLOOR);
      ctx.lineTo(s.x - 4, FLOOR - ht * 0.6);
      ctx.lineTo(s.x, FLOOR - ht);
      ctx.lineTo(s.x + 5, FLOOR - ht * 0.55);
      ctx.lineTo(s.x + 13, FLOOR);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(94,231,255,0.55)";
      ctx.fillRect(s.x - 1, FLOOR - ht, 2, ht);
    }
    for (const wv of waves) {
      ctx.fillStyle = "rgba(255,179,71,0.9)";
      ctx.beginPath();
      const d = Math.sign(wv.dir);
      ctx.moveTo(wv.x - 14 * d, FLOOR);
      ctx.quadraticCurveTo(wv.x - 4 * d, FLOOR - 30, wv.x + 12 * d, FLOOR);
      ctx.fill();
      ctx.fillStyle = "rgba(255,240,200,0.9)";
      ctx.fillRect(wv.x - 2, FLOOR - 20, 4, 20);
    }
    for (const l of lasers) {
      if (l.warn > 0) continue;
      const k = Math.min(1, l.beam / 0.1);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255,77,94,${0.35 * k})`;
      ctx.fillRect(0, l.y - 14, W, 28);
      ctx.fillStyle = `rgba(255,200,200,${0.9 * k})`;
      ctx.fillRect(0, l.y - 5, W, 10);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(l.from, l.y, 12 + Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBoss(ctx: CanvasRenderingContext2D) {
    const col = PHASE_COL[b.phase - 1]!;
    const x = b.x;
    const y = b.y;
    ctx.save();
    ctx.translate(x, y);
    // Orbiting shards
    for (let i = 0; i < 4 + b.phase; i++) {
      const a = b.spin + (i / (4 + b.phase)) * Math.PI * 2;
      const r = 62 + Math.sin(a * 2 + time) * 6;
      const sx = Math.cos(a) * r;
      const sy = Math.sin(a) * r * 0.55 + 10;
      ctx.fillStyle = Math.sin(a) > 0 ? "#3b3546" : "#2a2533";
      ctx.beginPath();
      ctx.moveTo(sx, sy - 7);
      ctx.lineTo(sx + 5, sy);
      ctx.lineTo(sx, sy + 7);
      ctx.lineTo(sx - 4, sy);
      ctx.fill();
    }
    // Glow behind
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(0, -20, 10, 0, -20, 120);
    glow.addColorStop(0, col + "44");
    glow.addColorStop(1, col + "00");
    ctx.fillStyle = glow;
    ctx.fillRect(-120, -140, 240, 240);
    ctx.globalCompositeOperation = "source-over";
    // Obelisk body
    ctx.beginPath();
    ctx.moveTo(-22, -90);
    ctx.lineTo(0, -108);
    ctx.lineTo(22, -90);
    ctx.lineTo(36, 88);
    ctx.lineTo(-36, 88);
    ctx.closePath();
    const g = ctx.createLinearGradient(-36, 0, 36, 0);
    g.addColorStop(0, "#2b2733");
    g.addColorStop(0.45, "#4a4456");
    g.addColorStop(0.55, "#3b3646");
    g.addColorStop(1, "#1d1a24");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Cracks by phase
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (b.phase >= 2) {
      ctx.moveTo(-14, -70);
      ctx.lineTo(-6, -48);
      ctx.lineTo(-18, -26);
      ctx.lineTo(-10, -4);
      ctx.moveTo(18, 30);
      ctx.lineTo(10, 52);
      ctx.lineTo(22, 74);
    }
    if (b.phase >= 3) {
      ctx.moveTo(8, -84);
      ctx.lineTo(14, -60);
      ctx.lineTo(4, -40);
      ctx.moveTo(-24, 40);
      ctx.lineTo(-10, 58);
      ctx.lineTo(-20, 80);
      ctx.moveTo(0, 10);
      ctx.lineTo(-6, 34);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Runes
    ctx.fillStyle = col;
    const pulse = 0.55 + 0.45 * Math.sin(time * 3);
    ctx.globalAlpha = pulse;
    for (let i = 0; i < 4; i++) {
      const ry = 16 + i * 18;
      const rw = 8 + (i % 2) * 4;
      ctx.fillRect(-rw / 2, ry, rw, 2);
      ctx.fillRect(-1, ry - 4, 2, 8);
    }
    ctx.globalAlpha = 1;
    // Eye core
    const ex = 0;
    const ey = -28;
    ctx.fillStyle = "#0b0a12";
    ctx.beginPath();
    ctx.ellipse(ex, ey, 13, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    const look = Math.atan2(p.y - 14 - (y + ey), p.x - x);
    const er = 4 + b.eye * 4;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.35 + b.eye * 0.4;
    ctx.beginPath();
    ctx.arc(ex + Math.cos(look) * 4, ey + Math.sin(look) * 2, er * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex + Math.cos(look) * 5, ey + Math.sin(look) * 3, er * 0.6 + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // Hit flash
    if (b.flash > 0 || (b.act === "roar" && Math.sin(time * 40) > 0)) {
      ctx.globalAlpha = b.act === "roar" ? 0.25 : 0.45;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(-22, -90);
      ctx.lineTo(0, -108);
      ctx.lineTo(22, -90);
      ctx.lineTo(36, 88);
      ctx.lineTo(-36, 88);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Resting after a slam: dazed sparks
    if (b.act === "slam" && b.step === 3) {
      ctx.fillStyle = "#ffe08a";
      for (let i = 0; i < 3; i++) {
        const a = time * 5 + (i * Math.PI * 2) / 3;
        ctx.fillRect(Math.cos(a) * 26 - 2, -118 + Math.sin(a) * 6, 4, 4);
      }
    }
    ctx.restore();
  }

  function drawDrones(ctx: CanvasRenderingContext2D) {
    for (const d of drones) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(time * 2);
      ctx.fillStyle = d.flash > 0 ? "#fff" : "#3b3546";
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(12, 0);
      ctx.lineTo(0, 14);
      ctx.lineTo(-12, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#ffb347";
      ctx.beginPath();
      ctx.arc(d.x, d.y, 4 + (d.cd < 0.3 ? 2 : 0), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPlayer(ctx: CanvasRenderingContext2D) {
    for (const gh of ghosts) {
      ctx.globalAlpha = gh.life * 2.2;
      ctx.fillStyle = "#ff8a65";
      ctx.fillRect(gh.x - 7, gh.y - 26, 14, 26);
    }
    ctx.globalAlpha = 1;
    if (state === "over") return;
    if (p.inv > 0 && Math.floor(time * 20) % 2 === 0) return;
    const x = p.x;
    const y = p.y;
    const f = p.face;
    // Scarf
    ctx.strokeStyle = "#ff8a65";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(scarf[0]!.x, scarf[0]!.y);
    for (let i = 1; i < scarf.length; i++) ctx.lineTo(scarf[i]!.x, scarf[i]!.y);
    ctx.stroke();
    // Legs
    const moving = Math.abs(p.vx) > 10 && p.ground;
    const ph = p.run * 0.08;
    const l1 = moving ? Math.sin(ph) * 5 : p.ground ? 2 : -3;
    const l2 = moving ? -Math.sin(ph) * 5 : p.ground ? -2 : 3;
    ctx.strokeStyle = "#1a1722";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 2, y - 9);
    ctx.lineTo(x - 2 + l1, y - (p.ground ? 0 : 3));
    ctx.moveTo(x + 2, y - 9);
    ctx.lineTo(x + 2 + l2, y - (p.ground ? 0 : 3));
    ctx.stroke();
    // Cloak
    ctx.fillStyle = "#2d2a3a";
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 22);
    ctx.lineTo(x + 5, y - 22);
    ctx.lineTo(x + 8 - f * 2, y - 8);
    ctx.lineTo(x - 8 - f * 2, y - 8);
    ctx.closePath();
    ctx.fill();
    // Gun arm
    const gx = x + p.ax * 13;
    const gy = y - 15 + p.ay * 10;
    ctx.strokeStyle = "#cfd2dc";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - 16);
    ctx.lineTo(gx, gy);
    ctx.stroke();
    // Hood
    ctx.fillStyle = "#3a3648";
    ctx.beginPath();
    ctx.arc(x, y - 26, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - f * 4, y - 31);
    ctx.lineTo(x - f * 10, y - 27);
    ctx.lineTo(x - f * 5, y - 24);
    ctx.fill();
    ctx.fillStyle = "#ff8a65";
    ctx.fillRect(x + f * 2 - 1, y - 27, 2.5, 2);
    ctx.fillRect(x + f * 4.5 - 1, y - 27, 2, 2);
    // Muzzle flash
    if (p.fireCd > 0.07 && p.beamT <= 0) {
      ctx.fillStyle = "#ffe0c0";
      ctx.beginPath();
      ctx.arc(gx + p.ax * 3, gy + p.ay * 3, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Beam
    if (p.beamT > 0) {
      const k = Math.min(1, p.beamT / 0.15) * (0.85 + Math.random() * 0.15);
      const bx = x;
      const by = y - 14;
      ctx.globalCompositeOperation = "lighter";
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.atan2(p.beamDy, p.beamDx));
      ctx.fillStyle = `rgba(255,138,101,${0.4 * k})`;
      ctx.fillRect(0, -20, 1200, 40);
      ctx.fillStyle = `rgba(255,236,220,${0.95 * k})`;
      ctx.fillRect(0, -7, 1200, 14);
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function drawShots(ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = "#ffd0b8";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const s of pb) {
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.014, s.y - s.vy * 0.014);
    }
    ctx.stroke();
    const col = PHASE_COL[b.phase - 1]!;
    // Enemy orbs: a coloured halo then a white core, batched per pass.
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (const s of eb) {
      if (s.kind === 1) continue;
      ctx.moveTo(s.x + s.r + 3, s.y);
      ctx.arc(s.x, s.y, s.r + 3, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    for (const s of eb) {
      if (s.kind === 1) continue;
      ctx.moveTo(s.x + s.r * 0.55, s.y);
      ctx.arc(s.x, s.y, s.r * 0.55, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = "#7d7466";
    for (const s of eb) {
      if (s.kind !== 1) continue;
      ctx.beginPath();
      ctx.moveTo(s.x - 11, s.y);
      ctx.lineTo(s.x - 4, s.y - 12);
      ctx.lineTo(s.x + 10, s.y - 6);
      ctx.lineTo(s.x + 8, s.y + 9);
      ctx.lineTo(s.x - 6, s.y + 11);
      ctx.fill();
    }
  }

  function drawFx(ctx: CanvasRenderingContext2D) {
    for (const s of sparks) {
      ctx.globalAlpha = Math.min(1, (s.life / s.max) * 1.5);
      ctx.fillStyle = s.col;
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#4a4456";
    for (const f of frags) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.beginPath();
      ctx.moveTo(f.pts[0]!, f.pts[1]!);
      for (let i = 2; i < f.pts.length; i += 2) ctx.lineTo(f.pts[i]!, f.pts[i + 1]!);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawHud(ctx: CanvasRenderingContext2D) {
    const m = Math.max(10, Math.min(w, h) * 0.03);
    const u = Math.max(0.8, Math.min(1.4, w / 900));
    ctx.font = `600 ${Math.round(12 * u)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = "top";
    // HP pips
    for (let i = 0; i < p.maxHp; i++) {
      ctx.fillStyle = i < p.hp ? "#ff8a65" : "rgba(255,255,255,0.15)";
      const px = m + i * 18 * u;
      ctx.beginPath();
      ctx.moveTo(px + 6 * u, m);
      ctx.lineTo(px + 12 * u, m + 6 * u);
      ctx.lineTo(px + 6 * u, m + 12 * u);
      ctx.lineTo(px, m + 6 * u);
      ctx.fill();
    }
    // Overcharge meter
    const mw = 110 * u;
    const my = m + 18 * u;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(m, my, mw, 6 * u);
    const full = p.meter >= 1;
    ctx.fillStyle = full ? (Math.sin(time * 12) > 0 ? "#fff" : "#ff8a65") : "#ff8a65";
    ctx.fillRect(m, my, mw * p.meter, 6 * u);
    if (full) {
      ctx.fillStyle = "#fff";
      ctx.fillText(touchAim ? "BEAM READY" : "BEAM READY  [E]", m, my + 10 * u);
    }
    // Boss bar
    const bw = Math.min(w * 0.42, 360 * u);
    const bx = (w - bw) / 2;
    const by = m + 2;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx - 2, by - 2, bw + 4, 10 * u + 4);
    ctx.fillStyle = PHASE_COL[b.phase - 1]!;
    ctx.fillRect(bx, by, bw * Math.max(0, b.hp / BOSS_HP), 10 * u);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(bx + bw / 3 - 1, by, 2, 10 * u);
    ctx.fillRect(bx + (bw * 2) / 3 - 1, by, 2, 10 * u);
    ctx.fillStyle = "#e9e6f0";
    ctx.textAlign = "center";
    ctx.fillText("THE MONOLITH", w / 2, by + 13 * u);
    // Timer
    ctx.textAlign = "right";
    ctx.fillText(formatTime(runMs), w - m, m);
    if (hard) {
      ctx.fillStyle = "#ff4d5e";
      ctx.fillText("HARD", w - m, m + 16 * u);
    }
    ctx.textAlign = "left";
  }

  function drawTitleCard(ctx: CanvasRenderingContext2D, t: number) {
    const a = t < 0.3 ? t / 0.3 : t > 1.5 ? Math.max(0, (1.8 - t) / 0.3) : 1;
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, h * 0.4, w, h * 0.2);
    ctx.fillStyle = "#f4f4f6";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fs = Math.round(Math.min(w / 14, 46));
    ctx.font = `800 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText("THE MONOLITH", w / 2, h * 0.48);
    ctx.font = `600 ${Math.round(fs * 0.32)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.fillStyle = "#ff8a65";
    ctx.fillText(hard ? "HARD · 3 HITS" : "BREAK IT", w / 2, h * 0.48 + fs * 0.75);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
  }

  function paintBg() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    bg ??= document.createElement("canvas");
    bg.width = Math.max(1, Math.round(w * dpr));
    bg.height = Math.max(1, Math.round(h * dpr));
    const g = bg.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#07060f");
    sky.addColorStop(0.55, "#191226");
    sky.addColorStop(0.8, "#3a1c2c");
    sky.addColorStop(1, "#120d18");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const r = rng(42);
    g.fillStyle = "#fff";
    for (let i = 0; i < 90; i++) {
      g.globalAlpha = 0.2 + r() * 0.6;
      const s = r() < 0.1 ? 2 : 1;
      g.fillRect(r() * w, r() * h * 0.6, s, s);
    }
    g.globalAlpha = 1;
    // Moon with a broken ring
    const mx = ox + 400 * sc;
    const my = oy + 120 * sc;
    const mr = 46 * sc;
    const mg = g.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 2.6);
    mg.addColorStop(0, "rgba(255,210,190,0.18)");
    mg.addColorStop(1, "rgba(255,210,190,0)");
    g.fillStyle = mg;
    g.fillRect(mx - mr * 3, my - mr * 3, mr * 6, mr * 6);
    g.fillStyle = "#e9d8cf";
    g.beginPath();
    g.arc(mx, my, mr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.beginPath();
    g.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.25, 0, Math.PI * 2);
    g.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.15, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(233,216,207,0.35)";
    g.lineWidth = 2 * sc;
    g.beginPath();
    g.ellipse(mx, my, mr * 2, mr * 0.45, -0.2, 0.3, Math.PI * 1.75);
    g.stroke();
    // Ruined pillars on the horizon
    const fl = oy + FLOOR * sc;
    for (let layer = 0; layer < 2; layer++) {
      g.fillStyle = layer === 0 ? "#1d1527" : "#140f1c";
      const n = 9 - layer * 3;
      for (let i = 0; i < n; i++) {
        const px = r() * w;
        const pw = (14 + r() * 22) * sc * (1 + layer * 0.5);
        const ph = (60 + r() * 140) * sc * (1 - layer * 0.25);
        g.fillRect(px, fl - ph, pw, ph);
        if (r() < 0.5) g.fillRect(px - pw * 0.3, fl - ph - 6 * sc, pw * 1.6, 6 * sc);
      }
    }
    // Mist line
    const mist = g.createLinearGradient(0, fl - 80 * sc, 0, fl);
    mist.addColorStop(0, "rgba(255,138,101,0)");
    mist.addColorStop(1, "rgba(255,138,101,0.1)");
    g.fillStyle = mist;
    g.fillRect(0, fl - 80 * sc, w, 80 * sc);
  }

  function resize(width: number, height: number) {
    w = width;
    h = height;
    sc = Math.min(w / W, h / H);
    ox = (w - W * sc) / 2;
    oy = (h - H * sc) / 2;
    paintBg();
    if (ctxRef) draw(ctxRef);
  }

  // ---------- flow ----------

  function paintStats(last?: { ms: number; grade: string } | null) {
    const mine = bests[mode()];
    if (elBest) elBest.textContent = mine.ms > 0 ? formatTime(mine.ms) : "–";
    if (elBestGrade) elBestGrade.textContent = mine.grade || "–";
    if (elReached) elReached.textContent = mine.phase === 0 ? "–" : mine.ms > 0 ? "Cleared" : `Phase ${mine.phase}`;
    if (last !== undefined) {
      if (elTime) elTime.textContent = last ? formatTime(last.ms) : "–";
      if (elGrade) elGrade.textContent = last ? last.grade : "–";
    }
    paintPhases();
  }

  /** Practice is unlocked one phase at a time: you can start at any phase you have reached on this difficulty. */
  function paintPhases(locked = state === "run" || state === "paused" || state === "won") {
    const reached = Math.max(1, bests[mode()].phase);
    if (startPhase > reached) startPhase = 1;
    for (const btn of phaseBtns) {
      const n = Number(btn.dataset.startPhase);
      btn.disabled = locked || n > reached;
      btn.setAttribute("aria-pressed", String(n === startPhase));
      btn.title = n > reached ? `Reach phase ${n} on ${hard ? "Hard" : "Normal"} to practise it` : "";
    }
  }

  function paintAutoFire() {
    if (!autoBtn) return;
    autoBtn.setAttribute("aria-pressed", String(autoFire));
    autoBtn.textContent = `Auto-fire: ${autoFire ? "on" : "off"}`;
  }

  function setModeLock(locked: boolean) {
    for (const btn of modeBtns) btn.disabled = locked;
    paintPhases(locked);
  }

  function save(run: { won: boolean; ms: number; grade: Grade | ""; phase: 1 | 2 | 3 }): boolean {
    if (practice) return false;
    const before = bests[mode()];
    bests[mode()] = recordMonolith(before, run);
    writeJSON(STORAGE_KEYS.monolithBests, bests);
    return run.won && bests[mode()].ms !== before.ms;
  }

  function statLine(): string {
    const acc = shotsFired > 0 ? Math.round((shotsHit / shotsFired) * 100) : 0;
    const by = hitsByPhase.slice(0, b.phase).join(" / ");
    return `Accuracy ${acc}% (${shotsHit}/${shotsFired}) · hits by phase ${by} · ${dashes} dash${dashes === 1 ? "" : "es"} · ${beams} beam${beams === 1 ? "" : "s"}`;
  }

  function start() {
    unlockAudio();
    reset();
    state = "run";
    shell.hide();
    shell.setRunning(true);
    setModeLock(true);
    shell.say(practice ? `Practice from phase ${startPhase}. Nothing is recorded.` : "Fight started. The Monolith rises.");
    tone(110, 0.6, "sawtooth", 0.1, 220);
  }

  function pause() {
    if (state !== "run") return;
    state = "paused";
    mouseHeld = false;
    for (const k in keys) keys[k] = false;
    shell.setRunning(false);
    shell.show({ kicker: "Paused", title: formatTime(runMs), msg: `Monolith at ${Math.ceil((b.hp / BOSS_HP) * 100)}%, phase ${b.phase}.`, label: "Resume" });
  }

  function resume() {
    state = "run";
    shell.hide();
    shell.setRunning(true);
  }

  function lose() {
    state = "over";
    shell.setRunning(false);
    setModeLock(false);
    spark(p.x, p.y - 14, 30, "#ff8a65", 260, 3, 300);
    const pct = Math.max(1, Math.ceil((b.hp / BOSS_HP) * 100));
    const before = bests[mode()].phase;
    save({ won: false, ms: runMs, grade: "", phase: b.phase as 1 | 2 | 3 });
    const unlocked = !practice && b.phase > Math.max(1, before);
    const stats = statLine();
    paintStats(null);
    window.setTimeout(() => {
      if (state !== "over") return;
      shell.show({
        kicker: practice ? "Practice over" : "Knocked out",
        title: `${pct}% left`,
        msg: `You reached phase ${b.phase} in ${formatTime(runMs)}.${unlocked ? ` Phase ${b.phase} practice unlocked.` : ""}\n${stats}${b.phase === 1 ? "\nDash through bolts: it makes you untouchable." : b.phase === 2 ? "\nWhen it rises and shadows you, move. It rests after landing." : "\nWatch the red lines: low means jump, high means stay down."}`,
        label: "Try again",
        share: practice ? undefined : `The Monolith beat me at ${pct}% in phase ${b.phase}. Think you can break it?`,
      });
    }, 700);
  }

  function finishWin() {
    state = "over";
    setModeLock(false);
    const grade = gradeFor(runMs, hits, hard);
    const firstWin = bests[mode()].ms === 0;
    const isBest = save({ won: true, ms: runMs, grade, phase: 3 });
    paintStats(practice ? undefined : { ms: runMs, grade });
    const hitsMsg = hits === 0 ? "No hits taken." : `${hits} hit${hits === 1 ? "" : "s"} taken.`;
    shell.show({
      kicker: practice ? "Practice cleared" : isBest && !firstWin ? "New best!" : "Shattered",
      title: practice ? formatTime(runMs) : `${formatTime(runMs)} · grade ${grade}`,
      msg: `${hitsMsg}${practice ? ` Practice from phase ${startPhase}: no grade or best.` : hard ? " Hard mode." : " Try Hard for a bonus."}\n${statLine()}`,
      label: "Fight again",
      share: practice ? undefined : `I shattered the Monolith in ${formatTime(runMs)} (grade ${grade}${hard ? ", Hard" : ""}). Beat that.`,
    });
  }

  const shell = createShell(cg, {
    onMain() {
      if (state === "paused") resume();
      else start();
    },
    onPause: pause,
  });

  // ---------- input ----------

  const KEYMAP: Record<string, string> = {
    ArrowLeft: "left",
    a: "left",
    A: "left",
    ArrowRight: "right",
    d: "right",
    D: "right",
    ArrowUp: "up",
    w: "up",
    W: "up",
    ArrowDown: "down",
    s: "down",
    S: "down",
    " ": "jump",
    z: "jump",
    Z: "jump",
    k: "jump",
    K: "jump",
    j: "shoot",
    J: "shoot",
    x: "shoot",
    X: "shoot",
    Shift: "dash",
    c: "dash",
    C: "dash",
    l: "dash",
    L: "dash",
    e: "beam",
    E: "beam",
    v: "beam",
    V: "beam",
  };

  function press(name: string) {
    if (name === "jump") jumpPress = true;
    else if (name === "dash") dashPress = true;
    else if (name === "beam") beamPress = true;
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (state !== "run" || e.ctrlKey || e.metaKey || e.altKey) return;
    const name = KEYMAP[e.key];
    if (!name) return;
    e.preventDefault();
    if (!e.repeat) {
      if (touchAim && !coarse.matches) touchAim = false;
      press(name);
    }
    keys[name] = true;
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const name = KEYMAP[e.key];
    if (name) keys[name] = false;
  };
  const clearKeys = () => {
    for (const k in keys) keys[k] = false;
    mouseHeld = false;
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearKeys);

  const offHold = holdButtons(cg, keys, (name) => {
    touchAim = true;
    press(name);
  });

  const toLogical = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    mouseX = (e.clientX - r.left - ox) / sc;
    mouseY = (e.clientY - r.top - oy) / sc;
  };
  const onPtrDown = (e: PointerEvent) => {
    if (state !== "run" || e.pointerType !== "mouse" || e.button !== 0) return;
    touchAim = false;
    mouseHeld = true;
    toLogical(e);
  };
  const onPtrMove = (e: PointerEvent) => {
    if (e.pointerType === "mouse") toLogical(e);
  };
  const onPtrUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse") mouseHeld = false;
  };
  canvas.addEventListener("pointerdown", onPtrDown);
  canvas.addEventListener("pointermove", onPtrMove);
  window.addEventListener("pointerup", onPtrUp);

  const onMode = (e: Event) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (state === "run" || state === "paused" || state === "won") return;
    hard = btn.dataset.mode === "hard";
    for (const b2 of modeBtns) b2.setAttribute("aria-pressed", String(b2 === btn));
    paintStats();
    shell.say(hard ? "Hard mode: three hits, faster attacks." : "Normal mode.");
  };
  for (const btn of modeBtns) btn.addEventListener("click", onMode);

  const onPhase = (e: Event) => {
    const btn = e.currentTarget as HTMLButtonElement;
    if (btn.disabled) return;
    startPhase = Number(btn.dataset.startPhase) as 1 | 2 | 3;
    paintPhases();
    shell.say(startPhase === 1 ? "Full fight from phase 1." : `Practice from phase ${startPhase}. Practice runs record nothing.`);
  };
  for (const btn of phaseBtns) btn.addEventListener("click", onPhase);

  const onAuto = () => {
    autoFire = !autoFire;
    writeJSON(STORAGE_KEYS.monolithAutoFire, autoFire);
    paintAutoFire();
    shell.say(autoFire ? "Auto-fire on: touch controls shoot for you." : "Auto-fire off: hold Fire to shoot.");
  };
  autoBtn?.addEventListener("click", onAuto);
  paintAutoFire();

  shell.show({
    kicker: "Monolith",
    title: "Break the stone",
    msg: "One arena, one boss, three phases. Dash through danger, fill the meter, unleash the beam.",
    label: "Start fight",
  });
  paintStats(null);

  const loop = startCanvasLoop(canvas, { essential: true, mobileFPS: 60, onFrame: frame, onResize: resize });

  return {
    destroy() {
      loop.stop();
      shell.destroy();
      offHold();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
      canvas.removeEventListener("pointerdown", onPtrDown);
      canvas.removeEventListener("pointermove", onPtrMove);
      window.removeEventListener("pointerup", onPtrUp);
      for (const btn of modeBtns) btn.removeEventListener("click", onMode);
      for (const btn of phaseBtns) btn.removeEventListener("click", onPhase);
      autoBtn?.removeEventListener("click", onAuto);
    },
  };
}
