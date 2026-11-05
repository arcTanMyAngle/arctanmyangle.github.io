// Skate Lab training core: one request in, one reply out, no DOM. src/lib/skateWorker.ts runs it in a Worker; when a
// Worker can't start, src/lib/skateLabClient.ts runs the same handler on the page between timeouts. Each request is
// one unit of work (an SFT epoch, a GRPO step, a DPO round), so pausing is the client simply not sending the next one.
import { TRICK_BY_ID, TRICKS, type Frame, type TrickId, type Verdict } from "./skateSim";
import { fromCheckpoint, type Checkpoint } from "./skateNet";
import {
  buildDemos,
  createLab,
  DEFAULT_CONFIG,
  dpoRound,
  dpoUpdate,
  candidatePair,
  evaluate,
  EVAL_SEED,
  grpoUpdate,
  replay,
  sftEpoch,
  startDpo,
  startGrpo,
  startSft,
  styleScore,
  type Demo,
  type DpoLog,
  type EvalLog,
  type EvalResult,
  type GrpoLog,
  type Lab,
  type Rollout,
  type SftLog,
  type Stage,
  type TrainConfig,
} from "./skateTrain";

export type Source = "shipped" | "fresh";

export type LabRequest =
  | { type: "init"; checkpoint: Checkpoint }
  /** Back to the shipped checkpoint, or to a freshly initialised net. */
  | { type: "reset"; source: Source }
  | { type: "sft" }
  | { type: "grpo" }
  | { type: "dpo" }
  | { type: "pair"; trick: TrickId }
  | { type: "vote"; pick: 0 | 1 }
  | { type: "replay"; trick: TrickId; seed: number; greedy: boolean }
  | { type: "evaluate"; n?: number }
  | { type: "config"; group?: number; beta?: number };

export interface LabStatus {
  source: Source;
  stage: Stage;
  step: number;
  unlocked: number;
  group: number;
  beta: number;
  /** Units of work in a full run of the current stage (epochs, steps or rounds). */
  total: number;
}

export interface Attempt {
  frames: Frame[];
  actions: number[];
  verdict: Verdict;
}

export interface Replay extends Attempt {
  trick: TrickId;
  seed: number;
  probs: Float32Array[];
  masks: Uint8Array[];
}

export type LabReply =
  | { type: "ready"; status: LabStatus }
  | { type: "sft"; status: LabStatus; log: SftLog; done: boolean }
  | { type: "grpo"; status: LabStatus; log: GrpoLog; eval: EvalLog | null; done: boolean }
  | { type: "dpo"; status: LabStatus; log: DpoLog; done: boolean }
  /** Two landed attempts in random order; `judge` is the side the scripted style score prefers. */
  | { type: "pair"; status: LabStatus; pair: [Attempt, Attempt] | null; judge: 0 | 1 | null }
  | { type: "vote"; status: LabStatus; log: DpoLog | null }
  | { type: "replay"; status: LabStatus; replay: Replay }
  | { type: "evaluate"; status: LabStatus; tricks: Record<TrickId, { greedy: EvalResult; sampled: EvalResult }> }
  | { type: "error"; message: string };

const attemptOf = (ro: Rollout): Attempt => ({ frames: ro.frames, actions: ro.actions, verdict: ro.verdict });

