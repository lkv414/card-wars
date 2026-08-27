/**
 * Smoke tests for buildBroadcastState — verifies fog-of-war redaction:
 * the viewer sees their own hand/deck, but other players' hand/deck
 * are redacted to empty arrays while hand_count / deck_pile_count
 * stay correct.
 */
import { describe, it, expect } from 'vitest'
import { buildBroadcastState } from './state-broadcast.js'
import type { GameState, PlayerState } from './game-engine/types.js'

function makePlayer(over: Partial<PlayerState> & { player_id: string }): PlayerState {
  return {
    player_id: over.player_id,
    nickname: over.nickname ?? over.player_id,
    health: over.health ?? 25,
    player_order: over.player_order ?? 1,
    hand: over.hand ?? [],
    deck_pile: over.deck_pile ?? [],
    deck_remaining: over.deck_remaining ?? 0,
    discard_pile: over.discard_pile ?? [],
    actions_remaining: over.actions_remaining ?? 2,
    free_draw_used: false,
    paid_draw_used: false,
    zones: over.zones ?? [],
  }
}

const game: GameState = {
  id: 'g1',
  status: 'active',
  current_turn: 1,
  current_player_id: 'p1',
  version: 5,
  players: [
    makePlayer({
      player_id: 'p1',
      hand: [{ id: 'c1' } as any, { id: 'c2' } as any],
      deck_pile: [{ id: 'd1' } as any],
    }),
    makePlayer({
      player_id: 'p2',
      hand: [{ id: 'secret' } as any],
      deck_pile: [{ id: 'sp1' } as any, { id: 'sp2' } as any],
    }),
  ],
}

describe('buildBroadcastState', () => {
  it('reveals own hand and deck for the viewer', () => {
    const broadcast = buildBroadcastState(game, 'p1') as any
    const me = broadcast.players.find((p: any) => p.player_id === 'p1')
    expect(me.is_self).toBe(true)
    expect(me.hand).toHaveLength(2)
    expect(me.hand[0].id).toBe('c1')
    expect(me.deck_pile).toHaveLength(1)
    expect(me.hand_count).toBe(2)
    expect(me.deck_pile_count).toBe(1)
  })

  it('redacts other players hand and deck but keeps counts', () => {
    const broadcast = buildBroadcastState(game, 'p1') as any
    const opp = broadcast.players.find((p: any) => p.player_id === 'p2')
    expect(opp.is_self).toBe(false)
    expect(opp.hand).toEqual([])
    expect(opp.deck_pile).toEqual([])
    expect(opp.hand_count).toBe(1) // p2 actually has 1 hand card
    expect(opp.deck_pile_count).toBe(2) // p2 actually has 2 deck cards
  })

  it('preserves top-level game metadata', () => {
    const broadcast = buildBroadcastState(game, 'p1') as any
    expect(broadcast.id).toBe('g1')
    expect(broadcast.version).toBe(5)
    expect(broadcast.status).toBe('active')
    expect(broadcast.current_turn).toBe(1)
    expect(broadcast.current_player_id).toBe('p1')
  })
})