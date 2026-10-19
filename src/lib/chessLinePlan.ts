// Build-time only: works out an opening line's moves with chess.js so the animated boards
// (components/chessLine.ts) can replay them without shipping chess.js to the browser.
// Import this from page frontmatter, never from a client <script>.
import { Chess } from "chess.js";
import type { PieceType } from "./pieces";

/** One ply as the board needs it: what moves where, plus the side effects SAN implies. */
export interface Ply {
  from: string;
  to: string;
  san: string;
  /** Castling: the rook's from/to squares. */
  rook?: [string, string];
  /** En passant: the square of the pawn taken. */
  ep?: string;
  promo?: PieceType;
  /** Square of the king left in check. */
  check?: string;
}

export function linePlies(moves: string[]): Ply[] {
  const chess = new Chess();
  return moves.map((san) => {
    const m = chess.move(san);
    const ply: Ply = { from: m.from, to: m.to, san: m.san };
    if (m.isKingsideCastle() || m.isQueensideCastle()) {
      const rank = m.from[1];
      ply.rook = m.isKingsideCastle() ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
    }
    if (m.isEnPassant()) ply.ep = `${m.to[0]}${m.from[1]}`;
    if (m.promotion) ply.promo = m.promotion as PieceType;
    if (chess.inCheck()) {
      const turn = chess.turn();
      ply.check = chess
        .board()
        .flat()
        .find((p) => p?.type === "k" && p.color === turn)?.square;
    }
    return ply;
  });
}

/** FEN after playing `moves` from the start, for server-rendering a line's final position. */
export function fenAfter(moves: string[]): string {
  const chess = new Chess();
  for (const san of moves) chess.move(san);
  return chess.fen();
}
