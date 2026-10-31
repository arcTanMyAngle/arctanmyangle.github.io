import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import { bestMove } from "../src/lib/chessEngine.ts";

// The engine leans on chess.js internals (_moves/_makeMove/_undoMove); these fail loudly if an upgrade changes them.
const fixed = () => 0.5;
const legal = (fen, m) => new Chess(fen).moves({ verbose: true }).some((x) => x.from === m.from && x.to === m.to);

describe("chess engine", () => {
  test("plays a legal opening move at every level", () => {
    for (const level of ["easy", "medium", "hard"]) {
      const m = bestMove([], level, { ms: 300, random: fixed });
      expect(m).not.toBeNull();
      expect(legal(new Chess().fen(), m)).toBe(true);
    }
  });

  test("finds mate in one", () => {
    // Back-rank mate: Ra8#.
    const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
    for (const level of ["medium", "hard"]) {
      expect(bestMove([], level, { ms: 500 }, fen)).toMatchObject({ from: "a1", to: "a8" });
    }
  });

  test("takes a hanging queen", () => {
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1";
    expect(bestMove([], "medium", { ms: 500 }, fen)).toMatchObject({ from: "f3", to: "h4" });
  });

  test("promotes when it should", () => {
    const fen = "8/P7/8/8/8/8/k7/4K3 w - - 0 1";
    expect(bestMove([], "hard", { ms: 500 }, fen)).toMatchObject({ from: "a7", to: "a8", promotion: "q" });
  });

  test("returns null when the game is over", () => {
    expect(bestMove(["f3", "e5", "g4", "Qh4#"], "hard")).toBeNull();
  });

  test("a whole game against itself stays legal", () => {
    const g = new Chess();
    for (let i = 0; i < 40 && !g.isGameOver(); i++) {
      const m = bestMove(g.history(), i % 2 ? "easy" : "medium", { ms: 60 });
      expect(m).not.toBeNull();
      g.move(m);
    }
  });
});
