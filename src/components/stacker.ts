// Stacker: stop the sliding row over the one below; whatever overhangs is cut off.
// Contract: mount(root) => { destroy() }. `root` holds the SSR grid ([data-cell] spans, rows top to
// bottom), [data-act="main"], [data-act="pause"], [data-sound], [data-difficulty] (select), [data-score],
// [data-height], [data-streak], [data-best], [data-state] and a polite live region [data-live] that only speaks on
// placements, pauses and game over, never per tick. The rules live in src/lib/stackerLogic.ts.
//
// Ticks are a setTimeout chain, not a rAF loop: the row moves in whole cells, so there is nothing
// to interpolate. A hidden tab or a blurred window pauses the game; Space, Enter or the button resumes it.
import { STORAGE_KEYS, readJSON, readNumber, writeJSON } from "../lib/clientState";
import { buzz } from "../lib/gameShell";
import { noise, setMuted, tone, unlockAudio } from "../lib/sfx";
import { COLS, ROWS, isSpeed, placeRow, readBests, score, stepMs, widthForRow, type Speed } from "../lib/stackerLogic";

export { COLS, ROWS };

type State = "idle" | "playing" | "paused" | "over" | "won";
const LABEL: Record<Speed, string> = { easy: "Easy", normal: "Normal", hard: "Hard", impossible: "Impossible" };

function soundStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.gameSound) !== "off";
  } catch {
    return true;
  }
}

