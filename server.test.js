import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApp } from './server.js';
import { RoomStore, RateLimiter } from './room-store.js';

async function fixture(t, options = {}) {
  const dir = mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '.test-data-'));
  let server;
  let base;
  const launch = async () => {
    server = createApp({ dataDir: dir, rng: () => 6, ...options });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await launch();
  t.after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });
  const request = async (route, { token, payload, ...extra } = {}) => {
    const response = await fetch(base + route, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra.headers },
      body: payload === undefined ? undefined : JSON.stringify(payload), ...extra
    });
    return { status: response.status, value: await response.json() };
  };
  const create = async (seats = 4) => (await request('/api/games', { payload: { name: 'Ana', seats } })).value;
  const join = async id => (await request(`/api/games/${id}/join`, { payload: { name: 'Bojan' } })).value;
  const get = room => request(`/api/games/${room.id}`, { token: room.token });
  const command = (room, action, revision, extra = {}) => request(`/api/games/${room.id}/${action}`, {
    token: room.token, payload: { requestId: randomUUID(), expectedRevision: revision, ...extra }
  });
  return { dir, request, create, join, get, command, url: route => base + route, restart: async () => { await close(); await launch(); } };
}

test('five-character rooms, authenticated reads, hashes and persistence with original rules', async t => {
  const f = await fixture(t);
  const host = await f.create(2);
  assert.match(host.id, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.match(host.token, /^[a-f0-9]{64}$/);
  const guest = await f.join(host.id);
  assert.equal(guest.seat, 1);
  assert.equal((await f.request(`/api/games/${host.id}`)).status, 401);
  assert.equal((await f.request(`/api/games/${host.id}/events`)).status, 401);
  assert.equal((await f.request(`/api/games/${host.id}?token=${host.token}`)).status, 401);
  assert.equal((await f.command(guest, 'start', 2)).status, 400);
  assert.equal((await f.command(host, 'start', 2)).status, 200);
  const rolled = await f.command(host, 'roll', 3);
  assert.deepEqual(rolled.value.legalMoves, [0, 1, 2, 3]);
  assert.equal((await f.command(host, 'move', 4, { piece: 5 })).status, 400);
  assert.equal((await f.get(host)).value.revision, 4);
  const moved = await f.command(host, 'move', 4, { piece: 0 });
  assert.equal(moved.value.pieces[0][0], 0);
  const disk = readFileSync(path.join(f.dir, `${host.id}.json`), 'utf8');
  assert.equal(disk.includes(host.token), false);
  assert.equal(disk.includes(guest.token), false);
  assert.equal(JSON.stringify(moved.value).includes('tokenHash'), false);
  await f.restart();
  assert.deepEqual((await f.get(host)).value, moved.value);
});

test('idempotent commands survive restart, reject reused IDs and concurrent stale moves', async t => {
  const f = await fixture(t);
  const host = await f.create();
  await f.join(host.id);
  const requestId = randomUUID();
  const started = await f.command(host, 'start', 2, { requestId });
  assert.deepEqual(await f.command(host, 'start', 2, { requestId }), started);
  await f.restart();
  assert.deepEqual(await f.command(host, 'start', 2, { requestId }), started);
  assert.equal((await f.command(host, 'roll', 2, { requestId })).value.code, 'REQUEST_ID_REUSED');
  const results = await Promise.all([f.command(host, 'roll', 3), f.command(host, 'roll', 3)]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
  assert.equal((await f.get(host)).value.revision, 4);
  assert.equal((await f.command(host, 'move', 3, { piece: 0 })).value.code, 'STALE_REVISION');
});

test('leave transfers host, revokes token, supports four players and rejects active leave', async t => {
  const f = await fixture(t);
  const host = await f.create();
  const guest = await f.join(host.id);
  const third = await f.join(host.id);
  await f.join(host.id);
  assert.equal((await f.request(`/api/games/${host.id}/join`, { payload: { name: 'Fifth' } })).status, 400);
  const requestId = randomUUID();
  const left = await f.command(host, 'leave', 4, { requestId });
  assert.equal(left.status, 200);
  assert.deepEqual(await f.command(host, 'leave', 4, { requestId }), left);
  assert.equal((await f.get(host)).status, 401);
  assert.equal((await f.get(guest)).value.players[0].id, guest.state.players[1].id);
  assert.equal((await f.command(third, 'start', 5)).status, 400);
  assert.equal((await f.command(guest, 'start', 5)).status, 200);
  assert.equal((await f.command(guest, 'leave', 6)).status, 400);
});

test('save failure rolls back creation, joining, commands and receipts', async t => {
  let failWrite = true;
  const f = await fixture(t, { persist(record) {
    if (failWrite) throw new Error('disk full');
    writeFileSync(path.join(f.dir, `${record.id}.json`), JSON.stringify(record));
  } });
  assert.equal((await f.request('/api/games', { payload: { name: 'Ana' } })).status, 500);
  assert.equal(readdirSync(f.dir).length, 0);
  failWrite = false;
  const host = await f.create();
  failWrite = true;
  assert.equal((await f.request(`/api/games/${host.id}/join`, { payload: { name: 'Bojan' } })).status, 500);
  assert.equal((await f.get(host)).value.revision, 1);
  failWrite = false;
  await f.join(host.id);
  failWrite = true;
  const requestId = randomUUID();
  assert.equal((await f.command(host, 'start', 2, { requestId })).status, 500);
  assert.equal((await f.get(host)).value.phase, 'lobby');
  failWrite = false;
  assert.equal((await f.command(host, 'start', 2, { requestId })).status, 200);
  assert.equal((await f.get(host)).value.revision, 3);
});

test('rate limits include invalid probes and cannot be bypassed by forwarded addresses', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/api/games', { payload: { name: 'A' } })).status, 201);
  assert.equal((await f.request('/api/games', { payload: { name: 'A' }, headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' } })).status, 429);
  for (let i = 0; i < 20; i++) assert.equal((await f.request('/api/games/AAAAA/join', { payload: { name: 'A' } })).status, 404);
  assert.equal((await f.request('/api/games/AAAAA/join', { payload: { name: 'A' } })).status, 429);
});

test('capacity and expiry bound persisted rooms including after restart', async t => {
  let time = Date.now();
  const f = await fixture(t, { now: () => time, limits: { maxRooms: 1, idleMs: 100, maxAgeMs: 1000 } });
  const host = await f.create();
  assert.equal((await f.request('/api/games', { payload: { name: 'A' } })).status, 503);
  time += 101;
  assert.equal((await f.get(host)).status, 404);
  assert.equal(readdirSync(f.dir).length, 0);
  const second = await f.create();
  time += 101;
  await f.restart();
  assert.equal((await f.get(second)).status, 404);
  assert.equal(readdirSync(f.dir).length, 0);
});

test('authenticated SSE streams publish changes and close when membership is revoked', async t => {
  const f = await fixture(t);
  const host = await f.create();
  const guest = await f.join(host.id);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(f.url(`/api/games/${host.id}/events`), { headers: { authorization: `Bearer ${host.token}` }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: state/);
  const second = await fetch(f.url(`/api/games/${host.id}/events`), { headers: { authorization: `Bearer ${host.token}` }, signal: controller.signal });
  assert.equal(second.status, 200);
  assert.equal((await f.request(`/api/games/${host.id}/events`, { token: host.token })).status, 429);
  await f.command(host, 'leave', 2);
  assert.equal((await reader.read()).done, true);
  assert.equal((await f.get(guest)).value.revision, 3);
  await second.body.cancel();
});

test('origin, oversized bodies, unknown credentials and invalid command metadata are rejected', async t => {
  const f = await fixture(t, { publicUrl: 'https://game.example' });
  assert.equal((await f.request('/api/games', { payload: { name: 'A' }, headers: { origin: 'https://evil.example', 'content-type': 'application/json' } })).status, 403);
  assert.equal((await f.request('/api/games', { payload: { name: 'č'.repeat(2200) } })).status, 413);
  const host = await f.create(3);
  const other = await f.create();
  assert.equal((await f.request(`/api/games/${host.id}`, { token: other.token })).status, 401);
  assert.equal((await f.request(`/api/games/${host.id}/start`, { token: host.token, payload: {} })).status, 400);
  const page = await (await fetch(f.url('/'))).text();
  assert.match(page, /Kod od 5 znakova/);
  const client = await (await fetch(f.url('/app.js'))).text();
  assert.match(client, /authorization: `Bearer/);
  assert.match(client, /crypto.randomUUID/);
  assert.doesNotMatch(client, /new EventSource/);
});

test('limiter prunes expired keys and absolute/finished room lifetime is enforced', () => {
  let time = 0;
  const rate = new RateLimiter(() => time);
  rate.consume('client', 1);
  assert.throws(() => rate.consume('client', 1), { status: 429 });
  time = 60_000;
  rate.sweep();
  assert.equal(rate.buckets.size, 0);
  const store = Object.create(RoomStore.prototype);
  store.now = () => time;
  store.limits = { maxAgeMs: 100, idleMs: 1000, finishedMs: 10 };
  assert.equal(store.expired({ createdAt: time - 100, touchedAt: time }), true);
  assert.equal(store.expired({ createdAt: time, touchedAt: time, finishedAt: time - 10 }), true);
});
