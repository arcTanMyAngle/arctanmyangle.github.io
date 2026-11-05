#!/usr/bin/env bun
// Build-time script: trains the Skate Lab policy (SFT → GRPO → DPO) with the fixed seed in DEFAULT_CONFIG, runs the
// two ablations the page quotes, and writes src/data/skate-policy.generated.json: the int8 checkpoint plus every curve
// and number the page shows. Machine-written; don't hand-edit. The same seed gives a byte-identical file, so nothing
// run-specific (wall time, commit) goes in it.
import { fromCheckpoint, paramCount, toCheckpoint } from "../src/lib/skateNet.ts";
import { TRICKS } from "../src/lib/skateSim.ts";
import {
  DEFAULT_CONFIG,
  CURRICULUM,
  buildDemos,
  createLab,
  dpoRound,
  evaluate,
  grpoUpdate,
  sftEpoch,
  startDpo,
  startGrpo,
  startSft,
} from "../src/lib/skateTrain.ts";

const OUTPUT_PATH = new URL("../src/data/skate-policy.generated.json", import.meta.url);
const FINAL_N = 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const t0 = performance.now();
const log = (msg) => console.log(`[train-skate] ${((performance.now() - t0) / 1000).toFixed(1)}s ${msg}`);

/** Greedy (the page's replays) and sampled (temperature 1) results on the fixed eval seeds, per trick. */
function finalEval(net) {
  return Object.fromEntries(
    TRICKS.map((t) => {
      const g = evaluate(net, t, FINAL_N);
      const s = evaluate(net, t, FINAL_N, undefined, false);
      return [t.id, { greedy: r3(g.clean), landed: r3(g.landed), style: r3(g.style), sampled: r3(s.clean) }];
    }),
  );
}

function runSft(lab) {
  startSft(lab);
  const demos = buildDemos(lab);
  for (let e = 0; e < lab.cfg.sft.epochs; e++) sftEpoch(lab, demos);
  return demos.length;
}

/** GRPO logs as columns (one array per series), which is smaller and is what the charts draw. */
function grpoColumns(logs) {
  const pass1 = Object.fromEntries(CURRICULUM.map((id) => [id, logs.map((l) => (l.tricks[id] ? r3(l.tricks[id].pass1) : null))]));
  return {
    reward: logs.map((l) => r3(l.reward)),
    kl: logs.map((l) => r3(l.kl)),
    entropy: logs.map((l) => r3(l.entropy)),
    clipFrac: logs.map((l) => r3(l.clipFrac)),
    zeroVar: logs.map((l) => r3(l.zeroVar)),
    unlocked: logs.map((l) => l.unlocked),
    pass1,
  };
}

/** The step at which each rung opened (null if it never did). */
function unlockSteps(logs, first) {
  const at = {};
  CURRICULUM.forEach((id, i) => (at[id] = i < first ? 0 : null));
  for (const l of logs) for (let i = 0; i < l.unlocked; i++) at[CURRICULUM[i]] ??= l.step;
  return at;
}

// Main run
const cfg = structuredClone(DEFAULT_CONFIG);
const lab = createLab(cfg);
const sftTokens = runSft(lab);
const afterSft = finalEval(lab.net);
log(`SFT on ${sftTokens} tokens: ${JSON.stringify(Object.fromEntries(Object.entries(afterSft).map(([k, v]) => [k, v.greedy])))}`);

startGrpo(lab);
const firstOpen = lab.unlocked;
for (let i = 0; i < cfg.grpo.steps; i++) grpoUpdate(lab);
const grpoLogs = lab.logs.grpo;
const evals = lab.logs.evals;
const afterGrpo = finalEval(lab.net);
log(`GRPO ×${cfg.grpo.steps}: ${JSON.stringify(Object.fromEntries(Object.entries(afterGrpo).map(([k, v]) => [k, v.greedy])))}`);

