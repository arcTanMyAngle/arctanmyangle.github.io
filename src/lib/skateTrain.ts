// Skate Lab training: the three-stage recipe used to post-train LLMs, run on a 6k-parameter policy.
//   1. SFT: behaviour cloning on hand-written demonstrations: the basics in bulk, a small cold-start set
//      for heelflip and 360 flip, none at all for varial.
//   2. RLVR with GRPO: groups of sampled attempts per trick, the landing judge as a verifiable reward, group-relative
//      advantages (no critic), a PPO-clipped ratio and a k3 KL penalty to the SFT policy.
//   3. DPO: pairs of landed attempts, the better-looking one preferred, against the GRPO policy as reference.
// Pure and deterministic under the config's seed; used by the build script, the Worker and the tests.
import { rng } from "./gameShell";
import {
  adamStep,
  argmax,
  backward,
  clearGrad,
  cloneNet,
  createAdam,
  createNet,
  dLogProb,
  entropy,
  forward,
  makeTmp,
  newCache,
  sampleIndex,
  zeroGrad,
  type Adam,
  type Cache,
  type Grad,
  type Net,
} from "./skateNet";
import {
  EXPERT,
  N_ACTIONS,
  OBS_SIZE,
  TRICKS,
  TRICK_BY_ID,
  runAttempt,
  type Frame,
  type Trick,
  type TrickId,
  type Verdict,
} from "./skateSim";

export interface TrainConfig {
  seed: number;
  hidden: number[];
  /** Expert demos per trick in the SFT set. A trick left out (or at 0) can only be found by RL. */
  sft: { mix: Partial<Record<TrickId, number>>; epochs: number; batch: number; lr: number; smoothing: number };
  grpo: {
    /** Updates in a full run (the shipped checkpoint and the page's "Run all"). */
    steps: number;
    group: number;
    clip: number;
    beta: number;
    epochs: number;
    minibatches: number;
    lr: number;
    /** Rolling pass@1 on the newest rung that unlocks the next one. */
    unlockAt: number;
    window: number;
    /** Sampling temperature for rollouts; the ratio and the KL use the same tempered distribution. */
    temperature: number;
    /** Divide advantages by the group's std (GRPO) or only centre them (Dr. GRPO). */
    stdNorm: boolean;
    curriculum: boolean;
    evalEvery: number;
    evalN: number;
  };
  dpo: { rounds: number; beta: number; lr: number; pairs: number; samples: number };
}

export const DEFAULT_CONFIG: TrainConfig = {
  seed: 7,
  hidden: [64, 64],
  // The three basics in bulk, a small "cold-start" set for heelflip and 360 flip (DeepSeek-R1 style), none for varial
  sft: { mix: { ollie: 100, shuvit: 100, kickflip: 100, heelflip: 8, tre: 8 }, epochs: 6, batch: 64, lr: 2e-3, smoothing: 0.1 },
  grpo: {
    steps: 220,
    group: 16,
    clip: 0.2,
    beta: 0.02,
    epochs: 2,
    minibatches: 4,
    lr: 3e-4,
    unlockAt: 0.6,
    window: 3,
    temperature: 1,
    stdNorm: true,
    curriculum: true,
    evalEvery: 5,
    evalN: 16,
  },
  dpo: { rounds: 30, beta: 0.1, lr: 1e-4, pairs: 16, samples: 8 },
};

/** The order RL meets the tricks in: the basics, varial (no demos, between two known tricks), then the cold-start ones. */
export const CURRICULUM: readonly TrickId[] = ["ollie", "shuvit", "kickflip", "varial", "heelflip", "tre"];

/** Dr. GRPO's constant normaliser: a fixed "typical attempt length" in decisions, instead of each attempt's own. */
const T_NORM = 40;
/** Seeds 1e6 and up are kept for evaluation, so a training attempt never repeats an eval attempt's jitter. */
export const EVAL_SEED = 1_000_000;

