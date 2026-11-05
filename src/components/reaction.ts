// Reaction: wait for the signal, then hit it. Five rounds make one set; four modes change what the signal is.
// Contract: mount(root) => { destroy() }. `root` holds [data-pad] (the big target), [data-pad-title],
// [data-pad-sub], round chips [data-round="1..5"], [data-mode] (select), [data-sound], the stats [data-avg],
// [data-median], [data-sd], [data-fastest], [data-misses], [data-best], the history list [data-history] with its
// empty note [data-history-empty], and a polite live region [data-live]. The rules live in src/lib/reactionStats.ts.
//
// Timing is measured between timestamps on the same clock: for a visual signal the "go" stamp is the timestamp of
// the second animation frame after the change (the first frame it can be on screen), for the sound cue it is the
// moment the beep is scheduled plus the output latency the browser reports, and the hit is the input event's own
// timeStamp. A hidden tab or a blurred window drops the round rather than producing a bogus time. Results get a
// short sound, but the visual modes never get an audio cue for the signal itself.
import { STORAGE_KEYS, readJSON, readNumber, writeJSON } from "../lib/clientState";
import { buzz } from "../lib/gameShell";
import {
  ROUNDS,
  isMode,
  judge,
  pushHistory,
  readBests,
  readHistory,
  summarise,
  type Mode,
  type Outcome,
  type Side,
} from "../lib/reactionStats";
import { audioLatencyMs, audioRunning, noise, setMuted, tone, unlockAudio } from "../lib/sfx";

type Phase = "idle" | "waiting" | "go" | "nogo" | "hold" | "result" | "early" | "done";

const LABEL: Record<Mode, string> = { classic: "Classic", gonogo: "Go/No-Go", choice: "Choice", sound: "Sound cue" };
/** Share of Go/No-Go signals that are the blue decoy. */
const DECOY_RATE = 0.3;
/** How long the decoy stays up; holding still that long passes it. */
const HOLD_MS = 1000;

const INTRO: Record<Mode, string> = {
  classic: "Space, Enter or tap. Hit when the pad turns green. Five rounds.",
  gonogo: "Hit on green only. Blue means don't: hold still and it passes.",
  choice: "When it turns green, press the arrow it shows, or tap that half of the pad.",
  sound: "The pad stays still. Hit the moment you hear the beep.",
};

function soundStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.gameSound) !== "off";
  } catch {
    return true;
  }
}

