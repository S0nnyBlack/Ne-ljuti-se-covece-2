import test from 'node:test';
import assert from 'node:assert/strict';
import { returnToArena, chooseSavedEntry } from './public/arena-navigation.js';

test('canceling an active-game exit preserves all state and connections', () => {
  const effects = [];
  const result = returnToArena({
    active: true, confirm: () => false,
    saveSolo: () => effects.push('save'), closeStream: () => effects.push('close'),
    navigate: url => effects.push(url)
  });
  assert.equal(result, false);
  assert.deepEqual(effects, []);
});

test('confirmed navigation saves solo first and closes only the local stream', () => {
  const effects = [];
  assert.equal(returnToArena({
    active: true, confirm: () => { effects.push('confirm'); return true; },
    saveSolo: () => effects.push('save'), closeStream: () => effects.push('close'),
    navigate: url => effects.push(url)
  }), true);
  assert.deepEqual(effects, ['confirm', 'save', 'close', '/']);
});

test('inactive navigation requires no confirmation and follows the Jamb link', () => {
  const effects = [];
  const destination = 'https://dice-jumbo-2.onrender.com/jamb';
  returnToArena({
    destination,
    confirm: () => assert.fail('Inactive games need no confirmation'),
    saveSolo: () => {}, closeStream: () => {},
    navigate: url => effects.push(url)
  });
  assert.deepEqual(effects, [destination]);
});

test('an invitation takes priority over saved solo and unrelated online rooms', () => {
  const solo = { game: {}, playerId: 'local' };
  const online = { id: 'ABCDE', token: 'a'.repeat(64), seat: 0 };
  assert.deepEqual(chooseSavedEntry({ solo, online }), { mode: 'solo', solo });
  assert.deepEqual(chooseSavedEntry({ online }), { mode: 'online', session: online });
  assert.deepEqual(chooseSavedEntry({ inviteCode: 'BCDEF', solo, online }), { mode: 'home', session: null });
  assert.deepEqual(chooseSavedEntry({ inviteCode: 'ABCDE', solo, online }), { mode: 'online', session: online });
  assert.deepEqual(chooseSavedEntry({ inviteCode: 'ABCDE', solo }), { mode: 'home', session: null });
  assert.equal(chooseSavedEntry({ online: { id: 'ABCDE', token: 'bad' } }).mode, 'home');
  assert.equal(chooseSavedEntry({ online: { id: 'bad', token: 'a'.repeat(64) } }).mode, 'home');
});
