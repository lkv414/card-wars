import { describe, expect, it } from 'vitest'
import { activateAbility, dispatchMechanicEvent } from './mechanics-runtime'
import { playCard } from './cards'
import type { Card, GameState, PlayerState, Zone } from './types'

function zones(cards: Card[] = []): Zone[] {
  return [1, 2, 3, 4].map((n) => ({ zone_position: n, cards: n === 1 ? cards : [] }))
}

function player(id: string, order: number, hand: Card[] = [], board: Card[] = []): PlayerState {
  return {
    player_id: id,
    nickname: id,
    health: 25,
    player_order: order,
    hand,
    deck_pile: [],
    deck_remaining: 0,
    discard_pile: [],
    actions_remaining: 2,
    free_draw_used: false,
    paid_draw_used: false,
    zones: zones(board),
  }
}

function card(id: string, type: Card['card_type'], extra: Partial<Card> = {}): Card {
  return { id, instanceId: `${id}-instance`, card_type: type, attack: 0, health: 5, cost: 0, ...extra }
}

function state(players: PlayerState[], catalog: Record<string, any> = {}): GameState {
  return {
    id: 'g1',
    status: 'active',
    current_turn: 1,
    current_player_id: players[0]?.player_id ?? null,
    version: 1,
    players,
    catalog,
  }
}

describe('mechanics runtime — Supabase/KV catalog contract', () => {
  it('executes on_enters_play from catalog mechanics after play', () => {
    const played = card('spell', 'spell')
    const target = card('target', 'creature', { health: 5 })
    const p1 = player('p1', 1, [played])
    const p2 = player('p2', 2, [], [target])
    const catalog = {
      spell: {
        id: 'spell',
        card_type: 'spell',
        cost: 0,
        mechanics_status: 'implemented',
        mechanics: [{ trigger: 'on_enters_play', actions: [{ type: 'deal_damage', target: 'each_creature_opponent', amount: 2 }], conditions: [] }],
      },
    }
    const result = playCard(state([p1, p2], catalog), { type: 'play_card', cardIndex: 0, zonePosition: 1 })
    expect('state' in result).toBe(true)
    if (!('state' in result)) return
    const nextTarget = result.state.players[1].zones[0].cards[0]
    expect(nextTarget.health).toBe(3)
    expect(result.state.players[0].discard_pile.map((c) => c.id)).toContain('spell')
  })

  it('activates an executable manual action and charges its action cost', () => {
    const source = card('source', 'creature', { instanceId: 'source-instance' })
    const target = card('target', 'creature', { health: 4, instanceId: 'target-instance' })
    const p1 = player('p1', 1, [], [source])
    const p2 = player('p2', 2, [], [target])
    const catalog = {
      source: {
        id: 'source',
        card_type: 'creature',
        cost: 0,
        mechanics_status: 'implemented',
        mechanics: [{ trigger: 'manual', actions: [{ type: 'deal_damage', target: 'chosen_opponent_creature', amount: 1 }], conditions: [{ type: 'cost_actions', value: 1 }] }],
      },
    }
    const result = activateAbility(state([p1, p2], catalog), {
      actorId: 'p1',
      zonePosition: 1,
      cardId: 'source-instance',
      mechanicIndex: 0,
      targetCardIds: ['target-instance'],
    })
    expect(result.error).toBeUndefined()
    expect(result.state.players[0].actions_remaining).toBe(1)
    expect(result.state.players[1].zones[0].cards[0].health).toBe(3)
  })

  it('does not execute text-only abilities as fake effects', () => {
    const source = card('source', 'creature')
    const p1 = player('p1', 1, [], [source])
    const catalog = {
      source: {
        id: 'source',
        mechanics: [{ trigger: 'manual', actions: [{ type: 'imperative', effect: 'do something', source_type: 'unparsed_description' }], conditions: [] }],
      },
    }
    const result = activateAbility(state([p1], catalog), { actorId: 'p1', zonePosition: 1, cardId: 'source', mechanicIndex: 0 })
    expect(result.applied).toBe(false)
    expect(result.error).toContain('не реализована')
  })

  it('does not execute mechanics that have not passed review (unreviewed / text_only)', () => {
    const source = card('source', 'creature', { instanceId: 'source-instance' })
    const target = card('target', 'creature', { health: 4, instanceId: 'target-instance' })
    const p1 = player('p1', 1, [], [source])
    const p2 = player('p2', 2, [], [target])
    for (const status of ['unreviewed', 'text_only']) {
      const catalog = {
        source: {
          id: 'source',
          card_type: 'creature',
          cost: 0,
          mechanics_status: status,
          mechanics: [{ trigger: 'manual', actions: [{ type: 'deal_damage', target: 'chosen_opponent_creature', amount: 1 }], conditions: [{ type: 'cost_actions', value: 1 }] }],
        },
      }
      const result = activateAbility(state([p1, p2], catalog), {
        actorId: 'p1',
        zonePosition: 1,
        cardId: 'source-instance',
        mechanicIndex: 0,
        targetCardIds: ['target-instance'],
      })
      expect(result.applied).toBe(false)
      expect(result.state.players[1].zones[0].cards[0].health).toBe(4)
    }
  })

  it('keeps the event dispatcher pure and returns the same state for no matching trigger', () => {
    const p1 = player('p1', 1)
    const before = state([p1])
    const after = dispatchMechanicEvent(before, { type: 'start_of_turn', actorId: 'p1' })
    expect(after).toEqual(before)
  })
})
