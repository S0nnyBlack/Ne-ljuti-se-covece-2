import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardGameAction } from './public/keyboard-shortcuts.js';

const game = (changes = {}) => ({
  desktop: true, visible: true, modalOpen: false, busy: false, ownTurn: true,
  focusIsEditable: false, focusIsActivatable: false,
  phase: 'await-roll', legalMoves: [], ...changes
});

test('Space rolls at the start and during a turn, but not while choosing a piece', () => {
  assert.deepEqual(keyboardGameAction({ code: 'Space' }, game({ phase: 'choose-starter' })), { type: 'roll' });
  assert.deepEqual(keyboardGameAction({ code: 'Space' }, game()), { type: 'roll' });
  assert.equal(keyboardGameAction({ code: 'Space' }, game({ phase: 'await-move' })), null);
});

test('number row and numpad choose only legal pieces', () => {
  const turn = game({ phase: 'await-move', legalMoves: [0, 2] });
  assert.deepEqual(keyboardGameAction({ code: 'Digit1' }, turn), { type: 'move', piece: 0 });
  assert.deepEqual(keyboardGameAction({ code: 'Numpad3' }, turn), { type: 'move', piece: 2 });
  assert.equal(keyboardGameAction({ code: 'Digit2' }, turn), null);
  assert.equal(keyboardGameAction({ code: 'Digit1' }, game()), null);
});

test('shortcuts stay inactive outside desktop play and while another control has focus', () => {
  const key = { code: 'Space' };
  for (const changes of [{ desktop: false }, { visible: false }, { modalOpen: true }, { busy: true },
    { ownTurn: false }, { focusIsEditable: true }, { focusIsActivatable: true }]) {
    assert.equal(keyboardGameAction(key, game(changes)), null);
  }
  assert.equal(keyboardGameAction({ code: 'Digit1' }, game({ phase: 'await-move', legalMoves: [0], focusIsEditable: true })), null);
  assert.equal(keyboardGameAction({ code: 'Space', repeat: true }, game()), null);
  assert.equal(keyboardGameAction({ code: 'Space', ctrlKey: true }, game()), null);
});
