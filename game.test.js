import test from "node:test";
import assert from "node:assert/strict";
import { newGame, join, leave, start, roll, move, legalMoves } from "./game.js";

function started(seats = 2) {
  const game = newGame(seats);
  for (let i = 0; i < seats; i++) join(game, `player-${i}`, `Igrač ${i + 1}`);
  start(game, 0);
  roll(game, 0, 6);
  for (let i = 1; i < seats; i++) roll(game, i, 1);
  return game;
}

test("svaki igrač bira početak bacanjem; najviši rezultat počinje", () => {
  const game = newGame(2);
  join(game, "one", "Prvi");
  assert.equal(game.phase, "lobby");
  join(game, "two", "Drugi");
  assert.equal(game.phase, "lobby");
  assert.throws(() => start(game, 1), /Samo domaćin/);
  start(game, 0);
  assert.equal(game.phase, "choose-starter");
  assert.throws(() => roll(game, 1, 6), /Nije vaš potez/);
  roll(game, 0, 3);
  assert.equal(game.current, 1);
  roll(game, 1, 5);
  assert.equal(game.phase, "await-roll");
  assert.equal(game.current, 1);
  assert.equal(game.turn, 1);
});

test("domaćin može početi sa dva od četiri mesta; posle toga se ne može ući", () => {
  const game = newGame(4);
  join(game, "one", "Prvi");
  assert.throws(() => start(game, 0), /najmanje dva/);
  join(game, "two", "Drugi");
  start(game, 0);
  assert.equal(game.seats, 2);
  assert.equal(game.players.length, 2);
  assert.equal(game.phase, "choose-starter");
  assert.throws(() => join(game, "three", "Treći"), /već počela/);
});

test("napuštanje čekaonice oslobađa mesto i prenosi domaćina", () => {
  const game = newGame(4);
  join(game, "one", "Prvi");
  join(game, "two", "Drugi");
  join(game, "three", "Treći");
  leave(game, 0);
  assert.equal(game.players[0].id, "two");
  assert.equal(game.players[0].color, "red");
  assert.equal(game.players[1].id, "three");
  assert.equal(join(game, "four", "Četvrti"), 2);
  start(game, 0);
  assert.equal(game.seats, 3);
});

test("šestica izvodi figuru i daje novo bacanje", () => {
  const game = started();
  roll(game, 0, 6);
  assert.deepEqual(legalMoves(game), [0, 1, 2, 3]);
  move(game, 0, 2);
  assert.equal(game.pieces[0][2], 0);
  assert.equal(game.current, 0);
  assert.equal(game.turn, 1);
  assert.throws(() => move(game, 0, 0), /Prvo bacite/);
});

test("izjednačeni ponovo bacaju, a ostali ne učestvuju u razigravanju", () => {
  const game = newGame(3);
  for (let i = 0; i < 3; i++) join(game, `p${i}`, `Igrač ${i}`);
  start(game, 0);
  roll(game, 0, 5);
  roll(game, 1, 2);
  const tie = roll(game, 2, 5);
  assert.deepEqual(tie.tiedSeats, [0, 2]);
  assert.equal(game.phase, "choose-starter");
  assert.equal(game.current, 0);
  roll(game, 0, 3);
  assert.equal(game.current, 2);
  assert.throws(() => roll(game, 1, 6), /Nije vaš potez/);
  roll(game, 2, 4);
  assert.equal(game.phase, "await-roll");
  assert.equal(game.current, 2);
});

test("tri pokušaja važe samo kada su sve preostale figure u kući", () => {
  const game = started();
  assert.equal(roll(game, 0, 1).attemptsLeft, 2);
  assert.equal(game.current, 0);
  assert.equal(roll(game, 0, 2).attemptsLeft, 1);
  assert.equal(game.current, 0);
  assert.equal(roll(game, 0, 3).attemptsLeft, 0);
  assert.equal(game.current, 1);
  assert.equal(game.openingAttempts, 0);
  game.pieces[1][0] = 7;
  roll(game, 1, 1);
  assert.equal(game.phase, "await-move");
  move(game, 1, 0);
  assert.equal(game.current, 0);
  roll(game, 0, 6);
  move(game, 0, 0);
  roll(game, 0, 1);
  move(game, 0, 0);
  assert.equal(game.current, 1);
  game.pieces[1] = [56, -1, -1, -1];
  roll(game, 1, 2);
  assert.equal(game.current, 0);
});

test("sopstvena figura blokira start, krug i završnu stazu, ali ne zajednički cilj", () => {
  const game = started();
  game.pieces[0][0] = 0;
  roll(game, 0, 6);
  assert.deepEqual(legalMoves(game), [0]);
  assert.throws(() => move(game, 0, 1), /nema dozvoljen potez/);
  game.roll = null;
  game.phase = "await-roll";
  game.pieces[0] = [4, 5, 54, 53];
  roll(game, 0, 1);
  assert.deepEqual(legalMoves(game), [1, 2]);
  game.roll = null;
  game.phase = "await-roll";
  game.pieces[0] = [56, 57, 57, 57];
  roll(game, 0, 1);
  assert.deepEqual(legalMoves(game), [0]);
});

test("cilj zahteva tačan broj i završava partiju sa četiri figure", () => {
  const game = started();
  game.pieces[0] = [56, 57, 57, 57];
  roll(game, 0, 2);
  assert.equal(game.current, 1);
  game.current = 0;
  roll(game, 0, 1);
  move(game, 0, 0);
  assert.equal(game.winner, 0);
  assert.equal(game.phase, "finished");
  assert.throws(() => roll(game, 0, 6), /nije dozvoljeno/);
});

test("izbacivanje važi na običnom polju i daje dodatni potez", () => {
  const game = started();
  game.pieces[0][0] = 4;
  game.pieces[1][0] = 44; // plavi: (13+44)%52 = 5
  roll(game, 0, 1);
  const event = move(game, 0, 0);
  assert.deepEqual(event.captured, [{ seat: 1, piece: 0 }]);
  assert.equal(game.pieces[1][0], -1);
  assert.equal(game.current, 0);
});

test("gaženje važi i na obojenom početnom polju", () => {
  const game = started();
  game.pieces[0][0] = 12;
  game.pieces[1][0] = 0; // plavo početno polje je fizičko polje 13
  roll(game, 0, 1);
  move(game, 0, 0);
  assert.equal(game.pieces[1][0], -1);
});
