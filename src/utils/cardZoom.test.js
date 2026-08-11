import assert from 'node:assert/strict'
import test from 'node:test'
import { clampOrigin } from './cardZoom.js'

test('clampOrigin keeps preferred value inside range', () => {
  assert.equal(clampOrigin(0.2, 0.8, 0.5), 0.5)
  assert.equal(clampOrigin(0.2, 0.8, 0.1), 0.2)
  assert.equal(clampOrigin(0.2, 0.8, 0.9), 0.8)
})

test('clampOrigin picks nearest edge when range is inverted', () => {
  assert.equal(clampOrigin(0.8, 0.2, 0.5), 0.2)
  assert.equal(clampOrigin(0.8, 0.2, 0.75), 0.8)
})
