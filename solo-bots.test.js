import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, join, start, roll, move, legalMoves } from './game.js';
import { chooseBotMove, rollBotDie } from './public/solo-bots.js';

function gameForBot() {
  const game = newGame(2);
  join(game, 'human', 'Igrač');
  join(game, 'bot', 'Bot');
  start(game, 0);
  roll(game, 0, 1);
  roll(game, 1, 6);
  assert.equal(game.current, 1);
  roll(game, 1, 6);
  assert.equal(game.phase, 'await-move');
  return game;
}

test('bot chooses only a server-legal move and gets a piece onto the board', () => {
  const game = gameForBot();
  const before = structuredClone(game);
  const piece = chooseBotMove(game, 1, () => 0);
  assert.ok(legalMoves(game).includes(piece));
  move(game, 1, piece);
  assert.equal(game.pieces[1][piece], 0);
  assert.deepEqual(game.pieces[0], before.pieces[0]);
});

test('bot chooses a capture when it can make one', () => {
  const game = gameForBot();
  game.pieces[1][0] = 3;
  game.pieces[0][0] = 17;
  game.roll = 1;
  const piece = chooseBotMove(game, 1, () => 0);
  assert.equal(piece, 0);
  const result = move(game, 1, piece);
  assert.deepEqual(result.captured, [{ seat: 0, piece: 0 }]);
});

test('bot die comes from a cryptographic source and remains between one and six', () => {
  for (let index = 0; index < 100; index++) {
    const die = rollBotDie();
    assert.ok(die >= 1 && die <= 6);
  }
});
