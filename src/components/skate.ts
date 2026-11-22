// Skate Lab: watch the shipped policy land tricks, retrain it from scratch in a Worker (SFT → GRPO → DPO), rate its
// style to steer it, or try the same tricks yourself on the same physics. The page markup lives in
// src/pages/skate.astro; the model and trainer in src/lib/skate*.ts (see docs/skate/SKATE-LAB.md).
import policy from "../data/skate-policy.generated.json";
import { startCanvasLoop } from "../lib/canvasLoop";
import { readJSON, STORAGE_KEYS, writeJSON } from "../lib/clientState";
import { buzz, holdButtons } from "../lib/gameShell";
import { createLabClient } from "../lib/skateLabClient";
import type { LabStatus, Replay } from "../lib/skateLabCore";
import type { Checkpoint } from "../lib/skateNet";
import {
  ACT,
  ACTIONS,
  actionMask,
  DT,
  HOLD,
  makeJitter,
  newState,
  step,
  TRICK_BY_ID,
  TRICKS,
  type ActionName,
  type Frame,
  type Jitter,
  type SkateState,
  type TrickId,
  type Verdict,
} from "../lib/skateSim";
import { CURRICULUM, EVAL_SEED, type DpoLog, type GrpoLog, type SftLog } from "../lib/skateTrain";

type Tab = "watch" | "train" | "rate" | "try";
const TABS: Tab[] = ["watch", "train", "rate", "try"];

interface Final {
  greedy: number;
  landed: number;
  style: number;
  sampled: number;
}

interface Shipped {
  checkpoint: Checkpoint;
  config: { sft: { epochs: number }; grpo: { steps: number; group: number; beta: number }; dpo: { rounds: number } };
  evalN: number;
  sft: SftLog[];
  grpo: {
    reward: number[];
    kl: number[];
    entropy: number[];
    zeroVar: number[];
    pass1: Record<TrickId, Array<number | null>>;
  };
  dpo: { loss: number[]; margin: number[]; acc: number[] };
  final: Record<"sft" | "grpo" | "dpo", Record<TrickId, Final>>;
}

const SHIPPED = policy as unknown as Shipped;

// ---------------------------------------------------------------------------------------------------------------
// Colours: read from the theme tokens, refreshed when the theme flips

const TRICK_HUE: Record<TrickId, string> = {
  ollie: "--arcade",
  shuvit: "--chess",
  kickflip: "--lab",
  varial: "--tabs",
  heelflip: "--skate",
  tre: "--projects",
};

interface Palette {
  surface2: string;
  surface3: string;
  line: string;
  line2: string;
  text: string;
  text2: string;
  text3: string;
  hue: string;
  tricks: Record<TrickId, string>;
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim() || "#888";
  return {
    surface2: v("--surface-2"),
    surface3: v("--surface-3"),
    line: v("--line"),
    line2: v("--line-2"),
    text: v("--text"),
    text2: v("--text-2"),
    text3: v("--text-3"),
    hue: v("--skate"),
    tricks: Object.fromEntries(TRICKS.map((t) => [t.id, v(TRICK_HUE[t.id])])) as Record<TrickId, string>,
  };
}

const reducedMotion = () => document.documentElement.dataset.motion === "reduced";

// ---------------------------------------------------------------------------------------------------------------
// Renderer: a 3/4 view of the board, its shadow and a stick rider

type Vec = [number, number, number];

const TAU = Math.PI * 2;
const CAM_YAW = (35 * Math.PI) / 180;
const CAM_ELEV = (18 * Math.PI) / 180;
const CA = Math.cos(CAM_YAW);
const SA = Math.sin(CAM_YAW);
const CE = Math.cos(CAM_ELEV);
const SE = Math.sin(CAM_ELEV);
/** Unit vector toward the camera: a face whose normal points along it is the one you see. */
const VIEW: Vec = [-SA * CE, SE, CA * CE];
const SHADOW_TILT = Math.atan2(-SA * SE, CA);

// Board, in metres, in its own frame: x nose-ward, y up, z across
const DECK_Y = 0.09;
const WHEEL_R = 0.028;
const DECK: Vec[] = [
  [-0.4, 0.05, 0],
  [-0.37, 0.035, -0.075],
  [-0.3, 0, -0.105],
  [0.3, 0, -0.105],
  [0.37, 0.035, -0.075],
  [0.4, 0.05, 0],
  [0.37, 0.035, 0.075],
  [0.3, 0, 0.105],
  [-0.3, 0, 0.105],
  [-0.37, 0.035, 0.075],
];
const WHEELS: Vec[] = [
  [-0.27, -0.06, -0.085],
  [-0.27, -0.06, 0.085],
  [0.27, -0.06, -0.085],
  [0.27, -0.06, 0.085],
];
const BACK_FOOT = -0.3;
const FRONT_FOOT = (f: number) => -0.04 + 0.32 * f;

interface View {
  cx: number;
  gy: number;
  s: number;
}

function project(p: Vec, v: View): [number, number] {
  const xp = p[0] * CA + p[2] * SA;
  const zp = -p[0] * SA + p[2] * CA;
  return [v.cx + v.s * xp, v.gy - v.s * p[1] * CE + v.s * zp * SE];
}

/** Board orientation: roll (flip) about its length, then pitch, then yaw (shove). */
function rotate(p: Vec, f: Frame): Vec {
  let [x, y, z] = p;
  const cr = Math.cos(f.phi);
  const sr = Math.sin(f.phi);
  [y, z] = [y * cr - z * sr, y * sr + z * cr];
  const cp = Math.cos(f.th);
  const sp = Math.sin(f.th);
  [x, y] = [x * cp - y * sp, x * sp + y * cp];
  const cy = Math.cos(f.psi);
  const sy = Math.sin(f.psi);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  return [x, y, z];
}

