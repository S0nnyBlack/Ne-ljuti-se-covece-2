import test from 'node:test';
import assert from 'node:assert/strict';
import { movementPositions } from './public/piece-motion.js';

test('piece movement includes each square from home through the goal lane', () => {
  assert.deepEqual(movementPositions(-1, 0), [-1, 0]);
  assert.deepEqual(movementPositions(49, 55), [49, 50, 51, 52, 53, 54, 55]);
  assert.deepEqual(movementPositions(55, 57), [55, 56, 57]);
});

test('captured and stale positions do not create a misleading route', () => {
  assert.deepEqual(movementPositions(12, -1), []);
  assert.deepEqual(movementPositions(4, 4), []);
  assert.deepEqual(movementPositions(4, 12), []);
  assert.deepEqual(movementPositions(undefined, 2), []);
});
