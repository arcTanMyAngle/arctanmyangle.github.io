// Reaction: wait for the pad to turn, then hit it. Five rounds, averaged.
// Contract: mount(root) => { destroy() }. `root` holds [data-pad] (the big target), [data-pad-title],
// [data-pad-sub], round chips [data-round="1..5"], [data-avg], [data-best] and a polite live region.
//
// Timing is measured between event timestamps on the same clock: the "go" stamp is the timestamp of
// the second animation frame after the colour change (the first frame the change can be on screen),
// and the hit is the input event's own timeStamp. A hidden tab aborts the round rather than
// producing a bogus time.

const ROUNDS = 5;
const BEST_KEY = "proto-c-reaction-best";
const MIN_MS = 100; // Faster than any human: treat as an anticipation, i.e. a false start.

type Phase = "idle" | "waiting" | "go" | "result" | "early" | "done";

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function writeBest(n: number) {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    /* storage blocked */
  }
}

export function mount(root: HTMLElement) {
  const pad = root.querySelector<HTMLElement>("[data-pad]")!;
  const title = root.querySelector<HTMLElement>("[data-pad-title]")!;
  const sub = root.querySelector<HTMLElement>("[data-pad-sub]")!;
  const chips = Array.from(root.querySelectorAll<HTMLElement>("[data-round]"));
  const avgEl = root.querySelector<HTMLElement>("[data-avg]");
  const bestEl = root.querySelector<HTMLElement>("[data-best]");
  const live = root.querySelector<HTMLElement>("[data-live]");

  let phase: Phase = "idle";
  let times: number[] = [];
  let delayTimer = 0;
  let raf = 0;
  let goStamp: number | null = null;
  let best = readBest();

  const say = (t: string) => {
    if (live) live.textContent = t;
  };
  const avg = () => Math.round(times.reduce((a, b) => a + b, 0) / times.length);

  const show = (p: Phase, heading: string, detail: string) => {
    phase = p;
    pad.dataset.phase = p;
    title.textContent = heading;
    sub.textContent = detail;
    chips.forEach((chip, i) => {
      const t = times[i];
      chip.textContent = t ? `${t} ms` : "–";
      chip.classList.toggle("is-done", !!t);
      chip.classList.toggle("is-current", i === times.length && p !== "done" && p !== "idle");
    });
    if (avgEl) avgEl.textContent = times.length ? `${avg()} ms` : "–";
    if (bestEl) bestEl.textContent = best ? `${best} ms` : "–";
  };

  const cancelTimers = () => {
    clearTimeout(delayTimer);
    cancelAnimationFrame(raf);
    goStamp = null;
  };

  const arm = () => {
    cancelTimers();
    show("waiting", "Wait for green…", `Round ${times.length + 1} of ${ROUNDS}. Don't jump the gun.`);
    const delay = 1200 + Math.random() * 2000;
    delayTimer = window.setTimeout(() => {
      show("go", "Go!", "Hit it now.");
      // Two frames: the first runs before the paint that shows "go", the second just after it.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame((t) => {
          goStamp = t;
        });
      });
    }, delay);
  };

  const finishRound = (ms: number) => {
    times.push(ms);
    if (times.length >= ROUNDS) {
      const a = avg();
      const record = !best || a < best;
      if (record) {
        best = a;
        writeBest(a);
      }
      show("done", `${a} ms average`, record ? "New best on this device. Hit again to play another five." : "Hit again to play another five.");
      say(`Round ${ROUNDS}: ${ms} milliseconds. Average ${a} milliseconds.${record ? " New best." : ""}`);
    } else {
      show("result", `${ms} ms`, "Hit again for the next round.");
      say(`Round ${times.length}: ${ms} milliseconds.`);
    }
  };

  const hit = (stamp: number) => {
    switch (phase) {
      case "idle":
      case "done":
        times = [];
        arm();
        say("Wait for green.");
        break;
      case "result":
      case "early":
        arm();
        say("Wait for green.");
        break;
      case "waiting":
        cancelTimers();
        show("early", "Too soon!", "That one doesn't count. Hit to retry the round.");
        say("Too soon. That round doesn't count.");
        break;
      case "go": {
        // Input before the go frame was stamped can't be measured honestly: count it as early.
        const ms = goStamp === null ? -1 : Math.round(stamp - goStamp);
        cancelTimers();
        if (ms < MIN_MS) {
          show("early", "Too soon!", "Faster than a human can react, so it counts as a false start.");
          say("False start. That round doesn't count.");
        } else finishRound(ms);
        break;
      }
    }
  };

  const isControl = (t: EventTarget | null) =>
    t instanceof Element && !!t.closest("a, button:not([data-pad]), select, input, textarea, [contenteditable]");

  const onPointer = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    hit(e.timeStamp);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    if (isControl(e.target)) return;
    e.preventDefault();
    hit(e.timeStamp);
  };
  const onVis = () => {
    if (document.hidden && (phase === "waiting" || phase === "go")) {
      cancelTimers();
      show("early", "Paused", "You left the tab, so that round was dropped. Hit to retry it.");
    }
  };

  pad.addEventListener("pointerdown", onPointer);
  window.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVis);
  root.dataset.ready = "";
  show("idle", "Hit to start", "Space, Enter or tap. Five rounds.");

  return {
    destroy() {
      cancelTimers();
      pad.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
