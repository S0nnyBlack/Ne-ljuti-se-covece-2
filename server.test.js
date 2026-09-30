import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApp, resolvePublicUrl } from './server.js';
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
  const dice = [6, 1, 6];
  const f = await fixture(t, { rng: () => dice.shift() });
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
  assert.equal((await f.get(host)).value.phase, 'choose-starter');
  assert.equal((await f.command(host, 'roll', 3)).status, 200);
  assert.equal((await f.command(guest, 'roll', 4)).status, 200);
  assert.equal((await f.get(host)).value.current, 0);
  const rolled = await f.command(host, 'roll', 5);
  assert.deepEqual(rolled.value.legalMoves, [0, 1, 2, 3]);
  assert.equal((await f.command(host, 'move', 6, { piece: 5 })).status, 400);
  assert.equal((await f.get(host)).value.revision, 6);
  const moved = await f.command(host, 'move', 6, { piece: 0 });
  assert.equal(moved.value.pieces[0][0], 0);
  const disk = readFileSync(path.join(f.dir, `${host.id}.json`), 'utf8');
  assert.equal(disk.includes(host.token), false);
  assert.equal(disk.includes(guest.token), false);
  assert.equal(JSON.stringify(moved.value).includes('tokenHash'), false);
  await f.restart();
  assert.deepEqual((await f.get(host)).value, moved.value);
});

