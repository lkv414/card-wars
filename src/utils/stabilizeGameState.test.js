import { describe, it, expect } from 'vitest'
import { stabilizeGameState } from './stabilizeGameState.js'

describe('stabilizeGameState', () => {
  const base = {
    id: 'g1',
    version: 1,
    status: 'active',
    current_player_id: 'p1',
    players: [
      {
        player_id: 'p1',
        hand: [{ id: 'c1', instanceId: 'i1', name: 'A' }],
        zones: [{ zone_position: 1, cards: [{ id: 'z1', instanceId: 'z1' }], land_id: 'l1' }],
        deck_pile: [],
        discard_pile: [],
        actions_remaining: 2,
      },
    ],
  }

  it('returns prev when version is not newer', () => {
    const same = { ...base, version: 1 }
    expect(stabilizeGameState(base, same)).toBe(base)
  })

  it('preserves zone refs when only top-level turn fields change', () => {
    const next = {
      ...base,
      version: 2,
      current_player_id: 'p2',
      players: [
        {
          ...base.players[0],
          actions_remaining: 1,
          hand: [{ id: 'c1', instanceId: 'i1', name: 'A' }],
          zones: [{ zone_position: 1, cards: [{ id: 'z1', instanceId: 'z1' }], land_id: 'l1' }],
        },
      ],
    }

    const merged = stabilizeGameState(base, next)
    expect(merged.version).toBe(2)
    expect(merged.players[0].zones).toBe(base.players[0].zones)
    expect(merged.players[0].hand).toBe(base.players[0].hand)
  })

  it('uses new zone refs when cards change', () => {
    const next = {
      ...base,
      version: 2,
      players: [
        {
          ...base.players[0],
          zones: [{ zone_position: 1, cards: [{ id: 'z2', instanceId: 'z2' }], land_id: 'l1' }],
        },
      ],
    }

    const merged = stabilizeGameState(base, next)
    expect(merged.players[0].zones).not.toBe(base.players[0].zones)
    expect(merged.players[0].zones[0].cards[0].id).toBe('z2')
  })
})
