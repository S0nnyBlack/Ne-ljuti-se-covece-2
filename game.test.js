import test from "node:test";
import assert from "node:assert/strict";
import { newGame, join, roll, move, legalMoves } from "./game.js";

function started(seats = 2) {
  const game = newGame(seats);
  for (let i = 0; i < seats; i++) join(game, `player-${i}`, `Igrač ${i + 1}`);
  return game;
}

test("soba počinje tek kada se popuni, a potez pripada aktivnom igraču", () => {
  const game = newGame(2);
  join(game, "one", "Prvi");
  assert.equal(game.phase, "lobby");
  join(game, "two", "Drugi");
  assert.equal(game.phase, "await-roll");
  assert.throws(() => roll(game, 1, 6), /Nije vaš potez/);
  roll(game, 0, 3);
  assert.equal(game.current, 1);
  assert.equal(game.turn, 2);
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

test("početna polja su zaštićena", () => {
  const game = started();
  game.pieces[0][0] = 12;
  game.pieces[1][0] = 0; // plavo početno polje je fizičko polje 13
  roll(game, 0, 1);
  move(game, 0, 0);
  assert.equal(game.pieces[1][0], 0);
});