export interface Rollout {
  trick: TrickId;
  seed: number;
  obs: Float32Array[];
  masks: Uint8Array[];
  actions: number[];
  /** log π(aₜ | sₜ) under the policy that sampled it. */
  logp: Float32Array;
  /** The full action distribution at every step (only with `probs`). */
  probs: Float32Array[] | null;
  verdict: Verdict;
  reward: number;
  frames: Frame[];
  /** Mean per-step entropy of the policy (nats). */
  entropy: number;
}

export interface SampleOptions {
  greedy?: boolean;
  temperature?: number;
  record?: boolean;
  probs?: boolean;
  noise?: boolean;
}

/** One attempt by the policy. The physics jitter comes from `seed`; the action draws from a second stream. */
export function sample(net: Net, trick: Trick, seed: number, opts: SampleOptions = {}): Rollout {
  const { greedy = false, temperature = 1, record = false, noise = true } = opts;
  const cache = newCache(net);
  const draw = rng((Math.imul(seed, 31) + 17) >>> 0);
  const logps: number[] = [];
  const probs: Float32Array[] | null = opts.probs ? [] : null;
  let ent = 0;
  const at = runAttempt(
    (obs, mask) => {
      const p = forward(net, obs, mask, cache, temperature);
      const a = greedy ? argmax(p) : sampleIndex(p, draw());
      logps.push(Math.log(Math.max(p[a], 1e-12)));
      ent += entropy(p);
      if (probs) probs.push(p.slice());
      return a;
    },
    trick,
    { seed, noise, record, keepObs: true },
  );
  return {
    trick: trick.id,
    seed,
    obs: at.obs,
    masks: at.masks,
    actions: at.actions,
    logp: Float32Array.from(logps),
    probs,
    verdict: at.verdict,
    reward: at.verdict.reward,
    frames: at.frames,
    entropy: ent / Math.max(1, at.actions.length),
  };
}

/** Unbiased pass@k from n samples with c correct (Chen et al. 2021), in the numerically stable product form. */
export function passAtK(n: number, c: number, k: number) {
  if (n - c < k) return 1;
  let prod = 1;
  for (let i = n - c + 1; i <= n; i++) prod *= 1 - k / i;
  return 1 - prod;
}

/** Group-relative advantages. Returns null for a group whose rewards are all equal: it carries no signal. */
export function groupAdvantages(rewards: number[], stdNorm = true): number[] | null {
  const n = rewards.length;
  const mean = rewards.reduce((s, r) => s + r, 0) / n;
  const std = Math.sqrt(rewards.reduce((s, r) => s + (r - mean) ** 2, 0) / n);
  if (std < 1e-6) return null;
  return rewards.map((r) => (stdNorm ? (r - mean) / (std + 1e-4) : r - mean));
}

/** The k3 estimator of KL(π ‖ π_ref) from one sampled token: r − log r − 1 with r = π_ref / π. Always ≥ 0. */
export function k3(logp: number, logRef: number) {
  const r = Math.exp(logRef - logp);
  return r - Math.log(r) - 1;
}

/** A hand-written style judge for the unattended DPO stage: high pop, flat landing, rotation finished on the mark. */
export function styleScore(v: Verdict, trick: Trick) {
  return 2 * v.height - Math.abs(v.pitchDeg) / 30 - 4 * (Math.abs(v.rollTurns - trick.roll) + Math.abs(v.yawTurns - trick.yaw));
}

export interface SftLog {
  epoch: number;
  loss: number;
  acc: number;
}

export interface TrickStat {
  /** Clean landings of the asked-for trick (reward 1). */
  pass1: number;
  pass4: number;
  reward: number;
}

export interface GrpoLog {
  step: number;
  reward: number;
  tricks: Partial<Record<TrickId, TrickStat>>;
  kl: number;
  entropy: number;
  clipFrac: number;
  /** Fraction of groups dropped because every attempt got the same reward. */
  zeroVar: number;
  gradNorm: number;
  unlocked: number;
}

