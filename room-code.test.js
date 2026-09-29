import test from 'node:test';
import assert from 'node:assert/strict';
import { readRoomCode } from './public/room-code.js';
test('invite codes are exactly five characters and full links normalize safely', () => {
  assert.equal(readRoomCode(' ab2cd '), 'AB2CD');
  assert.equal(readRoomCode('https://game.example/?room=ab2cd&other=1#rules'), 'AB2CD');
  assert.equal(readRoomCode('?room=AB2CD'), 'AB2CD');
  for (const value of ['', 'ABCD', 'ABCDEF', 'AB0CD', 'ABI23', 'a'.repeat(32), '?room=AB2CDX', null]) assert.equal(readRoomCode(value), '');
});
