import { FINISH, move, legalMoves } from '../game.js';

export function rollBotDie() {
  const values = new Uint32Array(1);
  const limit = 4_294_967_292; // largest multiple of six below 2^32
  do { globalThis.crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % 6 + 1;
}

/** Pick a legal move, preferring a win, capture, entering, then progress. */
export function chooseBotMove(game, seat, random = Math.random) {
  if (game.phase !== 'await-move' || game.current !== seat) return null;
  const choices = legalMoves(game);
  if (!choices.length) return null;
  const ranked = choices.map(piece => {
    const draft = structuredClone(game);
    const oldPosition = draft.pieces[seat][piece];
    const result = move(draft, seat, piece);
    const score = (result.winner === seat ? 100_000 : 0) +
      result.captured.length * 1_000 +
      (oldPosition === -1 ? 100 : 0) +
      (result.position === FINISH ? 500 : result.position);
    return { piece, score };
  });
  const best = Math.max(...ranked.map(choice => choice.score));
  const tied = ranked.filter(choice => choice.score === best);
  return tied[Math.min(tied.length - 1, Math.floor(random() * tied.length))].piece;
}
