import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCardType,
  getCardHealth,
  getCardAttack,
  isCreatureCard,
  isBuildingCard,
} from './cardFields.ts'

test('getCardType prefers card_type over type', () => {
  assert.equal(getCardType({ card_type: 'creature', type: 'spell' }), 'creature')
  assert.equal(getCardType({ type: 'building' }), 'building')
})

test('getCardHealth reads health then defense', () => {
  assert.equal(getCardHealth({ health: 4 }), 4)
  assert.equal(getCardHealth({ defense: 3 }), 3)
  assert.equal(getCardHealth({ health: 2, defense: 9 }), 2)
  assert.equal(getCardHealth({}), null)
})

test('getCardAttack parses numeric attack', () => {
  assert.equal(getCardAttack({ attack: 5 }), 5)
  assert.equal(getCardAttack({ attack: '3' }), 3)
  assert.equal(getCardAttack({}), null)
})

test('isCreatureCard / isBuildingCard', () => {
  assert.equal(isCreatureCard({ card_type: 'creature' }), true)
  assert.equal(isBuildingCard({ type: 'building' }), true)
  assert.equal(isCreatureCard({ card_type: 'spell' }), false)
})
