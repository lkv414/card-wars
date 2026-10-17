import assert from 'node:assert/strict'
import test from 'node:test'
import { generateDeckCode, decodeDeckCode, expandDeckCodeWithCardData } from './deckCode.js'
import { CARDS, LANDS } from '../data/catalog.js'

const CARD_A = '550e8400-e29b-41d4-a716-446655440001'
const CARD_B = '550e8400-e29b-41d4-a716-446655440002'
const LAND_A = '660e8400-e29b-41d4-a716-446655440001'

test('generateDeckCode returns DK-000000 for empty deck', () => {
  assert.equal(generateDeckCode({}, {}), 'DK-000000')
})

test('generateDeckCode round-trips cards and lands', () => {
  const selectedCards = { [CARD_A]: 2, [CARD_B]: 1 }
  const selectedLands = { [LAND_A]: 1 }
  const code = generateDeckCode(selectedCards, selectedLands)
  assert.ok(code.startsWith('DK-'))
  assert.notEqual(code, 'DK-000000')

  const decoded = decodeDeckCode(code)
  assert.deepEqual(decoded.selectedCards, selectedCards)
  assert.deepEqual(decoded.selectedLands, selectedLands)
})

test('decodeDeckCode accepts code without DK- prefix', () => {
  const code = generateDeckCode({ [CARD_A]: 1 }, {})
  const payload = code.slice(3)
  const decoded = decodeDeckCode(payload)
  assert.equal(decoded.selectedCards[CARD_A], 1)
})

test('decodeDeckCode returns empty for DK-000000', () => {
  const decoded = decodeDeckCode('DK-000000')
  assert.deepEqual(decoded, { selectedCards: {}, selectedLands: {} })
})

test('decodeDeckCode returns null for invalid input', () => {
  assert.equal(decodeDeckCode(null), null)
  assert.equal(decodeDeckCode('not-a-code'), null)
})

test('generateDeckCode accepts slug ids from the local catalog', () => {
  const selectedCards = { 'card-костяная-палочка': 2 }
  const selectedLands = { corn: 1 }
  const code = generateDeckCode(selectedCards, selectedLands)
  const decoded = decodeDeckCode(code)
  assert.deepEqual(decoded.selectedCards, selectedCards)
  assert.deepEqual(decoded.selectedLands, selectedLands)
})

test('generateDeckCode rejects empty id', () => {
  assert.throws(() => generateDeckCode({ '  ': 1 }, {}), /непустой строкой/)
})

test('generateDeckCode rejects quantity out of range', () => {
  assert.throws(() => generateDeckCode({ [CARD_A]: 256 }, {}), /Количество/)
})

test('generateDeckCode ignores zero quantity entries', () => {
  assert.equal(generateDeckCode({ [CARD_A]: 0 }, {}), 'DK-000000')
})

test('expandDeckCodeWithCardData раскрывает карты и земли из локального каталога', () => {
  const card = CARDS[0]
  const land = LANDS[0]
  const code = generateDeckCode({ [card.id]: 2 }, { [land.id]: 1 })

  const expanded = expandDeckCodeWithCardData(code)

  assert.equal(expanded.cards.length, 1)
  assert.equal(expanded.cards[0].id, card.id)
  assert.equal(expanded.cards[0].quantity, 2)
  assert.ok(expanded.cards[0].name)
  assert.ok(expanded.cards[0].image_url)
  assert.equal(expanded.lands.length, 1)
  assert.equal(expanded.lands[0].land_type, land.id)
})

test('expandDeckCodeWithCardData не падает на неизвестном id', () => {
  const code = generateDeckCode({ 'нет-такой-карты': 1 }, {})
  const expanded = expandDeckCodeWithCardData(code)
  assert.deepEqual(expanded.cards, [{ id: 'нет-такой-карты', quantity: 1 }])
})
