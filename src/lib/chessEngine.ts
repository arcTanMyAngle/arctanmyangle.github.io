// A small chess engine for "play the computer": negamax alpha-beta with iterative deepening, a transposition
// table, quiescence on captures and a piece-square evaluation. It drives chess.js's own internal move generator
// (_moves/_makeMove/_undoMove on the 0x88 board) because the public API builds SAN and FEN for every move, which
// is far too slow inside a search. Pinned to chess.js 1.4.x: re-check these internals on an upgrade
// (tests/chessEngine.test.ts will fail loudly if they change).
//
// Runs in a Web Worker (src/lib/chessWorker.ts) so the board never freezes while it thinks.
import { Chess } from "chess.js";

export type Level = "easy" | "medium" | "hard";
export interface EngineMove {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
}

type Color = "w" | "b";
type Kind = "p" | "n" | "b" | "r" | "q" | "k";
interface IMove {
  color: Color;
  from: number;
  to: number;
  piece: Kind;
  captured?: Kind;
  promotion?: Kind;
  flags: number;
}
interface Internals {
  _board: ({ color: Color; type: Kind } | undefined)[];
  _turn: Color;
  _hash: bigint;
  _halfMoves: number;
  _moves(o: { legal: boolean }): IMove[];
  _makeMove(m: IMove): void;
  _undoMove(): IMove | null;
  _isKingAttacked(c: Color): boolean;
}

/** How hard each level tries: search depth cap, time budget, and how much noise blurs its judgement at the root. */
const LEVELS: Record<Level, { depth: number; ms: number; noise: number }> = {
  easy: { depth: 1, ms: 400, noise: 140 },
  medium: { depth: 3, ms: 700, noise: 25 },
  hard: { depth: 64, ms: 1500, noise: 0 },
};

const MATE = 100_000;
const INF = 1_000_000;
const VALUE: Record<Kind, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables from White's side, rank 8 first (Michniewski's "simplified evaluation function").
// prettier-ignore
const PST: Record<Kind | "kEnd", number[]> = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
      20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  kEnd: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30,
      -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30,
      -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50],
};

const sqName = (sq: number) => "abcdefgh"[sq & 7] + String(8 - (sq >> 4));

class Aborted extends Error {}

interface TTEntry {
  depth: number;
  score: number;
  flag: 0 | 1 | 2; // exact, lower bound, upper bound
  best?: IMove;
}

/** Static evaluation in centipawns from the side to move's point of view. */
function evaluate(c: Internals): number {
  const board = c._board;
  let mat = { w: 0, b: 0 };
  let heavy = { w: 0, b: 0 };
  let pst = 0;
  let kings: Record<Color, number> = { w: 0, b: 0 };
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = board[sq];
    if (!p) continue;
    if (p.type === "k") {
      kings[p.color] = sq;
      continue;
    }
    mat[p.color] += VALUE[p.type];
    if (p.type !== "p") heavy[p.color] += VALUE[p.type];
    const i = p.color === "w" ? (sq >> 4) * 8 + (sq & 7) : (7 - (sq >> 4)) * 8 + (sq & 7);
    pst += p.color === "w" ? PST[p.type][i] : -PST[p.type][i];
  }
  const endgame = heavy.w <= 1300 && heavy.b <= 1300;
  for (const col of ["w", "b"] as const) {
    const sq = kings[col];
    const i = col === "w" ? (sq >> 4) * 8 + (sq & 7) : (7 - (sq >> 4)) * 8 + (sq & 7);
    pst += (col === "w" ? 1 : -1) * (endgame ? PST.kEnd : PST.k)[i];
  }
  let score = mat.w - mat.b + pst;
  // Mop-up: when one side is well ahead in an endgame, herd the lone king to the edge and bring ours close,
  // so the engine actually finishes off K+Q v K instead of shuffling.
  const lead = mat.w - mat.b;
  if (endgame && Math.abs(lead) >= 400) {
    const win: Color = lead > 0 ? "w" : "b";
    const lose = kings[win === "w" ? "b" : "w"];
    const ours = kings[win];
    const fl = lose & 7;
    const rl = lose >> 4;
    const edge = Math.max(3 - fl, fl - 4) + Math.max(3 - rl, rl - 4);
    const near = Math.abs((ours & 7) - fl) + Math.abs((ours >> 4) - rl);
    const bonus = edge * 10 + (14 - near) * 4;
    score += win === "w" ? bonus : -bonus;
  }
  return c._turn === "w" ? score : -score;
}

const orderKey = (m: IMove) =>
  (m.captured ? 10 * VALUE[m.captured] - VALUE[m.piece] + 10_000 : 0) + (m.promotion ? VALUE[m.promotion] + 9_000 : 0);

const same = (a: IMove | undefined, b: IMove) =>
  !!a && a.from === b.from && a.to === b.to && a.promotion === b.promotion;

export interface SearchOptions {
  /** Override the level's time budget (ms). */
  ms?: number;
  /** Override the level's depth cap. */
  depth?: number;
  /** 0..1 random source, for repeatable tests. */
  random?: () => number;
}

/**
 * Pick a move for the side to move after `moves` (SAN from the standard start position, or from `fen`).
 * Returns null when the game is already over.
 */
