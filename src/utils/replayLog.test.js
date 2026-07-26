import assert from 'node:assert/strict'
import test from 'node:test'

import { getReplayEntry, normalizeReplayLog } from './replayLog.js'

test('normalizeReplayLog keeps valid entries and assigns stable step numbers', () => {
  const log = [
    { timestamp: 1000, message: 'Первое действие' },
    null,
    { timestamp: 2000, message: 'Второе действие' },
  ]

  assert.deepEqual(normalizeReplayLog(log), [
    { timestamp: 1000, message: 'Первое действие', step: 1 },
    { timestamp: 2000, message: 'Второе действие', step: 2 },
  ])
})

test('normalizeReplayLog returns an empty list for invalid input', () => {
  assert.deepEqual(normalizeReplayLog(null), [])
  assert.deepEqual(normalizeReplayLog({}), [])
})

test('getReplayEntry clamps the requested step to the available range', () => {
  const entries = normalizeReplayLog([
    { timestamp: 1000, message: 'Первое' },
    { timestamp: 2000, message: 'Второе' },
  ])

  assert.equal(getReplayEntry(entries, -5)?.message, 'Первое')
  assert.equal(getReplayEntry(entries, 99)?.message, 'Второе')
  assert.equal(getReplayEntry([], 0), null)
})
