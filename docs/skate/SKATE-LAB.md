# Skate Lab — design note

`/skate/` is a flatground skate sim whose six tricks are learned by a small policy net, not scripted. It is trained the
way a language model is post-trained, in three stages: supervised fine-tuning (SFT) on demonstrations, then RL with a
verifiable reward (GRPO), then preference tuning (DPO). This note covers the moving parts, the constants, what the
recorded runs show, how to add a trick and how to retrain. The page itself (`src/pages/skate.astro`, "How it learns")
is the reader-facing write-up; this file is for whoever changes the code.

## Files

| File | Role |
| --- | --- |
| `src/lib/skateSim.ts` | The sim: state, action mask, observation, `step`, `judgeLanding`, `runAttempt`, the hand-written expert. No DOM. |
| `src/lib/skateNet.ts` | Tanh MLP with masked softmax, Adam, gradient code, int8 checkpoint (`toCheckpoint` / `fromCheckpoint`). |
| `src/lib/skateTrain.ts` | SFT, GRPO, DPO, curriculum, `passAtK`, evaluation, `DEFAULT_CONFIG`, `CURRICULUM`. |
| `src/lib/skateLabCore.ts` | One request in, one reply out (`init`, `reset`, `sft`, `grpo`, `dpo`, `pair`, `vote`, `replay`, `evaluate`, `config`). |
| `src/lib/skateWorker.ts` | Runs the core in a module Worker. |
| `src/lib/skateLabClient.ts` | Talks to the worker; falls back to running the core on the page, one request per timeout, if a Worker can't start or crashes. |
| `src/components/skate.ts` | The island: canvas replay, token strip, charts, Train/Rate/Try tabs. `mount(root) => { destroy }`. |
| `scripts/train-skate.mjs` | Build-time training (`bun run train:skate`). Writes the JSON below. |
| `src/data/skate-policy.generated.json` | The shipped int8 checkpoint plus every curve and number the page quotes. Machine-written; don't hand-edit. |
| `tests/skate.test.mjs` | Sim, net and algorithm unit tests (`bun test`). |

## The sim

A 2D side view with the board's flip (roll, φ) and shove (yaw, ψ) tracked as angles. It is a tuned toy, not a
rigid-body sim: pop height, flick torque and catch damping were set for feel and learnability, not measured from real
boards.

- **Timing:** physics at `DT = 1/120` s; the policy decides every `HOLD = 4` physics steps (30 Hz). An attempt is capped
  at `T_MAX = 1.8` s.
- **Phases:** `roll → air → landed | bailed`. Feet on the board: 0 (both, just after pop), 1 (front foot off, flicking),
  2 (caught).
- **Actions (`ACTIONS`, 8):** `idle`, `crouch`, `pop`, `slide`, `flickToe`, `flickHeel`, `scoop`, `catch`.
  `actionMask` makes illegal ones unpickable (no pop without a crouch, no flick before the pop, no catch on the ground…).
  This is the "constrained decoding" of the analogy.
- **Observation:** `OBS_SIZE = 21` floats from `observe(state, trick)`. It includes the trick's targets, so one net
  serves all six tricks.
- **Noise:** `makeJitter(seed)` perturbs pop strength and flick/scoop rates per attempt. A seed fixes an attempt
  exactly; seeds from `EVAL_SEED = 1_000_000` up are kept for evaluation.

### Sim constants (`skateSim.ts`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `G` | 9.8 | Gravity, m/s². |
| `ROLL_SPEED` | 3 | Forward speed, m/s. |
| `CROUCH_RATE` / `CROUCH_DECAY` | 3 / 1 | Crouch (0–1) gained per second while crouching / lost per second otherwise. |
| `POP_MIN` | 0.3 | Least crouch that allows a pop. |
| `POP_BASE` / `POP_GAIN` | 1.6 / 2.4 | Pop vertical speed (m/s) = base + gain × crouch. |
| `POP_SPIN` | 9.5 | Pitch rate (rad/s) the tail snap gives the board. |
| `SLIDE_RATE` / `SLIDE_LIFT` / `SLIDE_WIN` | 6 / 3 / 0.4 | Front-foot slide speed (foot position 0–1 per s), extra climb while rising (m/s²), and the window after pop it works in (s). |
| `PITCH_GAIN` / `PITCH_K` / `PITCH_D` | 0.38 / 180 / 27 | Feet on: a stiff spring toward pitch target `PITCH_GAIN·(1 − foot)`, so sliding levels the board. |
| `FREE_K` / `FREE_D` | 60 / 10 | Feet off: a looser spring toward level. |
| `FLICK_WIN` / `FLICK_RATE` | 0.3 / 16 | Flick window after pop (s) and the flip rate a flick adds (rad/s, scaled by how far the front foot slid). |
| `SCOOP_WIN` / `SCOOP_RATE` | 0.3 / 8 | Scoop window (s) and the shove rate a scoop adds (rad/s, fading over the window). |
| `CATCH_DAMP` | 40 | Decay rate (1/s) of flip and shove spin once caught. |
| `SETTLE_WIN` / `SETTLE_RATE` | 0.65 / 3 | After a catch, how close (rad) and how fast (1/s) the feet nudge the board onto the nearest whole flip / half shove. |
| `CATCH_FOOT` | 0.6 | Front-foot position a catch puts the foot at (at least). |

