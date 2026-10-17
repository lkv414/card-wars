/**
 * Vitest unit tests for the server-side bot and the catalog deck builder.
 *
 * The bot is deliberately testable as a pure function pair:
 *   - `buildCatalogDeck({ rng })` — deterministic deck from the bundled catalog;
 *   - `chooseBotAction(state, botId)` — one legal action, validated by the engine.
 *
 * The last test plays a whole bot turn through `applyAction` to prove the bot
 * always terminates (no infinite turn) and never proposes an illegal move.
 */
import { describe, it, expect } from 'vitest'
import { applyAction, isError } from './game-engine/engine.js'
import { seededRng } from './game-engine/utils.js'
import { getCardIndex } from './catalog.js'
import { buildCatalogDeck, fillSeatWithCatalogDeck, needsDeck, STARTING_HAND_SIZE, DECK_SIZE } from './deck.js'
import { chooseBotAction, findBotId } from './bot.js'
import type { Card, CardCatalogEntry, GameState, PlayerState, Zone } from './game-engine/types.js'

const BOT_ID = 'bot-test'

const CATALOG: Record<string, CardCatalogEntry> = {
  'corn-cheap': { id: 'corn-cheap', card_type: 'creature', cost: 1, land_type: 'corn' },
  'corn-pricey': { id: 'corn-pricey', card_type: 'creature', cost: 2, land_type: 'corn' },
  'any-dud': { id: 'any-dud', card_type: 'building', cost: 2, land_type: 'any' },
}

function makeCard(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    instanceId: `${id}-i`,
    card_type: 'creature',
    attack: 3,
    health: 3,
    cost: 1,
    tapped: false,
    ...overrides,
  }
}

function makeZones(land = 'corn'): Zone[] {
  return [1, 2, 3, 4].map((n) => ({ zone_position: n, cards: [] as Card[], land_type: land }))
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
    is_bot: overrides.is_bot,
  }
}

/** Bot (order 2) is the active player, human (order 1) sits opposite. */
function makeBotState(botOverrides: Partial<PlayerState> = {}): GameState {
  const human = makePlayer({ player_id: 'human', player_order: 1 })
  const bot = makePlayer({
    player_id: BOT_ID,
    player_order: 2,
    is_bot: true,
    ...botOverrides,
  })
  return {
    id: 'g-bot',
    status: 'active',
    current_turn: 2,
    current_player_id: BOT_ID,
    version: 1,
    game_state: {},
    players: [human, bot],
    catalog: CATALOG,
  }
}

