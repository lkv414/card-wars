/**
 * uuidMatch.test.js — Unit-тесты для сравнения UUID
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { hexNoDash, findClosestUuid } from './uuidMatch.js'

test('hexNoDash removes dashes from UUID', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000'
  assert.equal(hexNoDash(uuid), '550e8400e29b41d4a716446655440000')
})

test('hexNoDash converts to lowercase', () => {
  const uuid = '550E8400-E29B-41D4-A716-446655440000'
  assert.equal(hexNoDash(uuid), '550e8400e29b41d4a716446655440000')
})

test('hexNoDash handles null/undefined', () => {
  assert.equal(hexNoDash(null), '')
  assert.equal(hexNoDash(undefined), '')
})

test('hexNoDash handles empty string', () => {
  assert.equal(hexNoDash(''), '')
})

test('hexNoDash handles non-UUID string', () => {
  assert.equal(hexNoDash('abc-def'), 'abcdef')
})

test('hexNoDash handles already dash-less UUID', () => {
  const uuid = '550e8400e29b41d4a716446655440000'
  assert.equal(hexNoDash(uuid), uuid)
})

test('findClosestUuid returns null and Infinity for empty candidates', () => {
  const result = findClosestUuid('550e8400-e29b-41d4-a716-446655440000', [])
  assert.equal(result.id, null)
  assert.equal(result.distance, Infinity)
})

test('findClosestUuid returns null and Infinity for null target', () => {
  const candidates = ['550e8400-e29b-41d4-a716-446655440000']
  const result = findClosestUuid(null, candidates)
  assert.equal(result.id, null)
  assert.equal(result.distance, Infinity)
})

test('findClosestUuid finds exact match', () => {
  const target = '550e8400-e29b-41d4-a716-446655440000'
  const candidates = [
    '550e8400-e29b-41d4-a716-446655440001',
    target,
    '550e8400-e29b-41d4-a716-446655440002',
  ]
  const result = findClosestUuid(target, candidates)
  assert.equal(result.id, target)
  assert.equal(result.distance, 0)
})

test('findClosestUuid handles case-insensitive comparison', () => {
  const target = '550E8400-E29B-41D4-A716-446655440000'
  const candidates = ['550e8400-e29b-41d4-a716-446655440000']
  const result = findClosestUuid(target, candidates)
  assert.equal(result.id, '550e8400-e29b-41d4-a716-446655440000')
  assert.equal(result.distance, 0)
})

test('findClosestUuid returns first candidate with minimum distance', () => {
  const target = '550e8400-e29b-41d4-a716-446655440000'
  const candidates = [
    '650e8400-e29b-41d4-a716-446655440000', // distance 1
    '550e8400-e29b-41d4-a716-446655440001', // distance 1
  ]
  const result = findClosestUuid(target, candidates)
  assert.equal(result.distance, 1)
  assert.equal(result.id, '650e8400-e29b-41d4-a716-446655440000')
})

test('findClosestUuid calculates correct hex distance', () => {
  const target = '550e8400-e29b-41d4-a716-446655440000'
  const candidate = '661f9511-f3ac-52e5-b827-557766551111'
  const result = findClosestUuid(target, [candidate])
  // All 32 hex chars are different = distance 32
  assert.equal(result.distance, 32)
})

test('findClosestUuid ignores candidates with different length', () => {
  const target = '550e8400-e29b-41d4-a716-446655440000'
  const candidates = [
    '550e8400-e29b-41d4-a716-44665544000', // 31 chars
    '550e8400-e29b-41d4-a716-4466554400000', // 33 chars
    '550e8400-e29b-41d4-a716-446655440000', // 32 chars - valid
  ]
  const result = findClosestUuid(target, candidates)
  assert.equal(result.id, '550e8400-e29b-41d4-a716-446655440000')
  assert.equal(result.distance, 0)
})
