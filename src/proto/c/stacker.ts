// Stacker: stop the sliding row over the one below; whatever overhangs is cut off.
// Contract: mount(root) => { destroy() }. `root` holds the SSR grid ([data-cell] spans, rows top to
// bottom), [data-act="main"], [data-difficulty] (select), [data-height], [data-best], [data-state]
// and a polite live region [data-live] that only speaks on placements and game over, never per tick.
//
// Ticks are a setTimeout chain, not a rAF loop: the row moves in whole cells, so there is nothing
// to interpolate. A hidden tab pauses the chain and the visible tab picks it up where it was.

export const COLS = 7;
export const ROWS = 15;
const BEST_KEY = "proto-c-stacker-best";
const MULT = { easy: 0.72, normal: 1, hard: 1.45 } as const;
type Difficulty = keyof typeof MULT;
type State = "idle" | "playing" | "over" | "won";

/** Widest row allowed at this height (0 = bottom): 3, then 2, then 1. */
const maxWidth = (row: number) => (row < 3 ? 3 : row < 9 ? 2 : 1);

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
    /* storage blocked: the best score just isn't kept */
  }
}

export function mount(root: HTMLElement) {
  const cells = Array.from(root.querySelectorAll<HTMLElement>("[data-cell]"));
  const mainBtn = root.querySelector<HTMLButtonElement>('[data-act="main"]')!;
  const pad = root.querySelector<HTMLElement>("[data-pad]")!;
  const difficultyEl = root.querySelector<HTMLSelectElement>("[data-difficulty]");
  const heightEl = root.querySelector<HTMLElement>("[data-height]");
  const bestEl = root.querySelector<HTMLElement>("[data-best]");
  const live = root.querySelector<HTMLElement>("[data-live]");
  const stateEl = root.querySelector<HTMLElement>("[data-state]");

  const cell = (row: number, col: number) => cells[(ROWS - 1 - row) * COLS + col];

  let state: State = "idle";
  let stack: [number, number][] = []; // [from, len] per placed row
  let row = 0;
  let width = maxWidth(0);
  let pos = 0;
  let dir = 1;
  let timer = 0;
  let best = readBest();

  const difficulty = (): Difficulty => (difficultyEl?.value as Difficulty) in MULT ? (difficultyEl!.value as Difficulty) : "normal";
  const stepMs = () => 1000 / ((4.5 + row * 0.55) * MULT[difficulty()]);

  const say = (text: string) => {
    if (live) live.textContent = text;
  };

  const render = () => {
    for (const c of cells) c.classList.remove("is-on", "is-mover");
    stack.forEach(([from, len], r) => {
      for (let c = from; c < from + len; c++) cell(r, c).classList.add("is-on");
    });
    if (state === "playing") for (let c = pos; c < pos + width; c++) cell(row, c).classList.add("is-mover", "is-on");
    if (heightEl) heightEl.textContent = String(stack.length);
    if (bestEl) bestEl.textContent = best ? String(best) : "–";
    root.dataset.game = state;
    if (stateEl) {
      stateEl.textContent =
        state === "idle"
          ? "Press Space or tap to start"
          : state === "playing"
            ? `Row ${row + 1} of ${ROWS}`
            : state === "won"
              ? "Top reached!"
              : "Game over";
    }
    mainBtn.textContent = state === "playing" ? "Stop" : state === "idle" ? "Start" : "Play again";
    if (difficultyEl) difficultyEl.disabled = state === "playing";
  };

  const tick = () => {
    if (pos + dir < 0 || pos + dir + width > COLS) dir = -dir;
    pos += dir;
    render();
    schedule();
  };
  const schedule = () => {
    clearTimeout(timer);
    if (state === "playing" && !document.hidden) timer = window.setTimeout(tick, stepMs());
  };

  const flashCut = (r: number, from: number, len: number) => {
    for (let c = from; c < from + len; c++) {
      const el = cell(r, c);
      el.classList.remove("is-cut");
      void el.offsetWidth;
      el.classList.add("is-cut");
    }
  };

  const finish = (won: boolean) => {
    state = won ? "won" : "over";
    clearTimeout(timer);
    const h = stack.length;
    const record = h > best;
    if (record) {
      best = h;
      writeBest(h);
    }
    render();
    say(won ? `You reached the top: ${h} rows.${record ? " New best." : ""}` : `Game over at height ${h}.${record ? " New best." : ""}`);
  };

  const start = () => {
    stack = [];
    row = 0;
    width = maxWidth(0);
    pos = 0;
    dir = 1;
    state = "playing";
    for (const c of cells) c.classList.remove("is-cut");
    render();
    say(`Started on ${difficulty()}.`);
    schedule();
  };

  const place = () => {
    const below = stack[row - 1];
    let from = pos;
    let len = width;
    if (below) {
      from = Math.max(pos, below[0]);
      len = Math.min(pos + width, below[0] + below[1]) - from;
    }
    // Cells that overhang the row below fall away.
    for (let c = pos; c < pos + width; c++) {
      if (c < from || c >= from + Math.max(len, 0)) flashCut(row, c, 1);
    }
    if (len <= 0) return finish(false);
    const trimmed = len < width;
    stack.push([from, len]);
    if (stack.length === ROWS) return finish(true);
    row++;
    width = Math.min(len, maxWidth(row));
    // New rows enter from a random edge so the timing can't be memorised.
    dir = Math.random() < 0.5 ? 1 : -1;
    pos = dir === 1 ? 0 : COLS - width;
    say(trimmed ? `Trimmed. Row ${row + 1} is ${width} wide.` : `Placed row ${row}.`);
    render();
    schedule();
  };

  const act = () => {
    if (state === "playing") place();
    else start();
  };

  const isControl = (t: EventTarget | null) =>
    t instanceof Element && !!t.closest("button, a, select, input, textarea, [contenteditable]");

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
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
  const onVis = () => {
    if (document.hidden) clearTimeout(timer);
    else schedule();
  };
  const onDifficulty = () => render();

  window.addEventListener("keydown", onKey);
  pad.addEventListener("pointerdown", onPad);
  mainBtn.addEventListener("click", onMain);
  difficultyEl?.addEventListener("change", onDifficulty);
  document.addEventListener("visibilitychange", onVis);
  root.dataset.ready = "";
  render();

  return {
    destroy() {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      pad.removeEventListener("pointerdown", onPad);
      mainBtn.removeEventListener("click", onMain);
      difficultyEl?.removeEventListener("change", onDifficulty);
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