startDpo(lab);
for (let i = 0; i < cfg.dpo.rounds; i++) dpoRound(lab);
const dpoLogs = lab.logs.dpo;
// The shipped numbers are the int8 checkpoint's own, since that is what the page runs, not the float net's
const checkpoint = toCheckpoint(lab.net);
const afterDpo = finalEval(fromCheckpoint(JSON.parse(JSON.stringify(checkpoint))));
log(`DPO ×${cfg.dpo.rounds}: ${JSON.stringify(Object.fromEntries(Object.entries(afterDpo).map(([k, v]) => [k, `${v.greedy}/${v.style}`])))}`);

// Ablation 1: GRPO from random weights, every trick open. With no SFT nearly every group is all-zero: no gradient.
const SCRATCH_STEPS = 30;
const scratchCfg = structuredClone(DEFAULT_CONFIG);
scratchCfg.sft.mix = {};
scratchCfg.grpo.curriculum = false;
scratchCfg.grpo.evalEvery = 0;
const scratch = createLab(scratchCfg);
startGrpo(scratch);
for (let i = 0; i < SCRATCH_STEPS; i++) grpoUpdate(scratch);
const scratchLogs = scratch.logs.grpo;
log(`from scratch: zeroVar ${r3(scratchLogs.reduce((s, l) => s + l.zeroVar, 0) / SCRATCH_STEPS)}`);

// Ablation 2: the basics only, no cold-start demos for heelflip and 360 flip ("R1-Zero" for those two)
const zeroCfg = structuredClone(DEFAULT_CONFIG);
zeroCfg.sft.mix = { ollie: 100, shuvit: 100, kickflip: 100 };
zeroCfg.grpo.evalEvery = 0;
const zero = createLab(zeroCfg);
runSft(zero);
startGrpo(zero);
const zeroFirst = zero.unlocked;
for (let i = 0; i < zeroCfg.grpo.steps; i++) grpoUpdate(zero);
const zeroFinal = finalEval(zero.net);
log(`no cold start: ${JSON.stringify(Object.fromEntries(Object.entries(zeroFinal).map(([k, v]) => [k, v.greedy])))}`);

const out = {
  generatedBy: "scripts/train-skate.mjs",
  config: cfg,
  params: paramCount(lab.net),
  sftTokens,
  evalN: FINAL_N,
  checkpoint,
  sft: lab.logs.sft.map((l) => ({ epoch: l.epoch, loss: r3(l.loss), acc: r3(l.acc) })),
  grpo: grpoColumns(grpoLogs),
  unlockedAt: unlockSteps(grpoLogs, firstOpen),
  evals: {
    step: evals.map((e) => e.step),
    clean: Object.fromEntries(TRICKS.map((t) => [t.id, evals.map((e) => r3(e.tricks[t.id].clean))])),
  },
  dpo: {
    loss: dpoLogs.map((l) => r3(l.loss)),
    margin: dpoLogs.map((l) => r3(l.margin)),
    acc: dpoLogs.map((l) => r3(l.acc)),
    pairs: dpoLogs.map((l) => l.pairs),
  },
  final: { sft: afterSft, grpo: afterGrpo, dpo: afterDpo },
  ablations: {
    scratch: {
      steps: SCRATCH_STEPS,
      zeroVar: scratchLogs.map((l) => r3(l.zeroVar)),
      reward: scratchLogs.map((l) => r3(l.reward)),
      final: finalEval(scratch.net),
    },
    noColdStart: {
      mix: zeroCfg.sft.mix,
      steps: zeroCfg.grpo.steps,
      pass1: grpoColumns(zero.logs.grpo).pass1,
      unlockedAt: unlockSteps(zero.logs.grpo, zeroFirst),
      final: zeroFinal,
    },
  },
};

await Bun.write(OUTPUT_PATH, JSON.stringify(out) + "\n");
log(`wrote ${new URL(OUTPUT_PATH).pathname} (${(JSON.stringify(out).length / 1024).toFixed(1)} KiB)`);