### The judge (`judgeLanding`)

The verifiable reward. At touchdown the flip is rounded to the nearest whole flip and the shove to the nearest half
turn; that rounded pair names the trick actually landed (`landedAs`), and the leftover angles are the errors.

- **Bail:** landed with only one foot on, the worse angle error over `BAIL_ANGLE = 45°`, or pitch over
  `BAIL_PITCH = 25°`.
- **Clean:** angle error under `CLEAN_ANGLE = 25°`, pitch under `CLEAN_PITCH = 15°`, legs absorbing (crouch at least
  `ABSORB = 0.35`), peak at least the landed trick's `minH`.
- **Sketchy:** landed, but one or more of those clean checks failed. The verdict lists which ("stiff legs", "caught
  12° short on the shove", …).

Reward is 1 for a clean landing of the asked-for trick, 0.5 for a sketchy one, and 0 for a bail or for landing a
different trick ("landed a shove-it, wanted a varial kickflip"). The DPO style score is
`2·height − |pitch°|/30 − 4·(|roll − target| + |yaw − target|)`, rotations in turns (`styleScore` in
`skateTrain.ts`); the page calls the last two terms flip error and spin error.

## The policy

`21 → 64 → 64 → 8` tanh MLP, Glorot init, masked softmax: 6,088 parameters (`params` in the JSON). It ships as an int8
checkpoint (one scale per tensor); the tests bound the round-trip error.

## Training (`DEFAULT_CONFIG`, seed 7)

| Stage | Settings | LLM analogue |
| --- | --- | --- |
| SFT | 6 epochs, batch 64, lr 2e-3, label smoothing 0.1 over **legal** actions only. Demos from `EXPERT`: 100 each of ollie, shove-it, kickflip; 8 each of heelflip and 360 flip (a "cold start"); none of varial. 11,452 decision tokens. | Supervised fine-tuning on demonstrations |
| GRPO | 220 steps, group G = 16, PPO clip 0.2, β = 0.02 (k3 KL to the SFT net), 2 epochs × 4 minibatches, lr 3e-4, temperature 1, std-normalised advantages, Dr. GRPO length term with fixed `T_NORM = 40` decisions. Curriculum in `CURRICULUM` order: the next trick unlocks when rolling pass@1 on the newest one reaches 0.6 over 3 checks (checks every 5 steps, 16 seeds). Zero-variance groups are dropped. | RL with verifiable rewards (DeepSeekMath / R1) |
| DPO | 30 rounds, β = 0.1, lr 1e-4, 16 pairs per round from 8 samples each, pairs ranked by the style score. Readers' Rate-tab votes are DPO pairs too, but they only change the copy in their own browser. | Preference tuning; the style score plays the reward model / LLM judge |

`CURRICULUM` is `ollie, shove-it, kickflip, varial, heelflip, 360 flip`. Varial comes fourth on purpose: it has no
demos, but it sits between two known tricks (kickflip's flick plus shove-it's scoop), so RL has to find it by
composition.

## What the shipped run shows

From `src/data/skate-policy.generated.json`, clean-landing rate on 100 held-out seeds, greedy / sampled:

| Trick | After SFT | After GRPO | After DPO |
| --- | --- | --- | --- |
| Ollie | 1.00 / 0.67 | 1.00 / 1.00 | 1.00 / 1.00 |
| Shove-it | 1.00 / 0.48 | 1.00 / 0.94 | 1.00 / 0.97 |
| Kickflip | 1.00 / 0.44 | 1.00 / 1.00 | 1.00 / 1.00 |
| Heelflip | 0.00 / 0.08 | 1.00 / 0.91 | 0.91 / 0.89 |
| Varial kickflip | 0.34 / 0.25 | 1.00 / 0.92 | 1.00 / 0.83 |
| 360 flip | 0.98 / 0.14 | 1.00 / 0.87 | 0.99 / 0.89 |

Curriculum unlock steps in the main run: varial at 0 (already above the bar from SFT), heelflip at 56, 360 flip at 75.

## Tuning log

What the recorded runs (main run plus the two ablations the trainer writes into the JSON) show, and what was changed
because of it. Constant-level iterations on the sim were made before this log started and aren't recorded here.

1. **RL from scratch starves.** The `scratch` ablation (fresh net, GRPO only, 30 steps) drops a median 83% of groups as
   zero-variance, because every attempt in the group scores 0. Reward creeps from 0.02 to 0.13 and no trick is ever
   landed greedily. **Fix:** SFT on expert demos first, as the page explains. That is the whole case for stage 1.
2. **Without a cold start, the hard rungs never unlock.** The `noColdStart` ablation (demos for the three basics only)
   unlocks heelflip at step 36 but never reaches 360 flip within 220 steps. **Fix:** 8 demos each of heelflip and
   360 flip in the SFT mix, as in DeepSeek-R1's cold-start data. With them, both unlock (steps 56 and 75), and all six
   tricks land at 1.00 greedy after GRPO.
3. **Varial is left to RL on purpose.** It needs no demos: SFT alone gets it 34% clean greedy, enough to pass the
   unlock bar at once, and GRPO takes it to 1.00. It stays out of the mix as the "found by RL" example.
4. **Length bias.** Plain GRPO divides each attempt's loss by its own length, which favours short attempts. **Fix:**
   Dr. GRPO's fixed normaliser (`T_NORM = 40`, about a typical attempt) instead of per-attempt length.
5. **DPO costs some reliability.** Tuning for style moves heelflip greedy from 1.00 to 0.91 and varial sampled from 0.92
   to 0.83, while 360 flip greedy moves from 1.00 to 0.99. The page computes and shows this as the "alignment tax"
   rather than tuning it away. If a future change makes the tax worse, raise DPO β or lower its lr before cutting
   rounds.

## How to add a trick

1. **`skateSim.ts`:** add the id to `TrickId` and an entry to `TRICKS` (`roll` in flips, `yaw` in turns, `minH`).
   Check that `judgeLanding`'s trick naming still tells it apart from its neighbours.
2. **Expert:** make sure `expertAction` lands it. It is generic over `roll`/`yaw`, so a new combination may just work;
   the "expert lands every trick clean with noise off" test in `tests/skate.test.mjs` proves it either way.
3. **`skateTrain.ts`:** place it in `CURRICULUM` (harder after easier, ideally next to the tricks it composes), and
   decide its SFT demos in `DEFAULT_CONFIG.sft.mix`: none if RL can find it, a small cold-start set if the ablation
   shows it never unlocks.
4. **`src/pages/skate.astro`:** add it to the `tricks` array (id, name, hue) in curriculum order. The picker, tables
   and charts read from that array and the JSON.
5. Retrain (below), then run the tests and check the page.

The observation size doesn't change, since the trick enters as its targets, but a new trick does change every number
on the page, so retrain rather than reuse the old checkpoint.

## How to retrain

```bash
bun run train:skate
```

The script trains SFT → GRPO → DPO with `DEFAULT_CONFIG`, runs the two ablations, evaluates every stage on 100 held-out
seeds, and overwrites `src/data/skate-policy.generated.json`. It logs progress with elapsed times to the console.

**The JSON deliberately omits wall time and the git commit**, so the same seed and code give a byte-identical file
and a rerun with no code changes shows no diff. (This deviates from the original plan, which asked for both to be
recorded.) To check a change is truly behaviour-neutral, rerun and `git diff --stat src/data/skate-policy.generated.json`.

After retraining, run `bun test`, `bun run check` and `bun run build`, and read the page's "How it learns" section.
Its numbers and the alignment-tax and ablation sentences are computed from the JSON, but its prose (for example "never
unlocks") should still match what the new run did.
