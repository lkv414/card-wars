/**
 * deckState.test.js — Unit-тесты для управления состоянием колоды
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDeckEntryId, applyDeckEntries } from './deckState.js'

test('normalizeDeckEntryId normalizes valid UUID', () => {
  assert.equal(
    normalizeDeckEntryId('550e8400-e29b-41d4-a716-446655440000'),
    '550e8400-e29b-41d4-a716-446655440000'
  )
})

test('normalizeDeckEntryId trims whitespace', () => {
  assert.equal(
    normalizeDeckEntryId(' 550e8400-e29b-41d4-a716-446655440000 '),
    '550e8400-e29b-41d4-a716-446655440000'
  )
})

test('normalizeDeckEntryId converts to lowercase', () => {
  assert.equal(
    normalizeDeckEntryId('550E8400-E29B-41D4-A716-446655440000'),
    '550e8400-e29b-41d4-a716-446655440000'
  )
})

test('normalizeDeckEntryId handles null/undefined/empty', () => {
  assert.equal(normalizeDeckEntryId(null), '')
  assert.equal(normalizeDeckEntryId(undefined), '')
  assert.equal(normalizeDeckEntryId(''), '')
})

test('applyDeckEntries returns empty object for empty inputs', () => {
  assert.deepEqual(applyDeckEntries({}, {}, { maxPerEntry: 3, maxTotal: 40 }), {})
})

test('applyDeckEntries adds new entries', () => {
  const existing = {}
  const incoming = { 'card-1': 1, 'card-2': 2 }
  const result = applyDeckEntries(existing, incoming, { maxPerEntry: 3, maxTotal: 40 })
  assert.deepEqual(result, { 'card-1': 1, 'card-2': 2 })
})

test('applyDeckEntries adds to existing entries', () => {
  const existing = { 'card-1': 1 }
  const incoming = { 'card-1': 2 }
  const result = applyDeckEntries(existing, incoming, { maxPerEntry: 3, maxTotal: 40 })
  assert.deepEqual(result, { 'card-1': 3 })
})

test('applyDeckEntries respects maxPerEntry limit', () => {
  const existing = { 'card-1': 2 }
  const incoming = { 'card-1': 2 }
  const result = applyDeckEntries(existing, incoming, { maxPerEntry: 3, maxTotal: 40 })
  assert.deepEqual(result, { 'card-1': 3 })
})

test('applyDeckEntries respects maxTotal limit', () => {
  const existing = { 'card-1': 38 }
  const incoming = { 'card-2': 5 }
  const result = applyDeckEntries(existing, incoming, { maxPerEntry: 3, maxTotal: 40 })
  assert.deepEqual(result, { 'card-1': 38, 'card-2': 2 })
})

test('applyDeckEntries normalizes entry IDs', () => {
  const existing = { 'CARD-1': 1 }
  const incoming = { 'card-1': 1 }
  const result = applyDeckEntries(existing, incoming, { maxPerEntry: 3, maxTotal: 40 })
  assert.deepEqual(result, { 'card-1': 2 })
})

test('applyDeckEntries ignores zero or negative quantities in existing', () => {
  const existing = { 'card-1': 0, 'card-2': -1, 'card-3': 1 }
  const incoming = { 'card-1': 1 }
  const result = applyDeckEntries(existing, incoming, { maxPerEntry: 3, maxTotal: 40 })
  assert.deepEqual(result, { 'card-3': 1, 'card-1': 1 })
})

test('applyDeckEntries ignores zero or negative quantities in incoming', () => {
  const existing = { 'card-1': 1 }
  const incoming = { 'card-1': 0, 'card-2': -1, 'card-3': 1 }
  const result = applyDeckEntries(existing, incoming, { maxPerEntry: 3, maxTotal: 40 })
  assert.deepEqual(result, { 'card-1': 1, 'card-3': 1 })
})

test('applyDeckEntries filters out empty normalized IDs', () => {
  const existing = { '': 1, '   ': 1 }
  const incoming = { 'card-1': 1 }
  const result = applyDeckEntries(existing, incoming, { maxPerEntry: 3, maxTotal: 40 })
  assert.deepEqual(result, { 'card-1': 1 })
})

test('applyDeckEntries uses custom limits', () => {
  const options = { maxPerEntry: 2, maxTotal: 10 }
  const existing = { 'card-1': 1 }
  const incoming = { 'card-1': 2, 'card-2': 10 }
  const result = applyDeckEntries(existing, incoming, options)
  assert.equal(result['card-1'], 2) // 1 existing + 1 added (maxPerEntry=2)
  assert.equal(result['card-2'], 2) // 0 existing + 2 added (maxPerEntry=2, maxTotal=10-2=8)
})

test('applyDeckEntries handles null/undefined inputs', () => {
  assert.deepEqual(applyDeckEntries(null, { 'card-1': 1 }, { maxPerEntry: 3, maxTotal: 40 }), { 'card-1': 1 })
  assert.deepEqual(applyDeckEntries({ 'card-1': 1 }, null, { maxPerEntry: 3, maxTotal: 40 }), { 'card-1': 1 })
  assert.deepEqual(applyDeckEntries(null, null, { maxPerEntry: 3, maxTotal: 40 }), {})
})