export function mount(root: HTMLElement) {
  const cells = Array.from(root.querySelectorAll<HTMLElement>("[data-cell]"));
  const mainBtn = root.querySelector<HTMLButtonElement>('[data-act="main"]')!;
  const pauseBtn = root.querySelector<HTMLButtonElement>('[data-act="pause"]');
  const soundBtn = root.querySelector<HTMLButtonElement>("[data-sound]");
  const pad = root.querySelector<HTMLElement>("[data-pad]")!;
  const difficultyEl = root.querySelector<HTMLSelectElement>("[data-difficulty]");
  const scoreEl = root.querySelector<HTMLElement>("[data-score]");
  const heightEl = root.querySelector<HTMLElement>("[data-height]");
  const streakEl = root.querySelector<HTMLElement>("[data-streak]");
  const bestEl = root.querySelector<HTMLElement>("[data-best]");
  const live = root.querySelector<HTMLElement>("[data-live]");
  const stateEl = root.querySelector<HTMLElement>("[data-state]");

  const cell = (row: number, col: number) => cells[(ROWS - 1 - row) * COLS + col];

  let state: State = "idle";
  let stack: [number, number][] = []; // [from, len] per placed row
  let row = 0;
  let width = 3;
  let pos = 0;
  let dir = 1;
  let timer = 0;
  let perfects = 0;
  let streak = 0;
  let bestStreak = 0;
  const bests = readBests(readJSON(STORAGE_KEYS.stackerBests), readNumber(STORAGE_KEYS.stackerBest));

  const saved = (() => {
    try {
      return window.localStorage.getItem(STORAGE_KEYS.stackerSpeed);
    } catch {
      return null;
    }
  })();
  if (difficultyEl && isSpeed(saved)) difficultyEl.value = saved;
  const speed = (): Speed => (isSpeed(difficultyEl?.value) ? (difficultyEl!.value as Speed) : "normal");

  const say = (text: string) => {
    if (live) live.textContent = text;
  };

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
  };

  const render = () => {
    for (const c of cells) c.classList.remove("is-on", "is-mover");
    stack.forEach(([from, len], r) => {
      for (let c = from; c < from + len; c++) cell(r, c).classList.add("is-on");
    });
    if (state === "playing" || state === "paused")
      for (let c = pos; c < pos + width; c++) cell(row, c).classList.add("is-mover", "is-on");
    if (scoreEl) scoreEl.textContent = String(score(stack.length, perfects));
    if (heightEl) heightEl.textContent = String(stack.length);
    if (streakEl) streakEl.textContent = streak > 1 ? `×${streak}` : bestStreak ? `best ×${bestStreak}` : "–";
    const best = bests[speed()];
    if (bestEl) bestEl.textContent = best ? String(best) : "–";
    root.dataset.game = state;
    if (stateEl) {
      stateEl.textContent =
        state === "idle"
          ? "Press Space or tap to start"
          : state === "playing"
            ? `Row ${row + 1} of ${ROWS}`
            : state === "paused"
              ? "Paused"
              : state === "won"
                ? "Top reached!"
                : "Game over";
    }
    mainBtn.textContent =
      state === "playing" ? "Stop" : state === "paused" ? "Resume" : state === "idle" ? "Start" : "Play again";
    if (pauseBtn) pauseBtn.hidden = state !== "playing";
    if (difficultyEl) difficultyEl.disabled = state === "playing" || state === "paused";
  };

  const tick = () => {
    if (pos + dir < 0 || pos + dir + width > COLS) dir = -dir;
    pos += dir;
    render();
    schedule();
  };
  const schedule = () => {
    clearTimeout(timer);
    if (state === "playing" && !document.hidden) timer = window.setTimeout(tick, stepMs(row, speed()));
  };

  const replay = (els: HTMLElement[], cls: string) => {
    for (const el of els) el.classList.remove(cls);
    if (els.length) void els[0].offsetWidth;
    for (const el of els) el.classList.add(cls);
  };

  const finish = (won: boolean) => {
    state = won ? "won" : "over";
    clearTimeout(timer);
    const h = stack.length;
    const total = score(h, perfects);
    const s = speed();
    const record = total > bests[s];
    if (record) {
      bests[s] = total;
      writeJSON(STORAGE_KEYS.stackerBests, bests);
    }
    render();
    if (won) [523, 659, 784, 1047].forEach((f, i) => window.setTimeout(() => tone(f, 0.14, "square", 0.14), i * 90));
    else tone(330, 0.4, "sawtooth", 0.16, 90);
    const tail = `Score ${total} (${h} rows, ${perfects} perfect).${record ? ` New ${LABEL[s]} best.` : ""}`;
    say(won ? `You reached the top. ${tail}` : `Game over at height ${h}. ${tail}`);
  };

  const start = () => {
    unlockAudio();
    stack = [];
    row = 0;
    width = widthForRow(0, speed());
    pos = 0;
    dir = 1;
    perfects = 0;
    streak = 0;
    bestStreak = 0;
    state = "playing";
    for (const c of cells) c.classList.remove("is-cut", "is-perfect");
    render();
    say(`Started on ${LABEL[speed()]}.`);
    schedule();
  };

  const pause = (why: string) => {
    if (state !== "playing") return;
    state = "paused";
    clearTimeout(timer);
    render();
    say(`${why} Press Space or Resume to carry on.`);
  };
  const resume = () => {
    if (state !== "paused") return;
    state = "playing";
    render();
    say(`Resumed on row ${row + 1}.`);
    schedule();
  };

  const place = () => {
    const p = placeRow(pos, width, stack[row - 1]);
    // Cells that overhang the row below fall away.
    replay(p.cut.map((c) => cell(row, c)), "is-cut");
    if (p.cut.length) {
      noise(0.18, 0.22, 700);
      buzz(30);
    }
    if (p.len <= 0) return finish(false);
    stack.push([p.from, p.len]);
    if (p.perfect) {
      perfects++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      const placed: HTMLElement[] = [];
      for (let c = p.from; c < p.from + p.len; c++) placed.push(cell(row, c));
      replay(placed, "is-perfect");
      tone(660 + streak * 60, 0.12, "triangle", 0.18, 990 + streak * 60);
    } else {
      streak = 0;
      if (!p.cut.length) tone(440 + row * 30, 0.06, "square", 0.12);
    }
    if (stack.length === ROWS) return finish(true);
    row++;
    width = Math.min(p.len, widthForRow(row, speed()));
    // New rows enter from a random edge so the timing can't be memorised.
    dir = Math.random() < 0.5 ? 1 : -1;
    pos = dir === 1 ? 0 : COLS - width;
    say(
      p.perfect
        ? `Perfect${streak > 1 ? `, streak ${streak}` : ""}. Row ${row + 1}.`
        : p.cut.length
          ? `Trimmed. Row ${row + 1} is ${width} wide.`
          : `Placed row ${row}.`,
    );
    render();
    schedule();
  };

  const act = () => {
    if (state === "playing") place();
    else if (state === "paused") resume();
    else start();
  };

  const isControl = (t: EventTarget | null) =>
    t instanceof Element && !!t.closest("button, a, select, input, textarea, [contenteditable]");

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    if ((e.key === "p" || e.key === "P" || e.key === "Escape") && (state === "playing" || state === "paused")) {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      if (state === "playing") pause("Paused.");
      else resume();
      return;
    }
    if (e.key !== " " && e.key !== "Enter") return;
    // A focused button or select handles its own keys; everything else on the page drives the game.
    if (isControl(e.target)) return;
    e.preventDefault();
    act();
  };
  const onPad = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    act();
  };
  const onMain = () => act();
  const onPause = () => pause("Paused.");
  const onVis = () => {
    if (document.hidden) pause("Paused while the tab was hidden.");
  };
  const onBlur = () => pause("Paused while the window was in the background.");
  const onDifficulty = () => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.stackerSpeed, speed());
    } catch {
      // Storage unavailable: the speed resets next visit.
    }
    render();
  };

  window.addEventListener("keydown", onKey);
  window.addEventListener("blur", onBlur);
  pad.addEventListener("pointerdown", onPad);
  mainBtn.addEventListener("click", onMain);
  pauseBtn?.addEventListener("click", onPause);
  soundBtn?.addEventListener("click", onSound);
  difficultyEl?.addEventListener("change", onDifficulty);
  document.addEventListener("visibilitychange", onVis);
  if (soundBtn) soundBtn.hidden = false;
  paintSound();
  root.dataset.ready = "";
  render();

  return {
    destroy() {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      pad.removeEventListener("pointerdown", onPad);
      mainBtn.removeEventListener("click", onMain);
      pauseBtn?.removeEventListener("click", onPause);
      soundBtn?.removeEventListener("click", onSound);
      difficultyEl?.removeEventListener("change", onDifficulty);
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
