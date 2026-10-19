import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { linePlies } from "../src/lib/chessLinePlan.ts";
import { buildFrames } from "../src/components/chessLine.ts";
import { chessLines } from "../src/data/site.ts";

// The client replays build-time plies without chess.js; its final frame must match
// what chess.js says the board is, for every line and for the awkward move kinds.
function finalSquares(moves) {
  const { pieces, frames } = buildFrames(linePlies(moves));
  const last = frames.at(-1);
  const out = {};
  for (const p of pieces) {
    const sq = last.at.get(p.id);
    if (sq) out[sq] = `${p.color}${last.types.get(p.id)}`;
  }
  return out;
}

function chessSquares(moves) {
  const chess = new Chess();
  for (const m of moves) chess.move(m);
  const out = {};
  for (const p of chess.board().flat()) if (p) out[p.square] = `${p.color}${p.type}`;
  return out;
}

describe("linePlies + buildFrames", () => {
  for (const line of chessLines) {
    test(`${line.slug} ends on chess.js's position`, () => {
      expect(finalSquares(line.moves)).toEqual(chessSquares(line.moves));
    });
  }

  test("castling moves the rook", () => {
    const moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"];
    expect(linePlies(moves).at(-1).rook).toEqual(["h1", "f1"]);
    expect(finalSquares(moves)).toEqual(chessSquares(moves));
  });

  test("en passant removes the passed pawn", () => {
    const moves = ["e4", "a6", "e5", "d5", "exd6"];
    expect(linePlies(moves).at(-1).ep).toBe("d5");
    expect(finalSquares(moves)).toEqual(chessSquares(moves));
  });

  test("promotion changes the piece type", () => {
    const moves = ["h4", "g5", "hxg5", "h6", "gxh6", "Bg7", "hxg7", "a6", "gxh8=Q"];
    expect(linePlies(moves).at(-1).promo).toBe("q");
    expect(finalSquares(moves)).toEqual(chessSquares(moves));
  });

  test("check marks the checked king", () => {
    const plies = linePlies(["e4", "f5", "Qh5+"]);
    expect(plies.at(-1).check).toBe("e8");
  });
});
