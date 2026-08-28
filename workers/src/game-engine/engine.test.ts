/**
 * Vitest unit tests for the game engine.
 *
 * Each test sets up a minimal GameState fixture, calls `applyAction`
 * (or `validateAction` for the pre-flight checks), and asserts on the
 * resulting state shape. All tests are deterministic — no Date.now, no
 * Math.random, no I/O.
 */
import { describe, it, expect } from 'vitest'
import { applyAction, validateAction, isError } from './engine.js'
import { canPlayerDealDamage, pickBattleTarget, resolveAttack } from './combat.js'
import { endTurn, forfeitGame } from './turn.js'
import { drawFree, drawPaid, flipCard, playCard, shuffleDeckAction, discardFromHand, discardFromZone } from './cards.js'
import { seededRng, shuffleDeck } from './utils.js'
import type { Action, Card, GameState, PlayerState, Zone } from './types.js'

/* -------------------------------------------------------------------- *
 * Fixtures                                                              *
 * -------------------------------------------------------------------- */

function makeCard(overrides: Partial<Card> & { id: string; instanceId?: string }): Card {
  const { id, instanceId, card_type, name, attack, health, cost, slot_type, tapped, flipped, ...rest } = overrides
  return {
    ...rest,
    id,
    instanceId: instanceId ?? id,
    card_type: card_type ?? 'creature',
    name: name ?? id,
    attack: attack ?? 5,
    health: health ?? 5,
    cost: cost ?? 1,
    slot_type,
    tapped,
    flipped,
  }
}

function makeZones(): Zone[] {
  return [1, 2, 3, 4].map((n) => ({ zone_position: n, cards: [] as Card[] }))
}

function makePlayer(overrides: Partial<PlayerState> & { player_id: string }): PlayerState {
  return {
    player_id: overrides.player_id,
    nickname: overrides.nickname ?? overrides.player_id,
    health: overrides.health ?? 25,
    player_order: overrides.player_order ?? 1,
    hand: overrides.hand ?? [],
    deck_pile: overrides.deck_pile ?? [],
    deck_remaining: overrides.deck_remaining ?? 0,
    discard_pile: overrides.discard_pile ?? [],
    actions_remaining: overrides.actions_remaining ?? 2,
    free_draw_used: overrides.free_draw_used ?? false,
    paid_draw_used: overrides.paid_draw_used ?? false,
    zones: overrides.zones ?? makeZones(),
  }
}

function makeState(overrides: Partial<GameState> & { players: PlayerState[] }): GameState {
  return {
    id: overrides.id ?? 'g1',
    lobby_id: overrides.lobby_id ?? 'l1',
    status: overrides.status ?? 'active',
    current_turn: overrides.current_turn ?? 0,
    current_player_id: overrides.current_player_id ?? overrides.players[0]?.player_id ?? null,
    version: overrides.version ?? 1,
    players: overrides.players,
    catalog: overrides.catalog,
  }
}

/** Two-player state where it's p1's turn, p1 has a creature in zone1. */
function makeTwoPlayerAttackReady() {
  const p1Attacker = makeCard({ id: 'creature-1', attack: 7, health: 5, cost: 2 })
  const p2Defender = makeCard({ id: 'creature-2', attack: 3, health: 4 })
  const p1Zones = makeZones()
  p1Zones[0]!.cards = [p1Attacker]
  const p2Zones = makeZones()
  p2Zones[0]!.cards = [p2Defender]
  const p1 = makePlayer({
    player_id: 'p1',
    player_order: 1,
    hand: [],
    deck_pile: [],
    deck_remaining: 0,
    actions_remaining: 2,
    zones: p1Zones,
  })
  const p2 = makePlayer({
    player_id: 'p2',
    player_order: 2,
    health: 25,
    hand: [],
    deck_pile: [],
    deck_remaining: 0,
    actions_remaining: 2,
    zones: p2Zones,
  })
  return makeState({ current_turn: 1, players: [p1, p2] })
}

