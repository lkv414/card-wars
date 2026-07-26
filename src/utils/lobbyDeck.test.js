/**
 * lobbyDeck.test.js — Unit-тесты для работы с колодами лобби
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  expandSelectionToInstances,
  expandLandsToInstances,
  isLobbyDeckPlayable,
  shuffleDeck,
  dealStartingHand,
  STARTING_HAND_SIZE
} from './lobbyDeck.js'

test('expandSelectionToInstances creates correct number of instances', () => {
  const fullCards = [
    { id: 'card-1', quantity: 3, name: 'Card 1' },
  ]
  const result = expandSelectionToInstances(fullCards)
  assert.equal(result.length, 3)
})

test('expandSelectionToInstances removes quantity and metadata fields', () => {
  const fullCards = [
    { id: 'card-1', quantity: 1, name: 'Card 1', cost: 5, created_at: '2024-01-01', updated_at: '2024-01-02' },
  ]
  const result = expandSelectionToInstances(fullCards)
  const instance = result[0]
  
  assert.equal(instance.id, 'card-1')
  assert.equal(instance.name, 'Card 1')
  assert.equal(instance.cost, 5)
  assert.equal(instance.quantity, undefined)
  assert.equal(instance.created_at, undefined)
  assert.equal(instance.updated_at, undefined)
})

test('expandSelectionToInstances adds instanceId, tapped, and flipped fields', () => {
  const fullCards = [
    { id: 'card-1', quantity: 1 },
  ]
  const result = expandSelectionToInstances(fullCards)
  const instance = result[0]
  
  assert.ok(instance.instanceId)
  assert.equal(typeof instance.instanceId, 'string')
  assert.ok(instance.instanceId.includes('card-1'))
  assert.equal(instance.tapped, false)
  assert.equal(instance.flipped, false)
})

test('expandSelectionToInstances generates unique instanceIds', () => {
  const fullCards = [
    { id: 'card-1', quantity: 3 },
  ]
  const result = expandSelectionToInstances(fullCards)
  
  const instanceIds = result.map(i => i.instanceId)
  const uniqueIds = new Set(instanceIds)
  assert.equal(uniqueIds.size, 3)
})

test('expandSelectionToInstances handles zero quantity by using minimum of 1', () => {
  const fullCards = [
    { id: 'card-1', quantity: 0 },
  ]
  const result = expandSelectionToInstances(fullCards)
  assert.equal(result.length, 1)
})

test('expandSelectionToInstances returns empty array for empty input', () => {
  assert.deepEqual(expandSelectionToInstances([]), [])
})

test('expandSelectionToInstances returns empty array for null/undefined', () => {
  assert.deepEqual(expandSelectionToInstances(null), [])
  assert.deepEqual(expandSelectionToInstances(undefined), [])
})

test('expandLandsToInstances creates correct number of instances', () => {
  const fullLands = [
    { id: 'land-1', quantity: 2 },
  ]
  const result = expandLandsToInstances(fullLands)
  assert.equal(result.length, 2)
})

test('expandLandsToInstances removes quantity and metadata fields', () => {
  const fullLands = [
    { id: 'land-1', quantity: 1, name: 'Land 1', created_at: '2024-01-01' },
  ]
  const result = expandLandsToInstances(fullLands)
  const instance = result[0]
  
  assert.equal(instance.id, 'land-1')
  assert.equal(instance.name, 'Land 1')
  assert.equal(instance.quantity, undefined)
  assert.equal(instance.created_at, undefined)
})

test('expandLandsToInstances does not add instanceId, tapped, or flipped fields', () => {
  const fullLands = [
    { id: 'land-1', quantity: 1 },
  ]
  const result = expandLandsToInstances(fullLands)
  const instance = result[0]
  
  assert.equal(instance.instanceId, undefined)
  assert.equal(instance.tapped, undefined)
  assert.equal(instance.flipped, undefined)
})

test('expandLandsToInstances returns empty array for empty input', () => {
  assert.deepEqual(expandLandsToInstances([]), [])
})

test('isLobbyDeckPlayable returns true for valid deck', () => {
  const deck = { cards: [{ id: 'card-1' }], lands: [] }
  assert.equal(isLobbyDeckPlayable(deck), true)
})

test('isLobbyDeckPlayable returns false for null/undefined deck', () => {
  assert.equal(isLobbyDeckPlayable(null), false)
  assert.equal(isLobbyDeckPlayable(undefined), false)
})

test('isLobbyDeckPlayable returns false for deck without cards', () => {
  assert.equal(isLobbyDeckPlayable({}), false)
})

test('isLobbyDeckPlayable returns false for deck with empty cards array', () => {
  assert.equal(isLobbyDeckPlayable({ cards: [], lands: [] }), false)
})

test('isLobbyDeckPlayable returns true for deck with cards even if lands are missing', () => {
  const deck = { cards: [{ id: 'card-1' }] }
  assert.equal(isLobbyDeckPlayable(deck), true)
})

test('shuffleDeck returns copy of array', () => {
  const cards = [{ id: 'card-1' }, { id: 'card-2' }]
  const result = shuffleDeck(cards)
  assert.notEqual(result, cards)
})

test('shuffleDeck returns array of same length', () => {
  const cards = [{ id: 'card-1' }, { id: 'card-2' }, { id: 'card-3' }]
  const result = shuffleDeck(cards)
  assert.equal(result.length, 3)
})

test('shuffleDeck contains same elements', () => {
  const cards = [{ id: 'card-1' }, { id: 'card-2' }, { id: 'card-3' }]
  const result = shuffleDeck(cards)
  const originalIds = cards.map(c => c.id).sort()
  const resultIds = result.map(c => c.id).sort()
  assert.deepEqual(resultIds, originalIds)
})

test('shuffleDeck handles empty array', () => {
  assert.deepEqual(shuffleDeck([]), [])
})

test('shuffleDeck handles null/undefined', () => {
  assert.deepEqual(shuffleDeck(null), [])
  assert.deepEqual(shuffleDeck(undefined), [])
})

test('shuffleDeck does not modify original', () => {
  const cards = [{ id: 'card-1' }, { id: 'card-2' }]
  const original = [...cards]
  shuffleDeck(cards)
  assert.deepEqual(cards, original)
})

test('dealStartingHand returns correct structure', () => {
  const lobbyDeck = {
    cards: Array(10).fill().map((_, i) => ({ id: `card-${i}` })),
    lands: Array(4).fill().map((_, i) => ({ id: `land-${i}` })),
  }
  const result = dealStartingHand(lobbyDeck)
  
  assert.ok(result.hand !== undefined)
  assert.ok(result.deckRemaining !== undefined)
  assert.ok(result.deckPile !== undefined)
  assert.ok(result.lands !== undefined)
})

test('dealStartingHand returns correct hand size (default 5)', () => {
  const lobbyDeck = {
    cards: Array(10).fill().map((_, i) => ({ id: `card-${i}` })),
    lands: [],
  }
  const result = dealStartingHand(lobbyDeck)
  assert.equal(result.hand.length, STARTING_HAND_SIZE)
})

test('dealStartingHand uses custom hand size', () => {
  const lobbyDeck = {
    cards: Array(10).fill().map((_, i) => ({ id: `card-${i}` })),
    lands: [],
  }
  const result = dealStartingHand(lobbyDeck, 3)
  assert.equal(result.hand.length, 3)
})

test('dealStartingHand does not exceed deck size', () => {
  const lobbyDeck = {
    cards: Array(3).fill().map((_, i) => ({ id: `card-${i}` })),
    lands: [],
  }
  const result = dealStartingHand(lobbyDeck, 10)
  assert.equal(result.hand.length, 3)
})

test('dealStartingHand deckPile contains remaining cards', () => {
  const lobbyDeck = {
    cards: Array(10).fill().map((_, i) => ({ id: `card-${i}` })),
    lands: [],
  }
  const result = dealStartingHand(lobbyDeck)
  assert.equal(result.deckPile.length, 10 - STARTING_HAND_SIZE)
})

test('dealStartingHand deckRemaining is correct', () => {
  const lobbyDeck = {
    cards: Array(10).fill().map((_, i) => ({ id: `card-${i}` })),
    lands: [],
  }
  const result = dealStartingHand(lobbyDeck)
  assert.equal(result.deckRemaining, 10 - STARTING_HAND_SIZE)
})

test('dealStartingHand lands are returned as-is', () => {
  const lands = Array(4).fill().map((_, i) => ({ id: `land-${i}` }))
  const lobbyDeck = { cards: Array(10).fill().map((_, i) => ({ id: `card-${i}` })), lands }
  const result = dealStartingHand(lobbyDeck)
  assert.deepEqual(result.lands, lands)
})

test('dealStartingHand handles null/undefined lobbyDeck', () => {
  const result = dealStartingHand(null)
  assert.deepEqual(result.hand, [])
  assert.deepEqual(result.deckPile, [])
  assert.equal(result.deckRemaining, 0)
  assert.deepEqual(result.lands, [])
})

test('STARTING_HAND_SIZE has value of 5', () => {
  assert.equal(STARTING_HAND_SIZE, 5)
})
