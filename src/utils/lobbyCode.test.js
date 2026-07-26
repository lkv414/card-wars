/**
 * lobbyCode.test.js — Unit-тесты для генерации кода лобби
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { generateLobbyCode } from './lobbyCode.js'

test('generateLobbyCode generates 6 character code', () => {
  const code = generateLobbyCode()
  assert.equal(code.length, 6)
})

test('generateLobbyCode generates uppercase code', () => {
  const code = generateLobbyCode()
  assert.equal(code, code.toUpperCase())
})

test('generateLobbyCode uses valid character set (no O, 0, I, 1)', () => {
  const VALID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const code = generateLobbyCode()
  
  for (const char of code) {
    assert.ok(VALID_CHARS.includes(char))
  }
})

test('generateLobbyCode generates different codes on each call (usually)', () => {
  const code1 = generateLobbyCode()
  const code2 = generateLobbyCode()
  // Note: There's a tiny chance they could be the same, but very unlikely
  assert.notEqual(code1, code2)
})

test('generateLobbyCode all generated codes use only valid characters', () => {
  const VALID_CHARS = new Set('ABCDEFGHJKLMNPQRSTUVWXYZ23456789')
  
  for (let i = 0; i < 100; i++) {
    const code = generateLobbyCode()
    for (const char of code) {
      assert.ok(VALID_CHARS.has(char))
    }
  }
})

test('generateLobbyCode all generated codes have correct length', () => {
  for (let i = 0; i < 100; i++) {
    const code = generateLobbyCode()
    assert.equal(code.length, 6)
  }
})
