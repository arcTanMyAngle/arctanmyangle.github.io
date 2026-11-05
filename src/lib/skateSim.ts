// Skate Lab physics: one flatground trick attempt as a short sequence of discrete foot "tokens". Pure (no DOM) and
// deterministic under a seed, so the trainer, the Worker, the tests and the page all see the same world.
//
// The board is a rigid body with three angles we care about: pitch θ (nose up +), roll φ (the kickflip axis,
// accumulated, so one full flip is 2π) and yaw ψ (the shove-it axis, accumulated). The rider is two numbers: crouch c
// (0 standing, 1 deep) and front-foot position f (0 at the bolts, 1 at the nose), plus whether their feet are on the
// board. The sim steps at 120 Hz; the policy picks one of eight actions at 30 Hz (each is held for four sim steps).
// Constants are hand-tuned for feel and learnability, not measured from real boards (see docs/skate/SKATE-LAB.md).
import { rng } from "./gameShell";

export type TrickId = "ollie" | "shuvit" | "kickflip" | "heelflip" | "varial" | "tre";

export interface Trick {
  id: TrickId;
  name: string;
  /** Target flips: +1 kickflip (toe side), −1 heelflip. */
  roll: number;
  /** Target shove rotation in turns: ½ is a shove-it, 1 is a 360 shove. */
  yaw: number;
  /** Lowest peak height (m) that still counts as a proper pop. */
  minH: number;
}

export const TRICKS: readonly Trick[] = [
  { id: "ollie", name: "Ollie", roll: 0, yaw: 0, minH: 0.3 },
  { id: "shuvit", name: "Shove-it", roll: 0, yaw: 0.5, minH: 0.25 },
  { id: "kickflip", name: "Kickflip", roll: 1, yaw: 0, minH: 0.3 },
  { id: "heelflip", name: "Heelflip", roll: -1, yaw: 0, minH: 0.3 },
  { id: "varial", name: "Varial kickflip", roll: 1, yaw: 0.5, minH: 0.3 },
  { id: "tre", name: "360 flip", roll: 1, yaw: 1, minH: 0.3 },
];

export const TRICK_BY_ID = Object.fromEntries(TRICKS.map((t) => [t.id, t])) as Record<TrickId, Trick>;

export const ACTIONS = ["idle", "crouch", "pop", "slide", "flickToe", "flickHeel", "scoop", "catch"] as const;
export type ActionName = (typeof ACTIONS)[number];
export const ACT = {
  idle: 0,
  crouch: 1,
  pop: 2,
  slide: 3,
  flickToe: 4,
  flickHeel: 5,
  scoop: 6,
  catch: 7,
} as const satisfies Record<ActionName, number>;
export const N_ACTIONS = ACTIONS.length;
export const OBS_SIZE = 21;

export const DT = 1 / 120;
export const HOLD = 4;
export const T_MAX = 1.8;
const G = 9.8;
const ROLL_SPEED = 3;

// Rider
const CROUCH_RATE = 3;
const CROUCH_DECAY = 1;
const POP_MIN = 0.3;
const POP_BASE = 1.6;
const POP_GAIN = 2.4;
const POP_SPIN = 9.5;
const SLIDE_RATE = 6;
const SLIDE_LIFT = 3;
const SLIDE_WIN = 0.4;
// Board pitch: feet on, a stiff spring toward a target set by the front foot; feet off, a looser one toward level.
const PITCH_GAIN = 0.38;
const PITCH_K = 180;
const PITCH_D = 27;
const FREE_K = 60;
const FREE_D = 10;
// Flick and scoop
const FLICK_WIN = 0.3;
const FLICK_RATE = 16;
const SCOOP_WIN = 0.3;
const SCOOP_RATE = 8;
// Catch: the feet kill most of the spin and nudge the board onto the nearest whole flip / half shove
const CATCH_DAMP = 40;
const SETTLE_WIN = 0.65;
const SETTLE_RATE = 3;
const CATCH_FOOT = 0.6;

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;

