// Pravila preuzeta iz interaktivnog koncepta; varijante su opisane u README.
export const STARTS = [0, 13, 26, 39];
export const COLORS = ["red", "blue", "yellow", "green"];
export const FINISH = 57;

export class GameError extends Error {
  constructor(message) { super(message); this.name = "GameError"; }
}

export function newGame(seats = 4) {
  if (!Number.isInteger(seats) || seats < 2 || seats > 4) throw new GameError("Broj igrača mora biti 2–4.");
  return {
    version: 1, seats, players: Array(seats).fill(null),
    pieces: Array.from({ length: seats }, () => [-1, -1, -1, -1]),
    phase: "lobby", current: 0, roll: null, turn: 1, winner: null, revision: 0,
    lastAction: null
  };
}

export function join(game, playerId, name) {
  if (game.phase !== "lobby") throw new GameError("Partija je već počela.");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 32) throw new GameError("Ime mora imati 1–32 znaka.");
  if (game.players.some(p => p?.id === playerId)) throw new GameError("Igrač je već u partiji.");
  const seat = game.players.findIndex(p => p === null);
  if (seat < 0) throw new GameError("Soba je puna.");
  game.players[seat] = { id: playerId, name: name.trim(), color: COLORS[seat] };
  if (game.players.every(Boolean)) game.phase = "await-roll";
  game.revision++;
  game.lastAction = { type: "join", seat };
  return seat;
}

export function legalMoves(game) {
  if (game.phase !== "await-move") return [];
  return game.pieces[game.current].flatMap((pos, piece) => {
    if (pos === FINISH) return [];
    if (pos === -1) return game.roll === 6 ? [piece] : [];
    return pos + game.roll <= FINISH ? [piece] : [];
  });
}

function advance(game) {
  game.current = (game.current + 1) % game.seats;
  game.turn++;
}

export function roll(game, seat, die) {
  if (game.phase !== "await-roll") throw new GameError("Bacanje sada nije dozvoljeno.");
  if (seat !== game.current) throw new GameError("Nije vaš potez.");
  if (!Number.isInteger(die) || die < 1 || die > 6) throw new GameError("Kockica mora biti 1–6.");
  game.roll = die;
  game.phase = "await-move";
  const moves = legalMoves(game);
  const passed = moves.length === 0;
  const extra = passed && die === 6;
  if (passed) {
    game.roll = null;
    game.phase = "await-roll";
    if (!extra) advance(game);
  }
  game.revision++;
  game.lastAction = { type: "roll", seat, die, passed, extra, legalMoves: moves };
  return game.lastAction;
}

export function move(game, seat, piece) {
  if (game.phase !== "await-move") throw new GameError("Prvo bacite kockicu.");
  if (seat !== game.current) throw new GameError("Nije vaš potez.");
  if (!Number.isInteger(piece) || !legalMoves(game).includes(piece)) throw new GameError("Figura nema dozvoljen potez.");
  const die = game.roll;
  const old = game.pieces[seat][piece];
  const position = old === -1 ? 0 : old + die;
  game.pieces[seat][piece] = position;
  const captured = [];
  if (position < 52) {
    const square = (STARTS[seat] + position) % 52;
    if (!STARTS.includes(square)) {
      for (let other = 0; other < game.seats; other++) {
        if (other === seat) continue;
        for (let index = 0; index < 4; index++) {
          const otherPos = game.pieces[other][index];
          if (otherPos >= 0 && otherPos < 52 && (STARTS[other] + otherPos) % 52 === square) {
            game.pieces[other][index] = -1;
            captured.push({ seat: other, piece: index });
          }
        }
      }
    }
  }
  const extra = die === 6 || captured.length > 0;
  game.roll = null;
  if (game.pieces[seat].every(pos => pos === FINISH)) {
    game.phase = "finished";
    game.winner = seat;
  } else {
    game.phase = "await-roll";
    if (!extra) advance(game);
  }
  game.revision++;
  game.lastAction = { type: "move", seat, piece, die, position, captured, extra, winner: game.winner };
  return game.lastAction;
}

export function publicGame(game) {
  return {
    version: game.version, seats: game.seats, players: game.players,
    pieces: game.pieces, phase: game.phase, current: game.current,
    roll: game.roll, turn: game.turn, winner: game.winner,
    revision: game.revision, legalMoves: legalMoves(game), lastAction: game.lastAction
  };
}
