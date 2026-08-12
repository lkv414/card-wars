import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canPlayCardToSlot,
  findPlayableZone,
  getCardSlotType,
  isSlotEmpty,
  SLOT_BUILDING,
  SLOT_CREATURE,
  splitZoneCards,
} from './zoneCards.js'

test('splitZoneCards keeps at most one card per slot', () => {
  const cards = [
    { id: '1', card_type: 'creature' },
    { id: '2', card_type: 'creature' },
    { id: '3', card_type: 'building' },
    { id: '4', card_type: 'building' },
  ]
  const { creatureCard, buildingCard, creatureCards, buildingCards } = splitZoneCards(cards)
  assert.equal(creatureCard.id, '1')
  assert.equal(buildingCard.id, '3')
  assert.equal(creatureCards.length, 1)
  assert.equal(buildingCards.length, 1)
})

test('splitZoneCards handles empty input', () => {
  assert.deepEqual(splitZoneCards(null), {
    creatureCard: null,
    buildingCard: null,
    creatureCards: [],
    buildingCards: [],
  })
})

test('getCardSlotType maps card types', () => {
  assert.equal(getCardSlotType({ card_type: 'building' }), SLOT_BUILDING)
  assert.equal(getCardSlotType({ card_type: 'creature' }), SLOT_CREATURE)
  assert.equal(getCardSlotType({ card_type: 'spell' }), SLOT_CREATURE)
})

test('isSlotEmpty and canPlayCardToSlot enforce one per slot', () => {
  const zone = [{ id: 'c1', card_type: 'creature' }]
  assert.equal(isSlotEmpty(zone, SLOT_CREATURE), false)
  assert.equal(isSlotEmpty(zone, SLOT_BUILDING), true)
  assert.equal(canPlayCardToSlot(zone, { card_type: 'creature' }), false)
  assert.equal(canPlayCardToSlot(zone, { card_type: 'building' }), true)
  assert.equal(canPlayCardToSlot(zone, { card_type: 'spell' }), false)
  assert.equal(canPlayCardToSlot([], { card_type: 'spell' }), true)
})

test('canPlayCardToSlot ignores zone land type', () => {
  assert.equal(canPlayCardToSlot([], { card_type: 'creature', land_type: 'corn' }, 'swamp'), true)
  assert.equal(canPlayCardToSlot([], { card_type: 'building', land_type: 'ice' }, 'corn'), true)
})

test('findPlayableZone picks first land with free matching slot', () => {
  const zones = [
    [{ id: 'c', card_type: 'creature' }],
    [],
    [{ id: 'b', card_type: 'building' }],
    [],
  ]
  assert.equal(findPlayableZone(zones, { card_type: 'building' }), 0)
  assert.equal(findPlayableZone(zones, { card_type: 'creature' }), 1)
})