export type Phase = "roll" | "air" | "landed" | "bailed";
/** 0 feet on (before the trick), 1 off (board free), 2 caught. */
export type Feet = 0 | 1 | 2;

export interface SkateState {
  t: number;
  phase: Phase;
  x: number;
  y: number;
  vy: number;
  th: number;
  om: number;
  phi: number;
  phid: number;
  psi: number;
  psid: number;
  c: number;
  f: number;
  feet: Feet;
  /** Seconds since the pop, −1 before it. */
  popT: number;
  maxY: number;
  flicked: boolean;
  scoops: number;
}

export type Grade = "clean" | "sketchy" | "bail";

export interface Verdict {
  grade: Grade;
  /** The trick the landing counts as, or null for a bail or a rotation that isn't in TRICKS. */
  landedAs: TrickId | null;
  reward: number;
  reason: string;
  rollTurns: number;
  yawTurns: number;
  pitchDeg: number;
  height: number;
  time: number;
}

export function newState(): SkateState {
  return {
    t: 0,
    phase: "roll",
    x: 0,
    y: 0,
    vy: 0,
    th: 0,
    om: 0,
    phi: 0,
    phid: 0,
    psi: 0,
    psid: 0,
    c: 0,
    f: 0.2,
    feet: 0,
    popT: -1,
    maxY: 0,
    flicked: false,
    scoops: 0,
  };
}

/** Legal actions in this state (1 = allowed). The policy's softmax is masked with it: constrained decoding. */
export function actionMask(s: SkateState, out = new Uint8Array(N_ACTIONS)): Uint8Array {
  out.fill(0);
  out[ACT.idle] = 1;
  out[ACT.crouch] = 1;
  if (s.phase === "roll") {
    if (s.c >= POP_MIN) out[ACT.pop] = 1;
    return out;
  }
  if (s.phase !== "air") return out;
  if (s.feet === 0 && s.f < 1 && s.popT < SLIDE_WIN) out[ACT.slide] = 1;
  if (s.feet !== 2 && !s.flicked && s.popT < FLICK_WIN) {
    out[ACT.flickToe] = 1;
    out[ACT.flickHeel] = 1;
  }
  if (s.feet !== 2 && s.popT < SCOOP_WIN) out[ACT.scoop] = 1;
  if (s.feet === 1) out[ACT.catch] = 1;
  return out;
}

/** The policy's input: board, rider, clock and the goal (target turns and turns still to go). */
export function observe(s: SkateState, trick: Trick, out = new Float32Array(OBS_SIZE)): Float32Array {
  out[0] = s.y / 0.8;
  out[1] = s.vy / 4;
  out[2] = s.th;
  out[3] = s.om / 10;
  out[4] = Math.sin(s.phi);
  out[5] = Math.cos(s.phi);
  out[6] = s.phid / 15;
  out[7] = Math.sin(s.psi);
  out[8] = Math.cos(s.psi);
  out[9] = s.psid / 15;
  out[10] = s.c;
  out[11] = s.f;
  out[12] = s.feet === 1 ? 0 : 1;
  out[13] = s.popT < 0 ? 0 : Math.min(1, s.popT);
  out[14] = s.t / T_MAX;
  out[15] = s.phase === "roll" ? 1 : 0;
  out[16] = s.phase === "air" ? 1 : 0;
  out[17] = trick.roll;
  out[18] = trick.yaw;
  out[19] = trick.roll - s.phi / TAU;
  out[20] = trick.yaw - s.psi / TAU;
  return out;
}

export interface Jitter {
  /** Returns a multiplier near 1 (or exactly 1 with noise off). */
  (spread: number): number;
}

export function makeJitter(seed: number, noise = true): Jitter {
  const r = rng(seed);
  return (spread) => (noise ? 1 + spread * (2 * r() - 1) : 1);
}