test('opening tie-break and three attempts persist across restart', async t => {
  const dice = [4, 4, 5, 1, 2, 3, 4];
  const f = await fixture(t, { rng: () => dice.shift() });
  const host = await f.create(2);
  const guest = await f.join(host.id);
  await f.command(host, 'start', 2);
  await f.command(host, 'roll', 3);
  const tied = await f.command(guest, 'roll', 4);
  assert.deepEqual(tied.value.starterCandidates, [0, 1]);
  assert.equal(tied.value.phase, 'choose-starter');
  await f.restart();
  await f.command(host, 'roll', 5);
  const selected = await f.command(guest, 'roll', 6);
  assert.equal(selected.value.phase, 'await-roll');
  assert.equal(selected.value.current, 0);
  const first = await f.command(host, 'roll', 7);
  assert.equal(first.value.openingAttempts, 1);
  assert.equal(first.value.current, 0);
  await f.restart();
  const second = await f.command(host, 'roll', 8);
  assert.equal(second.value.openingAttempts, 2);
  const third = await f.command(host, 'roll', 9);
  assert.equal(third.value.current, 1);
  assert.equal(third.value.openingAttempts, 0);
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
  const page = await (await fetch(f.url('/covece'))).text();
  assert.match(page, /Kod od 5 znakova/);
  const client = await (await fetch(f.url('/app.js'))).text();
  assert.match(client, /authorization: `Bearer/);
  assert.match(client, /crypto.randomUUID/);
  assert.doesNotMatch(client, /new EventSource/);
  assert.equal((await fetch(f.url('/game.js'))).status, 200);
  assert.equal((await fetch(f.url('/solo-bots.js'))).status, 200);
  assert.equal((await fetch(f.url('/keyboard-shortcuts.js'))).status, 200);
  assert.match(page, /Solo igra/);
  assert.match(page, /<details class="mobile-menu"><summary>Meni<\/summary>/);
  assert.match(page, /id="mobileRules">Kako se igra<\/button>/);
  assert.doesNotMatch(page, /<section class="rules-card"/);
  assert.match(client, /options\.append\(button\)/);
});

test('the server serves every module imported by the browser app', async t => {
  const f = await fixture(t);
  const pending = ['/app.js'];
  const seen = new Set();
  while (pending.length) {
    const route = pending.shift();
    if (seen.has(route)) continue;
    seen.add(route);
    const response = await fetch(f.url(route));
    assert.equal(response.status, 200, `Missing browser module: ${route}`);
    assert.match(response.headers.get('content-type'), /^text\/javascript/);
    const source = await response.text();
    for (const match of source.matchAll(/^import\s+.+?\s+from\s+['"]([^'"]+)['"];?/gm)) {
      pending.push(new URL(match[1], f.url(route)).pathname);
    }
  }
  assert.ok(seen.has('/solo-storage.js'));
  assert.ok(seen.has('/piece-motion.js'));
  assert.ok(seen.has('/game-feed.js'));
  for (const route of ['/game-navigation.js', '/game-i18n.js', '/hub/shared/language.js', '/hub/shared/brand-die.js']) assert.ok(seen.has(route), route);
  const page = await (await fetch(f.url('/covece'))).text();
  assert.equal((page.match(/data-brand-die/g) || []).length, 2);
  assert.equal((page.match(/data-game-language/g) || []).length, 2);
  assert.match(page, /id="homeRules"/);
  assert.match(page, /href="https:\/\/dice-jumbo-2\.onrender\.com\/jamb"/);
  assert.match(page, /href="\/" data-arena-home/);
});

test('Render deployment uses its public URL unless a custom URL is configured', async t => {
  assert.equal(resolvePublicUrl({ RENDER_EXTERNAL_URL: 'https://game.onrender.com' }), 'https://game.onrender.com');
  assert.equal(resolvePublicUrl({ PUBLIC_URL: 'https://play.example', RENDER_EXTERNAL_URL: 'https://game.onrender.com' }), 'https://play.example');
  const f = await fixture(t, { publicUrl: resolvePublicUrl({ RENDER_EXTERNAL_URL: 'https://game.onrender.com' }) });
  const created = await f.request('/api/games', {
    payload: { name: 'Ana' }, headers: { 'content-type': 'application/json', origin: 'https://game.onrender.com' }
  });
  assert.equal(created.status, 201);
  const foreign = await f.request(`/api/games/${created.value.id}`, {
    token: created.value.token, headers: { origin: 'https://other.example' }
  });
  assert.equal(foreign.status, 403);
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

test('Arena homepage, English entry, room redirects and public modules are available', async t => {
  const f = await fixture(t);
  const home = await (await fetch(f.url('/'))).text();
  assert.match(home, /Arena Games — Izaberi igru/);
  assert.match(home, /href="\/covece"/);
  assert.match(home, /href="https:\/\/dice-jumbo-2.onrender.com\/jamb"/);
  assert.doesNotMatch(home, /PROTOTIP|PROTOTYPE|src="\/app.js"/);
  const english = await (await fetch(f.url('/en.html'))).text();
  assert.match(english, /<html lang="en">/);
  assert.match(english, /What shall we play/);
  for (const route of ['/covece', '/covece/', '/index.html', '/covece?room=ABCDE']) {
    const response = await fetch(f.url(route));
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.doesNotMatch(page, /<base\b/);
    assert.match(page, /src="\/app.js"/);
    assert.match(page, /href="\/menu.css"/);
    assert.match(page, /id="enterOnline"/);
    assert.match(page, /data-arena-home/);
  }
  const invite = await fetch(f.url('/?room=ABCDE&lang=en'), { redirect: 'manual' });
  assert.equal(invite.status, 302);
  assert.equal(invite.headers.get('location'), '/covece?room=ABCDE&lang=en');
  const seen = new Set();
  async function visit(route) {
    if (seen.has(route)) return;
    seen.add(route);
    const response = await fetch(f.url(route));
    assert.equal(response.status, 200, route);
    const source = await response.text();
    if (route.endsWith('.js')) {
      assert.match(response.headers.get('content-type'), /^text\/javascript/);
      for (const match of source.matchAll(/^import\s+.+?\s+from\s+['"]([^'"]+)['"];?/gm)) {
        await visit(new URL(match[1], f.url(route)).pathname);
      }
    } else assert.match(response.headers.get('content-type'), /^text\/css/);
  }
  for (const match of home.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) await visit(match[1]);
  assert.equal(seen.size, 5);
  for (const route of ['/hub/shared/missing.js', '/hub/shared/../../server.js', '/package.json', '/server.js', '/room-store.js']) {
    assert.equal((await fetch(f.url(route))).status, 404);
  }
});

test('browser defenses block framing and foreign scripts while keeping authenticated room reads private', async t => {
  const f = await fixture(t, { publicUrl: 'https://ne-ljuti-se-covece-2.onrender.com' });
  const response = await fetch(f.url('/covece'));
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*(unsafe-inline|unsafe-eval|https:)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const room = await f.create();
  assert.equal((await f.request('/api/games/' + room.id)).status, 401);
  assert.equal((await f.request('/api/games/' + room.id + '/events')).status, 401);
  const foreign = await f.request('/api/games/' + room.id, { token: room.token, headers: { origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  const hidden = await f.request('/api/games/' + room.id + '/events', { token: room.token, headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(hidden.status, 403);
  assert.equal((await f.get(room)).status, 200);
});
