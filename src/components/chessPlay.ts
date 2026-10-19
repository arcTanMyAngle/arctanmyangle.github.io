// Chess for two: pass and play on one device.
// Contract: mount(root) => { destroy() }. `root` holds a Board.astro ([data-board]) inside [data-table],
// two seats [data-seat="w|b"] (each with input[data-name], [data-captured], [data-clock] > [data-time]),
// [data-status], the move list [data-moves] (+ [data-moves-empty]), action buttons [data-act=...],
// select[data-tc], input[data-autoflip], [data-tc-hint], a polite [data-live] region, the preload note
// [data-note] (+ [data-note-text]) and data-lines (JSON of the opening lines, for ?line=<slug>).
//
// The board is 64 real buttons with a roving tabindex: arrow keys move, Enter/Space picks up and puts
// down. Mouse and touch go through pointer events on the same layer, so click-to-move and drag both work.
// Pieces keep their identity between positions, so moves, undo and a new game all glide.
import { Chess, type Move, type Square } from "chess.js";
import { STORAGE_KEYS } from "../lib/clientState";
import {
  FILES,
  PIECE_NAMES,
  isLightSquare,
  pieceSvg,
  squareXY,
  squaresInOrder,
  xyToSquare,
  type PieceColor,
  type PieceType,
} from "../lib/pieces";

const STORE_KEY = STORAGE_KEYS.chessGame;
const BACKUP_KEY = STORAGE_KEYS.chessBackup;

export type TimeControl = "off" | "3+2" | "5+0" | "10+0";
const CLOCKS: Record<Exclude<TimeControl, "off">, [base: number, inc: number]> = {
  "3+2": [180_000, 2_000],
  "5+0": [300_000, 0],
  "10+0": [600_000, 0],
};

type Clocks = Record<PieceColor, number>;
interface ManualEnd {
  reason: "resign" | "time" | "agreed";
  loser?: PieceColor;
  /** Flag fell but the other side has no way to mate. */
  draw?: boolean;
}
interface Saved {
  v: 1;
  moves: string[];
  names: Record<PieceColor, string>;
  tc: TimeControl;
  nextTc: TimeControl;
  clock: Clocks | null;
  /** Both clocks just before each timed move, so undo can hand the time back. */
  clockHist: Clocks[];
  end: ManualEnd | null;
  flipped: boolean;
  autoFlip: boolean;
}
interface LineData {
  slug: string;
  name: string;
  side: "White" | "Black";
  moves: string[];
}
interface Result {
  text: string;
  score: "1-0" | "0-1" | "1/2-1/2";
}

const COLOR_NAME = { w: "White", b: "Black" } as const;
const other = (c: PieceColor): PieceColor => (c === "w" ? "b" : "w");
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 } as const;
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 } as const;
const CAPTURE_ORDER = ["q", "r", "b", "n", "p"] as const;

const baseClocks = (tc: TimeControl): Clocks | null =>
  tc === "off" ? null : { w: CLOCKS[tc][0], b: CLOCKS[tc][0] };

function fresh(tc: TimeControl): Saved {
  return {
    v: 1,
    moves: [],
    names: { w: "", b: "" },
    tc,
    nextTc: tc,
    clock: baseClocks(tc),
    clockHist: [],
    end: null,
    flipped: false,
    autoFlip: false,
  };
}

function read(key: string): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? "null");
    return s && s.v === 1 && Array.isArray(s.moves) ? (s as Saved) : null;
  } catch {
    return null;
  }
}
function write(key: string, s: Saved | null) {
  try {
    if (s) localStorage.setItem(key, JSON.stringify(s));
    else localStorage.removeItem(key);
  } catch {
    /* storage blocked: the game still plays, it just won't survive a reload */
  }
}

