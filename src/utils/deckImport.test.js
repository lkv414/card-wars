import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDeckImportMap } from './deckImport.js'

test('normalizeDeckImportMap lowercases ids and drops zero qty', () => {
  const result = normalizeDeckImportMap({
    'ABC-123': 2,
    'def-456': 0,
    '  GHI-789  ': 1,
  })
  assert.deepEqual(result, {
    'abc-123': 2,
    'ghi-789': 1,
  })
})

test('normalizeDeckImportMap handles empty input', () => {
  assert.deepEqual(normalizeDeckImportMap(null), {})
  assert.deepEqual(normalizeDeckImportMap({}), {})
})
