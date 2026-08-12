import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeZoneCards, normalizePlayerZones, normalizePlayerZoneRows } from './format.js'

test('normalizeZoneCards handles array and object shapes', () => {
  assert.deepEqual(normalizeZoneCards([{ id: 'a' }]), [{ id: 'a' }])
  assert.deepEqual(normalizeZoneCards({ cards: [{ id: 'b' }] }), [{ id: 'b' }])
  assert.deepEqual(normalizeZoneCards(null), [])
})

test('normalizePlayerZones normalizes four slots', () => {
  const zones = [[{ id: '1' }], { cards: [{ id: '2' }] }, [], []]
  const result = normalizePlayerZones(zones)
  assert.equal(result.length, 4)
  assert.equal(result[0][0].id, '1')
  assert.equal(result[1][0].id, '2')
  assert.deepEqual(result[2], [])
})

test('normalizePlayerZones handles object map', () => {
  const result = normalizePlayerZones({ 0: [{ id: 'x' }], 2: { cards: [{ id: 'y' }] } })
  assert.equal(result[0][0].id, 'x')
  assert.equal(result[2][0].id, 'y')
  assert.deepEqual(result[1], [])
})

test('normalizePlayerZoneRows preserves land metadata', () => {
  const rows = normalizePlayerZoneRows([
    { zone_position: 1, cards: [], land_id: 'a', land_type: 'corn', land_name: 'Corn' },
  ])
  assert.equal(rows[0].land_type, 'corn')
  assert.equal(rows[0].land_name, 'Corn')
})
