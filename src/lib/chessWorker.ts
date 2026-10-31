// Web Worker wrapper around the chess engine, so the board stays responsive while the computer thinks.
import { bestMove, type Level } from "./chessEngine";

interface Ask {
  id: number;
  moves: string[];
  level: Level;
}

self.onmessage = (e: MessageEvent<Ask>) => {
  const { id, moves, level } = e.data;
  let move = null;
  try {
    move = bestMove(moves, level);
  } catch {
    move = null;
  }
  self.postMessage({ id, move });
};