export function formatClock(ms: number): string {
  if (ms <= 0) return "0:00";
  if (ms < 10_000) return `0:0${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}`;
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface PieceEl {
  el: HTMLElement;
  sq: string;
  color: PieceColor;
  type: PieceType;
}

export function mount(root: HTMLElement) {
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const board = q("[data-board]")!;
  const table = q("[data-table]")!;
  const squaresLayer = board.querySelector<HTMLElement>(".board__squares")!;
  const marksLayer = board.querySelector<HTMLElement>("[data-marks]")!;
  const piecesLayer = board.querySelector<HTMLElement>("[data-pieces]")!;
  const statusEl = q("[data-status]");
  const movesEl = q("[data-moves]");
  const movesEmpty = q("[data-moves-empty]");
  const live = q("[data-live]");
  const note = q("[data-note]");
  const tcSel = q<HTMLSelectElement>("select[data-tc]");
  const tcHint = q("[data-tc-hint]");
  const autoFlipBox = q<HTMLInputElement>("input[data-autoflip]");
  const btn = (act: string) => q<HTMLButtonElement>(`[data-act="${act}"]`);
  const seats = { w: q('[data-seat="w"]')!, b: q('[data-seat="b"]')! };
  const nameInputs = {
    w: seats.w.querySelector<HTMLInputElement>("[data-name]")!,
    b: seats.b.querySelector<HTMLInputElement>("[data-name]")!,
  };
  const lines: LineData[] = JSON.parse(root.dataset.lines ?? "[]");
  const motionOK = () => document.documentElement.dataset.motion === "full";

  const chess = new Chess();
  let state: Saved = read(STORE_KEY) ?? fresh("off");
  let ended: Result | null = null;
  let lastMove: Move | undefined;
  let selected: string | null = null;
  let selTargets = new Map<string, Move>();
  let focusSq = "e2";
  let promoFor: { from: string; to: string } | null = null;
  let overHidden = false;
  let drawnFlip: boolean | null = null;
  let lastTick = performance.now();
  let flipTimer = 0;
  let drag: {
    id: number;
    sq: string;
    x0: number;
    y0: number;
    moving: boolean;
    wasSelected: boolean;
    el: HTMLElement | null;
    over: string | null;
  } | null = null;

  const say = (t: string) => {
    if (live) live.textContent = t;
  };
  const nameOf = (c: PieceColor) => nameInputs[c].value.trim() || COLOR_NAME[c];
  const save = () => write(STORE_KEY, state);

  // ---- Layers built on the client ----
  piecesLayer.textContent = "";
  let pels: PieceEl[] = [];

  const hitsLayer = document.createElement("div");
  hitsLayer.className = "hits";
  hitsLayer.setAttribute("role", "group");
  if (statusEl?.id) hitsLayer.setAttribute("aria-describedby", statusEl.id);
  const hits = new Map<string, HTMLButtonElement>();
  for (const sq of squaresInOrder(false)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hit";
    b.dataset.sq = sq;
    b.tabIndex = -1;
    hitsLayer.append(b);
    hits.set(sq, b);
  }
  const promo = document.createElement("div");
  promo.className = "promo";
  promo.hidden = true;
  const overEl = document.createElement("div");
  overEl.className = "over";
  overEl.hidden = true;
  board.append(hitsLayer, promo, overEl);

  const place = (el: HTMLElement, sq: string) => {
    const { x, y } = squareXY(sq, state.flipped);
    el.style.setProperty("--x", String(x));
    el.style.setProperty("--y", String(y));
  };

  // ---- Game state ----
  function result(): Result | null {
    const e = state.end;
    const win = (c: PieceColor, why: string): Result => ({
      text: `${why} ${nameOf(c)} wins.`,
      score: c === "w" ? "1-0" : "0-1",
    });
    const draw = (text: string): Result => ({ text, score: "1/2-1/2" });
    if (e?.reason === "resign" && e.loser) return win(other(e.loser), `${nameOf(e.loser)} resigned.`);
    if (e?.reason === "time" && e.loser) {
      return e.draw
        ? draw(`${nameOf(e.loser)} ran out of time, but ${nameOf(other(e.loser))} can't checkmate. Draw.`)
        : win(other(e.loser), `${nameOf(e.loser)} ran out of time.`);
    }
    if (e?.reason === "agreed") return draw("Draw agreed.");
    if (chess.isCheckmate()) return win(other(chess.turn()), "Checkmate.");
    if (chess.isStalemate()) return draw(`Stalemate: ${nameOf(chess.turn())} has no legal move. Draw.`);
    if (chess.isInsufficientMaterial()) return draw("Neither side can checkmate. Draw.");
    if (chess.isThreefoldRepetition()) return draw("Same position three times. Draw.");
    if (chess.isDrawByFiftyMoves()) return draw("Fifty moves without a capture or pawn move. Draw.");
    return null;
  }

  /** Could `c` still mate at all? Decides whether a flag fall wins or draws. */
  function canMate(c: PieceColor) {
    let minors = 0;
    let theirs = false;
    for (const row of chess.board()) {
      for (const p of row) {
        if (!p || p.type === "k") continue;
        if (p.color !== c) theirs = true;
        else if (p.type === "p" || p.type === "r" || p.type === "q") return true;
        else minors++;
      }
    }
    return minors >= 2 || (minors === 1 && theirs);
  }

  function loadState(s: Saved) {
    state = s;
    chess.reset();
    for (const san of s.moves) {
      try {
        chess.move(san);
      } catch {
        break;
      }
    }
    state.moves = chess.history();
    if (state.tc !== "off" && !state.clock) state.clock = baseClocks(state.tc);
    if (state.tc === "off") state.clock = null;
    nameInputs.w.value = s.names.w;
    nameInputs.b.value = s.names.b;
    if (tcSel) tcSel.value = s.nextTc;
    if (autoFlipBox) autoFlipBox.checked = s.autoFlip;
    if (s.autoFlip) state.flipped = chess.turn() === "b";
    selected = null;
    selTargets = new Map();
    overHidden = false;
    lastTick = performance.now();
  }

  // ---- Clocks ----
  const clockRunning = () => !!state.clock && !ended && !promoFor && chess.history().length > 0 && !document.hidden;

  function tick() {
    const now = performance.now();
    if (clockRunning()) {
      const c = chess.turn();
      state.clock![c] -= now - lastTick;
      if (state.clock![c] <= 0) {
        state.clock![c] = 0;
        lastTick = now;
        state.end = { reason: "time", loser: c, draw: !canMate(other(c)) };
        refresh();
        save();
        say(ended?.text ?? "");
        return;
      }
    }
    lastTick = now;
    renderClocks();
  }
  const interval = window.setInterval(tick, 100);

  // ---- Rendering ----
  function renderSquares() {
    if (drawnFlip === state.flipped) return;
    drawnFlip = state.flipped;
    const bottom = state.flipped ? "8" : "1";
    const left = state.flipped ? "h" : "a";
    squaresLayer.innerHTML = squaresInOrder(state.flipped)
      .map(
        (sq) =>
          `<div class="sq ${isLightSquare(sq) ? "sq--light" : "sq--dark"}" data-sq="${sq}">` +
          (sq[1] === bottom ? `<span class="sq__file">${sq[0]}</span>` : "") +
          (sq[0] === left ? `<span class="sq__rank">${sq[1]}</span>` : "") +
          `</div>`
      )
      .join("");
    board.toggleAttribute("data-flipped", state.flipped);
    table.toggleAttribute("data-flipped", state.flipped);
    hitsLayer.setAttribute("aria-label", `Chessboard, ${state.flipped ? "Black" : "White"} at the bottom`);
  }

  /** Match the piece elements to the position, moving existing ones so they glide. */
  function syncPieces(snap: boolean) {
    const want: { sq: string; color: PieceColor; type: PieceType }[] = [];
    for (const row of chess.board()) for (const p of row) if (p) want.push({ sq: p.square, color: p.color, type: p.type });

    const free = new Set(pels);
    const next: PieceEl[] = [];
    const moved = new Set<PieceEl>();
    const dist = (a: string, b: string) =>
      Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])) + Math.abs(Number(a[1]) - Number(b[1]));
    const nearest = (w: (typeof want)[number], sameType: boolean) => {
      let best: PieceEl | null = null;
      let bestD = Infinity;
      for (const p of free) {
        if (p.color !== w.color || (sameType && p.type !== w.type)) continue;
        const d = dist(p.sq, w.sq);
        if (d < bestD) [best, bestD] = [p, d];
      }
      return best;
    };

    // 1. Pieces that haven't moved. 2. The same piece somewhere else. 3. A promotion (or its undo).
    let rest = want.filter((w) => {
      const p = [...free].find((f) => f.sq === w.sq && f.color === w.color && f.type === w.type);
      if (!p) return true;
      free.delete(p);
      next.push(p);
      return false;
    });
    for (const sameType of [true, false]) {
      rest = rest.filter((w) => {
        const p = nearest(w, sameType);
        if (!p) return true;
        free.delete(p);
        p.sq = w.sq;
        if (p.type !== w.type) {
          p.type = w.type;
          p.el.innerHTML = pieceSvg(p.color, p.type);
        }
        next.push(p);
        moved.add(p);
        return false;
      });
    }
    for (const w of rest) {
      const el = document.createElement("span");
      el.className = "pc";
      el.innerHTML = pieceSvg(w.color, w.type);
      piecesLayer.append(el);
      const p = { el, ...w };
      next.push(p);
      if (pels.length) moved.add(p);
    }
    for (const p of free) p.el.remove();
    pels = next;

    if (snap) board.classList.add("board--snap");
    for (const p of pels) {
      p.el.classList.remove("pc--arrive");
      place(p.el, p.sq);
    }
    if (!snap && moved.size) {
      void board.offsetWidth;
      for (const p of moved) p.el.classList.add("pc--arrive");
    }
    if (snap) {
      void board.offsetWidth;
      requestAnimationFrame(() => board.classList.remove("board--snap"));
    }
  }

  function kingSquare(c: PieceColor) {
    for (const row of chess.board()) for (const p of row) if (p && p.type === "k" && p.color === c) return p.square;
    return null;
  }

  function renderMarks() {
    const out: string[] = [];
    const mk = (sq: string | null, kind: string) => {
      if (!sq) return;
      const { x, y } = squareXY(sq, state.flipped);
      out.push(`<span class="mark mark--${kind}" style="--x:${x};--y:${y}"></span>`);
    };
    if (lastMove) {
      mk(lastMove.from, "last");
      mk(lastMove.to, "last");
    }
    if (chess.inCheck()) mk(kingSquare(chess.turn()), "check");
    if (selected) {
      mk(selected, "sel");
      for (const [to, m] of selTargets) mk(to, m.captured ? "take" : "dot");
    }
    if (drag?.moving && drag.over && drag.over !== drag.sq) mk(drag.over, "hover");
    marksLayer.innerHTML = out.join("");
  }

  function renderHits() {
    const turn = chess.turn();
    for (const [sq, b] of hits) {
      const p = chess.get(sq as Square);
      const t = selTargets.get(sq);
      let label = `${sq}, ${p ? `${COLOR_NAME[p.color].toLowerCase()} ${PIECE_NAMES[p.type]}` : "empty"}`;
      if (sq === selected) label += ", selected";
      else if (t) label += t.captured ? ", capture" : ", move here";
      b.setAttribute("aria-label", label);
      b.toggleAttribute("data-own", !ended && !!p && p.color === turn);
      b.toggleAttribute("data-target", !!t);
      b.tabIndex = sq === focusSq ? 0 : -1;
      place(b, sq);
    }
  }

  function renderMoves() {
    const sans = chess.history();
    if (movesEmpty) movesEmpty.hidden = sans.length > 0;
    if (!movesEl) return;
    let html = "";
    for (let i = 0; i < sans.length; i += 2) {
      const cls = (n: number) => `mvl__m${n === sans.length - 1 ? " is-last" : ""}`;
      html +=
        `<li><span class="mvl__n">${i / 2 + 1}.</span><span class="${cls(i)}">${sans[i]}</span>` +
        `<span class="${cls(i + 1)}">${sans[i + 1] ?? ""}</span></li>`;
    }
    movesEl.innerHTML = html;
    const scroller = movesEl.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function renderSeats() {
    const have = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const row of chess.board()) for (const p of row) if (p && p.type !== "k") have[p.color][p.type]++;
    const material = (c: PieceColor) => CAPTURE_ORDER.reduce((sum, t) => sum + VALUE[t] * have[c][t], 0);
    for (const c of ["w", "b"] as const) {
      const o = other(c);
      const taken = CAPTURE_ORDER.flatMap((t) => Array<PieceType>(Math.max(0, START_COUNT[t] - have[o][t])).fill(t));
      const adv = material(c) - material(o);
      const summary = CAPTURE_ORDER.map((t) => {
        const n = taken.filter((x) => x === t).length;
        return n ? `${n} ${PIECE_NAMES[t]}${n > 1 ? "s" : ""}` : "";
      })
        .filter(Boolean)
        .join(", ");
      const capEl = seats[c].querySelector("[data-captured]");
      if (capEl) {
        capEl.innerHTML =
          taken.map((t) => `<span class="cap">${pieceSvg(o, t)}</span>`).join("") +
          (adv > 0 ? `<span class="adv" aria-hidden="true">+${adv}</span>` : "") +
          `<span class="sr-only">${summary ? `Captured: ${summary}.` : "No captures yet."}${adv > 0 ? ` Up ${adv} in material.` : ""}</span>`;
      }
      seats[c].classList.toggle("is-turn", !ended && chess.turn() === c);
      const won = ended && ended.score === (c === "w" ? "1-0" : "0-1");
      seats[c].classList.toggle("is-winner", !!won);
    }
  }

  function renderClocks() {
    const running = clockRunning();
    for (const c of ["w", "b"] as const) {
      const wrap = seats[c].querySelector<HTMLElement>("[data-clock]");
      const time = wrap?.querySelector<HTMLElement>("[data-time]");
      if (!wrap || !time) continue;
      wrap.hidden = !state.clock;
      if (!state.clock) continue;
      const text = formatClock(state.clock[c]);
      if (time.textContent !== text) time.textContent = text;
      wrap.classList.toggle("is-running", running && chess.turn() === c);
      wrap.classList.toggle("is-low", state.clock[c] < 20_000);
    }
  }

  function renderStatus() {
    if (!statusEl) return;
    const turn = chess.turn();
    statusEl.textContent = ended ? ended.text : `${nameOf(turn)} to move${chess.inCheck() ? ", in check" : ""}.`;
    statusEl.dataset.turn = turn;
    statusEl.dataset.state = ended ? "over" : "play";
  }

  function renderButtons() {
    const any = chess.history().length > 0;
    const set = (act: string, disabled: boolean) => {
      const b = btn(act);
      if (b) b.disabled = disabled;
    };
    set("undo", (!any && !state.end) || !!promoFor);
    set("resign", !!ended || !!promoFor);
    set("draw", !!ended || !any || !!promoFor);
    set("copy", !any);
    const resign = btn("resign");
    const label = resign?.querySelector("[data-label]");
    if (resign && label && !("confirming" in resign.dataset)) label.textContent = `Resign as ${COLOR_NAME[chess.turn()]}`;
    if (tcHint) tcHint.hidden = state.nextTc === state.tc;
  }

  function renderOver() {
    if (!ended || overHidden) {
      overEl.hidden = true;
      return;
    }
    overEl.innerHTML =
      `<div class="over__box"><p class="over__title">${ended.score === "1/2-1/2" ? "Draw" : ended.score === "1-0" ? "White wins" : "Black wins"}</p>` +
      `<p class="over__text">${escapeHtml(ended.text)}</p><div class="over__row">` +
      `<button type="button" class="btn btn--primary btn--small" data-act="new">New game</button>` +
      `<button type="button" class="btn btn--small" data-act="hide-over">See the board</button></div></div>`;
    overEl.hidden = false;
  }

  function refresh(snap = false): Result | null {
    ended = result();
    if (ended) {
      selected = null;
      selTargets = new Map();
    }
    lastMove = chess.history({ verbose: true }).at(-1);
    renderSquares();
    syncPieces(snap);
    renderMarks();
    renderHits();
    renderMoves();
    renderSeats();
    renderClocks();
    renderStatus();
    renderButtons();
    renderOver();
    root.dataset.state = ended ? "over" : "play";
    return ended;
  }

  // ---- Moves ----
  function select(sq: string | null) {
    selected = sq;
    selTargets = new Map();
    if (sq) for (const m of chess.moves({ square: sq as Square, verbose: true })) if (!selTargets.has(m.to)) selTargets.set(m.to, m);
    renderMarks();
    renderHits();
  }

  function focusSquare(sq: string) {
    focusSq = sq;
    for (const [s, b] of hits) b.tabIndex = s === sq ? 0 : -1;
    hits.get(sq)?.focus();
  }

  function describe(m: Move) {
    const who = nameOf(m.color);
    let s: string;
    if (m.isKingsideCastle()) s = `${who} castles kingside`;
    else if (m.isQueensideCastle()) s = `${who} castles queenside`;
    else {
      s = `${who}: ${PIECE_NAMES[m.piece]} ${m.from} to ${m.to}`;
      if (m.captured) s += `, takes ${PIECE_NAMES[m.captured]}`;
      if (m.promotion) s += `, promotes to ${PIECE_NAMES[m.promotion]}`;
    }
    if (chess.inCheck() && !chess.isCheckmate()) s += ", check";
    return `${s}.`;
  }

  function scheduleAutoFlip() {
    clearTimeout(flipTimer);
    if (!state.autoFlip || ended) return;
    const want = chess.turn() === "b";
    if (want === state.flipped) return;
    flipTimer = window.setTimeout(
      () => {
        state.flipped = want;
        save();
        refresh(true);
      },
      motionOK() ? 560 : 0
    );
  }

  function play(input: { from: string; to: string; promotion?: string }) {
    tick();
    if (ended) return;
    const before = state.clock ? { ...state.clock } : null;
    const mover = chess.turn();
    let m: Move;
    try {
      m = chess.move(input);
    } catch {
      return;
    }
    if (state.clock && before && state.tc !== "off") {
      state.clockHist.push(before);
      state.clock[mover] += CLOCKS[state.tc][1];
    }
    state.moves = chess.history();
    selected = null;
    selTargets = new Map();
    focusSq = m.to;
    lastTick = performance.now();
    // Read the outcome from refresh(): TS still has `ended` narrowed to null from the guard above.
    const over = refresh();
    say(`${describe(m)}${over ? ` ${over.text}` : ""}`);
    save();
    scheduleAutoFlip();
  }

  function attempt(from: string, to: string) {
    const options = chess.moves({ square: from as Square, verbose: true }).filter((m) => m.to === to);
    if (!options.length) return;
    if (options.some((m) => m.promotion)) openPromo(from, to);
    else play({ from, to });
  }

  function openPromo(from: string, to: string) {
    promoFor = { from, to };
    const c = chess.turn();
    const pel = pels.find((p) => p.sq === from);
    if (pel) place(pel.el, to);
    promo.innerHTML =
      `<div class="promo__box" role="dialog" aria-modal="true" aria-labelledby="promo-title">` +
      `<p class="promo__title" id="promo-title">Promote to</p><div class="promo__row">` +
      (["q", "r", "b", "n"] as const)
        .map((t) => `<button type="button" class="promo__btn" data-promo="${t}" aria-label="${PIECE_NAMES[t]}">${pieceSvg(c, t)}</button>`)
        .join("") +
      `</div></div>`;
    promo.hidden = false;
    renderButtons();
    promo.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function closePromo(cancel: boolean) {
    const p = promoFor;
    promoFor = null;
    promo.hidden = true;
    promo.innerHTML = "";
    lastTick = performance.now();
    if (cancel && p) {
      syncPieces(false);
      renderButtons();
      focusSquare(p.from);
    }
  }

  function undo() {
    if (promoFor) closePromo(true);
    clearTimeout(flipTimer);
    if (state.end && state.end.reason !== "time") {
      state.end = null;
      overHidden = false;
      lastTick = performance.now();
      refresh();
      save();
      say(`Game reopened. ${nameOf(chess.turn())} to move.`);
      return;
    }
    state.end = null;
    const m = chess.undo();
    if (m && state.clock && state.clockHist.length) state.clock = state.clockHist.pop()!;
    state.moves = chess.history();
    selected = null;
    selTargets = new Map();
    overHidden = false;
    lastTick = performance.now();
    refresh();
    save();
    if (m) say(`Took back ${m.san}. ${nameOf(chess.turn())} to move.`);
    scheduleAutoFlip();
  }

  function newGame() {
    clearTimeout(flipTimer);
    if (promoFor) closePromo(false);
    const s = fresh(state.nextTc);
    s.names = state.names;
    s.autoFlip = state.autoFlip;
    s.flipped = state.autoFlip ? false : state.flipped;
    loadState(s);
    refresh();
    save();
    say(`New game. ${nameOf("w")} to move.`);
    focusSq = "e2";
  }

  // ---- Two-step confirm for the destructive buttons ----
  const confirmTimers = new Map<HTMLButtonElement, number>();
  function unconfirm(b: HTMLButtonElement) {
    clearTimeout(confirmTimers.get(b));
    confirmTimers.delete(b);
    if (!("confirming" in b.dataset)) return;
    delete b.dataset.confirming;
    const label = b.querySelector("[data-label]") ?? b;
    label.textContent = b.dataset.orig ?? label.textContent;
    renderButtons();
  }
  function confirmThen(b: HTMLButtonElement, ask: string, fn: () => void) {
    if ("confirming" in b.dataset) {
      unconfirm(b);
      fn();
      return;
    }
    const label = b.querySelector("[data-label]") ?? b;
    b.dataset.orig = label.textContent ?? "";
    b.dataset.confirming = "";
    label.textContent = ask;
    say(`${ask}? Press again to confirm.`);
    confirmTimers.set(
      b,
      window.setTimeout(() => unconfirm(b), 4000)
    );
  }

  async function copyPgn(b: HTMLButtonElement) {
    const g = new Chess();
    for (const san of chess.history()) g.move(san);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    g.setHeader("Event", "Casual game");
    g.setHeader("Date", `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`);
    g.setHeader("White", nameOf("w"));
    g.setHeader("Black", nameOf("b"));
    g.setHeader("Result", ended?.score ?? "*");
    if (state.tc !== "off") g.setHeader("TimeControl", `${CLOCKS[state.tc][0] / 1000}+${CLOCKS[state.tc][1] / 1000}`);
    const label = b.querySelector("[data-label]") ?? b;
    try {
      await navigator.clipboard.writeText(g.pgn());
      label.textContent = "Copied";
      say("Game copied to the clipboard as PGN.");
      window.setTimeout(() => (label.textContent = "Copy PGN"), 1800);
    } catch {
      say("Couldn't copy: the browser blocked the clipboard.");
    }
  }

  // ---- Input: pointer ----
  const sqAt = (e: PointerEvent) => {
    const r = board.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * 8);
    const y = Math.floor(((e.clientY - r.top) / r.height) * 8);
    return x < 0 || x > 7 || y < 0 || y > 7 ? null : xyToSquare(x, y, state.flipped);
  };

  function onDown(e: PointerEvent) {
    if (e.button !== 0 || ended || promoFor || drag) return;
    const sq = sqAt(e);
    if (!sq) return;
    focusSq = sq;
    if (selected && selTargets.has(sq)) {
      attempt(selected, sq);
      return;
    }
    const p = chess.get(sq as Square);
    if (p && p.color === chess.turn()) {
      drag = {
        id: e.pointerId,
        sq,
        x0: e.clientX,
        y0: e.clientY,
        moving: false,
        wasSelected: selected === sq,
        el: pels.find((x) => x.sq === sq)?.el ?? null,
        over: sq,
      };
      select(sq);
      hitsLayer.setPointerCapture(e.pointerId);
    } else {
      select(null);
    }
  }

  function onMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      drag.moving = true;
      drag.el?.classList.add("pc--drag");
    }
    const r = board.getBoundingClientRect();
    const size = r.width / 8;
    drag.el?.style.setProperty("--x", String((e.clientX - r.left) / size - 0.5));
    drag.el?.style.setProperty("--y", String((e.clientY - r.top) / size - 0.5));
    const over = sqAt(e);
    if (over !== drag.over) {
      drag.over = over;
      renderMarks();
    }
  }

  function onUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (hitsLayer.hasPointerCapture(e.pointerId)) hitsLayer.releasePointerCapture(e.pointerId);
    d.el?.classList.remove("pc--drag");
    if (d.moving) {
      const target = e.type === "pointerup" ? sqAt(e) : null;
      if (target && target !== d.sq && selTargets.has(target)) {
        attempt(d.sq, target);
        return;
      }
      if (d.el) place(d.el, d.sq);
      renderMarks();
    } else if (d.wasSelected) {
      select(null);
    }
  }

  // ---- Input: keyboard ----
  function activate(sq: string) {
    if (ended || promoFor) return;
    focusSq = sq;
    if (selected && selTargets.has(sq)) {
      attempt(selected, sq);
      return;
    }
    const p = chess.get(sq as Square);
    if (p && p.color === chess.turn()) {
      if (selected === sq) {
        select(null);
        say("Put down.");
      } else {
        select(sq);
        const n = selTargets.size;
        say(`${PIECE_NAMES[p.type]} on ${sq} picked up. ${n ? `${n} legal ${n === 1 ? "move" : "moves"}.` : "It has no legal moves."}`);
      }
    } else if (selected) {
      select(null);
      say("Not a legal move. Put down.");
    }
  }

  const DIRS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  function onHitKey(e: KeyboardEvent) {
    const b = (e.target as Element).closest<HTMLButtonElement>(".hit");
    if (!b) return;
    const dir = DIRS[e.key];
    if (dir) {
      e.preventDefault();
      const { x, y } = squareXY(b.dataset.sq!, state.flipped);
      const nx = Math.max(0, Math.min(7, x + dir[0]));
      const ny = Math.max(0, Math.min(7, y + dir[1]));
      focusSquare(xyToSquare(nx, ny, state.flipped));
    } else if (e.key === "Escape" && selected) {
      e.preventDefault();
      select(null);
      say("Put down.");
    }
  }
  function onHitClick(e: MouseEvent) {
    // Pointer input is handled on pointerdown; this is Enter/Space (a click with no pointer).
    if (e.detail !== 0) return;
    const b = (e.target as Element).closest<HTMLButtonElement>(".hit");
    if (b) activate(b.dataset.sq!);
  }

  function onPromoClick(e: MouseEvent) {
    const b = (e.target as Element).closest<HTMLButtonElement>("[data-promo]");
    if (b && promoFor) {
      const p = promoFor;
      closePromo(false);
      play({ ...p, promotion: b.dataset.promo });
      focusSquare(p.to);
    } else if (e.target === promo) {
      closePromo(true);
    }
  }
  function onPromoKey(e: KeyboardEvent) {
    const btns = Array.from(promo.querySelectorAll<HTMLButtonElement>("[data-promo]"));
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closePromo(true);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Tab") {
      e.preventDefault();
      const step = e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
      btns[(i + step + btns.length) % btns.length]?.focus();
    }
  }

  // ---- Buttons and settings ----
  function onAct(e: MouseEvent) {
    const b = (e.target as Element).closest<HTMLButtonElement>("[data-act]");
    if (!b || !root.contains(b)) return;
    switch (b.dataset.act) {
      case "undo":
        undo();
        break;
      case "flip":
        clearTimeout(flipTimer);
        state.flipped = !state.flipped;
        save();
        refresh(true);
        say(`Board turned. ${state.flipped ? "Black" : "White"} at the bottom.`);
        break;
      case "new":
        if (chess.history().length && !ended) confirmThen(b, "Sure? Start over", newGame);
        else newGame();
        break;
      case "resign": {
        const loser = chess.turn();
        confirmThen(b, `Confirm: ${COLOR_NAME[loser]} resigns`, () => {
          tick();
          state.end = { reason: "resign", loser };
          refresh();
          save();
          say(ended?.text ?? "");
        });
        break;
      }
      case "draw":
        confirmThen(b, "Both agree? Confirm", () => {
          tick();
          state.end = { reason: "agreed" };
          refresh();
          save();
          say(ended?.text ?? "");
        });
        break;
      case "copy":
        void copyPgn(b);
        break;
      case "hide-over":
        overHidden = true;
        renderOver();
        focusSquare(focusSq);
        break;
      case "restore": {
        const backup = read(BACKUP_KEY);
        if (backup) {
          loadState(backup);
          write(BACKUP_KEY, null);
          save();
          refresh(true);
          say(`Your game is back. ${nameOf(chess.turn())} to move.`);
        }
        if (note) note.hidden = true;
        break;
      }
      case "dismiss":
        if (note) note.hidden = true;
        break;
    }
  }

  function onTc() {
    if (!tcSel) return;
    const v = tcSel.value as TimeControl;
    state.nextTc = v;
    // Switch the current game too, as long as no timed move has been played in it yet.
    if (!state.clockHist.length && !ended) {
      state.tc = v;
      state.clock = baseClocks(v);
      lastTick = performance.now();
    }
    save();
    refresh();
    say(state.tc === v ? (v === "off" ? "Clock off." : `Clock set to ${v}.`) : "The new clock starts with your next game.");
  }
  function onAutoFlip() {
    if (!autoFlipBox) return;
    state.autoFlip = autoFlipBox.checked;
    if (state.autoFlip && !ended) state.flipped = chess.turn() === "b";
    save();
    refresh(true);
  }
  const onName = (c: PieceColor) => () => {
    state.names[c] = nameInputs[c].value;
    save();
    renderStatus();
    if (ended) refresh();
  };
  const nameHandlers = { w: onName("w"), b: onName("b") };

  const onVis = () => {
    if (document.hidden) {
      save();
    } else {
      lastTick = performance.now();
    }
  };
  const onHide = () => save();

  // ---- Start ----
  const params = new URLSearchParams(location.search);
  const line = lines.find((l) => l.slug === params.get("line"));
  if (line) {
    const prev = state;
    const s = fresh(prev.nextTc);
    s.names = prev.names;
    s.autoFlip = prev.autoFlip;
    s.moves = [...line.moves];
    s.flipped = line.side === "Black";
    const putAside = prev.moves.length > 0 && !(prev.moves.join(" ") === line.moves.join(" "));
    if (putAside) write(BACKUP_KEY, prev);
    loadState(s);
    save();
    history.replaceState(history.state, "", location.pathname + location.hash);
    if (note) {
      const text = note.querySelector("[data-note-text]");
      if (text) {
        text.textContent = `Set up the ${line.name}. ${nameOf(chess.turn())} to move.${putAside ? " Your unfinished game was put aside." : ""}`;
      }
      const restore = note.querySelector<HTMLElement>('[data-act="restore"]');
      if (restore) restore.hidden = !putAside;
      note.hidden = false;
    }
  } else {
    loadState(state);
  }

  hitsLayer.addEventListener("pointerdown", onDown);
  hitsLayer.addEventListener("pointermove", onMove);
  hitsLayer.addEventListener("pointerup", onUp);
  hitsLayer.addEventListener("pointercancel", onUp);
  hitsLayer.addEventListener("keydown", onHitKey);
  hitsLayer.addEventListener("click", onHitClick);
  promo.addEventListener("click", onPromoClick);
  promo.addEventListener("keydown", onPromoKey);
  root.addEventListener("click", onAct);
  tcSel?.addEventListener("change", onTc);
  autoFlipBox?.addEventListener("change", onAutoFlip);
  nameInputs.w.addEventListener("input", nameHandlers.w);
  nameInputs.b.addEventListener("input", nameHandlers.b);
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", onHide);

  refresh(true);
  root.dataset.ready = "";

  return {
    destroy() {
      clearInterval(interval);
      clearTimeout(flipTimer);
      for (const t of confirmTimers.values()) clearTimeout(t);
      save();
      root.removeEventListener("click", onAct);
      tcSel?.removeEventListener("change", onTc);
      autoFlipBox?.removeEventListener("change", onAutoFlip);
      nameInputs.w.removeEventListener("input", nameHandlers.w);
      nameInputs.b.removeEventListener("input", nameHandlers.b);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      hitsLayer.remove();
      promo.remove();
      overEl.remove();
    },
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
