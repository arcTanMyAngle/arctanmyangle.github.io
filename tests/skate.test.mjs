import { describe, expect, test } from "bun:test";
import { ACT, EXPERT, N_ACTIONS, OBS_SIZE, TRICKS, TRICK_BY_ID, T_MAX, actionMask, newState, runAttempt } from "../src/lib/skateSim.ts";
import {
  backward,
  createNet,
  dLogProb,
  forward,
  fromCheckpoint,
  makeTmp,
  newCache,
  toCheckpoint,
  zeroGrad,
} from "../src/lib/skateNet.ts";
import {
  DEFAULT_CONFIG,
  buildDemos,
  createLab,
  dpoUpdate,
  evaluate,
  groupAdvantages,
  grpoUpdate,
  judgedPair,
  k3,
  passAtK,
  sftEpoch,
  startDpo,
  startGrpo,
  startSft,
} from "../src/lib/skateTrain.ts";
import shipped from "../src/data/skate-policy.generated.json";

describe("Skate Lab physics", () => {
  test("the expert lands every trick clean, with and without noise", () => {
    for (const t of TRICKS) {
      expect(runAttempt(EXPERT[t.id], t, { noise: false }).verdict.reward).toBe(1);
      for (let seed = 1; seed <= 20; seed++) expect(runAttempt(EXPERT[t.id], t, { seed }).verdict.landedAs).toBe(t.id);
    }
  });

  test("no pop without a crouch, and no flick, scoop or catch before the pop", () => {
    const m = actionMask(newState());
    expect(m[ACT.pop]).toBe(0);
    for (const a of [ACT.flickToe, ACT.flickHeel, ACT.scoop, ACT.catch, ACT.slide]) expect(m[a]).toBe(0);
    const crouched = { ...newState(), c: 1 };
    expect(actionMask(crouched)[ACT.pop]).toBe(1);
  });

  test("every attempt ends within the time cap, whatever the policy does", () => {
    for (const t of TRICKS) {
      for (const choose of [() => ACT.idle, () => ACT.crouch, (_o, m) => m.lastIndexOf(1)]) {
        const at = runAttempt(choose, t, { seed: 3 });
        expect(at.verdict.time).toBeLessThanOrEqual(T_MAX + 1e-9);
      }
    }
  });

  test("the judge names the trick that was actually landed", () => {
    const v = runAttempt(EXPERT.shuvit, TRICK_BY_ID.kickflip, { noise: false }).verdict;
    expect(v.landedAs).toBe("shuvit");
    expect(v.reward).toBe(0);
    expect(v.reason).toBe("landed a shove-it, wanted a kickflip");
  });
});

