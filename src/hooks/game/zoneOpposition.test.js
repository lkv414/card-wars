/**
 * zoneOpposition.test.js — Unit tests for attack target resolution.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAttackTargets,
  canAttack,
  getNeighbor,
  getNextAliveNeighbor,
} from './zoneOpposition.js'

const p = (id, health = 25) => ({ player_id: id, health, nickname: id })

test('getAttackTargets returns empty for fewer than 2 players', () => {
  assert.deepEqual(getAttackTargets('a', [p('a')], 0), [])
  assert.deepEqual(getAttackTargets('a', null, 0), [])
})

test('2-player game: any zone hits all opponent zones', () => {
  const players = [p('a'), p('b')]
  for (let zone = 0; zone < 4; zone++) {
    const targets = getAttackTargets('a', players, zone)
    assert.equal(targets.length, 1)
    assert.equal(targets[0].playerId, 'b')
    assert.deepEqual(targets[0].zones, [0, 1, 2, 3])
  }
})

test('2-player fallback when only 2 alive in 4-player game', () => {
  const players = [p('a'), p('b', 0), p('c', 0), p('d')]
  const targets = getAttackTargets('a', players, 1)
  assert.equal(targets.length, 1)
  assert.equal(targets[0].playerId, 'd')
  assert.deepEqual(targets[0].zones, [0, 1, 2, 3])
})

test('3-player: left zones hit right zones of next alive neighbor', () => {
  const players = [p('a'), p('b'), p('c')]
  assert.deepEqual(getAttackTargets('a', players, 0), [{ playerId: 'b', zones: [2, 3] }])
  assert.deepEqual(getAttackTargets('a', players, 1), [{ playerId: 'b', zones: [2, 3] }])
})

test('3-player: right zones hit left zones of next alive neighbor', () => {
  const players = [p('a'), p('b'), p('c')]
  assert.deepEqual(getAttackTargets('b', players, 2), [{ playerId: 'a', zones: [0, 1] }])
  assert.deepEqual(getAttackTargets('b', players, 3), [{ playerId: 'a', zones: [0, 1] }])
})

test('4-player: skips dead neighbor when finding attack target', () => {
  const players = [p('a'), p('b', 0), p('c'), p('d')]
  assert.deepEqual(getAttackTargets('a', players, 0), [{ playerId: 'c', zones: [2, 3] }])
})

test('canAttack validates target player and zone', () => {
  const players = [p('a'), p('b'), p('c')]
  assert.equal(canAttack('a', players, 0, 'b', 2), true)
  assert.equal(canAttack('a', players, 0, 'b', 0), false)
  assert.equal(canAttack('a', players, 0, 'c', 2), false)
})

test('getNeighbor returns circular neighbor for 3+ players', () => {
  const players = [p('a'), p('b'), p('c')]
  assert.equal(getNeighbor('a', players, 1)?.player_id, 'b')
  assert.equal(getNeighbor('a', players, -1)?.player_id, 'c')
  assert.equal(getNeighbor('a', players)?.player_id, 'b')
  assert.equal(getNeighbor('a', [p('a'), p('b')]), null)
})

test('getNextAliveNeighbor skips dead players', () => {
  const players = [p('a'), p('b', 0), p('c')]
  assert.equal(getNextAliveNeighbor('a', players, 1)?.player_id, 'c')
  assert.equal(getNextAliveNeighbor('c', players, 1)?.player_id, 'a')
})

test('getNextAliveNeighbor returns null when no alive opponents', () => {
  const players = [p('a'), p('b', 0)]
  assert.equal(getNextAliveNeighbor('a', players, 1), null)
})
