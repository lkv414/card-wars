/**
 * guestId.test.js — Unit-тесты для работы с guest ID
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { getGuestId, getGuestNickname, setGuestNickname } from './guestId.js'

test('getGuestId is a function', () => {
  assert.equal(typeof getGuestId, 'function')
})

test('getGuestNickname is a function', () => {
  assert.equal(typeof getGuestNickname, 'function')
})

test('setGuestNickname is a function', () => {
  assert.equal(typeof setGuestNickname, 'function')
})