function path(ctx: CanvasRenderingContext2D, v: View, pts: Vec[]) {
  pts.forEach((p, i) => {
    const [x, y] = project(p, v);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
}

function frameOfState(s: SkateState): Frame {
  return { t: s.t, x: s.x, y: s.y, th: s.th, phi: s.phi, psi: s.psi, c: s.c, f: s.f, feet: s.feet };
}

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, f: Frame, pal: Palette) {
  ctx.fillStyle = pal.surface2;
  ctx.fillRect(0, 0, w, h);
  const s = Math.min(h / 2.9, w / 2.4);
  const v: View = { cx: w / 2, gy: h * 0.82, s };

  // Ground: two lane edges and ticks every half metre that scroll past as the board rolls
  ctx.strokeStyle = pal.line2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const z of [-0.5, 0.5]) path(ctx, v, [[-4, 0, z], [4, 0, z]]);
  const off = ((f.x % 0.5) + 0.5) % 0.5;
  for (let X = -4 - off; X <= 4; X += 0.5) path(ctx, v, [[X, 0, -0.5], [X, 0, 0.5]]);
  ctx.stroke();

  // Shadow shrinks and fades with height
  const k = 1 / (1 + 2.2 * Math.max(0, f.y));
  const [sx, sy] = project([0, 0, 0], v);
  ctx.save();
  ctx.globalAlpha = 0.2 * k;
  ctx.fillStyle = pal.text;
  ctx.beginPath();
  ctx.ellipse(sx, sy, s * 0.36 * k + 2, s * 0.09 * k + 1, SHADOW_TILT, 0, TAU);
  ctx.fill();
  ctx.restore();

  const C: Vec = [0, f.y + DECK_Y, 0];
  const world = (p: Vec): Vec => {
    const r = rotate(p, f);
    return [C[0] + r[0], C[1] + r[1], C[2] + r[2]];
  };
  const n = rotate([0, 1, 0], f);
  const top = n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2] > 0;

  const drawWheels = () => {
    ctx.strokeStyle = pal.text3;
    ctx.lineWidth = Math.max(1.5, s * 0.018);
    ctx.beginPath();
    for (const p of WHEELS) path(ctx, v, [world([p[0], -0.015, 0]), world(p)]);
    ctx.stroke();
    ctx.fillStyle = pal.text2;
    for (const p of WHEELS) {
      const [x, y] = project(world(p), v);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, s * WHEEL_R), 0, TAU);
      ctx.fill();
    }
  };
  const drawDeck = () => {
    ctx.beginPath();
    path(ctx, v, DECK.map(world));
    ctx.closePath();
    // Grip tape on top, the hue graphic underneath
    ctx.fillStyle = top ? pal.surface3 : pal.hue;
    ctx.fill();
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  if (top) {
    drawWheels();
    drawDeck();
  } else {
    drawDeck();
    drawWheels();
  }

  // Rider: feet on the board (mirrored once a shove has turned it round), lifted and tucked while it's free
  const dir = Math.cos(f.psi) < 0 ? -1 : 1;
  const on = f.feet !== 1;
  const feet: Vec[] = [BACK_FOOT, FRONT_FOOT(f.f)].map((x) =>
    on ? world([x * dir, 0.012, 0]) : ([x, f.y + DECK_Y + 0.16, 0] as Vec),
  );
  const legs = on ? 0.86 * (1 - 0.42 * f.c) : 0.58;
  const hipX = (feet[0][0] + feet[1][0]) / 2;
  const hipY = (feet[0][1] + feet[1][1]) / 2 + legs;
  const seg = 0.45;
  ctx.strokeStyle = pal.text;
  ctx.lineWidth = Math.max(2, s * 0.03);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const p of feet) {
    const hip: Vec = [hipX + (p[0] - hipX) * 0.22, hipY, 0];
    const d = Math.hypot(hip[0] - p[0], hip[1] - p[1], hip[2] - p[2]);
    const bend = Math.sqrt(Math.max(0, seg * seg - (d / 2) * (d / 2)));
    path(ctx, v, [p, [(p[0] + hip[0]) / 2, (p[1] + hip[1]) / 2, (p[2] + hip[2]) / 2 + bend], hip]);
  }
  const sh: Vec = [hipX + 0.04, hipY + 0.5 - 0.06 * f.c, 0.06 + 0.1 * f.c];
  path(ctx, v, [[hipX, hipY, 0], sh]);
  const arm = on ? -0.28 : -0.1;
  path(ctx, v, [
    [sh[0] - 0.34, sh[1] + arm, sh[2] + 0.05],
    sh,
    [sh[0] + 0.34, sh[1] + arm + 0.04, sh[2] + 0.05],
  ]);
  ctx.stroke();
  const [hx, hy] = project([sh[0] + 0.02, sh[1] + 0.17, sh[2]], v);
  ctx.beginPath();
  ctx.arc(hx, hy, s * 0.09, 0, TAU);
  ctx.fillStyle = pal.surface2;
  ctx.fill();
  ctx.stroke();
}

// ---------------------------------------------------------------------------------------------------------------
// Player: plays a recorded attempt (slow motion through the trick), or draws a live one

const SLOW = 0.25;
const KEY_MS = 800;

interface Player {
  play(frames: Frame[], onEnd?: () => void): void;
  restart(): void;
  seek(idx: number): void;
  live(get: (dtMs: number) => Frame): void;
  clear(): void;
  readonly done: boolean;
  destroy(): void;
}