describe('buildCatalogDeck', () => {
  it('builds a full deck from the bundled catalog', () => {
    const built = buildCatalogDeck(seededRng(42))
    expect(built.hand).toHaveLength(STARTING_HAND_SIZE)
    expect(built.deck).toHaveLength(DECK_SIZE - STARTING_HAND_SIZE)
  })

  it('gives every card a unique instance id', () => {
    const built = buildCatalogDeck(seededRng(7))
    const ids = [...built.hand, ...built.deck].map((card) => card.instanceId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only deals cards the chosen land accepts', () => {
    for (const seed of [1, 2, 3, 99]) {
      const built = buildCatalogDeck(seededRng(seed))
      for (const card of [...built.hand, ...built.deck]) {
        const land = card.land_type
        const compatible =
          card.is_rainbow === true ||
          typeof land !== 'string' ||
          land === 'any' ||
          land === built.landType
        expect(compatible).toBe(true)
      }
    }
  })
})

describe('fillSeatWithCatalogDeck', () => {
  it('fills an empty seat and binds the zones to the deck land', () => {
    const seat = makePlayer({ player_id: BOT_ID, is_bot: true, zones: [] })
    const filled = fillSeatWithCatalogDeck(seat, seededRng(11))
    expect(filled.hand).toHaveLength(STARTING_HAND_SIZE)
    expect(filled.deck_pile).toHaveLength(DECK_SIZE - STARTING_HAND_SIZE)
    expect(filled.deck_remaining).toBe(filled.deck_pile.length)
    expect(filled.zones).toHaveLength(4)
    for (const zone of filled.zones) {
      expect(zone.land_type).toBeTruthy()
      expect(zone.land_id).toBe(zone.land_type)
    }
  })

  it('detects seats that still need a deck', () => {
    expect(needsDeck(makePlayer({ player_id: 'x' }))).toBe(true)
    expect(
      needsDeck(makePlayer({ player_id: 'x', hand: [makeCard('a')], deck_pile: [] })),
    ).toBe(false)
  })

  it('produces a deck the engine accepts on the first lane (land rule)', () => {
    const catalog = Object.fromEntries(getCardIndex()) as Record<string, CardCatalogEntry>
    const filled = fillSeatWithCatalogDeck(
      makePlayer({ player_id: BOT_ID, is_bot: true, player_order: 2, zones: [] }),
      seededRng(5),
    )
    const human = makePlayer({ player_id: 'human', player_order: 1 })
    const state: GameState = {
      id: 'g-bot',
      status: 'active',
      current_turn: 2,
      current_player_id: BOT_ID,
      version: 1,
      game_state: {},
      players: [human, filled],
      catalog,
    }
    const result = applyAction(state, { type: 'play_card', cardIndex: 0, zonePosition: 1 }, BOT_ID)
    expect(isError(result)).toBe(false)
  })
})

describe('findBotId', () => {
  it('finds the bot seat', () => {
    expect(findBotId(makeBotState())).toBe(BOT_ID)
    expect(findBotId(makeBotState({ is_bot: false }))).toBeNull()
  })
})

describe('chooseBotAction', () => {
  it('returns null when it is not the bot turn', () => {
    const state = makeBotState()
    expect(chooseBotAction({ ...state, current_player_id: 'human' }, BOT_ID)).toBeNull()
  })

  it('returns null when the game is over', () => {
    const state = makeBotState()
    expect(chooseBotAction({ ...state, status: 'finished' }, BOT_ID)).toBeNull()
  })

  it('draws for free before anything else', () => {
    const state = makeBotState({
      hand: [makeCard('corn-cheap')],
      deck_pile: [makeCard('corn-pricey')],
    })
    expect(chooseBotAction(state, BOT_ID)).toEqual({ type: 'draw_free' })
  })

  it('plays its cheapest affordable card once the free draw is used', () => {
    const state = makeBotState({
      hand: [makeCard('corn-pricey'), makeCard('corn-cheap')],
      deck_pile: [],
      free_draw_used: true,
    })
    expect(chooseBotAction(state, BOT_ID)).toEqual({
      type: 'play_card',
      cardIndex: 1,
      zonePosition: 1,
    })
  })

  it('attacks with an untapped creature when no card can be played', () => {
    const zones = makeZones()
    zones[2]!.cards = [makeCard('corn-cheap', { attack: 4 })]
    const state = makeBotState({
      hand: [makeCard('corn-pricey', { cost: 2 })],
      deck_pile: [],
      free_draw_used: true,
      actions_remaining: 0,
      zones,
    })
    expect(chooseBotAction(state, BOT_ID)).toEqual({
      type: 'attack',
      fromZone: 3,
      attackerCardId: 'corn-cheap-i',
      toPlayerId: 'human',
      toZone: 3,
    })
  })

  it('ends the turn when nothing else is legal', () => {
    const state = makeBotState({
      hand: [],
      deck_pile: [],
      free_draw_used: true,
      paid_draw_used: true,
      actions_remaining: 0,
    })
    expect(chooseBotAction(state, BOT_ID)).toEqual({ type: 'end_turn' })
  })

  it('always finishes its turn when driven by the caller', () => {
    let state = makeBotState({
      hand: [makeCard('corn-cheap')],
      deck_pile: [makeCard('corn-cheap'), makeCard('corn-cheap')],
    })
    const played: string[] = []
    for (let step = 0; step < 20; step += 1) {
      if (state.current_player_id !== BOT_ID) break
      const action = chooseBotAction(state, BOT_ID)
      expect(action).not.toBeNull()
      played.push(action!.type)
      const result = applyAction(state, action!, BOT_ID)
      expect(isError(result)).toBe(false)
      if (isError(result)) return
      state = result.state
    }
    expect(state.current_player_id).toBe('human')
    expect(played.at(-1)).toBe('end_turn')
  })
})