/** Advance one decision: apply action `a` and integrate HOLD sim steps. Returns the verdict if the attempt ended. */
export function step(
  s: SkateState,
  a: number,
  trick: Trick,
  jitter: Jitter,
  frames?: Frame[],
): Verdict | null {
  // Impulses happen once, at the start of the decision
  if (s.phase === "roll" && a === ACT.pop && s.c >= POP_MIN) {
    s.phase = "air";
    s.vy = (POP_BASE + POP_GAIN * s.c) * jitter(0.04);
    s.om = POP_SPIN;
    s.c = 0;
    s.popT = 0;
  } else if (s.phase === "air") {
    if ((a === ACT.flickToe || a === ACT.flickHeel) && !s.flicked && s.feet !== 2 && s.popT < FLICK_WIN) {
      const dir = a === ACT.flickToe ? 1 : -1;
      s.phid += dir * FLICK_RATE * (0.5 + 0.5 * s.f) * jitter(0.05);
      s.flicked = true;
      s.feet = 1;
    } else if (a === ACT.scoop && s.feet !== 2 && s.popT < SCOOP_WIN) {
      s.psid += SCOOP_RATE * (1 - s.popT / SCOOP_WIN) * jitter(0.05);
      s.scoops++;
      s.feet = 1;
    } else if (a === ACT.catch && s.feet === 1) {
      s.feet = 2;
      s.f = Math.max(s.f, CATCH_FOOT);
    }
  }

  for (let i = 0; i < HOLD; i++) {
    const v = substep(s, a, trick);
    if (frames) frames.push(frameOf(s));
    if (v) return v;
  }
  return null;
}

function substep(s: SkateState, a: number, trick: Trick): Verdict | null {
  s.t += DT;
  s.x += ROLL_SPEED * DT;
  if (a === ACT.crouch) s.c = Math.min(1, s.c + CROUCH_RATE * DT);
  else s.c = Math.max(0, s.c - CROUCH_DECAY * DT);

  if (s.phase === "roll") {
    if (s.t >= T_MAX - DT / 2) return end(s, trick, bail(s, "never popped"));
    return null;
  }

  const sliding = a === ACT.slide && s.feet === 0 && s.popT < SLIDE_WIN;
  if (sliding) s.f = Math.min(1, s.f + SLIDE_RATE * DT);

  s.vy -= G * DT;
  if (sliding && s.vy > 0) s.vy += SLIDE_LIFT * DT;
  s.y += s.vy * DT;
  s.maxY = Math.max(s.maxY, s.y);

  const al =
    s.feet === 1
      ? -FREE_K * s.th - FREE_D * s.om
      : PITCH_K * (PITCH_GAIN * (1 - s.f) - s.th) - PITCH_D * s.om;
  s.om += al * DT;
  s.th += s.om * DT;

  if (s.feet === 2) {
    const damp = Math.exp(-CATCH_DAMP * DT);
    s.phid *= damp;
    s.psid *= damp;
    const k = 1 - Math.exp(-SETTLE_RATE * DT);
    const er = Math.round(s.phi / TAU) * TAU - s.phi;
    if (Math.abs(er) < SETTLE_WIN) s.phi += er * k;
    const ey = Math.round(s.psi / Math.PI) * Math.PI - s.psi;
    if (Math.abs(ey) < SETTLE_WIN) s.psi += ey * k;
  }
  s.phi += s.phid * DT;
  s.psi += s.psid * DT;
  s.popT += DT;

  if (s.y <= 0 && s.vy < 0) {
    s.y = 0;
    return end(s, trick, judgeLanding(s, trick));
  }
  if (s.t >= T_MAX - DT / 2) return end(s, trick, bail(s, "ran out of time"));
  return null;
}

function end(s: SkateState, _trick: Trick, v: Verdict): Verdict {
  s.phase = v.grade === "bail" ? "bailed" : "landed";
  return v;
}

function bail(s: SkateState, reason: string): Verdict {
  return {
    grade: "bail",
    landedAs: null,
    reward: 0,
    reason,
    rollTurns: s.phi / TAU,
    yawTurns: s.psi / TAU,
    pitchDeg: s.th * DEG,
    height: s.maxY,
    time: s.t,
  };
}

const CLEAN_ANGLE = 25;
const BAIL_ANGLE = 45;
const CLEAN_PITCH = 15;
const BAIL_PITCH = 25;
const ABSORB = 0.35;

