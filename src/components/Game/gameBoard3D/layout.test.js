import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculatePlayerSlotPositions,
  calculateSharedLaneXs,
  calculateTwoPlayerBoard,
  columnSpacing,
  computeFieldCardScale,
  getLandSlotLayout,
  COLUMN_WIDTH,
  HALF_LANE_DEPTH,
  LANE_WIDTH,
  PLAY_FIELD_DEPTH,
  PLAY_FIELD_WIDTH,
  SLOT_GAP,
} from './layout.js'

function assertApprox(actual, expected, label = '') {
  assert.ok(Math.abs(actual - expected) < 1e-9, label || `expected ~${expected}, got ${actual}`)
}

test('land slots: creature/building centers are half-land midpoints', () => {
  const { creature, building } = getLandSlotLayout()
  assert.equal(creature.z, -HALF_LANE_DEPTH / 4)
  assert.equal(building.z, HALF_LANE_DEPTH / 4)
  assert.equal(creature.depth, HALF_LANE_DEPTH / 2)
  assert.equal(building.depth, HALF_LANE_DEPTH / 2)
  assert.equal(creature.width, LANE_WIDTH)
})

test('field card scale fits inside slot half', () => {
  const scale = computeFieldCardScale(0.88)
  assert.ok(scale > 0.5)
  assert.ok(scale < 2)
})

test('lands have zero gap between columns', () => {
  assert.equal(SLOT_GAP, 0)
  const gaps2 = columnSpacing(2)
  assert.equal(gaps2.length, 3)
  for (const g of gaps2) {
    assertApprox(g, LANE_WIDTH)
  }
})

test('shared lanes: 4 flush vertical columns', () => {
  const xs = calculateSharedLaneXs()
  assert.equal(xs.length, 4)
  assert.equal(PLAY_FIELD_WIDTH, 4 * LANE_WIDTH)
  assert.equal(PLAY_FIELD_DEPTH, 2 * HALF_LANE_DEPTH)

  for (let i = 1; i < xs.length; i++) {
    assertApprox(Math.abs(xs[i] - xs[i - 1]), LANE_WIDTH)
  }
})

test('2-player board: halves meet at z=0 in each lane', () => {
  const board = calculateTwoPlayerBoard(0)
  assert.equal(board.length, 4)

  for (const lane of board) {
    const nearZ = lane.near.center[2]
    const farZ = lane.far.center[2]
    assert.equal(lane.near.zoneIndex, lane.far.zoneIndex)
    assert.equal(lane.near.center[0], lane.far.center[0])
    assert.ok(Math.abs(nearZ + farZ) < 0.01, 'lane halves centered around z=0')
    assert.ok(Math.abs(nearZ - farZ - HALF_LANE_DEPTH) < 0.01, 'halves span full lane depth')
  }

  const boardP1 = calculateTwoPlayerBoard(1)
  assert.equal(boardP1[0].near.playerIndex, 1)
  assert.equal(boardP1[0].far.playerIndex, 0)
})

test('2-player legacy row: same lane index (not mirrored)', () => {
  const p0 = calculatePlayerSlotPositions(0, 2)
  const p1 = calculatePlayerSlotPositions(1, 2)
  assert.equal(p0.length, 4)
  assert.equal(p1.length, 4)

  for (let i = 0; i < 4; i++) {
    assert.equal(p0[i].center[0], p1[i].center[0], `lane ${i} shares X`)
    assert.ok(Math.abs(p0[i].center[2] + p1[i].center[2]) < 0.01, 'halves meet at center')
  }
})

test('3-player layout: each player has 4 columns', () => {
  for (let i = 0; i < 3; i++) {
    const cols = calculatePlayerSlotPositions(i, 3)
    assert.equal(cols.length, 4)
    const gaps = columnSpacing(3)
    for (const g of gaps) {
      assertApprox(g, COLUMN_WIDTH)
    }
  }
})

test('4-player layout: each player has 4 columns on inner arc', () => {
  for (let i = 0; i < 4; i++) {
    const cols = calculatePlayerSlotPositions(i, 4)
    assert.equal(cols.length, 4)
    const dist = Math.hypot(cols[1].center[0], cols[1].center[2])
    assert.ok(dist > 0.5, 'columns sit near table center')
  }
})
