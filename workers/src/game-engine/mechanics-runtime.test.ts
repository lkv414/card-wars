import { describe, expect, it } from 'vitest'
import { activateAbility, dispatchMechanicEvent, EXECUTABLE_ACTION_TYPES } from './mechanics-runtime'
import { playCard, discardFromHand } from './cards'
import type { Card, GameState, PlayerState, Zone } from './types'
import cardsJson from '../../../individual_cards/cards.json' with { type: 'json' }

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

describe('mechanics runtime — bundled catalog contract', () => {
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


describe("mechanics runtime — new structured actions", () => {
  it("freeze_landscape marks the zone frozen", () => {
    const source = card("source", "creature", { instanceId: "source-instance" })
    const p1 = player("p1", 1, [], [source])
    const catalog = {
      source: {
        id: "source",
        card_type: "creature",
        cost: 0,
        mechanics_status: "implemented",
        mechanics: [{ trigger: "manual", actions: [{ type: "freeze_landscape", target: "this_landscape" }], conditions: [] }],
      },
    }
    const result = activateAbility(state([p1], catalog), {
      actorId: "p1",
      zonePosition: 1,
      cardId: "source-instance",
      mechanicIndex: 0,
    })
    expect(result.error).toBeUndefined()
    expect(result.state.players[0].zones[0].frozen).toBe(true)
  })

  it("frozen zone blocks playing a creature", () => {
    const played = card("creature", "creature")
    const p1 = player("p1", 1, [played])
    p1.zones[0].frozen = true
    const result = playCard(state([p1]), { type: "play_card", cardIndex: 0, zonePosition: 1 })
    expect("error" in result).toBe(true)
  })

  it("discard_from_hand removes one frozen token", () => {
    const p1 = player("p1", 1, [card("c", "creature")])
    p1.zones[0].frozen = true
    const s = state([p1])
    const result = discardFromHand(s, { type: "discard_from_hand", cardIndex: 0 })
    expect("state" in result).toBe(true)
    if (!("state" in result)) return
    expect(result.state.players[0].zones[0].frozen).toBe(false)
  })

  it("flip_landscape toggles the flipped flag", () => {
    const source = card("source", "creature", { instanceId: "source-instance" })
    const p1 = player("p1", 1, [], [source])
    const catalog = {
      source: {
        id: "source",
        card_type: "creature",
        cost: 0,
        mechanics_status: "implemented",
        mechanics: [{ trigger: "manual", actions: [{ type: "flip_landscape", target: "this_landscape", face: "down" }], conditions: [] }],
      },
    }
    const result = activateAbility(state([p1], catalog), {
      actorId: "p1",
      zonePosition: 1,
      cardId: "source-instance",
      mechanicIndex: 0,
    })
    expect(result.error).toBeUndefined()
    expect(result.state.players[0].zones[0].flipped).toBe(true)
  })

  it("immunity sets the immune_to flag on the card", () => {
    const source = card("source", "creature", { instanceId: "source-instance" })
    const p1 = player("p1", 1, [], [source])
    const catalog = {
      source: {
        id: "source",
        card_type: "creature",
        cost: 0,
        mechanics_status: "implemented",
        mechanics: [{ trigger: "manual", actions: [{ type: "immunity", target: "none", to: "damage_from_spells" }], conditions: [] }],
      },
    }
    const result = activateAbility(state([p1], catalog), {
      actorId: "p1",
      zonePosition: 1,
      cardId: "source-instance",
      mechanicIndex: 0,
    })
    expect(result.error).toBeUndefined()
    expect(result.state.players[0].zones[0].cards[0].immune_to).toBe("damage_from_spells")
  })

  it("peek succeeds without changing deck", () => {
    const source = card("source", "creature", { instanceId: "source-instance" })
    const p1 = player("p1", 1, [], [source])
    p1.deck_pile = [card("a", "creature"), card("b", "creature")]
    const catalog = {
      source: {
        id: "source",
        card_type: "creature",
        cost: 0,
        mechanics_status: "implemented",
        mechanics: [{ trigger: "manual", actions: [{ type: "peek", target: "none", count: 2 }], conditions: [] }],
      },
    }
    const result = activateAbility(state([p1], catalog), {
      actorId: "p1",
      zonePosition: 1,
      cardId: "source-instance",
      mechanicIndex: 0,
    })
    expect(result.error).toBeUndefined()
    expect(result.applied).toBe(true)
  })

  it("condition template: discard pile size", () => {
    const source = card("source", "creature", { instanceId: "source-instance" })
    const target = card("target", "creature", { health: 4, instanceId: "target-instance" })
    const p1 = player("p1", 1, [], [source])
    const p2 = player("p2", 2, [], [target])
    p1.discard_pile = [card("d1", "creature"), card("d2", "creature"), card("d3", "creature"), card("d4", "creature"), card("d5", "creature")]
    const catalog = {
      source: {
        id: "source",
        card_type: "creature",
        cost: 0,
        mechanics_status: "implemented",
        mechanics: [{ trigger: "manual", actions: [{ type: "deal_damage", target: "chosen_opponent_creature", amount: 1 }], conditions: [{ type: "if", description: "в твоей стопке сброса 5 карт или более" }] }],
      },
    }
    const result = activateAbility(state([p1, p2], catalog), {
      actorId: "p1",
      zonePosition: 1,
      cardId: "source-instance",
      mechanicIndex: 0,
      targetCardIds: ["target-instance"],
    })
    expect(result.error).toBeUndefined()
    expect(result.state.players[1].zones[0].cards[0].health).toBe(3)
  })
})



describe("mechanics runtime — contract with catalog", () => {
  it("EXECUTABLE_ACTION_TYPES covers every action of every implemented card", () => {
    const cards = cardsJson as any[]
    const unsupported: string[] = []
    for (const card of cards) {
      if (card.mechanics_status !== "implemented") continue
      for (const mech of (card.mechanics ?? [])) {
        for (const action of (mech?.actions ?? [])) {
          if (action?.source_type) continue
          if (typeof action?.type !== "string") continue
          if (!EXECUTABLE_ACTION_TYPES.has(action.type)) unsupported.push(card.id + ":" + action.type)
        }
      }
    }
    expect(unsupported).toEqual([])
  })
})