function createPlayer(canvas: HTMLCanvasElement, pal: () => Palette, onIndex?: (idx: number) => void): Player {
  let frames: Frame[] | null = null;
  let keys: number[] = [0];
  let slow: [number, number] = [Infinity, Infinity];
  let t = 0;
  let idx = 0;
  let keyI = 0;
  let keyClock = 0;
  let paused = false;
  let done = true;
  let endCb: (() => void) | undefined;
  let liveGet: ((dtMs: number) => Frame) | null = null;
  const rest = frameOfState(newState());

  const finish = () => {
    if (done) return;
    done = true;
    endCb?.();
  };

  const loop = startCanvasLoop(canvas, {
    essential: true,
    onFrame(ctx, { dt, width, height }) {
      const ms = Math.min(dt, 100);
      let f = rest;
      if (liveGet) f = liveGet(ms);
      else if (frames) {
        const last = frames.length - 1;
        if (!paused && !done) {
          if (reducedMotion()) {
            // No motion: step through the key moments instead (start, pop, peak, catch, land)
            keyClock += ms;
            if (keyClock >= KEY_MS) {
              keyClock = 0;
              keyI = Math.min(keyI + 1, keys.length - 1);
            }
            idx = keys[keyI];
            if (keyI === keys.length - 1) finish();
          } else {
            t += (ms / 1000) * (t >= slow[0] && t <= slow[1] ? SLOW : 1);
            idx = Math.min(last, Math.floor(t / DT + 1e-6));
            if (idx >= last) finish();
          }
          onIndex?.(idx);
        }
        f = frames[idx];
      }
      drawScene(ctx, width, height, f, pal());
    },
  });

  function reset() {
    t = 0;
    idx = 0;
    keyI = 0;
    keyClock = 0;
    paused = false;
    done = false;
    onIndex?.(0);
  }

  return {
    play(next, onEnd) {
      liveGet = null;
      frames = next;
      endCb = onEnd;
      const t0 = next[0].t;
      const air = next.map((fr, i) => (fr.y > 0.002 ? i : -1)).filter((i) => i >= 0);
      if (air.length) {
        slow = [next[air[0]].t - t0 - 0.06, next[air[air.length - 1]].t - t0 + 0.12];
        let peak = air[0];
        for (const i of air) if (next[i].y > next[peak].y) peak = i;
        const caught = next.findIndex((fr) => fr.feet === 2);
        keys = [...new Set([0, Math.max(0, air[0] - 1), peak, caught, next.length - 1])]
          .filter((i) => i >= 0)
          .sort((a, b) => a - b);
      } else {
        slow = [Infinity, Infinity];
        keys = [0, next.length - 1];
      }
      reset();
    },
    restart() {
      if (frames && !liveGet) reset();
    },
    seek(i) {
      if (!frames) return;
      idx = Math.max(0, Math.min(frames.length - 1, i));
      t = frames[idx].t - frames[0].t;
      paused = true;
      onIndex?.(idx);
    },
    live(get) {
      frames = null;
      liveGet = get;
      done = true;
    },
    clear() {
      frames = null;
      liveGet = null;
      done = true;
    },
    get done() {
      return done;
    },
    destroy() {
      loop.stop();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Charts: small static line charts, redrawn when the data, the size or the theme changes

interface Series {
  values: ArrayLike<number | null>;
  color: string;
}

function drawChart(
  canvas: HTMLCanvasElement,
  series: Series[],
  pal: Palette,
  o: { min?: number; max?: number; len: number },
) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series)
    for (let i = 0; i < s.values.length; i++) {
      const x = s.values[i];
      if (x === null || !Number.isFinite(x)) continue;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  if (o.min !== undefined) lo = Math.min(o.min, Number.isFinite(lo) ? lo : o.min);
  if (o.max !== undefined) hi = Math.max(o.max, Number.isFinite(hi) ? hi : o.max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (hi - lo < 1e-6) hi = lo + 1;

  const pad = { l: 2, r: 2, t: 14, b: 4 };
  const X = (i: number) => pad.l + (i / Math.max(1, o.len - 1)) * (w - pad.l - pad.r);
  const Y = (y: number) => pad.t + (1 - (y - lo) / (hi - lo)) * (h - pad.t - pad.b);

  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, Y(lo) + 0.5);
  ctx.lineTo(w - pad.r, Y(lo) + 0.5);
  if (lo < 0 && hi > 0) {
    ctx.moveTo(pad.l, Math.round(Y(0)) + 0.5);
    ctx.lineTo(w - pad.r, Math.round(Y(0)) + 0.5);
  }
  ctx.stroke();
  ctx.fillStyle = pal.text3;
  ctx.font = "10px ui-monospace, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`${fmtAxis(lo)} – ${fmtAxis(hi)}`, pad.l, 1);

  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < s.values.length; i++) {
      const y = s.values[i];
      if (y === null || !Number.isFinite(y)) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(X(i), Y(y));
      else ctx.moveTo(X(i), Y(y));
      pen = true;
    }
    ctx.stroke();
  }
}

const fmtAxis = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(1) : n.toFixed(2));
const pct = (n: number) => `${Math.round(n * 100)}%`;

// ---------------------------------------------------------------------------------------------------------------
// Words

const ABBR: Record<ActionName, string> = {
  idle: "·",
  crouch: "cr",
  pop: "pop",
  slide: "sl",
  flickToe: "toe",
  flickHeel: "heel",
  scoop: "sc",
  catch: "cat",
};

const ACTION_LABEL: Record<ActionName, string> = {
  idle: "idle",
  crouch: "crouch",
  pop: "pop",
  slide: "slide front foot",
  flickToe: "toe flick",
  flickHeel: "heel flick",
  scoop: "scoop",
  catch: "catch",
};

/** Accessible name for a strip token: the visible abbreviation, then the full action when the two differ. */
function tokenName(name: ActionName): string {
  const abbr = ABBR[name];
  const label = ACTION_LABEL[name];
  if (!/\w/.test(abbr) || label.split(/\W+/).includes(abbr)) return label;
  return `${abbr}, ${label}`;
}

function gradeWord(v: Verdict) {
  return v.grade === "clean" ? "Clean" : v.grade === "sketchy" ? "Sketchy" : "Bail";
}

function summary(v: Verdict) {
  return `${gradeWord(v)}: ${v.reason}`;
}

function details(v: Verdict) {
  return [
    `${v.height.toFixed(2)} m high`,
    `${Math.round(Math.abs(v.pitchDeg))}° pitch`,
    `${Math.abs(v.rollTurns).toFixed(2)} flips`,
    `${Math.abs(v.yawTurns).toFixed(2)} turns`,
    `${v.time.toFixed(2)} s`,
  ].join(" · ");
}

// ---------------------------------------------------------------------------------------------------------------

interface Prefs {
  tab: Tab;
  trick: TrickId;
  /** Clean landings and tries per trick in "You try". */
  tries: Partial<Record<TrickId, [number, number]>>;
}

function readPrefs(): Prefs {
  const raw = readJSON<Partial<Prefs>>(STORAGE_KEYS.skateLab);
  const tab = raw && TABS.includes(raw.tab as Tab) ? (raw.tab as Tab) : "watch";
  const trick = raw && typeof raw.trick === "string" && raw.trick in TRICK_BY_ID ? raw.trick : "kickflip";
  const tries: Prefs["tries"] = {};
  if (raw && raw.tries && typeof raw.tries === "object")
    for (const t of TRICKS) {
      const v = (raw.tries as Record<string, unknown>)[t.id];
      if (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0)) tries[t.id] = [v[0], v[1]];
    }
  return { tab, trick, tries };
}

interface LiveLogs {
  sft: SftLog[];
  grpo: GrpoLog[];
  dpo: DpoLog[];
}