/** Score a touchdown: which trick it counts as, how clean it was, and why. */
export function judgeLanding(s: SkateState, trick: Trick): Verdict {
  const rollN = Math.round(s.phi / TAU);
  const yawN = Math.round(s.psi / Math.PI) / 2;
  const rollErr = (s.phi - rollN * TAU) * DEG;
  const yawErr = (s.psi - yawN * TAU) * DEG;
  const pitch = s.th * DEG;
  const base = bail(s, "");

  if (s.feet === 1) return { ...base, reason: "landed with no feet on" };
  const worstAngle = Math.abs(rollErr) >= Math.abs(yawErr) ? "roll" : "yaw";
  const worstErr = worstAngle === "roll" ? rollErr : yawErr;
  // Short means the board hadn't turned far enough in the direction it was spinning; past means too far
  const spinDir = Math.sign(worstAngle === "roll" ? s.phi : s.psi);
  const angleText = () => {
    const word = worstErr * spinDir < 0 ? "short" : "past";
    return `caught ${Math.round(Math.abs(worstErr))}° ${word}${worstAngle === "yaw" ? " on the shove" : ""}`;
  };
  if (Math.abs(worstErr) > BAIL_ANGLE) return { ...base, reason: angleText() };
  if (Math.abs(pitch) > BAIL_PITCH) return { ...base, reason: pitch > 0 ? "tail-dragged" : "nose-dived" };

  const landedAs = TRICKS.find((t) => t.roll === rollN && t.yaw === yawN)?.id ?? null;
  const issues: string[] = [];
  if (Math.abs(worstErr) > CLEAN_ANGLE) issues.push(angleText());
  if (Math.abs(pitch) > CLEAN_PITCH) issues.push(pitch > 0 ? "landed tail-heavy" : "landed nose-heavy");
  if (s.c < ABSORB) issues.push("stiff legs");
  if (s.maxY < (TRICK_BY_ID[landedAs ?? trick.id] ?? trick).minH) issues.push("low pop");
  const grade: Grade = issues.length ? "sketchy" : "clean";
  const right = landedAs === trick.id;
  const reward = right ? (grade === "clean" ? 1 : 0.5) : 0;
  let reason = issues.length ? issues.join(", ") : "clean";
  if (!right) reason = `landed ${landedAs ? article(TRICK_BY_ID[landedAs].name) : describeTurns(rollN, yawN)}, wanted ${article(trick.name)}`;
  return { ...base, grade, landedAs, reward, reason };
}

function article(name: string) {
  return /^[aeiou]/i.test(name) ? `an ${name.toLowerCase()}` : `a ${name.toLowerCase()}`;
}

function describeTurns(roll: number, yaw: number) {
  const r = roll === 0 ? "" : `${Math.abs(roll)}× ${roll > 0 ? "kickflip" : "heelflip"}`;
  const y = yaw === 0 ? "" : `${yaw * 360}° shove`;
  return `a ${[r, y].filter(Boolean).join(" + ") || "trick"}`;
}

export interface Frame {
  t: number;
  x: number;
  y: number;
  th: number;
  phi: number;
  psi: number;
  c: number;
  f: number;
  feet: Feet;
}

function frameOf(s: SkateState): Frame {
  return { t: s.t, x: s.x, y: s.y, th: s.th, phi: s.phi, psi: s.psi, c: s.c, f: s.f, feet: s.feet };
}

/** Picks an action index from the observation and mask. */
export type Chooser = (obs: Float32Array, mask: Uint8Array, s: SkateState, k: number) => number;

export interface Attempt {
  trick: TrickId;
  actions: number[];
  /** One OBS_SIZE row per decision (only with keepObs). */
  obs: Float32Array[];
  masks: Uint8Array[];
  verdict: Verdict;
  frames: Frame[];
}

export interface AttemptOptions {
  seed?: number;
  noise?: boolean;
  record?: boolean;
  keepObs?: boolean;
}

