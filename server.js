/**
 * Ne ljuti se čoveče – Online (server.js)
 * Server-authoritative multiplayer Ludo ("Parcheesi"-style) game.
 * Node.js + Express + Socket.io. No database — everything lives in memory.
 */

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Game constants
// ---------------------------------------------------------------------------

const COLORS = ['red', 'green', 'yellow', 'blue'];
const COLOR_NAMES_SR = { red: 'Crveni', green: 'Zeleni', yellow: 'Žuti', blue: 'Plavi' };
// Where each color starts on the shared 52-cell ring.
const START_OFFSET = { red: 0, green: 13, yellow: 26, blue: 39 };
// Cells (relative to a color's own path, i.e. "step" numbers 0-50) that are safe stars.
const SAFE_STEP_OFFSETS = [0, 8];
const SHARED_LENGTH = 52;
const HOME_COLUMN_LENGTH = 6;
const STEPS_TO_ENTER_HOME = 51; // steps 0..50 are on the shared ring
const FINISH_STEP = STEPS_TO_ENTER_HOME + HOME_COLUMN_LENGTH; // 57 = finished
const MAX_PLAYERS = 4;
const MAX_CHAT_LEN = 200;
const MAX_NAME_LEN = 18;
const CHAT_RATE_MS = 700;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** @type {Map<string, Room>} */
const rooms = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[<>]/g, '').trim().slice(0, MAX_NAME_LEN);
}

function sanitizeChat(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[<>]/g, '').trim().slice(0, MAX_CHAT_LEN);
}

function globalCellForStep(color, step) {
  // Only meaningful while step is on the shared ring (0..50)
  return (START_OFFSET[color] + step) % SHARED_LENGTH;
}

function isSafeStep(step) {
  return SAFE_STEP_OFFSETS.includes(step);
}

function newRoom(code, hostSocketId) {
  return {
    code,
    createdAt: Date.now(),
    players: [], // { id, socketId, name, color, connected, isHost }
    started: false,
    currentPlayerIndex: 0,
    dice: null,
    rolling: false,
    consecutiveSixes: 0,
    tokens: {}, // color -> [ {state:'yard'|'active'|'home', step:number, slot:number} x4 ]
    log: [],
    winner: null,
    lastChatAt: {}, // playerId -> timestamp
  };
}

function initTokens(room) {
  room.tokens = {};
  for (const color of COLORS) {
    room.tokens[color] = [0, 1, 2, 3].map((slot) => ({ state: 'yard', step: -1, slot }));
  }
}

function pushLog(room, message) {
  room.log.push({ message, at: Date.now() });
  if (room.log.length > 60) room.log.shift();
}

function publicRoomState(room) {
  return {
    code: room.code,
    started: room.started,
    currentPlayerIndex: room.currentPlayerIndex,
    dice: room.dice,
    rolling: room.rolling,
    winner: room.winner,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      isHost: p.isHost,
    })),
    tokens: room.tokens,
    log: room.log.slice(-40),
  };
}

function broadcastState(room) {
  io.to(room.code).emit('room_state', publicRoomState(room));
}

function activePlayers(room) {
  return room.players.filter((p) => p.connected);
}

function currentPlayer(room) {
  return room.players[room.currentPlayerIndex] || null;
}

function playerTokens(room, color) {
  return room.tokens[color];
}

/** Compute which of a color's tokens can legally move with a given dice value. */
function legalMoves(room, color, diceValue) {
  const moves = [];
  const tokens = playerTokens(room, color);
  tokens.forEach((t, idx) => {
    if (t.state === 'home') return; // finished
    if (t.state === 'yard') {
      if (diceValue === 6) moves.push(idx);
      return;
    }
    if (t.state === 'active') {
      const newStep = t.step + diceValue;
      if (newStep <= FINISH_STEP) moves.push(idx);
    }
  });
  return moves;
}

function tokensOccupyingGlobalCell(room, cell, excludeColor) {
  const occupants = [];
  for (const color of COLORS) {
    if (color === excludeColor) continue;
    room.tokens[color].forEach((t, idx) => {
      if (t.state === 'active' && t.step <= STEPS_TO_ENTER_HOME - 1 && globalCellForStep(color, t.step) === cell) {
        occupants.push({ color, idx });
      }
    });
  }
  return occupants;
}

function applyMove(room, color, tokenIdx, diceValue) {
  const token = room.tokens[color][tokenIdx];
  const events = [];

  if (token.state === 'yard') {
    token.state = 'active';
    token.step = 0;
    events.push({ type: 'exit', color, tokenIdx });
  } else {
    token.step += diceValue;
    if (token.step >= FINISH_STEP) {
      token.step = FINISH_STEP;
      token.state = 'home';
      events.push({ type: 'finish', color, tokenIdx });
    } else {
      events.push({ type: 'move', color, tokenIdx, step: token.step });
    }
  }

  // Capture check — only while on the shared ring, and not on a safe cell.
  if (token.state === 'active' && token.step <= STEPS_TO_ENTER_HOME - 1 && !isSafeStep(token.step)) {
    const cell = globalCellForStep(color, token.step);
    const occupants = tokensOccupyingGlobalCell(room, cell, color);
    for (const occ of occupants) {
      const captured = room.tokens[occ.color][occ.idx];
      captured.state = 'yard';
      captured.step = -1;
      events.push({ type: 'capture', color, tokenIdx, capturedColor: occ.color, capturedIdx: occ.idx });
    }
  }

  return events;
}

