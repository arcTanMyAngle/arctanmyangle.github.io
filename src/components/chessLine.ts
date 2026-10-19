// Animated opening board: plays one line move by move, pieces gliding between squares.
// Contract: mount(root, options) => { destroy() }. `root` carries data-plies (JSON of the line's
// plies from lib/chessLinePlan.ts, worked out at build time so chess.js stays off the page) and contains a Board.astro ([data-board]); optional controls are [data-act="play|prev|next|restart"],
// move text spans are [data-ply="n"] (1-based) and [data-status] shows the current move.
//
// Autoplay only under data-motion="full", only while the board is on screen and the tab is visible.
// Otherwise the board rests on the final position (what the server rendered) and steps by hand.
import type { Ply } from "../lib/chessLinePlan";
import { pieceSvg, piecesFromFen, squareXY, START_FEN, type PieceColor, type PieceType } from "../lib/pieces";

interface Frame {
  at: Map<number, string>;
  types: Map<number, PieceType>;
  from?: string;
  to?: string;
  moved?: number;
  check?: string;
  san?: string;
}

interface Tracked {
  id: number;
  color: PieceColor;
  type: PieceType;
}

export function buildFrames(plies: Ply[]): { pieces: Tracked[]; frames: Frame[] } {
  const start = piecesFromFen(START_FEN);
  const pieces: Tracked[] = start.map((p, id) => ({ id, color: p.color, type: p.type }));
  let bySquare = new Map(start.map((p, id) => [p.square, id] as [string, number]));
  let types = new Map(pieces.map((p) => [p.id, p.type] as [number, PieceType]));

  const snapshot = (extra: Partial<Frame> = {}): Frame => {
    const at = new Map<number, string>();
    for (const [sq, id] of bySquare) at.set(id, sq);
    return { at, types: new Map(types), ...extra };
  };

  const frames: Frame[] = [snapshot()];
  for (const m of plies) {
    const next = new Map(bySquare);
    const id = next.get(m.from)!;
    next.delete(m.from);
    if (m.ep) next.delete(m.ep);
    next.set(m.to, id);
    if (m.rook) {
      const [rf, rt] = m.rook;
      const rook = next.get(rf)!;
      next.delete(rf);
      next.set(rt, rook);
    }
    bySquare = next;
    if (m.promo) {
      types = new Map(types);
      types.set(id, m.promo);
    }
    frames.push(snapshot({ from: m.from, to: m.to, moved: id, check: m.check, san: m.san }));
  }
  return { pieces, frames };
}

interface Options {
  /** Autoplay when motion is allowed. Default true. */
  autoplay?: boolean;
  /** ms between moves. */
  stepMs?: number;
}