/** Run one attempt to its end with `choose` picking every action. */
export function runAttempt(choose: Chooser, trick: Trick, opts: AttemptOptions = {}): Attempt {
  const { seed = 1, noise = true, record = false, keepObs = false } = opts;
  const s = newState();
  const jitter = makeJitter(seed, noise);
  const frames: Frame[] = [];
  if (record) frames.push(frameOf(s));
  const actions: number[] = [];
  const obsRows: Float32Array[] = [];
  const masks: Uint8Array[] = [];
  let obs = new Float32Array(OBS_SIZE);
  let mask = new Uint8Array(N_ACTIONS);
  for (let k = 0; ; k++) {
    observe(s, trick, obs);
    actionMask(s, mask);
    let a = choose(obs, mask, s, k);
    if (!mask[a]) a = ACT.idle;
    actions.push(a);
    if (keepObs) {
      obsRows.push(obs);
      masks.push(mask);
      obs = new Float32Array(OBS_SIZE);
      mask = new Uint8Array(N_ACTIONS);
    }
    const v = step(s, a, trick, jitter, record ? frames : undefined);
    if (v) return { trick: trick.id, actions, obs: obsRows, masks, verdict: v, frames };
  }
}

/** Seconds until touchdown from height y moving at vy. */
export function timeToLand(y: number, vy: number) {
  return (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, y))) / G;
}

const CATCH_LEAD = 0.05;

/**
 * The hand-written expert: a closed-loop controller, so its demonstrations stay good under noise. Stage 1 clones it
 * on ollie, shove-it and kickflip only; the tests use it to prove every trick in TRICKS can be landed.
 */
export function expertAction(s: SkateState, trick: Trick): number {
  if (s.phase === "roll") return s.c < 0.95 ? ACT.crouch : ACT.pop;
  if (s.phase !== "air") return ACT.idle;
  const tLand = timeToLand(s.y, s.vy);
  const wantYaw = trick.yaw * TAU;
  const wantRoll = trick.roll * TAU;
  const needYaw = trick.yaw !== 0;
  const needRoll = trick.roll !== 0;
  const slideTo = needYaw ? 0.5 : 0.8;

  if (s.feet === 0) {
    if (s.f < slideTo && s.popT < SLIDE_WIN) return ACT.slide;
    // A full 360 shove needs the early scoops, which are the strongest; everything else flicks first
    if (Math.abs(trick.yaw) >= 1 && s.popT < SCOOP_WIN) return ACT.scoop;
    if (needRoll && s.popT < FLICK_WIN) return trick.roll > 0 ? ACT.flickToe : ACT.flickHeel;
    if (needYaw && s.popT < SCOOP_WIN) return ACT.scoop;
    return tLand < 0.16 && s.vy < 0 ? ACT.crouch : ACT.idle;
  }
  if (s.feet === 1) {
    if (needRoll && !s.flicked && s.popT < FLICK_WIN) return trick.roll > 0 ? ACT.flickToe : ACT.flickHeel;
    // The flip went first (or right after the first scoop); scoop until the shove will finish when the flip does
    // (or by the landing), then catch on the flip axis and let the settle tidy a few degrees of shove
    const tr = needRoll && s.phid !== 0 ? (wantRoll - s.phi) / s.phid : 0;
    const target = needRoll ? Math.max(0.05, tr) : Math.max(0.12, tLand - 0.18);
    if (needYaw && s.popT < SCOOP_WIN && (wantYaw - s.psi) / target > s.psid + 0.15) return ACT.scoop;
    const ty = needYaw && s.psid !== 0 ? (wantYaw - s.psi) / s.psid : 0;
    if ((needRoll ? tr : ty) <= CATCH_LEAD || tLand < 0.12) return ACT.catch;
    return ACT.idle;
  }
  return tLand < 0.16 && s.vy < 0 ? ACT.crouch : ACT.idle;
}

export const EXPERT: Record<TrickId, Chooser> = Object.fromEntries(
  TRICKS.map((t) => [t.id, (_o: Float32Array, _m: Uint8Array, s: SkateState) => expertAction(s, t)]),
) as unknown as Record<TrickId, Chooser>;
