// Prototype C chess pieces and board geometry, shared by the line boards, the home tile and the
// two-player board. The pieces are original geometric silhouettes (viewBox 0 0 100 100), drawn
// here so there is no third-party piece-set licence to track.

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type PieceColor = "w" | "b";

const BASE = "M26 88v-5a5 5 0 0 1 5-5h38a5 5 0 0 1 5 5v5z";

// Body paths per piece. Each is closed and filled; `detail` strokes sit on top.
const SHAPES: Record<PieceType, { body: string[]; detail?: string[] }> = {
  p: {
    body: [BASE, "M37 78c1-12 6-21 13-25 7 4 12 13 13 25z", "M50 21a12 12 0 1 1 0 24 12 12 0 0 1 0-24z"],
  },
  r: {
    body: [
      BASE,
      "M33 78l3-31h28l3 31z",
      "M30 18h10v8h5v-8h10v8h5v-8h10v20a5 5 0 0 1-5 5H35a5 5 0 0 1-5-5z",
    ],
  },
  b: {
    body: [
      BASE,
      "M39 78c1-10 1-17 2-24h18c1 7 1 14 2 24z",
      "M37 47h26v7H37z",
      "M50 15c11 9 15 19 11 32H39c-4-13 0-23 11-32z",
      "M50 6a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z",
    ],
    detail: ["M55 25l-9 11"],
  },
  n: {
    body: [
      BASE,
      "M66 78H34c0-11 5-19 14-25-5-1-10 1-16 5-5-2-7-6-4-11l17-21c3-6 8-10 14-11l2 7c10 5 14 20 11 35-1 9-5 15-6 21z",
    ],
    detail: ["M51 32h.01"],
  },
  q: {
    body: [
      BASE,
      "M27 30l9 24 4-29 6 27 4-31 4 31 6-27 4 29 9-24-6 40H33z",
      "M33 70c2 3 2 6 0 8h34c-2-2-2-5 0-8z",
      "M27 23a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM40 18a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM50 14a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM60 18a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM73 23a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z",
    ],
  },
  k: {
    body: [
      BASE,
      "M40 66l-4 12h28l-4-12z",
      "M37 59h26v7H37z",
      "M50 27c10 0 17 6 17 15 0 7-5 12-8 17H41c-3-5-8-10-8-17 0-9 7-15 17-15z",
      "M47 6h6v6h6v6h-6v9h-6v-9h-6v-6h6z",
    ],
    detail: ["M50 36v14"],
  },
};

export const PIECE_NAMES: Record<PieceType, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/** Inline SVG markup for one piece. Decorative: the board or square carries the accessible name. */
export function pieceSvg(color: PieceColor, type: PieceType): string {
  const shape = SHAPES[type];
  const body = shape.body.map((d) => `<path d="${d}"/>`).join("");
  const detail = (shape.detail ?? []).map((d) => `<path class="pc-detail" d="${d}"/>`).join("");
  return `<svg class="pc-svg pc-${color}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${body}${detail}</svg>`;
}

export const FILES = "abcdefgh";

/** Board-relative column/row (0..7, top-left origin) for a square like "e4". */
export function squareXY(square: string, flipped = false): { x: number; y: number } {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return flipped ? { x: 7 - file, y: rank } : { x: file, y: 7 - rank };
}

/** Inverse of squareXY. */
export function xyToSquare(x: number, y: number, flipped = false): string {
  return flipped ? `${FILES[7 - x]}${y + 1}` : `${FILES[x]}${8 - y}`;
}

export function isLightSquare(square: string): boolean {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return (file + rank) % 2 === 1;
}

/** All 64 squares in visual order (rows top to bottom) for the given orientation. */
export function squaresInOrder(flipped = false): string[] {
  const out: string[] = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out.push(xyToSquare(x, y, flipped));
  return out;
}

export interface PlacedPiece {
  square: string;
  color: PieceColor;
  type: PieceType;
}

/** Pieces from the board part of a FEN. */
export function piecesFromFen(fen: string): PlacedPiece[] {
  const rows = fen.split(" ")[0].split("/");
  const out: PlacedPiece[] = [];
  rows.forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const color: PieceColor = ch === ch.toUpperCase() ? "w" : "b";
      out.push({ square: `${FILES[file]}${8 - i}`, color, type: ch.toLowerCase() as PieceType });
      file++;
    }
  });
  return out;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
