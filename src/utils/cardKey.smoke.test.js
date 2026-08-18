/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { makeCardKey } from './cardKey.js'

describe('makeCardKey', () => {
  it('returns instanceId-based key when instanceId is present', () => {
    const card = { id: 'card-1', instanceId: 'inst-1' }
    expect(makeCardKey(card)).toBe('card-inst-1')
  })

  it('falls back to id when instanceId is missing', () => {
    const card = { id: 'card-1' }
    expect(makeCardKey(card)).toBe('card-card-1')
  })

  it('returns stable key for the same instanceId', () => {
    const a = { id: 'card-1', instanceId: 'inst-1' }
    const b = { id: 'card-1', instanceId: 'inst-1' }
    expect(makeCardKey(a)).toBe(makeCardKey(b))
  })

  it('returns different keys for different instanceIds', () => {
    const a = { id: 'card-1', instanceId: 'inst-1' }
    const b = { id: 'card-1', instanceId: 'inst-2' }
    expect(makeCardKey(a)).not.toBe(makeCardKey(b))
  })

  it('returns slot+zone+index key when no id/instanceId', () => {
    const key = makeCardKey(null, { slot: 'creature', zoneIndex: 2, fallbackIndex: 0 })
    expect(key).toBe('empty-creature-2-0')
  })

  it('handles card with no id and no instanceId using fallback opts', () => {
    const key = makeCardKey({}, { slot: 'building', zoneIndex: 1, fallbackIndex: 5 })
    expect(key).toBe('card-building-1-5')
  })

  it('prefers instanceId over id (instanceId is more specific)', () => {
    const card = { id: 'generic-id', instanceId: 'specific-instance' }
    expect(makeCardKey(card)).toBe('card-specific-instance')
  })
})
