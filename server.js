import http from 'node:http';
import path from 'node:path';
import { createReadStream, statSync } from 'node:fs';
import { randomBytes, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GameError, newGame, join, leave, start, roll, move, publicGame } from './game.js';
import { RoomStore, RateLimiter, RoomError, codePattern, hashToken, fail } from './room-store.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const bearer = /^Bearer ([a-f0-9]{64})$/;
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
export const resolvePublicUrl = (env = process.env) => env.PUBLIC_URL || env.RENDER_EXTERNAL_URL;
function send(res, status, value) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new GameError('Očekuje se JSON zahtev.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) fail(413, 'PAYLOAD_TOO_LARGE', 'Zahtev je prevelik.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new GameError('Neispravan JSON zahtev.'); }
}

export function createApp({ dataDir = path.join(root, 'data'), rng = () => randomInt(1, 7), now = Date.now,
  limits, persist, publicUrl = resolvePublicUrl() } = {}) {
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('PUBLIC_URL must be an HTTP(S) URL without credentials');
  }
  const allowedOrigin = publicUrl ? new URL(publicUrl).origin : null;
  const listeners = new Map();
  const rates = new RateLimiter(now);
  const store = new RoomStore({ dataDir, now, limits, persist, onDelete(id) {
    for (const client of listeners.get(id) || []) client.res.end();
    listeners.delete(id);
  } });
  function publish(record) {
    const payload = `event: state\ndata: ${JSON.stringify(publicGame(record.game))}\n\n`;
    for (const client of listeners.get(record.id) || []) {
      if (!record.tokenHashes.includes(client.hash)) client.res.end();
      else if (!client.res.write(payload)) client.res.destroy();
    }
  }
  function auth(req, record) {
    const token = bearer.exec(req.headers.authorization || '')?.[1];
    const hash = token ? hashToken(token) : '';
    const seat = record.tokenHashes.indexOf(hash);
    if (seat < 0) fail(401, 'UNAUTHORIZED', 'Nevažeći pristupni token.');
    return { seat, hash };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && ['/', '/index.html', '/app.js', '/room-code.js', '/menu.css'].includes(url.pathname)) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const target = path.join(root, 'public', file);
        const contentType = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
        res.writeHead(200, { 'content-type': contentType, 'content-length': statSync(target).size, 'cache-control': 'no-cache' });
        createReadStream(target).pipe(res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, service: 'covece-server' });
      if (parts[0] !== 'api') return send(res, 404, { error: 'Ruta ne postoji.' });
      // Never trust client-supplied forwarding headers. Behind a proxy these limits are shared.
      const key = req.socket.remoteAddress || 'unknown';
      rates.consume(`all:${key}`, 240);
      const origin = req.headers.origin;
      const expectedOrigin = allowedOrigin || `http://${req.headers.host}`;
      if ((origin && origin !== expectedOrigin) || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'ORIGIN', 'Izvor zahteva nije dozvoljen.');
      if (req.method === 'POST' && url.pathname === '/api/games') {
        rates.consume(`create:${key}`, 5);
        const input = await body(req);
        const game = newGame(input.seats ?? 4);
        const id = store.code();
        const token = randomBytes(32).toString('hex');
        join(game, randomBytes(16).toString('hex'), input.name);
        const record = { version: 2, id, game, tokenHashes: [hashToken(token)], receipts: [], createdAt: now(), touchedAt: now(), finishedAt: null };
        store.commit(record);
        return send(res, 201, { id, seat: 0, token, state: publicGame(game) });
      }
      // Count probes before code validation and room lookup, including unknown room codes.
      rates.consume(`access:${key}`, 120);
      if (parts[3] === 'join') rates.consume(`join:${key}`, 20);
      if (parts[1] !== 'games' || !codePattern.test(parts[2] || '')) return send(res, 404, { error: 'Soba nije dostupna.' });
      // Read the body before looking up the record so concurrent requests never mutate a stale copy.
      const input = req.method === 'POST' ? await body(req) : null;
      const record = store.get(parts[2]);
      if (!record) return send(res, 404, { error: 'Soba nije dostupna.' });
      if (req.method === 'POST' && parts.length === 4 && parts[3] === 'join') {
        const draft = structuredClone(record);
        const token = randomBytes(32).toString('hex');
        const seat = join(draft.game, randomBytes(16).toString('hex'), input.name);
        draft.tokenHashes[seat] = hashToken(token);
        draft.touchedAt = now();
        store.commit(draft); publish(draft);
        return send(res, 201, { id: draft.id, seat, token, state: publicGame(draft.game) });
      }
      // A revoked token can only replay its exact successful leave acknowledgement.
      // It cannot read subsequent state or authorize any new command.
      if (req.method === 'POST' && parts.length === 4 && parts[3] === 'leave') {
        const token = bearer.exec(req.headers.authorization || '')?.[1];
        const previous = token && record.receipts.find(item => item.hash === hashToken(token) && item.requestId === input.requestId);
        const fingerprint = hashToken(JSON.stringify(['leave', input.expectedRevision, input.piece ?? null]));
        if (previous && previous.fingerprint === fingerprint) return send(res, 200, previous.state);
      }
      const { seat, hash } = auth(req, record);
      if (req.method === 'GET' && parts.length === 3) return send(res, 200, publicGame(record.game));
      if (req.method === 'GET' && parts[3] === 'events' && parts.length === 4) {
        const clients = [...listeners.values()].flatMap(set => [...set]);
        if (clients.filter(client => client.key === key).length >= 16 || clients.length >= 2000 ||
            clients.filter(client => client.hash === hash).length >= 2) fail(429, 'CONNECTION_LIMIT', 'Previše otvorenih veza.');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(`event: state\ndata: ${JSON.stringify(publicGame(record.game))}\n\n`);
        if (!listeners.has(record.id)) listeners.set(record.id, new Set());
        const client = { res, hash, key };
        listeners.get(record.id).add(client);
        const ping = setInterval(() => { if (!res.write(': keepalive\n\n')) res.destroy(); }, 25000);
        res.on('close', () => {
          clearInterval(ping);
          const set = listeners.get(record.id);
          set?.delete(client);
          if (!set?.size) listeners.delete(record.id);
        });
        return;
      }
      if (req.method !== 'POST' || parts.length !== 4 || !['leave', 'start', 'roll', 'move'].includes(parts[3])) return send(res, 404, { error: 'Ruta ne postoji.' });
      const action = parts[3];
      rates.consume(`command:${hash}`, 120);
      if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail(400, 'INVALID_COMMAND', 'Komanda zahteva ID i reviziju.');
      const fingerprint = hashToken(JSON.stringify([action, input.expectedRevision, input.piece ?? null]));
      const previous = record.receipts.find(item => item.hash === hash && item.requestId === input.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, 'REQUEST_ID_REUSED', 'ID zahteva je već iskorišćen.');
        return send(res, 200, previous.state);
      }
      if (input.expectedRevision !== record.game.revision) fail(409, 'STALE_REVISION', 'Stanje sobe je promenjeno. Proveri novi potez.');
      const draft = structuredClone(record);
      if (action === 'leave') { leave(draft.game, seat); draft.tokenHashes.splice(seat, 1); }
      if (action === 'start') start(draft.game, seat);
      if (action === 'roll') roll(draft.game, seat, rng());
      if (action === 'move') move(draft.game, seat, input.piece);
      draft.touchedAt = now();
      if (draft.game.phase === 'finished') draft.finishedAt = now();
      const state = structuredClone(publicGame(draft.game));
      draft.receipts.push({ hash, requestId: input.requestId, fingerprint, state });
      draft.receipts = draft.receipts.slice(-128);
      store.commit(draft); publish(draft);
      return send(res, 200, state);
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      if (error instanceof RoomError && error.status === 429) res.setHeader('Retry-After', '60');
      return send(res, error instanceof RoomError ? error.status : error instanceof GameError ? 400 : 500,
        { error: error instanceof RoomError || error instanceof GameError ? error.message : 'Greška servera.', code: error.code || 'INVALID_REQUEST' });
    }
  });
  const sweep = setInterval(() => {
    try { store.sweep(); rates.sweep(); } catch (error) { console.error('Room cleanup failed:', error.code || 'IO_ERROR'); }
  }, 60_000);
  sweep.unref();
  server.on('close', () => clearInterval(sweep));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production' && !resolvePublicUrl()) {
    throw new Error('PUBLIC_URL or RENDER_EXTERNAL_URL is required in production');
  }
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Čoveče server sluša na portu ${port}`));
}