export function createLabCore() {
  let shipped: Checkpoint | null = null;
  let source: Source = "fresh";
  let lab: Lab = createLab(structuredClone(DEFAULT_CONFIG));
  let demos: Demo[] | null = null;
  let pending: [Rollout, Rollout] | null = null;
  // The G and β the reader picked survive a reset
  const overrides: Partial<Pick<TrainConfig["grpo"], "group" | "beta">> = {};

  function rebuild(next: Source) {
    // Always a fresh copy: the lab holds its config by reference and "config" writes into it
    const cfg = structuredClone(DEFAULT_CONFIG);
    Object.assign(cfg.grpo, overrides);
    // No net means createLab initialises one from cfg.seed, so a fresh start is the same run every time
    lab = createLab(cfg, next === "shipped" && shipped ? fromCheckpoint(shipped) : undefined);
    source = next === "shipped" && shipped ? "shipped" : "fresh";
    demos = null;
    pending = null;
  }

  function status(): LabStatus {
    const c = lab.cfg;
    const total = lab.stage === "sft" ? c.sft.epochs : lab.stage === "grpo" ? c.grpo.steps : lab.stage === "dpo" ? c.dpo.rounds : 0;
    return { source, stage: lab.stage, step: lab.stage === "sft" ? lab.logs.sft.length : lab.step, unlocked: lab.unlocked, group: c.grpo.group, beta: c.grpo.beta, total };
  }

  function handle(req: LabRequest): LabReply {
    switch (req.type) {
      case "init":
        shipped = req.checkpoint;
        rebuild("shipped");
        return { type: "ready", status: status() };
      case "reset":
        rebuild(req.source);
        return { type: "ready", status: status() };
      case "sft": {
        if (lab.stage !== "sft") {
          startSft(lab);
          lab.logs.sft = [];
        }
        demos ??= buildDemos(lab);
        const log = sftEpoch(lab, demos);
        return { type: "sft", status: status(), log, done: lab.logs.sft.length >= lab.cfg.sft.epochs };
      }
      case "grpo": {
        if (lab.stage !== "grpo") {
          startGrpo(lab);
          lab.logs.grpo = [];
          lab.logs.evals = [];
        }
        const before = lab.logs.evals.length;
        const log = grpoUpdate(lab);
        const ev = lab.logs.evals.length > before ? lab.logs.evals[lab.logs.evals.length - 1] : null;
        return { type: "grpo", status: status(), log, eval: ev, done: lab.step >= lab.cfg.grpo.steps };
      }
      case "dpo": {
        if (lab.stage !== "dpo") {
          startDpo(lab);
          lab.logs.dpo = [];
        }
        const log = dpoRound(lab);
        return { type: "dpo", status: status(), log, done: lab.step >= lab.cfg.dpo.rounds };
      }
      case "pair": {
        const trick = TRICK_BY_ID[req.trick];
        const c = candidatePair(lab, trick);
        if (!c) {
          pending = null;
          return { type: "pair", status: status(), pair: null, judge: null };
        }
        // Shuffle the sides so the better-scored attempt isn't always on the left
        const flip = lab.rand() < 0.5;
        pending = flip ? [c[1], c[0]] : c;
        const s0 = styleScore(pending[0].verdict, trick);
        const s1 = styleScore(pending[1].verdict, trick);
        const judge = s0 === s1 ? null : s0 > s1 ? 0 : 1;
        return { type: "pair", status: status(), pair: [attemptOf(pending[0]), attemptOf(pending[1])], judge };
      }
      case "vote": {
        if (!pending) return { type: "vote", status: status(), log: null };
        if (lab.stage !== "dpo") startDpo(lab);
        const chosen = pending[req.pick];
        const rejected = pending[1 - req.pick];
        pending = null;
        const log = dpoUpdate(lab, [{ chosen, rejected }]);
        return { type: "vote", status: status(), log };
      }
      case "replay": {
        const ro = replay(lab.net, TRICK_BY_ID[req.trick], req.seed, req.greedy);
        return {
          type: "replay",
          status: status(),
          replay: { ...attemptOf(ro), trick: req.trick, seed: req.seed, probs: ro.probs ?? [], masks: ro.masks },
        };
      }
      case "evaluate": {
        const n = req.n ?? 100;
        const tricks = Object.fromEntries(
          TRICKS.map((t) => [t.id, { greedy: evaluate(lab.net, t, n, EVAL_SEED, true), sampled: evaluate(lab.net, t, n, EVAL_SEED, false) }]),
        ) as Record<TrickId, { greedy: EvalResult; sampled: EvalResult }>;
        return { type: "evaluate", status: status(), tricks };
      }
      case "config": {
        if (req.group !== undefined) overrides.group = Math.max(2, Math.min(64, Math.round(req.group)));
        if (req.beta !== undefined) overrides.beta = Math.max(0, Math.min(1, req.beta));
        Object.assign(lab.cfg.grpo, overrides);
        return { type: "ready", status: status() };
      }
    }
  }

  return {
    handle(req: LabRequest): LabReply {
      try {
        return handle(req);
      } catch (err) {
        return { type: "error", message: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export type LabCore = ReturnType<typeof createLabCore>;
