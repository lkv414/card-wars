/**
 * cardSort.test.js — Unit-тесты для утилит сортировки карт
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  sortCards,
  groupCardsByType,
  groupCardsByCost,
  matchesCostTier,
  filterCards,
  filterLands,
  DEFAULT_FILTERS,
  hasActiveFilters,
} from './cardSort.js'

const mockCards = [
  { card_number: 1, name: 'Card A', cost: 2, card_type: 'creature' },
  { card_number: 3, name: 'Card B', cost: 1, card_type: 'spell' },
  { card_number: 2, name: 'Card C', cost: 2, card_type: 'building' },
  { card_number: 4, name: 'Card D', cost: 3, card_type: 'creature' },
]

test('sortCards sorts by number by default', () => {
  const result = sortCards([...mockCards])
  assert.equal(result[0].card_number, 1)
  assert.equal(result[1].card_number, 2)
  assert.equal(result[2].card_number, 3)
  assert.equal(result[3].card_number, 4)
})

test('sortCards sorts by cost', () => {
  const result = sortCards([...mockCards], 'cost')
  assert.equal(result[0].cost, 1)
  assert.equal(result[1].cost, 2)
  assert.equal(result[2].cost, 2)
  assert.equal(result[3].cost, 3)
  assert.equal(result[1].card_number, 1)
  assert.equal(result[2].card_number, 2)
})

test('sortCards sorts by name (Russian locale)', () => {
  const cards = [
    { name: 'Б' },
    { name: 'А' },
    { name: 'В' },
  ]
  const result = sortCards([...cards], 'name')
  assert.equal(result[0].name, 'А')
  assert.equal(result[1].name, 'Б')
  assert.equal(result[2].name, 'В')
})

test('sortCards sorts by type using TYPE_ORDER', () => {
  const cards = [
    { card_type: 'spell' },
    { card_type: 'creature' },
    { card_type: 'building' },
    { card_type: 'unknown' },
  ]
  const result = sortCards([...cards], 'type')
  assert.equal(result[0].card_type, 'creature')
  assert.equal(result[1].card_type, 'building')
  assert.equal(result[2].card_type, 'spell')
  assert.equal(result[3].card_type, 'unknown')
})

test('sortCards returns empty array for empty input', () => {
  assert.deepEqual(sortCards([]), [])
})

test('sortCards does not mutate original array', () => {
  const original = [...mockCards]
  sortCards(original, 'cost')
  assert.deepEqual(original, mockCards)
})

test('groupCardsByType groups cards by type with correct labels', () => {
  const mockCards = [
    { card_type: 'creature', name: 'Creature 1' },
    { card_type: 'creature', name: 'Creature 2' },
    { card_type: 'building', name: 'Building 1' },
    { card_type: 'spell', name: 'Spell 1' },
    { card_type: 'other', name: 'Other 1' },
  ]
  const result = groupCardsByType(mockCards)
  assert.equal(result.length, 4)
  assert.equal(result[0].key, 'creature')
  assert.equal(result[0].label, 'Существа')
  assert.equal(result[0].items.length, 2)
  assert.equal(result[1].key, 'building')
  assert.equal(result[1].label, 'Строения')
  assert.equal(result[2].key, 'spell')
  assert.equal(result[2].label, 'Заклинания')
  assert.equal(result[3].key, 'other')
  assert.equal(result[3].label, 'Прочее')
})

test('groupCardsByType returns empty array for empty input', () => {
  assert.deepEqual(groupCardsByType([]), [])
})

test('groupCardsByType filters out empty groups', () => {
  const cards = [
    { card_type: 'creature', name: 'Creature 1' },
    { card_type: 'creature', name: 'Creature 2' },
  ]
  const result = groupCardsByType(cards)
  assert.equal(result.length, 1)
  assert.equal(result[0].key, 'creature')
})

test('groupCardsByCost groups cards by cost with correct labels', () => {
  const mockCards = [
    { cost: '0' },
    { cost: '1' },
    { cost: '2' },
    { cost: '5' },
    { cost: '6' },
    { cost: '10' },
  ]
  const result = groupCardsByCost(mockCards)
  assert.equal(result.length, 5) // 0, 1, 2, 5, 6+
  assert.equal(result[0].key, '0')
  assert.equal(result[0].label, 'Стоимость 0')
  assert.equal(result[1].key, '1')
  assert.equal(result[1].label, 'Стоимость 1')
  assert.equal(result[4].key, '6+')
  assert.equal(result[4].label, 'Стоимость 6+')
})

test('groupCardsByCost groups cost 6 and above into 6+', () => {
  const mockCards = [
    { cost: '0' },
    { cost: '1' },
    { cost: '2' },
    { cost: '5' },
    { cost: '6' },
    { cost: '10' },
  ]
  const result = groupCardsByCost(mockCards)
  const sixPlusGroup = result.find(g => g.key === '6+')
  assert.equal(sixPlusGroup.items.length, 2)
})

test('groupCardsByCost handles invalid cost values', () => {
  const cards = [
    { cost: 'invalid' },
    { cost: null },
    { cost: undefined },
  ]
  const result = groupCardsByCost(cards)
  assert.equal(result[0].key, '0')
  assert.equal(result[0].items.length, 3)
})

test('hasActiveFilters returns false for default filters', () => {
  assert.equal(hasActiveFilters(DEFAULT_FILTERS), false)
})

test('hasActiveFilters returns true when search is not empty', () => {
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, search: 'test' }), true)
})

test('hasActiveFilters returns true when cardTypes is not empty', () => {
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, cardTypes: ['creature'] }), true)
})

test('hasActiveFilters returns true when costTier is set', () => {
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, costTier: 2 }), true)
})

test('matchesCostTier filters exact and 3+ bucket', () => {
  assert.equal(matchesCostTier(0, 0), true)
  assert.equal(matchesCostTier(1, 0), false)
  assert.equal(matchesCostTier(2, 2), true)
  assert.equal(matchesCostTier(3, 3), true)
  assert.equal(matchesCostTier(6, 3), true)
  assert.equal(matchesCostTier(2, null), true)
})

test('hasActiveFilters returns false for empty filters object', () => {
  assert.equal(hasActiveFilters({}), false)
})

test('hasActiveFilters returns false for null/undefined', () => {
  assert.equal(hasActiveFilters(null), false)
  assert.equal(hasActiveFilters(undefined), false)
})

test('filterCards applies search, type, cost tier and sort', () => {
  const cards = [
    { card_number: 2, name: 'Alpha', description: '', card_type: 'creature', land_type: 'fire', cost: 1, has_flip: false },
    { card_number: 1, name: 'Beta spell', description: 'fire bolt', card_type: 'spell', land_type: 'fire', cost: 3, has_flip: true },
    { card_number: 3, name: 'Gamma', description: '', card_type: 'building', land_type: 'water', cost: 2, has_flip: false },
  ]

  const filtered = filterCards(cards, {
    ...DEFAULT_FILTERS,
    search: 'fire',
    cardTypes: ['spell'],
    costTier: 3,
    flipOnly: true,
    sort: 'name',
  })

  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].name, 'Beta spell')
})

test('filterLands filters by name', () => {
  const lands = [{ name: 'Огонь' }, { name: 'Вода' }]
  assert.equal(filterLands(lands, '').length, 2)
  assert.equal(filterLands(lands, 'ог').length, 1)
  assert.equal(filterLands(lands, 'ог')[0].name, 'Огонь')
})

test('DEFAULT_FILTERS has expected structure', () => {
  assert.deepEqual(DEFAULT_FILTERS, {
    search: '',
    cardTypes: [],
    landTypes: [],
    costTier: null,
    flipOnly: false,
    sort: 'number',
  })
})