function allTokensHome(room, color) {
  return room.tokens[color].every((t) => t.state === 'home');
}

function advanceTurn(room, keepTurn) {
  if (keepTurn) {
    room.dice = null;
    return;
  }
  const n = room.players.length;
  if (n === 0) return;
  let next = room.currentPlayerIndex;
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n;
    if (room.players[next].connected) break;
  }
  room.currentPlayerIndex = next;
  room.dice = null;
  room.consecutiveSixes = 0;
}

function nameFor(room, color) {
  const p = room.players.find((pl) => pl.color === color);
  return p ? p.name : COLOR_NAMES_SR[color];
}

function cleanupEmptyRoomsTick() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const allGone = room.players.every((p) => !p.connected);
    if (allGone && now - (room.emptiedAt || room.createdAt) > 5 * 60 * 1000) {
      rooms.delete(code);
    } else if (allGone && !room.emptiedAt) {
      room.emptiedAt = now;
    } else if (!allGone) {
      room.emptiedAt = null;
    }
  }
}
setInterval(cleanupEmptyRoomsTick, 60 * 1000);

// ---------------------------------------------------------------------------
// Socket.io handlers
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  let currentRoomCode = null;
  let currentPlayerId = null;

  socket.on('create_room', (payload, cb) => {
    try {
      const name = sanitizeName(payload && payload.name) || 'Igrač';
      const code = makeRoomCode();
      const room = newRoom(code, socket.id);
      initTokens(room);

      const player = {
        id: socket.id,
        socketId: socket.id,
        name,
        color: COLORS[0],
        connected: true,
        isHost: true,
      };
      room.players.push(player);
      rooms.set(code, room);

      socket.join(code);
      currentRoomCode = code;
      currentPlayerId = player.id;

      pushLog(room, `${name} je napravio/la sobu.`);
      cb && cb({ ok: true, code, playerId: player.id, color: player.color });
      broadcastState(room);
    } catch (err) {
      cb && cb({ ok: false, error: 'Greška pri kreiranju sobe.' });
    }
  });

  socket.on('join_room', (payload, cb) => {
    try {
      const name = sanitizeName(payload && payload.name) || 'Igrač';
      const code = String((payload && payload.code) || '').toUpperCase().trim();
      const room = rooms.get(code);

      if (!room) {
        cb && cb({ ok: false, error: 'Soba ne postoji.' });
        return;
      }
      if (room.started) {
        cb && cb({ ok: false, error: 'Igra je već počela.' });
        return;
      }
      if (activePlayers(room).length >= MAX_PLAYERS) {
        cb && cb({ ok: false, error: 'Soba je puna.' });
        return;
      }

      const usedColors = new Set(room.players.map((p) => p.color));
      const color = COLORS.find((c) => !usedColors.has(c));

      const player = {
        id: socket.id,
        socketId: socket.id,
        name,
        color,
        connected: true,
        isHost: false,
      };
      room.players.push(player);

      socket.join(code);
      currentRoomCode = code;
      currentPlayerId = player.id;

      pushLog(room, `${name} se pridružio/la sobi.`);
      cb && cb({ ok: true, code, playerId: player.id, color: player.color });
      broadcastState(room);
    } catch (err) {
      cb && cb({ ok: false, error: 'Greška pri pridruživanju.' });
    }
  });

  socket.on('start_game', (payload, cb) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return cb && cb({ ok: false, error: 'Soba ne postoji.' });
    const me = room.players.find((p) => p.id === currentPlayerId);
    if (!me || !me.isHost) return cb && cb({ ok: false, error: 'Samo domaćin može pokrenuti igru.' });
    if (room.started) return cb && cb({ ok: false, error: 'Igra je već počela.' });
    if (activePlayers(room).length < 2) return cb && cb({ ok: false, error: 'Potrebna su najmanje 2 igrača.' });

    room.started = true;
    room.currentPlayerIndex = 0;
    room.dice = null;
    pushLog(room, 'Igra je počela! Srećno svima.');
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('roll_dice', (payload, cb) => {
    const room = rooms.get(currentRoomCode);
    if (!room || !room.started || room.winner) return cb && cb({ ok: false });
    const me = currentPlayer(room);
    if (!me || me.id !== currentPlayerId) return cb && cb({ ok: false, error: 'Nije tvoj red.' });
    if (room.dice !== null) return cb && cb({ ok: false, error: 'Već si bacio/la kocku.' });

    const value = 1 + Math.floor(Math.random() * 6);
    room.dice = value;
    if (value === 6) room.consecutiveSixes += 1;
    else room.consecutiveSixes = 0;

    const moves = legalMoves(room, me.color, value);
    pushLog(room, `${me.name} je bacio/la ${value}.`);

    if (moves.length === 0) {
      // No legal moves — pass the turn (three-sixes-in-a-row also forfeits).
      const forfeitBySixes = room.consecutiveSixes >= 3;
      if (forfeitBySixes) pushLog(room, `${me.name} je bacio/la tri šestice zaredom — red prelazi dalje.`);
      setTimeout(() => {
        if (!rooms.has(room.code)) return;
        pushLog(room, `${me.name} nema legalan potez.`);
        advanceTurn(room, false);
        broadcastState(room);
      }, 650);
    }

    cb && cb({ ok: true, value, moves });
    broadcastState(room);
  });

  socket.on('move_token', (payload, cb) => {
    const room = rooms.get(currentRoomCode);
    if (!room || !room.started || room.winner) return cb && cb({ ok: false });
    const me = currentPlayer(room);
    if (!me || me.id !== currentPlayerId) return cb && cb({ ok: false, error: 'Nije tvoj red.' });
    if (room.dice === null) return cb && cb({ ok: false, error: 'Prvo baci kocku.' });

    const tokenIdx = Number(payload && payload.tokenIdx);
    const moves = legalMoves(room, me.color, room.dice);
    if (!moves.includes(tokenIdx)) {
      return cb && cb({ ok: false, error: 'Nelegalan potez.' });
    }

    const diceValue = room.dice;
    const events = applyMove(room, me.color, tokenIdx, diceValue);

    for (const ev of events) {
      if (ev.type === 'capture') {
        pushLog(room, `${nameFor(room, ev.color)} je pojeo/la figuru igrača ${nameFor(room, ev.capturedColor)}!`);
      } else if (ev.type === 'finish') {
        pushLog(room, `${nameFor(room, ev.color)} je doveo/la figuru kući!`);
      } else if (ev.type === 'exit') {
        pushLog(room, `${nameFor(room, ev.color)} je izveo/la figuru iz dvorišta.`);
      }
    }

    let wonNow = false;
    if (allTokensHome(room, me.color)) {
      room.winner = { color: me.color, name: me.name };
      pushLog(room, `🏆 ${me.name} je pobednik!`);
      wonNow = true;
    }

    const gotAnotherTurn = !wonNow && (diceValue === 6 && room.consecutiveSixes < 3);
    advanceTurn(room, gotAnotherTurn && !wonNow);

    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('new_game', (payload, cb) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return cb && cb({ ok: false });
    const me = room.players.find((p) => p.id === currentPlayerId);
    if (!me || !me.isHost) return cb && cb({ ok: false, error: 'Samo domaćin može započeti novu igru.' });

    room.started = false;
    room.winner = null;
    room.dice = null;
    room.currentPlayerIndex = 0;
    room.consecutiveSixes = 0;
    initTokens(room);
    room.log = [];
    pushLog(room, 'Nova igra je spremna. Domaćin može ponovo pokrenuti igru.');
    cb && cb({ ok: true });
    broadcastState(room);
  });

  socket.on('send_chat_message', (payload) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const me = room.players.find((p) => p.id === currentPlayerId);
    if (!me) return;

    const now = Date.now();
    const last = room.lastChatAt[me.id] || 0;
    if (now - last < CHAT_RATE_MS) return; // basic rate limiting
    room.lastChatAt[me.id] = now;

    const text = sanitizeChat(payload && payload.text);
    if (!text) return;

    io.to(room.code).emit('chat_message', {
      playerId: me.id,
      name: me.name,
      color: me.color,
      text,
      at: now,
    });
  });

  socket.on('send_reaction', (payload) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const me = room.players.find((p) => p.id === currentPlayerId);
    if (!me) return;
    const allowed = ['😀', '😂', '🔥', '👑', '😭', '🎉'];
    const emoji = allowed.includes(payload && payload.emoji) ? payload.emoji : null;
    if (!emoji) return;
    io.to(room.code).emit('reaction', { playerId: me.id, name: me.name, color: me.color, emoji });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const me = room.players.find((p) => p.id === currentPlayerId);
    if (!me) return;
    me.connected = false;
    pushLog(room, `${me.name} je napustio/la sobu.`);

    // Reassign host if the host left.
    if (me.isHost) {
      const nextHost = room.players.find((p) => p.connected);
      if (nextHost) nextHost.isHost = true;
    }

    // If it was this player's turn, move on so the game doesn't stall.
    if (room.started && !room.winner && currentPlayer(room) && currentPlayer(room).id === me.id) {
      advanceTurn(room, false);
    }

    broadcastState(room);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ne ljuti se čoveče – Online server sluša na portu ${PORT}`);
});
