/**
 * deckValidation.test.js — Unit-тесты для валидации колоды
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { validateDeck } from './deckValidation.js'

test('validateDeck validates valid deck with cards and lands', () => {
  const cards = Array(40).fill().map((_, i) => ({ id: `card-${i % 10}`, name: `Card ${i}`, quantity: 1 }))
  const lands = Array(4).fill().map((_, i) => ({ id: `land-${i}`, name: `Land ${i}`, quantity: 1 }))
  const result = validateDeck(cards, lands)
  assert.equal(result.isValid, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.cardTotal, 40)
  assert.equal(result.landTotal, 4)
})

test('validateDeck validates empty deck', () => {
  const result = validateDeck([], [])
  assert.equal(result.isValid, true)
  assert.equal(result.cardTotal, 0)
  assert.equal(result.landTotal, 0)
})

test('validateDeck returns error for cards > 40', () => {
  const cards = Array(41).fill().map((_, i) => ({ id: `card-${i}`, quantity: 1 }))
  const result = validateDeck(cards, [])
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some(e => e.includes('В колоде больше 40 карт')))
})

test('validateDeck returns error for card appearing > 3 times', () => {
  // Pass as object format where we can set quantity > 3
  const cards = { 'card-1': 4 }
  const result = validateDeck(cards, [])
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some(e => e.includes('card-1')))
  assert.ok(result.errors.some(e => e.includes('более 3 раз')))
})

test('validateDeck accepts card appearing exactly 3 times', () => {
  const cards = Array(3).fill({ id: 'card-1' })
  const result = validateDeck(cards, [])
  assert.equal(result.isValid, true)
})

test('validateDeck returns error for lands > 4', () => {
  // 5 different lands, each with quantity 1 = total 5 > 4
  const lands = { 'land-1': 1, 'land-2': 1, 'land-3': 1, 'land-4': 1, 'land-5': 1 }
  const result = validateDeck([], lands)
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some(e => e.includes('В колоде больше 4 земель')))
})

test('validateDeck returns error for land appearing > 4 times', () => {
  // Single land with quantity 5
  const lands = { 'land-1': 5 }
  const result = validateDeck([], lands)
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some(e => e.includes('land-1')))
  assert.ok(result.errors.some(e => e.includes('более 4 раз')))
})

test('validateDeck accepts land appearing exactly 4 times', () => {
  const lands = Array(4).fill({ id: 'land-1' })
  const result = validateDeck([], lands)
  assert.equal(result.isValid, true)
})

test('validateDeck handles object format for cards', () => {
  const cards = {
    'card-1': 3,
    'card-2': 2,
  }
  const result = validateDeck(cards, {})
  assert.equal(result.isValid, true)
  assert.equal(result.cardTotal, 5)
})

test('validateDeck handles object format for lands', () => {
  const lands = {
    'land-1': 2,
    'land-2': 2,
  }
  const result = validateDeck({}, lands)
  assert.equal(result.isValid, true)
  assert.equal(result.landTotal, 4)
})

test('validateDeck handles null/undefined inputs', () => {
  const result1 = validateDeck(null, null)
  assert.equal(result1.isValid, true)
  assert.equal(result1.cardTotal, 0)
  assert.equal(result1.landTotal, 0)
  
  const result2 = validateDeck(undefined, undefined)
  assert.equal(result2.isValid, true)
})

test('validateDeck counts quantities correctly', () => {
  const cards = [
    { id: 'card-1', quantity: 2 },
    { id: 'card-2', quantity: 3 },
  ]
  const result = validateDeck(cards, [])
  assert.equal(result.cardTotal, 5)
})

test('validateDeck returns warnings array', () => {
  const result = validateDeck([], [])
  assert.ok(Array.isArray(result.warnings))
})
