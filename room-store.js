import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

// Security model adapted from Dice-Jumbo/templates/secure-four-player-rooms.
export const codePattern = /^[A-HJ-NP-Z2-9]{5}$/;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const hashToken = token => createHash('sha256').update(token).digest('hex');
export class RoomError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
export const fail = (status, code, message) => { throw new RoomError(status, code, message); };
export class RateLimiter {
  constructor(now = Date.now) { this.now = now; this.buckets = new Map(); }
  consume(key, limit, window = 60_000) {
    const time = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || time >= bucket.until) {
      if (this.buckets.size >= 10_000) {
        this.sweep();
        if (this.buckets.size >= 10_000) fail(429, 'RATE_LIMITED', 'Previše zahteva. Pokušaj kasnije.');
      }
      bucket = { count: 0, until: time + window };
      this.buckets.set(key, bucket);
    }
    if (++bucket.count > limit) fail(429, 'RATE_LIMITED', 'Previše zahteva. Pokušaj kasnije.');
  }
  sweep() { for (const [key, value] of this.buckets) if (this.now() >= value.until) this.buckets.delete(key); }
}

export class RoomStore {
  constructor({ dataDir, now = Date.now, limits = {}, persist, onDelete = () => {} }) {
    Object.assign(this, { dataDir, now, onDelete });
    this.limits = { maxRooms: 500, idleMs: 30 * 60_000, maxAgeMs: 24 * 60 * 60_000, finishedMs: 60 * 60_000, ...limits };
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid room limit');
    this.games = new Map();
    this.persist = persist || (record => {
      const temp = path.join(dataDir, `${record.id}.${randomBytes(8).toString('hex')}.tmp`);
      try {
        writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
        renameSync(temp, path.join(dataDir, `${record.id}.json`));
      } finally {
        try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    });
    mkdirSync(dataDir, { recursive: true });
    for (const file of readdirSync(dataDir)) {
      if (!codePattern.test(file.slice(0, -5)) || !file.endsWith('.json')) continue;
      try {
        const record = JSON.parse(readFileSync(path.join(dataDir, file), 'utf8'));
        if (record.id !== file.slice(0, -5) || record.version !== 2 || record.game?.version !== 1 ||
            !Array.isArray(record.tokenHashes) || !Array.isArray(record.receipts) ||
            !Number.isFinite(record.createdAt) || !Number.isFinite(record.touchedAt)) continue;
        if (this.expired(record) || this.games.size >= this.limits.maxRooms) { unlinkSync(path.join(dataDir, file)); continue; }
        this.games.set(record.id, record);
      } catch { /* Invalid files are retired by the bounded retention sweep. */ }
    }
    this.sweep();
  }
  expired(record) {
    const time = this.now();
    return time - record.createdAt >= this.limits.maxAgeMs || time - record.touchedAt >= this.limits.idleMs ||
      (record.finishedAt != null && time - record.finishedAt >= this.limits.finishedMs);
  }
  code() {
    if (this.games.size >= this.limits.maxRooms) fail(503, 'CAPACITY', 'Sve sobe su zauzete. Pokušaj kasnije.');
    for (let i = 0; i < 32; i++) {
      const code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('');
      if (!this.games.has(code)) return code;
    }
    fail(503, 'CAPACITY', 'Nije moguće napraviti sobu.');
  }
  get(id) {
    const record = this.games.get(id);
    if (record && this.expired(record)) { this.remove(id); return undefined; }
    return record;
  }
  commit(record) {
    // No await between reading the current record, applying a draft and committing it.
    this.persist(record);
    this.games.set(record.id, record);
  }
  remove(id) {
    try { unlinkSync(path.join(this.dataDir, `${id}.json`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.games.delete(id);
    this.onDelete(id);
  }
  sweep() {
    for (const record of this.games.values()) if (this.expired(record)) this.remove(record.id);
    // Retire legacy 32-character rooms, corrupt records and interrupted write files.
    for (const file of readdirSync(this.dataDir)) {
      if (!/^(?:[A-HJ-NP-Z2-9]{5}|[a-f0-9]{32})(?:\.[a-f0-9.]+)?\.(?:json|tmp)$/.test(file)) continue;
      if (this.games.has(file.slice(0, -5))) continue;
      const target = path.join(this.dataDir, file);
      if (this.now() - statSync(target).mtimeMs >= this.limits.maxAgeMs) unlinkSync(target);
    }
  }
}