export interface EvalLog {
  step: number;
  stage: Stage;
  tricks: Record<TrickId, EvalResult>;
}

export interface DpoLog {
  step: number;
  loss: number;
  /** β·(log-ratio of chosen − log-ratio of rejected), before the step. */
  margin: number;
  acc: number;
  chosen: number;
  rejected: number;
  pairs: number;
}

export type Stage = "init" | "sft" | "grpo" | "dpo";

export interface Lab {
  cfg: TrainConfig;
  net: Net;
  ref: Net | null;
  opt: Adam;
  rand: () => number;
  stage: Stage;
  /** Curriculum rungs open to RL. */
  unlocked: number;
  step: number;
  recent: Partial<Record<TrickId, number[]>>;
  logs: { sft: SftLog[]; grpo: GrpoLog[]; evals: EvalLog[]; dpo: DpoLog[] };
  cache: Cache;
  refCache: Cache;
  grad: Grad;
  tmp: Float32Array[];
  dz: Float32Array;
}

export function createLab(cfg: TrainConfig = DEFAULT_CONFIG, net?: Net): Lab {
  const n = net ?? createNet([OBS_SIZE, ...cfg.hidden, N_ACTIONS], cfg.seed);
  return {
    cfg,
    net: n,
    ref: null,
    opt: createAdam(n, cfg.sft.lr),
    rand: rng(cfg.seed * 7919 + 1),
    stage: "init",
    unlocked: 0,
    step: 0,
    recent: {},
    logs: { sft: [], grpo: [], evals: [], dpo: [] },
    cache: newCache(n),
    refCache: newCache(n),
    grad: zeroGrad(n),
    tmp: makeTmp(n),
    dz: new Float32Array(N_ACTIONS),
  };
}

function nextSeed(lab: Lab) {
  return 1 + Math.floor(lab.rand() * (EVAL_SEED - 2));
}