export function mount(root: HTMLElement, options: Options = {}) {
  const { autoplay = true, stepMs = 1050 } = options;
  const plies: Ply[] = JSON.parse(root.dataset.plies ?? "[]");
  const board = root.querySelector<HTMLElement>("[data-board]")!;
  const flipped = board.hasAttribute("data-flipped");
  const piecesLayer = board.querySelector<HTMLElement>("[data-pieces]")!;
  const marksLayer = board.querySelector<HTMLElement>("[data-marks]")!;
  const playBtn = root.querySelector<HTMLButtonElement>('[data-act="play"]');
  const statusEl = root.querySelector<HTMLElement>("[data-status]");
  const plyEls = Array.from(root.querySelectorAll<HTMLElement>("[data-ply]"));

  const { pieces, frames } = buildFrames(plies);
  const last = frames.length - 1;
  const motionOK = () => document.documentElement.dataset.motion === "full";

  // Build one element per tracked piece so a piece keeps its identity (and glides) between frames.
  piecesLayer.textContent = "";
  const els = pieces.map((p) => {
    const el = document.createElement("span");
    el.className = "pc";
    el.innerHTML = pieceSvg(p.color, p.type);
    el.dataset.type = p.type;
    piecesLayer.append(el);
    return el;
  });
  const marks = ["last", "last", "check"].map((kind) => {
    const el = document.createElement("span");
    el.className = `mark mark--${kind}`;
    el.hidden = true;
    marksLayer.append(el);
    return el;
  });

  const place = (el: HTMLElement, square?: string) => {
    if (!square) {
      el.hidden = true;
      return;
    }
    const { x, y } = squareXY(square, flipped);
    el.style.setProperty("--x", String(x));
    el.style.setProperty("--y", String(y));
    el.hidden = false;
  };

  let ply = last;
  const render = (snap = false) => {
    const f = frames[ply];
    if (snap) board.classList.add("board--snap");
    pieces.forEach((p, i) => {
      const el = els[i];
      const type = f.types.get(p.id)!;
      if (el.dataset.type !== type) {
        el.innerHTML = pieceSvg(p.color, type);
        el.dataset.type = type;
      }
      el.classList.toggle("pc--arrive", !snap && f.moved === p.id);
      place(el, f.at.get(p.id));
    });
    place(marks[0], f.from);
    place(marks[1], f.to);
    place(marks[2], f.check);
    if (snap) {
      void board.offsetWidth;
      requestAnimationFrame(() => board.classList.remove("board--snap"));
    }
    plyEls.forEach((el) => {
      const on = Number(el.dataset.ply) === ply;
      el.classList.toggle("is-current", on);
      if (on) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
    if (statusEl) {
      statusEl.textContent =
        ply === 0 ? "Start position" : `${Math.ceil(ply / 2)}${ply % 2 ? "." : "…"} ${f.san}  ·  move ${ply} of ${last}`;
    }
  };

  // ---- Playback ----
  let playing = autoplay && motionOK();
  let visible = typeof IntersectionObserver === "undefined";
  let timer = 0;

  const syncPlayBtn = () => {
    if (!playBtn) return;
    playBtn.setAttribute("aria-pressed", String(playing));
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  };

  const schedule = () => {
    clearTimeout(timer);
    if (!playing || !visible || document.hidden) return;
    if (ply >= last) {
      // Rest on the final position, then start over from the top.
      timer = window.setTimeout(() => {
        ply = 0;
        render(true);
        timer = window.setTimeout(advance, 650);
      }, 2400);
    } else {
      timer = window.setTimeout(advance, ply === 0 ? 650 : stepMs);
    }
  };
  const advance = () => {
    if (ply < last) {
      ply++;
      render();
    }
    schedule();
  };

  const announce = () => statusEl?.setAttribute("aria-live", "polite");
  const stop = () => {
    playing = false;
    clearTimeout(timer);
    syncPlayBtn();
  };
  const go = (to: number, snap = false) => {
    ply = Math.max(0, Math.min(last, to));
    render(snap);
  };

  const onClick = (e: Event) => {
    const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (!act) return;
    announce();
    if (act === "play") {
      playing = !playing;
      if (playing && ply >= last) go(0, true);
      syncPlayBtn();
      schedule();
    } else if (act === "prev") {
      stop();
      go(ply - 1);
    } else if (act === "next") {
      stop();
      go(ply + 1);
    } else if (act === "restart") {
      go(0, true);
      playing = motionOK();
      syncPlayBtn();
      schedule();
    }
  };
  root.addEventListener("click", onClick);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (!(e.target as Element).closest("[data-act]")) return;
    e.preventDefault();
    announce();
    stop();
    go(ply + (e.key === "ArrowRight" ? 1 : -1));
  };
  root.addEventListener("keydown", onKey);

  const io =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            visible = entries.some((en) => en.isIntersecting);
            schedule();
          },
          { threshold: 0.35 }
        );
  io?.observe(board);
  const onVis = () => schedule();
  document.addEventListener("visibilitychange", onVis);

  render(true);
  syncPlayBtn();
  schedule();

  return {
    destroy() {
      clearTimeout(timer);
      io?.disconnect();
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
