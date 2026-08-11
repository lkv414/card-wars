import assert from 'node:assert/strict'
import test from 'node:test'
import { getDeckTileBlockReason } from './deckTileLimits.js'

test('getDeckTileBlockReason blocks when deck is full of cards', () => {
  assert.equal(
    getDeckTileBlockReason({ isLandCard: false, quantity: 0, selectionTotal: 40 }),
    'Колода полна (40 карт)'
  )
})

test('getDeckTileBlockReason blocks max copies per card', () => {
  assert.equal(
    getDeckTileBlockReason({ isLandCard: false, quantity: 3, selectionTotal: 10 }),
    'Максимум 3 копии этой карты'
  )
})

test('getDeckTileBlockReason blocks when lands are full', () => {
  assert.equal(
    getDeckTileBlockReason({ isLandCard: true, quantity: 0, selectionTotal: 4 }),
    'В колоде уже 4 земли'
  )
})

test('getDeckTileBlockReason allows valid add', () => {
  assert.equal(
    getDeckTileBlockReason({ isLandCard: false, quantity: 1, selectionTotal: 10 }),
    null
  )
})