export function bestMove(moves: string[], level: Level, opts: SearchOptions = {}, fen?: string): EngineMove | null {
  const chess = fen ? new Chess(fen) : new Chess();
  const seen = new Map<bigint, number>(); // positions already on the board, for repetition draws
  const c = chess as unknown as Internals;
  const bump = () => seen.set(c._hash, (seen.get(c._hash) ?? 0) + 1);
  bump();
  for (const san of moves) {
    chess.move(san);
    bump();
  }

  const cfg = LEVELS[level];
  const maxDepth = opts.depth ?? cfg.depth;
  const deadline = performance.now() + (opts.ms ?? cfg.ms);
  const random = opts.random ?? Math.random;
  const tt = new Map<bigint, TTEntry>();
  const killers: (IMove | undefined)[][] = [];
  const path: bigint[] = [];
  let nodes = 0;

  const rootMoves = c._moves({ legal: true });
  if (!rootMoves.length) return null;
  const toResult = (m: IMove): EngineMove => ({
    from: sqName(m.from),
    to: sqName(m.to),
    ...(m.promotion ? { promotion: m.promotion as EngineMove["promotion"] } : {}),
  });
  if (rootMoves.length === 1) return toResult(rootMoves[0]);

  const clock = () => {
    if ((++nodes & 1023) === 0 && performance.now() > deadline) throw new Aborted();
  };
  const repeated = () => {
    const h = c._hash;
    return (seen.get(h) ?? 0) > 0 || path.includes(h);
  };

  function order(list: IMove[], ttBest: IMove | undefined, ply: number) {
    const k = killers[ply] ?? [];
    const score = (m: IMove) =>
      same(ttBest, m) ? 1e9 : orderKey(m) || (same(k[0], m) ? 8_000 : same(k[1], m) ? 7_000 : 0);
    return list.map((m) => [score(m), m] as const).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  }

  function quiesce(alpha: number, beta: number, ply: number): number {
    clock();
    const all = c._moves({ legal: true });
    if (!all.length) return c._isKingAttacked(c._turn) ? -MATE + ply : 0;
    const stand = evaluate(c);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const noisy = all.filter((m) => m.captured || m.promotion).sort((a, b) => orderKey(b) - orderKey(a));
    for (const m of noisy) {
      c._makeMove(m);
      const s = -quiesce(-beta, -alpha, ply + 1);
      c._undoMove();
      if (s >= beta) return s;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  function search(depth: number, alpha: number, beta: number, ply: number): number {
    clock();
    if (ply > 0 && (c._halfMoves >= 100 || repeated())) return 0;
    const inCheck = c._isKingAttacked(c._turn);
    if (inCheck && ply < 24) depth++;
    if (depth <= 0) return quiesce(alpha, beta, ply);

    const key = c._hash;
    const hit = tt.get(key);
    if (hit && hit.depth >= depth && ply > 0) {
      const s = hit.score > MATE - 1000 ? hit.score - ply : hit.score < -MATE + 1000 ? hit.score + ply : hit.score;
      if (hit.flag === 0) return s;
      if (hit.flag === 1 && s >= beta) return s;
      if (hit.flag === 2 && s <= alpha) return s;
    }

    const list = c._moves({ legal: true });
    if (!list.length) return inCheck ? -MATE + ply : 0;

    const a0 = alpha;
    let best = -INF;
    let bestM: IMove | undefined;
    path.push(key);
    try {
      for (const m of order(list, hit?.best, ply)) {
        c._makeMove(m);
        let s: number;
        try {
          s = -search(depth - 1, -beta, -alpha, ply + 1);
        } finally {
          c._undoMove();
        }
        if (s > best) {
          best = s;
          bestM = m;
        }
        if (s > alpha) alpha = s;
        if (alpha >= beta) {
          if (!m.captured) {
            const k = (killers[ply] ??= []);
            if (!same(k[0], m)) [k[1], k[0]] = [k[0], m];
          }
          break;
        }
      }
    } finally {
      path.pop();
    }
    const stored = best > MATE - 1000 ? best + ply : best < -MATE + 1000 ? best - ply : best;
    tt.set(key, { depth, score: stored, flag: best <= a0 ? 2 : best >= beta ? 1 : 0, best: bestM });
    return best;
  }

  // Iterative deepening. With noise (the easier levels) every root move gets a full-window score so the
  // blur can be applied fairly; without it the root is an ordinary alpha-beta node.
  let chosen: IMove = rootMoves[0];
  let ordered = rootMoves.slice().sort((a, b) => orderKey(b) - orderKey(a));
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const scored: [number, IMove][] = [];
      let alpha = -INF;
      path.push(c._hash);
      try {
        for (const m of ordered) {
          c._makeMove(m);
          let s: number;
          try {
            s = cfg.noise ? -search(depth - 1, -INF, INF, 1) : -search(depth - 1, -INF, -alpha, 1);
          } finally {
            c._undoMove();
          }
          scored.push([s, m]);
          if (s > alpha) alpha = s;
        }
      } finally {
        path.pop();
      }
      scored.sort((a, b) => b[0] - a[0]);
      ordered = scored.map((x) => x[1]);
      if (cfg.noise && scored[0][0] < MATE - 1000) {
        // Never blur away a forced mate; otherwise pick the best of the noisy scores.
        let pick = scored[0];
        let top = -INF;
        for (const sm of scored) {
          const n = sm[0] + (random() * 2 - 1) * cfg.noise;
          if (n > top) [top, pick] = [n, sm];
        }
        chosen = pick[1];
      } else {
        chosen = scored[0][1];
      }
      if (scored[0][0] > MATE - 1000) break; // found a mate: deeper search can't improve it
    } catch (e) {
      if (e instanceof Aborted) break;
      throw e;
    }
    if (performance.now() > deadline) break;
  }
  return toResult(chosen);
}