type TrainState = "idle" | "running" | "paused" | "done";
type TrainStage = "sft" | "grpo" | "dpo";

// Keyboard: the same eight actions the model picks from (Space pops on the ground and catches in the air)
const KEYMAP: Record<string, ActionName> = {
  KeyS: "crouch",
  ArrowDown: "crouch",
  Space: "pop",
  KeyW: "pop",
  ArrowUp: "pop",
  KeyD: "slide",
  ArrowRight: "slide",
  KeyJ: "flickToe",
  KeyK: "scoop",
  KeyL: "flickHeel",
};
const TRY_SPEEDS = [0.25, 0.5, 1];

interface TryRun {
  s: SkateState;
  jitter: Jitter;
  frames: Frame[];
  seed: number;
  trick: TrickId;
  started: boolean;
  simT: number;
  nextT: number;
  verdict: Verdict | null;
}

export function mount(root: HTMLElement) {
  const ac = new AbortController();
  const on = { signal: ac.signal };
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const $$ = <T extends Element = HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T>(sel));
  let destroyed = false;

  const prefs = readPrefs();
  const savePrefs = () => writeJSON(STORAGE_KEYS.skateLab, prefs);

  let palette = readPalette(root);
  const pal = () => palette;

  const modeNote = $("[data-sk-mode]");
  const client = createLabClient(SHIPPED.checkpoint, () => {
    if (modeNote) modeNote.hidden = false;
  });
  if (modeNote) modeNote.hidden = client.mode === "worker";

  let status: LabStatus | null = null;
  let votes = 0;
  let agreed = 0;
  let live: LiveLogs | null = null;
  let trainState: TrainState = "idle";
  let stage: TrainStage = "sft";
  /** Bumped on every reset or new run, so replies from an abandoned run are dropped. */
  let gen = 0;
  let wallMs = 0;

  const send = (req: Parameters<typeof client.send>[0]) =>
    client.send(req).then((r) => {
      if (r.type === "error" && r.message !== "destroyed") showError(r.message);
      if ("status" in r) status = r.status;
      return r;
    });

  const errorEl = $("[data-sk-error]");
  function showError(message: string) {
    if (!errorEl) return;
    errorEl.hidden = false;
    errorEl.textContent = `Something went wrong in the lab: ${message}`;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Labels

  const policyEl = $("[data-sk-policy]");
  const sourceEl = $("[data-sk-source]");
  const verdictEl = $("[data-sk-verdict]");
  const statsEl = $("[data-sk-trick-stats]");

  function policyLabel() {
    const base =
      status?.source === "fresh" || live
        ? trainState === "done"
          ? "your run (finished)"
          : status && status.stage !== "init"
            ? `your run (${status.stage.toUpperCase()} ${status.stage === "sft" ? "epoch" : status.stage === "grpo" ? "step" : "round"} ${status.step})`
            : "a fresh, untrained net"
        : "shipped";
    return votes ? `${base} + ${votes} vote${votes === 1 ? "" : "s"}` : base;
  }

  function updatePolicy() {
    if (policyEl) policyEl.textContent = `Policy: ${policyLabel()}`;
  }

  function setVerdict(v: Verdict | null, lead = "") {
    if (!verdictEl) return;
    verdictEl.replaceChildren();
    if (!v) {
      verdictEl.textContent = lead;
      return;
    }
    const strong = document.createElement("strong");
    strong.textContent = `${lead}${gradeWord(v)}`;
    const small = document.createElement("span");
    small.className = "muted";
    small.textContent = details(v);
    verdictEl.append(strong, `: ${v.reason}. `, small);
  }

  function updateTrickStats() {
    if (!statsEl) return;
    const f = SHIPPED.final.dpo[prefs.trick];
    statsEl.textContent = `Shipped policy over ${SHIPPED.evalN} seeds: ${pct(f.greedy)} clean picking its top choice, ${pct(f.sampled)} clean sampling.`;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Stage, token strip and the distribution behind each decision

  const stageCanvas = $<HTMLCanvasElement>("canvas[data-sk-canvas]");
  const stageWrap = $("[data-sk-stagewrap]");
  const strip = $("[data-sk-strip]");
  const dist = $("[data-sk-dist]");
  let shown: Replay | null = null;
  let shownDecision = -1;
  let inspecting = false;

  const player = stageCanvas
    ? createPlayer(stageCanvas, pal, (idx) => {
        if (!shown) return;
        const d = Math.min(shown.actions.length - 1, Math.max(0, Math.floor((idx - 1) / HOLD)));
        if (d === shownDecision) return;
        shownDecision = d;
        strip?.querySelectorAll("[aria-current]").forEach((el) => el.removeAttribute("aria-current"));
        strip?.children[d]?.setAttribute("aria-current", "step");
        if (!inspecting) showDist(d);
      })
    : null;

  function buildStrip(rp: Replay | null) {
    shown = rp;
    shownDecision = -1;
    if (!strip || !dist) return;
    strip.replaceChildren();
    strip.hidden = !rp;
    dist.hidden = !rp;
    if (!rp) return;
    rp.actions.forEach((a, i) => {
      const b = document.createElement("button");
      const name = ACTIONS[a];
      const p = rp.probs[i]?.[a] ?? 1;
      b.type = "button";
      b.className = "sk__tok";
      if (a === ACT.pop) b.classList.add("is-pop");
      b.style.setProperty("--p", p.toFixed(3));
      b.textContent = ABBR[name];
      b.tabIndex = i === 0 ? 0 : -1;
      // The name starts with what the button shows (WCAG 2.5.3, label in name), unless the label already has it.
      b.setAttribute("aria-label", `${tokenName(name)}, decision ${i + 1}, ${pct(p)} likely`);
      strip.append(b);
    });
    showDist(0);
  }

  function showDist(i: number) {
    if (!dist || !shown) return;
    const probs = shown.probs[i];
    const mask = shown.masks[i];
    const chosen = shown.actions[i];
    if (!probs || !mask) return;
    const head = document.createElement("p");
    head.className = "sk__dist-head";
    head.textContent = `Decision ${i + 1} of ${shown.actions.length} · t = ${(i * HOLD * DT).toFixed(3)} s`;
    const rows = ACTIONS.map((name, k) => {
      const row = document.createElement("div");
      row.className = "sk__dist-row";
      if (!mask[k]) row.classList.add("is-masked");
      if (k === chosen) row.classList.add("is-chosen");
      const label = document.createElement("span");
      label.textContent = ACTION_LABEL[name];
      const bar = document.createElement("span");
      bar.className = "sk__dist-bar";
      bar.style.setProperty("--p", mask[k] ? probs[k].toFixed(3) : "0");
      const val = document.createElement("span");
      val.className = "sk__dist-val";
      val.textContent = mask[k] ? pct(probs[k]) : "masked";
      row.append(label, bar, val);
      return row;
    });
    dist.replaceChildren(head, ...rows);
  }

  const stripIndex = (el: EventTarget | null) =>
    strip && el instanceof HTMLElement && el.parentElement === strip ? Array.prototype.indexOf.call(strip.children, el) : -1;

  strip?.addEventListener(
    "pointerover",
    (e) => {
      const i = stripIndex(e.target);
      if (i < 0) return;
      inspecting = true;
      showDist(i);
    },
    on,
  );
  strip?.addEventListener(
    "pointerleave",
    () => {
      inspecting = strip.contains(document.activeElement);
      if (!inspecting && shownDecision >= 0) showDist(shownDecision);
    },
    on,
  );
  strip?.addEventListener(
    "focusin",
    (e) => {
      const i = stripIndex(e.target);
      if (i < 0) return;
      inspecting = true;
      showDist(i);
    },
    on,
  );
  strip?.addEventListener("focusout", () => (inspecting = false), on);
  strip?.addEventListener(
    "click",
    (e) => {
      const i = stripIndex(e.target);
      if (i >= 0) player?.seek(1 + i * HOLD);
    },
    on,
  );
  strip?.addEventListener(
    "keydown",
    (e) => {
      const i = stripIndex(e.target);
      if (i < 0) return;
      const n = strip.children.length;
      const next =
        e.key === "ArrowRight" ? Math.min(n - 1, i + 1) : e.key === "ArrowLeft" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
      if (next < 0) return;
      e.preventDefault();
      const el = strip.children[next] as HTMLElement;
      (strip.children[i] as HTMLElement).tabIndex = -1;
      el.tabIndex = 0;
      el.focus();
      player?.seek(1 + next * HOLD);
    },
    on,
  );

  function playReplay(rp: Replay, label: string) {
    if (!player) return;
    buildStrip(rp);
    if (sourceEl) sourceEl.textContent = label;
    setVerdict(null, "…");
    player.play(rp.frames, () => setVerdict(rp.verdict));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Watch

  let watchSeed = EVAL_SEED;
  let watchGreedy = true;
  let watchSeq = 0;

  async function watch(trick: TrickId, seed: number, greedy: boolean) {
    const seq = ++watchSeq;
    watchSeed = seed;
    watchGreedy = greedy;
    const r = await send({ type: "replay", trick, seed, greedy });
    if (destroyed || seq !== watchSeq || r.type !== "replay") return;
    updatePolicy();
    const how = greedy ? "top choice every decision" : "sampled";
    playReplay(r.replay, `${TRICK_BY_ID[trick].name} · ${how} · seed ${seed}`);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Train

  const trainBtn = $<HTMLButtonElement>('[data-sk-act="train"]');
  const resetBtn = $<HTMLButtonElement>('[data-sk-act="reset"]');
  const skipSft = $<HTMLInputElement>("input[data-sk-skipsft]");
  const groupInput = $<HTMLInputElement>("input[data-sk-group]");
  const groupOut = $("[data-sk-group-out]");
  const betaSelect = $<HTMLSelectElement>("select[data-sk-beta]");
  const stageLabel = $("[data-sk-stage-label]");
  const wallEl = $("[data-sk-wall]");
  const chartSrc = $("[data-sk-chart-src]");
  const evalEl = $("[data-sk-eval]");
  const charts = Object.fromEntries($$<HTMLCanvasElement>("canvas[data-sk-chart]").map((c) => [c.dataset.skChart!, c]));
  const lastEls = Object.fromEntries($$("[data-sk-last]").map((el) => [el.dataset.skLast!, el]));

  const G = SHIPPED.config.grpo.steps;
  const S = SHIPPED.config.sft.epochs;
  const D = SHIPPED.config.dpo.rounds;

  let chartsQueued = false;
  function queueCharts() {
    if (chartsQueued) return;
    chartsQueued = true;
    requestAnimationFrame(renderCharts);
  }

  function renderCharts() {
    chartsQueued = false;
    if (destroyed) return;
    const p = palette;
    const L = live;
    const col = (key: keyof GrpoLog & ("reward" | "kl" | "entropy" | "zeroVar")) =>
      L ? L.grpo.map((g) => g[key]) : SHIPPED.grpo[key];
    const data: Record<string, { series: Series[]; min?: number; max?: number; len: number }> = {
      pass: {
        series: CURRICULUM.map((id) => ({
          values: L ? L.grpo.map((g) => g.tricks[id]?.pass1 ?? null) : SHIPPED.grpo.pass1[id],
          color: p.tricks[id],
        })),
        min: 0,
        max: 1,
        len: G,
      },
      reward: { series: [{ values: col("reward"), color: p.hue }], min: 0, len: G },
      kl: { series: [{ values: col("kl"), color: p.hue }], min: 0, len: G },
      entropy: { series: [{ values: col("entropy"), color: p.hue }], min: 0, len: G },
      zerovar: { series: [{ values: col("zeroVar"), color: p.hue }], min: 0, max: 1, len: G },
      sftloss: { series: [{ values: L ? L.sft.map((s) => s.loss) : SHIPPED.sft.map((s) => s.loss), color: p.hue }], min: 0, len: S },
      dpomargin: { series: [{ values: L ? L.dpo.map((d) => d.margin) : SHIPPED.dpo.margin, color: p.hue }], len: D },
      dpoacc: { series: [{ values: L ? L.dpo.map((d) => d.acc) : SHIPPED.dpo.acc, color: p.hue }], min: 0, max: 1, len: D },
    };
    for (const [key, d] of Object.entries(data)) {
      const c = charts[key];
      if (c) drawChart(c, d.series, p, d);
      const el = lastEls[key];
      if (el && key !== "pass") {
        const vals = d.series[0].values;
        const last = vals.length ? vals[vals.length - 1] : null;
        el.textContent = last === null || last === undefined ? "–" : last.toFixed(3);
      }
    }
    if (chartSrc) chartSrc.textContent = L ? "Your run, live." : "The shipped run (the one this page loaded). Press Train to make your own.";
  }

  function updateTrainUi() {
    if (trainBtn)
      trainBtn.textContent =
        trainState === "running" ? "Pause" : trainState === "paused" ? "Resume" : trainState === "done" ? "Train again" : "Train from scratch";
    if (skipSft) skipSft.disabled = trainState === "running" || trainState === "paused";
    if (stageLabel) {
      let text = "Not started: showing the shipped run.";
      if (live && status) {
        const n = status.stage === "sft" ? 1 : status.stage === "grpo" ? 2 : 3;
        const unit = status.stage === "sft" ? "epoch" : status.stage === "grpo" ? "step" : "round";
        text =
          trainState === "done"
            ? "Done: all three stages."
            : status.stage === "init"
              ? "Starting…"
              : `Stage ${n} of 3 · ${status.stage.toUpperCase()} ${unit} ${status.step} of ${status.total}`;
        if (status.stage === "grpo") text += ` · ${status.unlocked} of ${CURRICULUM.length} tricks unlocked`;
        if (trainState === "paused") text += " · paused";
      }
      stageLabel.textContent = text;
    }
    if (wallEl) wallEl.textContent = live ? `${(wallMs / 1000).toFixed(1)} s of training` : "";
    updatePolicy();
  }

  async function runTraining(myGen: number) {
    while (trainState === "running" && myGen === gen && !destroyed) {
      const t0 = performance.now();
      const r = await send({ type: stage });
      if (destroyed || myGen !== gen || !live) return;
      wallMs += performance.now() - t0;
      if (r.type === "error") {
        trainState = "paused";
      } else if (r.type === "sft") {
        live.sft.push(r.log);
        if (r.done) stage = "grpo";
      } else if (r.type === "grpo") {
        live.grpo.push(r.log);
        if (r.done) stage = "dpo";
        if (currentTab === "train" && player?.done && r.log.step % 10 === 0) {
          const trick = CURRICULUM[Math.max(0, r.status.unlocked - 1)];
          void send({ type: "replay", trick, seed: EVAL_SEED + r.log.step, greedy: true }).then((rr) => {
            if (!destroyed && myGen === gen && currentTab === "train" && rr.type === "replay")
              playReplay(rr.replay, `Your run at GRPO step ${r.log.step} · ${TRICK_BY_ID[trick].name}, the newest unlocked trick`);
          });
        }
      } else if (r.type === "dpo") {
        live.dpo.push(r.log);
        if (r.done) {
          trainState = "done";
          void finalEval(myGen);
        }
      }
      updateTrainUi();
      queueCharts();
    }
  }

  async function finalEval(myGen: number) {
    if (!evalEl) return;
    evalEl.textContent = "Scoring your run on 50 seeds…";
    const r = await send({ type: "evaluate", n: 50 });
    if (destroyed || myGen !== gen || r.type !== "evaluate") return;
    const table = document.createElement("table");
    table.className = "sk__table";
    const cap = document.createElement("caption");
    cap.textContent = `Clean landings: your run (50 seeds) against the shipped run (${SHIPPED.evalN} seeds). Top choice / sampled.`;
    const thead = document.createElement("thead");
    thead.innerHTML = '<tr><th scope="col">Trick</th><th scope="col">Yours</th><th scope="col">Shipped</th></tr>';
    const tbody = document.createElement("tbody");
    for (const id of CURRICULUM) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = TRICK_BY_ID[id].name;
      const mine = document.createElement("td");
      mine.textContent = `${pct(r.tricks[id].greedy.clean)} / ${pct(r.tricks[id].sampled.clean)}`;
      const ship = document.createElement("td");
      ship.textContent = `${pct(SHIPPED.final.dpo[id].greedy)} / ${pct(SHIPPED.final.dpo[id].sampled)}`;
      tr.append(th, mine, ship);
      tbody.append(tr);
    }
    table.append(cap, thead, tbody);
    evalEl.replaceChildren(table);
  }

  async function startTraining() {
    const myGen = ++gen;
    trainState = "running";
    live = { sft: [], grpo: [], dpo: [] };
    votes = 0;
    agreed = 0;
    wallMs = 0;
    stage = skipSft?.checked ? "grpo" : "sft";
    if (evalEl) evalEl.replaceChildren();
    updateTrainUi();
    queueCharts();
    await send({ type: "reset", source: "fresh" });
    if (myGen !== gen) return;
    void runTraining(myGen);
  }

  trainBtn?.addEventListener(
    "click",
    () => {
      if (trainState === "running") trainState = "paused";
      else if (trainState === "paused") {
        trainState = "running";
        void runTraining(gen);
      } else void startTraining();
      updateTrainUi();
    },
    on,
  );

  resetBtn?.addEventListener(
    "click",
    async () => {
      const myGen = ++gen;
      trainState = "idle";
      live = null;
      votes = 0;
      agreed = 0;
      wallMs = 0;
      if (evalEl) evalEl.replaceChildren();
      await send({ type: "reset", source: "shipped" });
      if (myGen !== gen) return;
      updateTrainUi();
      updateTally();
      queueCharts();
      if (currentTab === "watch" || currentTab === "train") void watch(prefs.trick, EVAL_SEED, true);
      if (currentTab === "rate") void nextPair();
    },
    on,
  );

  const updateGroupOut = () => {
    if (groupOut && groupInput) groupOut.textContent = groupInput.value;
  };
  groupInput?.addEventListener("input", updateGroupOut, on);
  groupInput?.addEventListener(
    "change",
    () => {
      void send({ type: "config", group: Number(groupInput.value) }).then(() => {
        if (status && groupInput) groupInput.value = String(status.group);
        updateGroupOut();
      });
    },
    on,
  );
  betaSelect?.addEventListener("change", () => void send({ type: "config", beta: Number(betaSelect.value) }), on);

  // -------------------------------------------------------------------------------------------------------------
  // Rate style: two landings side by side; your pick becomes one DPO preference pair

  const pairPlayers = [0, 1].map((i) => {
    const c = $<HTMLCanvasElement>(`canvas[data-sk-pair="${i}"]`);
    return c ? createPlayer(c, pal) : null;
  });
  const pairInfo = [0, 1].map((i) => $(`[data-sk-pair-info="${i}"]`));
  const voteBtns = [0, 1].map((i) => $<HTMLButtonElement>(`[data-sk-vote="${i}"]`));
  const rateMsg = $("[data-sk-rate-msg]");
  const tallyEl = $("[data-sk-agree]");
  let judge: 0 | 1 | null = null;
  let pairSeq = 0;
  let havePair = false;

  const setVotes = (enabled: boolean) => voteBtns.forEach((b) => b && (b.disabled = !enabled));

  function updateTally() {
    if (tallyEl)
      tallyEl.textContent = votes
        ? `${votes} vote${votes === 1 ? "" : "s"} so far; the scripted style judge agreed with ${agreed}.`
        : "No votes yet.";
    updatePolicy();
  }

  async function nextPair() {
    const seq = ++pairSeq;
    havePair = false;
    setVotes(false);
    if (rateMsg) rateMsg.textContent = "Sampling attempts…";
    const trick = prefs.trick;
    const r = await send({ type: "pair", trick });
    if (destroyed || seq !== pairSeq || r.type !== "pair") return;
    if (!r.pair) {
      pairPlayers.forEach((p) => p?.clear());
      pairInfo.forEach((el) => el && (el.textContent = ""));
      if (rateMsg)
        rateMsg.textContent = `Couldn't find two different landings of ${article(TRICK_BY_ID[trick].name)} in this batch: the policy lands it too rarely, or the same way every time. Try again or pick another trick.`;
      return;
    }
    judge = r.judge;
    havePair = true;
    r.pair.forEach((a, i) => {
      pairPlayers[i]?.play(a.frames);
      const el = pairInfo[i];
      if (el) el.textContent = `${summary(a.verdict)}. ${details(a.verdict)}`;
    });
    if (rateMsg) rateMsg.textContent = "Which landing has more style? Click a board to replay it.";
    setVotes(true);
  }

  voteBtns.forEach((b, i) =>
    b?.addEventListener(
      "click",
      async () => {
        if (!havePair) return;
        havePair = false;
        setVotes(false);
        const pick = i as 0 | 1;
        const thisJudge = judge;
        const r = await send({ type: "vote", pick });
        if (destroyed || r.type !== "vote" || !r.log) return;
        votes++;
        if (thisJudge === pick) agreed++;
        const said =
          thisJudge === null ? "The style judge called it a tie." : thisJudge === pick ? "The style judge agrees." : "The style judge would have picked the other one.";
        if (rateMsg) rateMsg.textContent = `One DPO step on your pick: margin ${r.log.margin.toFixed(3)}. ${said}`;
        updateTally();
        void nextPair();
      },
      on,
    ),
  );
  [0, 1].forEach((i) =>
    $(`canvas[data-sk-pair="${i}"]`)?.addEventListener("click", () => pairPlayers[i]?.restart(), on),
  );

  // -------------------------------------------------------------------------------------------------------------
  // You try: the same sim, mask and judge the model gets, at 30 decisions a second (slowed down)

  const tryMsg = $("[data-sk-try-msg]");
  const vsEl = $("[data-sk-vs]");
  const showMeBtn = $<HTMLButtonElement>('[data-sk-act="showme"]');
  const speedSelect = $<HTMLSelectElement>("select[data-sk-speed]");
  const triesEl = $("[data-sk-tries]");
  const touch: Record<string, boolean> = {};
  const keyHeld: Record<string, boolean> = {};
  let order: ActionName[] = [];
  let run: TryRun | null = null;
  let modelReplay: Replay | null = null;

  const speed = () => {
    const n = Number(speedSelect?.value);
    return TRY_SPEEDS.includes(n) ? n : 0.5;
  };

  function press(name: ActionName) {
    order = order.filter((n) => n !== name);
    order.push(name);
    if (run && !run.started && !run.verdict) {
      run.started = true;
      if (tryMsg) tryMsg.textContent = "Go!";
    }
  }

  function heldAction(): ActionName | null {
    order = order.filter((n) => keyHeld[n] || touch[n]);
    return order.length ? order[order.length - 1] : null;
  }

  function updateTries() {
    if (!triesEl) return;
    const [lands, tries] = prefs.tries[prefs.trick] ?? [0, 0];
    triesEl.textContent = tries
      ? `Your clean ${TRICK_BY_ID[prefs.trick].name.toLowerCase()}s: ${lands} of ${tries} tries.`
      : `No tries at the ${TRICK_BY_ID[prefs.trick].name.toLowerCase()} yet.`;
  }

  function armTry() {
    if (!player) return;
    const s = newState();
    const seed = Math.floor(Math.random() * 1e9);
    const r: TryRun = {
      s,
      jitter: makeJitter(seed),
      frames: [frameOfState(s)],
      seed,
      trick: prefs.trick,
      started: false,
      simT: 0,
      nextT: 0,
      verdict: null,
    };
    run = r;
    modelReplay = null;
    order = [];
    buildStrip(null);
    if (showMeBtn) showMeBtn.disabled = true;
    if (vsEl) vsEl.textContent = "";
    setVerdict(null, "");
    if (sourceEl) sourceEl.textContent = `You · ${TRICK_BY_ID[r.trick].name} · ${speed()}× speed`;
    if (tryMsg) tryMsg.textContent = "Ready. The clock starts on your first key.";
    player.live((ms) => {
      if (r.started && !r.verdict) {
        r.simT += (ms / 1000) * speed();
        while (r.simT >= r.nextT && !r.verdict) {
          decide(r);
          r.nextT += HOLD * DT;
        }
      }
      return r.frames[Math.min(r.frames.length - 1, Math.floor(r.simT / DT + 1e-6))];
    });
  }

  function decide(r: TryRun) {
    const mask = actionMask(r.s);
    const name = heldAction();
    let a: number = ACT.idle;
    if (name === "pop") a = mask[ACT.pop] ? ACT.pop : mask[ACT.catch] ? ACT.catch : ACT.idle;
    else if (name && mask[ACT[name]]) a = ACT[name];
    const v = step(r.s, a, TRICK_BY_ID[r.trick], r.jitter, r.frames);
    if (v) void finishTry(r, v);
  }

  async function finishTry(r: TryRun, v: Verdict) {
    r.verdict = v;
    setVerdict(v, "You: ");
    buzz(v.grade === "bail" ? [30, 40, 30] : 15);
    const [lands, tries] = prefs.tries[r.trick] ?? [0, 0];
    prefs.tries[r.trick] = [lands + (v.grade === "clean" && v.landedAs === r.trick ? 1 : 0), tries + 1];
    savePrefs();
    updateTries();
    if (tryMsg) tryMsg.textContent = "Press R or Try again for another go.";
    const res = await send({ type: "replay", trick: r.trick, seed: r.seed, greedy: true });
    if (destroyed || run !== r || res.type !== "replay") return;
    modelReplay = res.replay;
    if (vsEl) vsEl.textContent = `Same seed, the model: ${summary(res.replay.verdict)}.`;
    if (showMeBtn) showMeBtn.disabled = false;
  }

  holdButtons(root, touch, (name) => {
    if (name in ACT) press(name as ActionName);
  });

  const isField = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));

  window.addEventListener(
    "keydown",
    (e) => {
      if (currentTab !== "try" || isField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "KeyR" && run?.verdict) {
        armTry();
        return;
      }
      const name = KEYMAP[e.code];
      if (!name || !run || run.verdict) return;
      e.preventDefault();
      if (e.repeat) return;
      keyHeld[name] = true;
      press(name);
    },
    on,
  );
  const heldCodes = new Set<string>();
  window.addEventListener("keydown", (e) => KEYMAP[e.code] && heldCodes.add(e.code), on);
  window.addEventListener(
    "keyup",
    (e) => {
      const name = KEYMAP[e.code];
      if (!name) return;
      // Several keys map to one action: it stays held while any of them is down
      keyHeld[name] = Object.entries(KEYMAP).some(([code, n]) => n === name && code !== e.code && heldCodes.has(code));
      heldCodes.delete(e.code);
    },
    on,
  );
  window.addEventListener(
    "blur",
    () => {
      heldCodes.clear();
      for (const k of Object.keys(keyHeld)) keyHeld[k] = false;
      order = [];
    },
    on,
  );

  // -------------------------------------------------------------------------------------------------------------
  // Tabs, trick picker and buttons

  const tabBtns = $$<HTMLButtonElement>("[data-sk-tab]");
  const panels = $$("[data-sk-panel]");
  let currentTab: Tab = prefs.tab;

  function setTab(tab: Tab, focus = false) {
    const leaving = currentTab;
    currentTab = tab;
    prefs.tab = tab;
    savePrefs();
    for (const b of tabBtns) {
      const sel = b.dataset.skTab === tab;
      b.setAttribute("aria-selected", String(sel));
      b.tabIndex = sel ? 0 : -1;
      if (sel && focus) b.focus();
    }
    for (const p of panels) p.hidden = p.dataset.skPanel !== tab;
    if (stageWrap) stageWrap.hidden = tab === "rate";
    if (leaving === "try" && tab !== "try") {
      run = null;
      player?.clear();
    }
    if (tab === "watch" || (tab === "train" && !shown)) void watch(prefs.trick, watchSeed, watchGreedy);
    if (tab === "train") queueCharts();
    if (tab === "rate" && !havePair) void nextPair();
    if (tab === "try" && !run) armTry();
  }

  tabBtns.forEach((b, i) => {
    b.addEventListener("click", () => setTab(b.dataset.skTab as Tab), on);
    b.addEventListener(
      "keydown",
      (e) => {
        const n = tabBtns.length;
        const j = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
        if (j < 0) return;
        e.preventDefault();
        setTab(tabBtns[j].dataset.skTab as Tab, true);
      },
      on,
    );
  });

  const trickBtns = $$<HTMLButtonElement>("[data-sk-trick]");

  function setTrick(id: TrickId, focus = false) {
    prefs.trick = id;
    savePrefs();
    for (const b of trickBtns) {
      const sel = b.dataset.skTrick === id;
      b.setAttribute("aria-checked", String(sel));
      b.tabIndex = sel ? 0 : -1;
      if (sel && focus) b.focus();
    }
    updateTrickStats();
    updateTries();
    if (currentTab === "watch" || currentTab === "train") void watch(id, EVAL_SEED, true);
    if (currentTab === "rate") void nextPair();
    if (currentTab === "try") armTry();
  }

  trickBtns.forEach((b, i) => {
    b.addEventListener("click", () => setTrick(b.dataset.skTrick as TrickId), on);
    b.addEventListener(
      "keydown",
      (e) => {
        const n = trickBtns.length;
        const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
        const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
        if (!fwd && !back) return;
        e.preventDefault();
        setTrick(trickBtns[(i + (fwd ? 1 : n - 1)) % n].dataset.skTrick as TrickId, true);
      },
      on,
    );
  });

  const act = (name: string, fn: () => void) => $(`[data-sk-act="${name}"]`)?.addEventListener("click", fn, on);
  act("replay", () => player?.restart());
  act("sample", () => void watch(prefs.trick, Math.floor(Math.random() * 1e9), false));
  act("pair", () => void nextPair());
  act("try", () => armTry());
  act("showme", () => {
    if (!modelReplay) return;
    run = null;
    playReplay(modelReplay, `The model · same seed as your try · ${TRICK_BY_ID[modelReplay.trick].name}`);
  });
  speedSelect?.addEventListener("change", () => currentTab === "try" && run && !run.started && armTry(), on);

  // -------------------------------------------------------------------------------------------------------------
  // Theme and size changes

  const themeObserver = new MutationObserver(() => {
    palette = readPalette(root);
    queueCharts();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const chartBox = $("[data-sk-charts]");
  const resize = new ResizeObserver(() => queueCharts());
  if (chartBox) resize.observe(chartBox);

  if (groupInput) groupInput.value = String(SHIPPED.config.grpo.group);
  updateGroupOut();
  updateTrainUi();
  updateTally();
  updateTrickStats();
  updateTries();
  for (const b of trickBtns) {
    const sel = b.dataset.skTrick === prefs.trick;
    b.setAttribute("aria-checked", String(sel));
    b.tabIndex = sel ? 0 : -1;
  }
  setTab(prefs.tab);

  return {
    destroy() {
      destroyed = true;
      ac.abort();
      themeObserver.disconnect();
      resize.disconnect();
      player?.destroy();
      pairPlayers.forEach((p) => p?.destroy());
      client.destroy();
    },
  };
}

function article(name: string) {
  return /^[aeiou]/i.test(name) ? `an ${name.toLowerCase()}` : `a ${name.toLowerCase()}`;
}

