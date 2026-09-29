import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, join, start } from './game.js';
import { restoreSoloSnapshot } from './public/solo-storage.js';
import { describeAction } from './public/game-feed.js';

test('a valid solo game can be restored after refresh', () => {
  const game = newGame(2);
  join(game, 'human', 'Igrač');
  join(game, 'bot', 'Bot 1');
  start(game, 0);
  const restored = restoreSoloSnapshot(JSON.stringify({ version: 1, playerId: 'human', game }));
  assert.deepEqual(restored, { game, playerId: 'human' });
});

test('damaged solo snapshots are rejected', () => {
  const game = newGame(2);
  join(game, 'human', 'Igrač');
  join(game, 'bot', 'Bot 1');
  start(game, 0);
  assert.equal(restoreSoloSnapshot('{'), null);
  assert.equal(restoreSoloSnapshot(JSON.stringify({ version: 1, playerId: 'wrong', game })), null);
  game.pieces[0][0] = 58;
  assert.equal(restoreSoloSnapshot(JSON.stringify({ version: 1, playerId: 'human', game })), null);
});

test('the move feed describes dice, figure, and capture', () => {
  const state = { players: [{ name: 'Mira' }], lastAction: { type: 'roll', seat: 0, die: 6, passed: false } };
  assert.equal(describeAction(state), 'Mira: kockica 6');
  state.lastAction = { type: 'move', seat: 0, piece: 2, die: 6, captured: [{ seat: 1, piece: 0 }] };
  assert.equal(describeAction(state), 'Mira: figura 3 ide 6 polja · izbacivanje');
  state.lastAction = { type: 'start', seat: 0 };
  assert.equal(describeAction(state), null);
});