export function mount(root: HTMLElement) {
  const pad = root.querySelector<HTMLElement>("[data-pad]")!;
  const title = root.querySelector<HTMLElement>("[data-pad-title]")!;
  const sub = root.querySelector<HTMLElement>("[data-pad-sub]")!;
  const chips = Array.from(root.querySelectorAll<HTMLElement>("[data-round]"));
  const modeEl = root.querySelector<HTMLSelectElement>("[data-mode]");
  const soundBtn = root.querySelector<HTMLButtonElement>("[data-sound]");
  const avgEl = root.querySelector<HTMLElement>("[data-avg]");
  const medianEl = root.querySelector<HTMLElement>("[data-median]");
  const sdEl = root.querySelector<HTMLElement>("[data-sd]");
  const fastestEl = root.querySelector<HTMLElement>("[data-fastest]");
  const missesEl = root.querySelector<HTMLElement>("[data-misses]");
  const bestEl = root.querySelector<HTMLElement>("[data-best]");
  const historyEl = root.querySelector<HTMLElement>("[data-history]");
  const historyEmpty = root.querySelector<HTMLElement>("[data-history-empty]");
  const live = root.querySelector<HTMLElement>("[data-live]");

  let phase: Phase = "idle";
  let times: number[] = [];
  let misses = 0;
  let delayTimer = 0;
  let holdTimer = 0;
  let raf = 0;
  let goStamp: number | null = null;
  let dueAt = 0;
  let want: Side | undefined;
  const bests = readBests(readJSON(STORAGE_KEYS.reactionBests), readNumber(STORAGE_KEYS.reactionBest));
  let history = readHistory(readJSON(STORAGE_KEYS.reactionHistory));

  const savedMode = (() => {
    try {
      return window.localStorage.getItem(STORAGE_KEYS.reactionMode);
    } catch {
      return null;
    }
  })();
  if (modeEl && isMode(savedMode)) modeEl.value = savedMode;
  const mode = (): Mode => (isMode(modeEl?.value) ? (modeEl!.value as Mode) : "classic");

  const say = (t: string) => {
    if (live) live.textContent = t;
  };
  const ms = (n: number) => (n ? `${n} ms` : "–");

  // --- Sound (shares the canvas games' on/off choice) ---
  let sound = soundStored();
  const paintSound = () => {
    setMuted(!sound);
    if (!soundBtn) return;
    soundBtn.setAttribute("aria-pressed", String(sound));
    soundBtn.textContent = sound ? "Sound on" : "Sound off";
  };
  const onSound = () => {
    sound = !sound;
    try {
      window.localStorage.setItem(STORAGE_KEYS.gameSound, sound ? "on" : "off");
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
    paintSound();
    if (sound) unlockAudio();
    if (phase === "idle" || phase === "done") intro();
  };

  const renderHistory = () => {
    if (!historyEl) return;
    const mine = history.filter((h) => h.mode === mode()).reverse();
    historyEl.replaceChildren(
      ...mine.map((h) => {
        const li = document.createElement("li");
        const avg = document.createElement("span");
        avg.className = "mono";
        avg.textContent = `${h.mean} ms`;
        const detail = document.createElement("span");
        detail.className = "muted";
        detail.textContent = `±${h.sd} ms${h.misses ? `, ${h.misses} ${h.misses === 1 ? "mistake" : "mistakes"}` : ""}`;
        li.append(avg, detail);
        return li;
      }),
    );
    historyEl.hidden = !mine.length;
    if (historyEmpty) historyEmpty.hidden = !!mine.length;
  };

  /** `look` is what the pad shows, which the sound cue keeps the same while `p` moves from waiting to go. */
  const show = (p: Phase, heading: string, detail: string, look: string = p) => {
    phase = p;
    pad.dataset.phase = look;
    if (p !== "go") delete pad.dataset.cue;
    title.textContent = heading;
    sub.textContent = detail;
    chips.forEach((chip, i) => {
      const t = times[i];
      chip.textContent = t ? `${t} ms` : "–";
      chip.classList.toggle("is-done", !!t);
      chip.classList.toggle("is-current", i === times.length && p !== "done" && p !== "idle");
    });
    const s = summarise(times);
    if (avgEl) avgEl.textContent = ms(s.mean);
    if (medianEl) medianEl.textContent = ms(s.median);
    if (sdEl) sdEl.textContent = times.length > 1 ? `±${s.sd} ms` : "–";
    if (fastestEl) fastestEl.textContent = ms(s.best);
    if (missesEl) missesEl.textContent = String(misses);
    if (bestEl) bestEl.textContent = ms(bests[mode()]);
  };

  const intro = () => {
    const off = mode() === "sound" && !sound;
    show("idle", off ? "Sound is off" : "Hit to start", off ? "This mode's signal is a beep. Turn sound on to play it." : INTRO[mode()]);
  };

  const cancelTimers = () => {
    clearTimeout(delayTimer);
    clearTimeout(holdTimer);
    cancelAnimationFrame(raf);
    goStamp = null;
    want = undefined;
  };

  // Two frames: the first runs before the paint that shows the change, the second just after it.
  const stampNextPaint = () => {
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame((t) => {
        goStamp = t;
      });
    });
  };

  const signal = () => {
    const m = mode();
    if (m === "sound") {
      if (!audioRunning()) {
        show("early", "No sound", "Sound isn't playing, so that round was dropped. Check sound is on, then hit to retry.");
        say("Sound isn't playing. Round dropped.");
        return;
      }
      tone(880, 0.12, "square", 0.3);
      goStamp = performance.now() + audioLatencyMs();
      show("go", "Listen…", sub.textContent ?? "", "listen");
      return;
    }
    if (m === "gonogo" && Math.random() < DECOY_RATE) {
      show("nogo", "Don't!", "Blue is a decoy. Hold still.");
      holdTimer = window.setTimeout(() => {
        show("hold", "Good hold", "You didn't take the bait. The next one is coming.");
        say("Good hold.");
        holdTimer = window.setTimeout(arm, 900);
      }, HOLD_MS);
      return;
    }
    if (m === "choice") {
      want = Math.random() < 0.5 ? "left" : "right";
      show("go", want === "left" ? "← Left" : "Right →", "Press that arrow, or tap that half.");
      pad.dataset.cue = want;
    } else show("go", "Go!", "Hit it now.");
    stampNextPaint();
  };

  const arm = () => {
    cancelTimers();
    const m = mode();
    const n = `Round ${times.length + 1} of ${ROUNDS}.`;
    if (m === "sound") show("waiting", "Listen…", `${n} Hit when you hear the beep.`, "listen");
    else show("waiting", "Wait for green…", `${n} Don't jump the gun.`);
    const delay = 1200 + Math.random() * 2000;
    dueAt = performance.now() + delay;
    delayTimer = window.setTimeout(signal, delay);
  };

  const finishSet = (last: number) => {
    const s = summarise(times);
    const m = mode();
    const record = !bests[m] || s.mean < bests[m];
    if (record) {
      bests[m] = s.mean;
      writeJSON(STORAGE_KEYS.reactionBests, bests);
    }
    history = pushHistory(history, { mode: m, mean: s.mean, sd: s.sd, misses });
    writeJSON(STORAGE_KEYS.reactionHistory, history);
    renderHistory();
    [660, 880, 1320].forEach((f, i) => window.setTimeout(() => tone(f, 0.12, "triangle", 0.16), i * 80));
    const spread = `Median ${s.median} ms, spread ±${s.sd} ms, fastest ${s.best} ms.`;
    show("done", `${s.mean} ms average`, `${spread} ${record ? `New ${LABEL[m]} best. ` : ""}Hit again for another five.`);
    say(`Round ${ROUNDS}: ${last} milliseconds. Average ${s.mean} milliseconds. ${spread}${record ? " New best." : ""}`);
  };

  const miss = (heading: string, detail: string, spoken: string) => {
    misses++;
    tone(140, 0.2, "sawtooth", 0.14, 90);
    buzz(40);
    show("early", heading, `${detail} Hit to retry the round.`);
    say(spoken);
  };

  const outcome = (o: Outcome) => {
    cancelTimers();
    switch (o.kind) {
      case "ok":
        times.push(o.ms);
        tone(1320, 0.03, "square", 0.1);
        if (times.length >= ROUNDS) return finishSet(o.ms);
        show("result", `${o.ms} ms`, "Hit again for the next round.");
        say(`Round ${times.length}: ${o.ms} milliseconds.`);
        return;
      case "early":
        return miss("Too soon!", `You pressed ${o.byMs} ms before the signal, so it doesn't count.`, `Too soon, by ${o.byMs} milliseconds.`);
      case "tooFast":
        return o.ms === null
          ? miss("Too soon!", "That press landed before the signal could reach you, so it counts as a false start.", "False start.")
          : miss("Too soon!", `${o.ms} ms is faster than humans react, so it counts as a false start.`, `False start: ${o.ms} milliseconds.`);
      case "decoy":
        return miss("Not that one!", "That was the blue decoy. Only green counts.", "That was the decoy.");
      case "wrongSide":
        return miss("Wrong side!", "The pad pointed the other way.", "Wrong side.");
    }
  };

  const hit = (stamp: number, side?: Side) => {
    switch (phase) {
      case "idle":
      case "done":
        unlockAudio();
        if (mode() === "sound" && !sound) return intro();
        times = [];
        misses = 0;
        arm();
        say(mode() === "sound" ? "Listen for the beep." : "Wait for green.");
        return;
      case "result":
      case "early":
      case "hold":
        unlockAudio();
        arm();
        return;
      case "waiting":
      case "go":
      case "nogo":
        // Choice needs a side once the signal is up; Space or Enter there is ignored rather than judged.
        if (phase === "go" && want && !side) return;
        outcome(judge({ phase, stamp, goAt: goStamp, dueAt, side, want }));
    }
  };

  const drop = (why: string) => {
    if (phase !== "waiting" && phase !== "go" && phase !== "nogo") return;
    cancelTimers();
    show("early", "Paused", `${why}, so that round was dropped. Hit to retry it.`);
    say("Round dropped.");
  };

  const isControl = (t: EventTarget | null) =>
    t instanceof Element && !!t.closest("a, button:not([data-pad]), select, input, textarea, [contenteditable]");

  const onPointer = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    let side: Side | undefined;
    if (mode() === "choice") {
      const r = pad.getBoundingClientRect();
      side = e.clientX < r.left + r.width / 2 ? "left" : "right";
    }
    hit(e.timeStamp, side);
  };
  // A touch only counts as the gesture that may start audio on pointerup, not pointerdown.
  const onPointerUp = () => {
    if (sound) unlockAudio();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    if (isControl(e.target)) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (mode() !== "choice") return;
      e.preventDefault();
      hit(e.timeStamp, e.key === "ArrowLeft" ? "left" : "right");
      return;
    }
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    hit(e.timeStamp);
  };
  const onVis = () => {
    if (document.hidden) drop("You left the tab");
  };
  const onBlur = () => drop("The window lost focus");
  const onMode = () => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.reactionMode, mode());
    } catch {
      // Storage unavailable: the mode resets next visit.
    }
    cancelTimers();
    times = [];
    misses = 0;
    renderHistory();
    intro();
    say(`${LABEL[mode()]} mode.`);
  };

  pad.addEventListener("pointerdown", onPointer);
  pad.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKey);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVis);
  modeEl?.addEventListener("change", onMode);
  soundBtn?.addEventListener("click", onSound);
  if (soundBtn) soundBtn.hidden = false;
  paintSound();
  renderHistory();
  root.dataset.ready = "";
  intro();

  return {
    destroy() {
      cancelTimers();
      pad.removeEventListener("pointerdown", onPointer);
      pad.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      modeEl?.removeEventListener("change", onMode);
      soundBtn?.removeEventListener("click", onSound);
    },
  };
}
