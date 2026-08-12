import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCardAnomalies,
  buildAnomalyMap,
  filterAdminCards,
  DEFAULT_ADMIN_FILTERS,
} from './adminCardValidation.js'

const baseCreature = {
  id: 'a1',
  card_number: 1,
  name: 'Test',
  card_type: 'creature',
  cost: 2,
  attack: 3,
  health: 4,
  land_type: 'corn',
  description: 'Desc',
  image_url: 'https://example.com/a.png',
  has_flip: false,
}

test('getCardAnomalies flags creature without stats', () => {
  const issues = getCardAnomalies({ ...baseCreature, attack: null, health: null })
  assert.ok(issues.some((i) => i.code === 'creature_stats'))
})

test('getCardAnomalies flags duplicate card numbers', () => {
  const other = { ...baseCreature, id: 'a2', card_number: 1, name: 'Dup' }
  const issues = getCardAnomalies(baseCreature, [baseCreature, other])
  assert.ok(issues.some((i) => i.code === 'dup_number'))
})

test('filterAdminCards filters anomalies only', () => {
  const bad = { ...baseCreature, id: 'b1', card_number: 2, name: '', attack: null, health: null }
  const map = buildAnomalyMap([baseCreature, bad])
  const filtered = filterAdminCards(
    [baseCreature, bad],
    { ...DEFAULT_ADMIN_FILTERS, anomaliesOnly: true },
    map
  )
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].id, 'b1')
})