function shuffle<T>(xs: T[], r: () => number) {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

// Stage 1: SFT

export interface Demo {
  obs: Float32Array;
  mask: Uint8Array;
  action: number;
}

/** Jittered expert attempts on the demonstrated tricks, flattened to (observation, mask, action) tokens. */
export function buildDemos(lab: Lab, mix = lab.cfg.sft.mix): Demo[] {
  const out: Demo[] = [];
  for (const t of TRICKS) {
    const perTrick = mix[t.id] ?? 0;
    if (!perTrick) continue;
    let kept = 0;
    // Only clean landings go in the data, the way an SFT set is filtered for quality
    for (let tries = 0; kept < perTrick && tries < perTrick * 3; tries++) {
      const at = runAttempt(EXPERT[t.id], t, { seed: nextSeed(lab), keepObs: true });
      if (at.verdict.reward !== 1) continue;
      kept++;
      for (let k = 0; k < at.actions.length; k++) out.push({ obs: at.obs[k], mask: at.masks[k], action: at.actions[k] });
    }
  }
  return out;
}

export function startSft(lab: Lab) {
  lab.stage = "sft";
  lab.opt = createAdam(lab.net, lab.cfg.sft.lr);
}

/** One pass over the demos: cross-entropy against the expert's action, label-smoothed over the legal actions. */
export function sftEpoch(lab: Lab, demos: Demo[]): SftLog {
  const { batch, smoothing } = lab.cfg.sft;
  const order = shuffle(demos.slice(), lab.rand);
  const q = new Float32Array(N_ACTIONS);
  let loss = 0;
  let hits = 0;
  for (let i0 = 0; i0 < order.length; i0 += batch) {
    const mb = order.slice(i0, i0 + batch);
    clearGrad(lab.grad);
    for (const d of mb) {
      const p = forward(lab.net, d.obs, d.mask, lab.cache);
      let legal = 0;
      for (let j = 0; j < N_ACTIONS; j++) legal += d.mask[j];
      for (let j = 0; j < N_ACTIONS; j++) {
        q[j] = d.mask[j] ? smoothing / legal + (j === d.action ? 1 - smoothing : 0) : 0;
        if (q[j] > 0) loss -= q[j] * Math.log(Math.max(p[j], 1e-12));
        lab.dz[j] = p[j] - q[j];
      }
      if (argmax(p) === d.action) hits++;
      backward(lab.net, lab.cache, lab.dz, lab.grad, 1 / mb.length, lab.tmp);
    }
    adamStep(lab.net, lab.grad, lab.opt);
  }
  const log = { epoch: lab.logs.sft.length + 1, loss: loss / order.length, acc: hits / order.length };
  lab.logs.sft.push(log);
  return log;
}

// Stage 2: GRPO

/** Freeze the current policy as π_ref and open the curriculum up to and including the first trick with no demos. */
export function startGrpo(lab: Lab) {
  lab.stage = "grpo";
  lab.ref = cloneNet(lab.net);
  lab.opt = createAdam(lab.net, lab.cfg.grpo.lr);
  const firstNew = CURRICULUM.findIndex((id) => !lab.cfg.sft.mix[id]);
  lab.unlocked = lab.cfg.grpo.curriculum && firstNew >= 0 ? firstNew + 1 : CURRICULUM.length;
  lab.step = 0;
  lab.recent = {};
}

interface Scored {
  ro: Rollout;
  adv: number;
  logRef: Float32Array;
}

function logProbs(net: Net, cache: Cache, ro: Rollout, temperature = 1) {
  const out = new Float32Array(ro.actions.length);
  for (let k = 0; k < ro.actions.length; k++) {
    const p = forward(net, ro.obs[k], ro.masks[k], cache, temperature);
    out[k] = Math.log(Math.max(p[ro.actions[k]], 1e-12));
  }
  return out;
}

/** One GRPO update: sample a group per open trick, score, drop flat groups, then clipped policy-gradient epochs. */
export function grpoUpdate(lab: Lab): GrpoLog {
  const g = lab.cfg.grpo;
  if (!lab.ref) startGrpo(lab);
  const ref = lab.ref!;
  const open = CURRICULUM.slice(0, lab.unlocked);
  const kept: Scored[] = [];
  const tricks: Partial<Record<TrickId, TrickStat>> = {};
  let rewardSum = 0;
  let entSum = 0;
  let klSum = 0;
  let tokens = 0;
  let flat = 0;
  for (const id of open) {
    const t = TRICK_BY_ID[id];
    const group: Rollout[] = [];
    for (let i = 0; i < g.group; i++) group.push(sample(lab.net, t, nextSeed(lab), { temperature: g.temperature }));
    const rewards = group.map((ro) => ro.reward);
    const clean = rewards.filter((r) => r === 1).length;
    const mean = rewards.reduce((s, r) => s + r, 0) / g.group;
    tricks[id] = { pass1: clean / g.group, pass4: passAtK(g.group, clean, 4), reward: mean };
    rewardSum += mean;
    for (const ro of group) entSum += ro.entropy;
    const adv = groupAdvantages(rewards, g.stdNorm);
    if (!adv) {
      flat++;
      continue;
    }
    group.forEach((ro, i) => {
      const logRef = logProbs(ref, lab.refCache, ro, g.temperature);
      for (let k = 0; k < ro.actions.length; k++) klSum += k3(ro.logp[k], logRef[k]);
      tokens += ro.actions.length;
      kept.push({ ro, adv: adv[i], logRef });
    });
  }

  let clipped = 0;
  let seen = 0;
  let normSum = 0;
  let steps = 0;
  if (kept.length) {
    const nMb = Math.max(1, Math.min(g.minibatches, kept.length));
    for (let e = 0; e < g.epochs; e++) {
      const order = shuffle(kept.slice(), lab.rand);
      for (let m = 0; m < nMb; m++) {
        const mb = order.slice(Math.floor((m * order.length) / nMb), Math.floor(((m + 1) * order.length) / nMb));
        if (!mb.length) continue;
        clearGrad(lab.grad);
        const scale = 1 / (mb.length * T_NORM);
        for (const { ro, adv, logRef } of mb) {
          for (let k = 0; k < ro.actions.length; k++) {
            const a = ro.actions[k];
            const p = forward(lab.net, ro.obs[k], ro.masks[k], lab.cache, g.temperature);
            const logp = Math.log(Math.max(p[a], 1e-12));
            const ratio = Math.exp(logp - ro.logp[k]);
            const isClipped = (adv > 0 && ratio > 1 + g.clip) || (adv < 0 && ratio < 1 - g.clip);
            if (isClipped) clipped++;
            seen++;
            // d/dlogπ of [−min(ρA, clip(ρ)A) + β·k3]: −ρA where the ratio isn't clipped, plus β(1 − π_ref/π)
            const coef = (isClipped ? 0 : -ratio * adv) + g.beta * (1 - Math.exp(logRef[k] - logp));
            dLogProb(p, a, coef, lab.dz);
            backward(lab.net, lab.cache, lab.dz, lab.grad, scale, lab.tmp);
          }
        }
        normSum += adamStep(lab.net, lab.grad, lab.opt);
        steps++;
      }
    }
  }

  lab.step++;
  const log: GrpoLog = {
    step: lab.step,
    reward: rewardSum / open.length,
    tricks,
    kl: tokens ? klSum / tokens : 0,
    entropy: entSum / (open.length * g.group),
    clipFrac: seen ? clipped / seen : 0,
    zeroVar: flat / open.length,
    gradNorm: steps ? normSum / steps : 0,
    unlocked: lab.unlocked,
  };
  lab.logs.grpo.push(log);

  // Curriculum: open the next rung once the newest one is landed often enough
  for (const id of open) {
    const r = (lab.recent[id] ??= []);
    r.push(tricks[id]!.pass1);
    if (r.length > g.window) r.shift();
  }
  const newest = lab.recent[open[open.length - 1]]!;
  if (
    lab.unlocked < CURRICULUM.length &&
    newest.length >= g.window &&
    newest.reduce((s, x) => s + x, 0) / newest.length >= g.unlockAt
  ) {
    lab.unlocked++;
  }
  if (g.evalEvery > 0 && lab.step % g.evalEvery === 0) evalAll(lab);
  return log;
}

// Stage 3: DPO

export interface Pair {
  chosen: Rollout;
  rejected: Rollout;
}

export function startDpo(lab: Lab) {
  lab.stage = "dpo";
  lab.ref = cloneNet(lab.net);
  lab.opt = createAdam(lab.net, lab.cfg.dpo.lr);
  lab.step = 0;
}

/** Two landed attempts of `trick` by the current policy (on-policy pairs), or null if fewer than two landed. */
export function candidatePair(lab: Lab, trick: Trick, samples = lab.cfg.dpo.samples): [Rollout, Rollout] | null {
  const landed: Rollout[] = [];
  for (let i = 0; i < samples; i++) {
    const ro = sample(lab.net, trick, nextSeed(lab), { record: true });
    if (ro.verdict.landedAs === trick.id) landed.push(ro);
  }
  if (landed.length < 2) return null;
  landed.sort((a, b) => styleScore(b.verdict, trick) - styleScore(a.verdict, trick));
  return [landed[0], landed[landed.length - 1]];
}

/** The scripted judge's pick: best and worst style among the landed samples. */
export function judgedPair(lab: Lab, trick: Trick): Pair | null {
  const c = candidatePair(lab, trick);
  if (!c) return null;
  if (styleScore(c[0].verdict, trick) === styleScore(c[1].verdict, trick)) return null;
  return { chosen: c[0], rejected: c[1] };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** One DPO step on a batch of preference pairs: −log σ(β[(log π_w − log ref_w) − (log π_l − log ref_l)]). */
export function dpoUpdate(lab: Lab, pairs: Pair[]): DpoLog {
  if (!lab.ref) startDpo(lab);
  const ref = lab.ref!;
  const beta = lab.cfg.dpo.beta;
  const seq = (net: Net, cache: Cache, ro: Rollout) => logProbs(net, cache, ro).reduce((s, x) => s + x, 0);
  let loss = 0;
  let margin = 0;
  let acc = 0;
  let chosen = 0;
  let rejected = 0;
  clearGrad(lab.grad);
  for (const pr of pairs) {
    const rw = beta * (seq(lab.net, lab.cache, pr.chosen) - seq(ref, lab.refCache, pr.chosen));
    const rl = beta * (seq(lab.net, lab.cache, pr.rejected) - seq(ref, lab.refCache, pr.rejected));
    const m = rw - rl;
    loss += -Math.log(Math.max(sigmoid(m), 1e-12));
    margin += m;
    if (m > 0) acc++;
    chosen += rw;
    rejected += rl;
    // dL/dm = −(1 − σ(m)); m rises by β per unit of a chosen token's log-prob and falls by β for a rejected one
    const w = (1 - sigmoid(m)) * beta;
    for (const [ro, coef] of [
      [pr.chosen, -w],
      [pr.rejected, w],
    ] as const) {
      for (let k = 0; k < ro.actions.length; k++) {
        const p = forward(lab.net, ro.obs[k], ro.masks[k], lab.cache);
        dLogProb(p, ro.actions[k], coef, lab.dz);
        backward(lab.net, lab.cache, lab.dz, lab.grad, 1 / pairs.length, lab.tmp);
      }
    }
  }
  if (pairs.length) adamStep(lab.net, lab.grad, lab.opt);
  lab.step++;
  const n = Math.max(1, pairs.length);
  const log = { step: lab.step, loss: loss / n, margin: margin / n, acc: acc / n, chosen: chosen / n, rejected: rejected / n, pairs: pairs.length };
  if (lab.stage === "dpo") lab.logs.dpo.push(log);
  return log;
}

/** One unattended DPO step: judged pairs round-robin over the tricks. */
export function dpoRound(lab: Lab): DpoLog {
  const pairs: Pair[] = [];
  for (let i = 0, misses = 0; pairs.length < lab.cfg.dpo.pairs && misses < lab.cfg.dpo.pairs * 2; i++) {
    const p = judgedPair(lab, TRICKS[i % TRICKS.length]);
    if (p) pairs.push(p);
    else misses++;
  }
  return dpoUpdate(lab, pairs);
}

// Evaluation

export interface EvalResult {
  clean: number;
  landed: number;
  reward: number;
  /** Mean style score of the right-trick landings (0 if none). */
  style: number;
}

/** n attempts on fixed eval seeds; greedy decoding by default, the way the page replays the policy. */
export function evaluate(net: Net, trick: Trick, n = 100, seed0 = EVAL_SEED, greedy = true): EvalResult {
  let clean = 0;
  let landed = 0;
  let reward = 0;
  let style = 0;
  for (let i = 0; i < n; i++) {
    const ro = sample(net, trick, seed0 + i, { greedy });
    if (ro.reward === 1) clean++;
    if (ro.verdict.landedAs === trick.id) {
      landed++;
      style += styleScore(ro.verdict, trick);
    }
    reward += ro.reward;
  }
  return { clean: clean / n, landed: landed / n, reward: reward / n, style: landed ? style / landed : 0 };
}

export function evalAll(lab: Lab, n = lab.cfg.grpo.evalN): EvalLog {
  const tricks = Object.fromEntries(TRICKS.map((t) => [t.id, evaluate(lab.net, t, n)])) as Record<TrickId, EvalResult>;
  const log = { step: lab.step, stage: lab.stage, tricks };
  lab.logs.evals.push(log);
  return log;
}

/** A recorded attempt with the full action distribution at every step, for the replay and the token strip. */
export function replay(net: Net, trick: Trick, seed: number, greedy = true) {
  return sample(net, trick, seed, { greedy, record: true, probs: true });
}
