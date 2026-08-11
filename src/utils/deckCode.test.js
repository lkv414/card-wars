import assert from 'node:assert/strict'
import test from 'node:test'
import { generateDeckCode, decodeDeckCode } from './deckCode.js'

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

test('generateDeckCode rejects invalid UUID', () => {
  assert.throws(() => generateDeckCode({ 'bad-id': 1 }, {}), /UUID/)
})

test('generateDeckCode rejects quantity out of range', () => {
  assert.throws(() => generateDeckCode({ [CARD_A]: 256 }, {}), /Количество/)
})

test('generateDeckCode ignores zero quantity entries', () => {
  assert.equal(generateDeckCode({ [CARD_A]: 0 }, {}), 'DK-000000')
})