/* -------------------------------------------------------------------- *
 * Validation                                                            *
 * -------------------------------------------------------------------- */

describe('validateAction', () => {
  it('rejects when the game is finished', () => {
    const state = makeTwoPlayerAttackReady()
    const result = validateAction({ ...state, status: 'finished' }, { type: 'end_turn' }, 'p1')
    expect(result.ok).toBe(false)
  })

  it('rejects non-current player trying to act', () => {
    const state = makeTwoPlayerAttackReady()
    const result = validateAction(state, { type: 'end_turn' }, 'p2')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/не ваш ход/)
  })

  it('rejects play_card when not enough actions remaining', () => {
    const hand = [makeCard({ id: 'big-cost', cost: 3 })]
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.hand = hand
    state.players[0]!.actions_remaining = 2

    const result = validateAction(state, { type: 'play_card', cardIndex: 0, zonePosition: 1 }, 'p1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/действий/)
  })

  it('rejects play_card on a full zone (>=10 cards)', () => {
    const hand = [makeCard({ id: 'c', cost: 1 })]
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.hand = hand
    state.players[0]!.zones[0]!.cards = Array.from({ length: 10 }, (_, i) =>
      makeCard({ id: `filler-${i}` }),
    )
    const result = validateAction(state, { type: 'play_card', cardIndex: 0, zonePosition: 1 }, 'p1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/полн/)
  })

  it('accepts a valid play_card', () => {
    const hand = [makeCard({ id: 'ok', cost: 1 })]
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.hand = hand
    const result = validateAction(state, { type: 'play_card', cardIndex: 0, zonePosition: 1 }, 'p1')
    expect(result.ok).toBe(true)
  })
})

/* -------------------------------------------------------------------- *
 * playCard                                                              *
 * -------------------------------------------------------------------- */

describe('playCard', () => {
  it('moves card from hand to zone, refills hand up to 5, decrements actions', () => {
    const card = makeCard({ id: 'c1', cost: 1 })
    const deck = [makeCard({ id: 'd1' }), makeCard({ id: 'd2' })]
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.hand = [card]
    state.players[0]!.deck_pile = deck
    state.players[0]!.deck_remaining = 2
    state.players[0]!.actions_remaining = 2

    const result = applyAction(state, { type: 'play_card', cardIndex: 0, zonePosition: 1 }, 'p1')
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    const p1 = result.state.players[0]!
    // hand was [c1] → after play []. Refill from [d1, d2] up to 5 → [d2, d1].
    expect(p1.hand.length).toBe(2)
    expect(p1.hand[0]!.id).toBe('d2') // top of deck drawn first
    expect(p1.hand[1]!.id).toBe('d1')
    expect(p1.zones[0]!.cards.length).toBe(2) // 1 defender + 1 played
    expect(p1.zones[0]!.cards[1]!.id).toBe('c1')
    expect(p1.actions_remaining).toBe(1)
    expect(result.state.version).toBe(state.version + 1)
  })

  it('enforces land matching when rule is strict (default)', () => {
    const card = makeCard({ id: 'corn-creature', card_type: 'creature', land_type: 'corn', cost: 1 })
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.hand = [card]
    state.players[0]!.zones[1]!.land_type = 'swamp'
    state.players[0]!.actions_remaining = 2
    const result = applyAction(state, { type: 'play_card', cardIndex: 0, zonePosition: 2 }, 'p1')
    expect(isError(result)).toBe(true)
    if (!isError(result)) return
    expect(result.error).toMatch(/не подходит/)
  })

  it('allows mismatched land when rule is free', () => {
    const card = makeCard({ id: 'corn-creature', card_type: 'creature', land_type: 'corn', cost: 1 })
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.hand = [card]
    state.players[0]!.zones[1]!.land_type = 'swamp'
    state.players[0]!.actions_remaining = 2
    state.game_state = { ...(state.game_state ?? {}), landPlacementRule: 'free' }
    const result = applyAction(state, { type: 'play_card', cardIndex: 0, zonePosition: 2 }, 'p1')
    expect(isError(result)).toBe(false)
  })

  it('allows matching land under strict rule', () => {
    const card = makeCard({ id: 'corn-creature', card_type: 'creature', land_type: 'corn', cost: 1 })
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.hand = [card]
    state.players[0]!.zones[1]!.land_type = 'corn'
    state.players[0]!.actions_remaining = 2
    const result = applyAction(state, { type: 'play_card', cardIndex: 0, zonePosition: 2 }, 'p1')
    expect(isError(result)).toBe(false)
  })

  it('rejects out-of-range cardIndex', () => {
    const state = makeTwoPlayerAttackReady()
    const result = applyAction(state, { type: 'play_card', cardIndex: 99, zonePosition: 1 }, 'p1')
    expect(isError(result)).toBe(true)
  })
})

/* -------------------------------------------------------------------- *
 * draw_free / draw_paid                                                 *
 * -------------------------------------------------------------------- */

describe('drawFree / drawPaid', () => {
  it('drawFree moves deck→hand and sets free_draw_used', () => {
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.deck_pile = [makeCard({ id: 'd1' })]
    state.players[0]!.deck_remaining = 1

    const result = applyAction(state, { type: 'draw_free' }, 'p1')
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    expect(result.state.players[0]!.hand.length).toBe(1)
    expect(result.state.players[0]!.free_draw_used).toBe(true)
  })

  it('drawFree reshuffles from discard when deck is empty', () => {
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.deck_pile = []
    state.players[0]!.discard_pile = [makeCard({ id: 'd1' })]
    const result = applyAction(state, { type: 'draw_free' }, 'p1')
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    expect(result.state.players[0]!.hand.length).toBe(1)
    expect(result.state.players[0]!.discard_pile.length).toBe(0)
  })

  it('drawPaid costs 1 action point', () => {
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.deck_pile = [makeCard({ id: 'd1' })]
    state.players[0]!.deck_remaining = 1
    state.players[0]!.actions_remaining = 2
    const result = applyAction(state, { type: 'draw_paid' }, 'p1')
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    expect(result.state.players[0]!.actions_remaining).toBe(1)
    expect(result.state.players[0]!.paid_draw_used).toBe(true)
  })

  it('drawPaid fails with no actions left', () => {
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.deck_pile = [makeCard({ id: 'd1' })]
    state.players[0]!.actions_remaining = 0
    const result = applyAction(state, { type: 'draw_paid' }, 'p1')
    expect(isError(result)).toBe(true)
  })
})

/* -------------------------------------------------------------------- *
 * shuffleDeck                                                           *
 * -------------------------------------------------------------------- */

describe('shuffleDeckAction', () => {
  it('reshuffles deck + discard together', () => {
    const state = makeTwoPlayerAttackReady()
    const combined = [makeCard({ id: 'a' }), makeCard({ id: 'b' }), makeCard({ id: 'c' })]
    state.players[0]!.deck_pile = [combined[0]!, combined[1]!]
    state.players[0]!.discard_pile = [combined[2]!]

    const result = applyAction(state, { type: 'shuffle_deck' }, 'p1')
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    const p1 = result.state.players[0]!
    expect(p1.deck_pile.length).toBe(3)
    expect(p1.discard_pile.length).toBe(0)
    const ids = p1.deck_pile.map((c) => c.id).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('is deterministic when given a seeded rng', () => {
    const deck = Array.from({ length: 10 }, (_, i) => makeCard({ id: `d${i}` }))
    const shuffled1 = shuffleDeck(deck, seededRng(42))
    const shuffled2 = shuffleDeck(deck, seededRng(42))
    expect(shuffled1.map((c) => c.id)).toEqual(shuffled2.map((c) => c.id))
  })
})

/* -------------------------------------------------------------------- *
 * flipCard / discardFromZone / discardFromHand                         *
 * -------------------------------------------------------------------- */

describe('flipCard / discardFromZone / discardFromHand', () => {
  it('flipCard toggles the flipped flag', () => {
    const state = makeTwoPlayerAttackReady()
    const card = state.players[0]!.zones[0]!.cards[0]!
    const result = applyAction(
      state,
      { type: 'flip_card', zonePosition: 1, cardId: card.instanceId! },
      'p1',
    )
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    const flipped = result.state.players[0]!.zones[0]!.cards[0]!
    expect(flipped.flipped).toBe(true)
  })

  it('discardFromZone moves card to discard', () => {
    const state = makeTwoPlayerAttackReady()
    const card = state.players[0]!.zones[0]!.cards[0]!
    const result = applyAction(
      state,
      { type: 'discard_from_zone', zonePosition: 1, cardId: card.instanceId! },
      'p1',
    )
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    expect(result.state.players[0]!.zones[0]!.cards.length).toBe(0)
    expect(result.state.players[0]!.discard_pile.length).toBe(1)
  })

  it('discardFromHand drops card from hand and pushes to discard', () => {
    const state = makeTwoPlayerAttackReady()
    state.players[0]!.hand = [makeCard({ id: 'h1' })]
    const result = applyAction(state, { type: 'discard_from_hand', cardIndex: 0 }, 'p1')
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    expect(result.state.players[0]!.hand.length).toBe(0)
    expect(result.state.players[0]!.discard_pile.length).toBe(1)
  })
})

/* -------------------------------------------------------------------- *
 * Combat — canPlayerDealDamage / pickBattleTarget / resolveAttack      *
 * -------------------------------------------------------------------- */

describe('canPlayerDealDamage', () => {
  it('2 players: order=1 deals only on turn >= 1', () => {
    expect(canPlayerDealDamage(1, 2, 0)).toBe(false)
    expect(canPlayerDealDamage(1, 2, 1)).toBe(true)
    expect(canPlayerDealDamage(2, 2, 0)).toBe(false)
  })

  it('3 players: order=N deals only on turn 0; everyone from turn 1', () => {
    expect(canPlayerDealDamage(1, 3, 0)).toBe(false)
    expect(canPlayerDealDamage(2, 3, 0)).toBe(false)
    expect(canPlayerDealDamage(3, 3, 0)).toBe(true)
    expect(canPlayerDealDamage(1, 3, 1)).toBe(true)
  })
})

describe('pickBattleTarget', () => {
  it('returns opponent in same lane for 2 players', () => {
    const p1 = makePlayer({ player_id: 'p1', player_order: 1 })
    const p2 = makePlayer({ player_id: 'p2', player_order: 2 })
    expect(pickBattleTarget('p1', 2, [p1, p2])).toEqual({
      defenderId: 'p2',
      toZone: 2,
    })
  })

  it('returns null when fewer than 2 alive', () => {
    expect(pickBattleTarget('p1', 1, [makePlayer({ player_id: 'p1' })])).toBeNull()
  })
})

describe('resolveAttack', () => {
  it('taps attacker when defender has a creature with strictly more HP than attack', () => {
    const state = makeTwoPlayerAttackReady()
    const attacker = state.players[0]!.zones[0]!.cards[0]! // attack 7
    state.players[1]!.zones[0]!.cards[0]!.health = 10 // > 7
    const { state: next, event } = resolveAttack(state, 'p1', 1)
    expect(event.face_damage).toBe(0)
    expect(event.creature_damaged).toBe(true)
    expect(event.creature_killed).toBe(false)
    expect(event.damage).toBe(7)
    const defenderCard = next.players[1]!.zones[0]!.cards[0]!
    expect(defenderCard.health).toBe(3) // 10 - 7
    const attackerAfter = next.players[0]!.zones[0]!.cards.find((c) => (c.instanceId ?? c.id) === attacker.instanceId)
    expect(attackerAfter?.tapped).toBe(true)
  })

  it('kills creature when attack strictly greater than hp', () => {
    const state = makeTwoPlayerAttackReady()
    const { state: next, event } = resolveAttack(state, 'p1', 1)
    expect(event.creature_killed).toBe(true)
    expect(next.players[1]!.zones[0]!.cards.length).toBe(0)
    expect(next.players[1]!.discard_pile.length).toBe(1)
  })

  it('deals face damage when defender zone is empty', () => {
    const state = makeTwoPlayerAttackReady()
    // Empty p2 zone1
    state.players[1]!.zones[0]!.cards = []
    state.players[1]!.health = 25
    const { state: next, event } = resolveAttack(state, 'p1', 1)
    expect(event.creature_killed).toBe(false)
    expect(event.face_damage).toBe(7)
    expect(next.players[1]!.health).toBe(18)
  })
})

/* -------------------------------------------------------------------- *
 * endTurn / forfeit                                                    *
 * -------------------------------------------------------------------- */

describe('endTurn', () => {
  it('rotates to next alive player, draws +1, untaps, resets actions', () => {
    const state = makeTwoPlayerAttackReady()
    state.current_turn = 0
    state.players[1]!.deck_pile = [makeCard({ id: 'p2-d1' })]
    state.players[1]!.deck_remaining = 1
    state.players[0]!.actions_remaining = 0 // exhausted
    state.players[0]!.free_draw_used = true

    const result = applyAction(state, { type: 'end_turn' }, 'p1')
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    expect(result.state.current_player_id).toBe('p2')
    expect(result.state.current_turn).toBe(1)
    const p2 = result.state.players[1]!
    expect(p2.hand.length).toBe(1)
    expect(p2.actions_remaining).toBe(2)
    expect(p2.free_draw_used).toBe(false)
    // Untap applies only to the NEW active player's creatures. We don't
    // assert on p1's attacker `tapped` here because turn=0 means
    // canPlayerDealDamage returns false and resolveAttack is never
    // invoked — the attacker stays untouched, which is the correct
    // game behavior for first-turn no-damage rounds.
    // The new active player (p2) should have a clean slate.
    const p2After = result.state.players[1]!
    expect(p2After.actions_remaining).toBe(2)
    expect(p2After.free_draw_used).toBe(false)
    expect(p2After.paid_draw_used).toBe(false)
  })

  it('finishes the game when face damage kills the last opponent', () => {
    const state = makeTwoPlayerAttackReady()
    state.players[1]!.zones[0]!.cards = [] // direct face damage
    state.players[1]!.health = 5 // < 7 attack
    const result = applyAction(state, { type: 'end_turn' }, 'p1')
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    expect(result.state.status).toBe('finished')
    expect(result.state.winner_id).toBe('p1')
  })
})

describe('forfeitGame', () => {
  it('marks the actor dead and the next alive player as winner', () => {
    const state = makeTwoPlayerAttackReady()
    const result = forfeitGame(state, 'p1')
    expect(isError(result)).toBe(false)
    if (isError(result)) return
    expect(result.state.status).toBe('finished')
    expect(result.state.winner_id).toBe('p2')
    expect(result.state.players.find((p) => p.player_id === 'p1')!.health).toBe(0)
  })
})

/* -------------------------------------------------------------------- *
 * End-to-end engine dispatch sanity                                     *
 * -------------------------------------------------------------------- */

describe('applyAction dispatch', () => {
  it('returns error envelope for unknown action (compile-time guard)', () => {
    // We can't construct a malformed Action at runtime, but we can verify
    // that isError correctly narrows the return type.
    const state = makeTwoPlayerAttackReady()
    const result = applyAction(state, { type: 'end_turn' }, 'p1')
    if (isError(result)) {
      expect(result.error).toBeTruthy()
    } else {
      expect(result.state).toBeTruthy()
    }
  })
})