import test from 'node:test';
import assert from 'node:assert/strict';
import { readSession, saveSession, forgetSession } from './public/session-store.js';

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

const session = (id, token) => ({ id, token: token.repeat(64), seat: 0, playerId: id });

test('an invitation selects its own room without discarding another active session', () => {
  const local = storage();
  const first = session('ABCDE', 'a');
  const second = session('FGHJK', 'b');
  saveSession(local, first);
  assert.equal(readSession(local, second.id), null);
  assert.deepEqual(readSession(local), first);
  saveSession(local, second);
  assert.deepEqual(readSession(local, first.id), first);
  assert.deepEqual(readSession(local, second.id), second);
  assert.deepEqual(readSession(local), second);
  forgetSession(local, first);
  assert.equal(readSession(local, first.id), null);
  assert.deepEqual(readSession(local), second);
});

test('legacy active sessions remain readable and malformed stored values are ignored', () => {
  const local = storage();
  const first = session('ABCDE', 'a');
  local.setItem('coveceArenaSessionV2', JSON.stringify(first));
  assert.deepEqual(readSession(local, first.id), first);
  assert.equal(readSession(local, 'FGHJK'), null);
  local.setItem('coveceArenaSessionV2:FGHJK', '{broken');
  assert.equal(readSession(local, 'FGHJK'), null);
});