describe("Skate Lab network", () => {
  test("backward matches a finite-difference gradient of coef · log p(a)", () => {
    const net = createNet([5, 6, 4, 3], 11);
    // Bigger last layer than the init gives, so the softmax isn't near-uniform
    for (let i = 0; i < net.W[2].length; i++) net.W[2][i] *= 10;
    const x = Float32Array.from([0.3, -0.7, 0.2, 0.9, -0.1]);
    const mask = Uint8Array.from([1, 0, 1]);
    const a = 2;
    const coef = -0.8;
    const f = () => coef * Math.log(forward(net, x, mask, newCache(net))[a]);
    const cache = newCache(net);
    const g = zeroGrad(net);
    const p = forward(net, x, mask, cache);
    backward(net, cache, dLogProb(p, a, coef, new Float32Array(3)), g, 1, makeTmp(net));
    const eps = 1e-2;
    let checked = 0;
    for (let l = 0; l < net.W.length; l++) {
      for (const [param, grad] of [
        [net.W[l], g.W[l]],
        [net.b[l], g.b[l]],
      ]) {
        for (let i = 0; i < param.length; i += 3) {
          const keep = param[i];
          param[i] = keep + eps;
          const up = f();
          param[i] = keep - eps;
          const down = f();
          param[i] = keep;
          const num = (up - down) / (2 * eps);
          expect(Math.abs(num - grad[i])).toBeLessThan(2e-3 + 0.02 * Math.abs(num));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  test("masked actions get exactly zero probability", () => {
    const net = createNet([OBS_SIZE, 8, N_ACTIONS], 2);
    const mask = new Uint8Array(N_ACTIONS);
    mask[ACT.idle] = mask[ACT.pop] = 1;
    const p = forward(net, new Float32Array(OBS_SIZE).fill(0.5), mask, newCache(net));
    for (let j = 0; j < N_ACTIONS; j++) if (!mask[j]) expect(p[j]).toBe(0);
    expect(p[ACT.idle] + p[ACT.pop]).toBeCloseTo(1, 6);
  });

  test("the int8 checkpoint round-trips within half a quantisation step", () => {
    const net = createNet([OBS_SIZE, 64, 64, N_ACTIONS], 5);
    const ck = toCheckpoint(net);
    const back = fromCheckpoint(JSON.parse(JSON.stringify(ck)));
    for (let l = 0; l < net.W.length; l++) {
      const step = ck.W[l].scale;
      for (let i = 0; i < net.W[l].length; i++) expect(Math.abs(back.W[l][i] - net.W[l][i])).toBeLessThanOrEqual(step / 2 + 1e-7);
    }
  });
});

describe("Skate Lab algorithms", () => {
  test("group advantages have zero mean and unit spread; a flat group gives none", () => {
    const adv = groupAdvantages([1, 0, 0, 1, 0.5, 0, 1, 1]);
    const mean = adv.reduce((s, x) => s + x, 0) / adv.length;
    const sd = Math.sqrt(adv.reduce((s, x) => s + (x - mean) ** 2, 0) / adv.length);
    expect(mean).toBeCloseTo(0, 6);
    expect(sd).toBeCloseTo(1, 3);
    expect(groupAdvantages([0, 0, 0, 0])).toBeNull();
    expect(groupAdvantages([1, 1, 1])).toBeNull();
  });

  test("the k3 KL estimate is never negative and is zero at the reference", () => {
    expect(k3(-1.2, -1.2)).toBe(0);
    for (const [a, b] of [
      [-0.1, -3],
      [-3, -0.1],
      [-2, -2.5],
      [-0.01, -0.02],
    ])
      expect(k3(a, b)).toBeGreaterThan(0);
  });

  test("pass@k matches the closed form 1 − C(n−c, k) / C(n, k)", () => {
    const choose = (n, k) => {
      let r = 1;
      for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
      return r;
    };
    for (const [n, c, k] of [
      [16, 0, 1],
      [16, 3, 1],
      [16, 3, 4],
      [16, 12, 4],
      [10, 9, 3],
      [20, 5, 16],
    ])
      expect(passAtK(n, c, k)).toBeCloseTo(1 - choose(n - c, k) / choose(n, k), 9);
    expect(passAtK(16, 4, 1)).toBeCloseTo(0.25, 9);
  });

  test("a DPO step raises the chosen-minus-rejected margin", () => {
    const lab = createLab(structuredClone(DEFAULT_CONFIG), fromCheckpoint(shipped.checkpoint));
    startDpo(lab);
    const pairs = [];
    for (let i = 0; pairs.length < 4 && i < 40; i++) {
      const p = judgedPair(lab, TRICKS[i % TRICKS.length]);
      if (p) pairs.push(p);
    }
    expect(pairs.length).toBe(4);
    const first = dpoUpdate(lab, pairs);
    expect(first.margin).toBeCloseTo(0, 6);
    const second = dpoUpdate(lab, pairs);
    expect(second.margin).toBeGreaterThan(0);
    expect(second.loss).toBeLessThan(first.loss);
  });

  test("a short seeded GRPO run from SFT raises kickflip's sampled success", () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.sft.mix = { ollie: 40, shuvit: 40, kickflip: 40 };
    cfg.sft.epochs = 4;
    cfg.grpo.evalEvery = 0;
    const lab = createLab(cfg);
    startSft(lab);
    const demos = buildDemos(lab);
    for (let e = 0; e < cfg.sft.epochs; e++) sftEpoch(lab, demos);
    const before = evaluate(lab.net, TRICK_BY_ID.kickflip, 64, undefined, false).reward;
    startGrpo(lab);
    for (let i = 0; i < 10; i++) grpoUpdate(lab);
    const after = evaluate(lab.net, TRICK_BY_ID.kickflip, 64, undefined, false).reward;
    expect(after).toBeGreaterThan(before + 0.15);
  });
});

describe("Skate Lab shipped checkpoint", () => {
  const net = fromCheckpoint(shipped.checkpoint);
  // Floors set from the committed run's own numbers, a little under them; never above
  const FLOOR = { ollie: 0.95, shuvit: 0.95, kickflip: 0.95, varial: 0.95, heelflip: 0.88, tre: 0.95 };

  test("greedy pass@1 over 100 seeded attempts clears each trick's floor", () => {
    for (const t of TRICKS) expect(evaluate(net, t, 100).clean).toBeGreaterThanOrEqual(FLOOR[t.id]);
  });

  test("the file's reported results are what the checkpoint actually does", () => {
    for (const t of TRICKS) expect(evaluate(net, t, shipped.evalN).clean).toBeCloseTo(shipped.final.dpo[t.id].greedy, 3);
  });
});
