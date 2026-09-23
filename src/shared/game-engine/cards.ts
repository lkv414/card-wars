/**
 * Card-mutation actions: playCard, drawFree, drawPaid, shuffleDeck,
 * discardFromHand, discardFromZone, flipCard.
 *
 * Each function is pure: `(state, payload) -> state | EngineError`. No
 * random numbers are used here except `shuffleDeck`, which accepts an
 * optional rng injection so tests stay deterministic.
 */

import {
  bumpVersion,
  drawTopCard,
  getActivePlayer,
  getPlayer,
  getZone,
  pushDiscard,
  refillHand,
  removeFromDiscard,
  reshuffleIfNeeded,
  shuffleDeck,
} from './utils'
import type {
  Action,
  ApplyResult,
  Card,
  EngineError,
  GameState,
  PlayerState,
  Zone,
} from './types'

const STARTING_HAND_SIZE = 5
const ZONE_LIMIT = 10

function err(msg: string): EngineError {
  return { error: msg }
}

function withPlayer(state: GameState, playerId: string, fn: (p: PlayerState) => PlayerState): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.player_id === playerId ? fn(p) : p)),
  }
}

function updateZones(player: PlayerState, zonePosition: number, cards: Card[]): PlayerState {
  const zones = player.zones.map((z) => (z.zone_position === zonePosition ? { ...z, cards } : z))
  return { ...player, zones }
}

/** Cost lookup — falls back to card.cost if catalog missing the entry. */
function getCardCost(state: GameState, card: Card): number {
  const cat = state.catalog?.[card.id]
  if (cat?.cost !== undefined) return cat.cost
  if (typeof card.cost === 'number') return card.cost
  return 1
}

/** Card slot lookup — building or creature. */
function getCardSlot(state: GameState, card: Card): 'creature' | 'building' {
  const cat = state.catalog?.[card.id]
  return cat?.slot_type ?? card.slot_type ?? 'creature'
}

/**
 * play_card — move a card from the active player's hand to the chosen zone.
 * Refills hand to STARTING_HAND_SIZE.
 */
export function playCard(
  state: GameState,
  payload: Extract<Action, { type: 'play_card' }>,
): ApplyResult | EngineError {
  if (state.status !== 'active') return err('Игра не активна')
  const me = getActivePlayer(state)
  if (!me) return err('Сейчас не ваш ход')

  const { cardIndex, zonePosition, slotType } = payload

  if (cardIndex < 0 || cardIndex >= me.hand.length) return err('Неверный индекс карты')
  if (zonePosition < 1 || zonePosition > 4) return err('Неверная позиция зоны (1-4)')

  const card = me.hand[cardIndex]
  // Narrow `slot` from the union (`'creature' | 'building' | undefined`)
  // by picking the first matching value. Unknown strings fall back to
  // `undefined` so `Card.slot_type` stays strictly typed.
  const rawSlot = slotType ?? getCardSlot(state, card)
  const slot: 'creature' | 'building' = rawSlot === 'building' ? 'building' : 'creature'

  const cost = getCardCost(state, card)
  if ((me.actions_remaining ?? 0) < cost) {
    return err(`Недостаточно действий (нужно ${cost})`)
  }

  const zone = getZone(me, zonePosition)
  if (!zone) return err('Зона не найдена')
  if (zone.cards.length >= ZONE_LIMIT) return err('Земля полная')

  // Slot-specific guard — building cards can only go on the matching slot.
  if (slot === 'building') {
    const nonBuilding = zone.cards.find((c) => c.card_type !== 'building' && c.card_type !== 'spell')
    if (nonBuilding) return err('Слот строения занят существом')
  } else {
    const blocked = zone.cards.some((c) => c.slot_type === 'creature' || c.card_type === 'building')
    if (blocked) return err('Слот существа занят строением')
  }

  // Mutate: take card out of hand, push to zone, untap, refill hand.
  const newHand = [...me.hand.slice(0, cardIndex), ...me.hand.slice(cardIndex + 1)]
  const placedCard: Card = { ...card, tapped: false, flipped: false, zone_position: zonePosition, slot_type: slot }
  const newZoneCards = [...zone.cards, placedCard]

  const { hand: filledHand, deck: newDeck } = refillHand(newHand, me.deck_pile, STARTING_HAND_SIZE)

  const updated: PlayerState = {
    ...me,
    hand: filledHand,
    deck_pile: newDeck,
    deck_remaining: newDeck.length,
    actions_remaining: Math.max(0, (me.actions_remaining ?? 0) - cost),
  }
  const withZone = updateZones(updated, zonePosition, newZoneCards)
  const next = withPlayer(state, me.player_id, () => withZone)
  return { state: bumpVersion(next) }
}

/** draw_free_card — one free draw per turn, no AP cost. */
export function drawFree(state: GameState): ApplyResult | EngineError {
  if (state.status !== 'active') return err('Игра не активна')
  const me = getActivePlayer(state)
  if (!me) return err('Сейчас не ваш ход')
  if (me.free_draw_used) return err('Бесплатный добор уже использован в этом ходу')

  const { deck, discard } = reshuffleIfNeeded(me.deck_pile, me.discard_pile)
  if (deck.length === 0) return err('Колода и сброс пусты')

  const { drawn, newDeck } = drawTopCard(deck)
  const updated: PlayerState = {
    ...me,
    hand: [...me.hand, drawn],
    deck_pile: newDeck,
    deck_remaining: newDeck.length,
    discard_pile: discard,
    free_draw_used: true,
  }
  return { state: bumpVersion(withPlayer(state, me.player_id, () => updated)) }
}

/** draw_card_for_action — paid draw, costs 1 action point. */
export function drawPaid(state: GameState): ApplyResult | EngineError {
  if (state.status !== 'active') return err('Игра не активна')
  const me = getActivePlayer(state)
  if (!me) return err('Сейчас не ваш ход')
  if (me.paid_draw_used) return err('Платный добор уже использован в этом ходу')
  if ((me.actions_remaining ?? 0) < 1) return err('Нет доступных действий')

  const { deck, discard } = reshuffleIfNeeded(me.deck_pile, me.discard_pile)
  if (deck.length === 0) return err('Колода и сброс пусты')

  const { drawn, newDeck } = drawTopCard(deck)
  const updated: PlayerState = {
    ...me,
    hand: [...me.hand, drawn],
    deck_pile: newDeck,
    deck_remaining: newDeck.length,
    discard_pile: discard,
    actions_remaining: (me.actions_remaining ?? 0) - 1,
    paid_draw_used: true,
  }
  return { state: bumpVersion(withPlayer(state, me.player_id, () => updated)) }
}

/** shuffle_deck — RNG-driven reshuffle of deck + discard. */
export function shuffleDeckAction(
  state: GameState,
  rng: () => number = Math.random,
): ApplyResult | EngineError {
  if (state.status !== 'active') return err('Игра не активна')
  const me = getActivePlayer(state)
  if (!me) return err('Сейчас не ваш ход')

  const combined = shuffleDeck([...me.deck_pile, ...me.discard_pile], rng)
  const updated: PlayerState = {
    ...me,
    deck_pile: combined,
    discard_pile: [],
    deck_remaining: combined.length,
  }
  return { state: bumpVersion(withPlayer(state, me.player_id, () => updated)) }
}

/** discard_from_hand — drop a card from hand, add to discard. */
export function discardFromHand(
  state: GameState,
  payload: Extract<Action, { type: 'discard_from_hand' }>,
): ApplyResult | EngineError {
  if (state.status !== 'active') return err('Игра не активна')
  const me = getActivePlayer(state)
  if (!me) return err('Сейчас не ваш ход')

  const { cardIndex } = payload
  if (cardIndex < 0 || cardIndex >= me.hand.length) return err('Неверный индекс карты')

  const card = me.hand[cardIndex]
  const newHand = [...me.hand.slice(0, cardIndex), ...me.hand.slice(cardIndex + 1)]
  const updated: PlayerState = {
    ...me,
    hand: newHand,
    discard_pile: pushDiscard(me.discard_pile, card),
  }
  return { state: bumpVersion(withPlayer(state, me.player_id, () => updated)) }
}

/** discard_from_zone — remove a card from a zone, add to discard. */
export function discardFromZone(
  state: GameState,
  payload: Extract<Action, { type: 'discard_from_zone' }>,
): ApplyResult | EngineError {
  if (state.status !== 'active') return err('Игра не активна')
  const me = getActivePlayer(state)
  if (!me) return err('Сейчас не ваш ход')

  const { zonePosition, cardId } = payload
  const zone = getZone(me, zonePosition)
  if (!zone) return err('Зона не найдена')

  const idx = zone.cards.findIndex((c) => (c.instanceId ?? c.id) === cardId)
  if (idx === -1) return err('Карта не найдена в зоне')

  const card = zone.cards[idx]
  const newZoneCards = [...zone.cards.slice(0, idx), ...zone.cards.slice(idx + 1)]
  const updated: PlayerState = {
    ...me,
    zones: me.zones.map((z) => (z.zone_position === zonePosition ? { ...z, cards: newZoneCards } : z)),
    discard_pile: pushDiscard(me.discard_pile, card),
  }
  return { state: bumpVersion(withPlayer(state, me.player_id, () => updated)) }
}

/** flip_card — toggle face-up/face-down. Mirrors the SQL: flipped = !flipped. */
export function flipCard(
  state: GameState,
  payload: Extract<Action, { type: 'flip_card' }>,
): ApplyResult | EngineError {
  if (state.status !== 'active') return err('Игра не активна')
  const me = getActivePlayer(state)
  if (!me) return err('Сейчас не ваш ход')

  const { zonePosition, cardId } = payload
  const zone = getZone(me, zonePosition)
  if (!zone) return err('Зона не найдена')

  const newCards = zone.cards.map((c) => {
    if ((c.instanceId ?? c.id) !== cardId) return c
    const flipped = !c.flipped
    return { ...c, flipped, isFlipped: flipped }
  })
  const withZone: PlayerState = {
    ...me,
    zones: me.zones.map((z) => (z.zone_position === zonePosition ? { ...z, cards: newCards } : z)),
  }
  return { state: bumpVersion(withPlayer(state, me.player_id, () => withZone)) }
}

/** Engine-side helper used by the lobby's land setup. Not gated by active state. */
export function reorderLands(
  state: GameState,
  payload: Extract<Action, { type: 'reorder_lands' }>,
  actorId?: string,
): ApplyResult | EngineError {
  if (!state.current_player_id && state.status === 'finished') {
    return err('Игра уже завершена')
  }
  const me = (actorId ? getPlayer(state, actorId) : null) ?? getActivePlayer(state)
  if (!me) return err('Игрок не найден')

  // Find each zone that has a land_id matching the payload, then reorder.
  const landById = new Map<string, Zone>()
  for (const z of me.zones) {
    if (z.land_id) landById.set(z.land_id, z)
  }

  const nextZones = me.zones.slice()
  payload.landIds.forEach((landId, index) => {
    const z = landById.get(landId)
    if (!z) return
    const targetPos = index + 1
    const targetIdx = nextZones.findIndex((n) => n.zone_position === targetPos)
    if (targetIdx === -1) return
    nextZones[targetIdx] = { ...z, zone_position: targetPos }
  })

  return {
    state: bumpVersion(withPlayer(state, me.player_id, () => ({ ...me, zones: nextZones }))),
  }
}

/** confirm_land_setup — flips phase from setup to active. */
export function confirmLandSetup(
  state: GameState,
  payload: Extract<Action, { type: 'confirm_land_setup' }>,
): ApplyResult | EngineError {
  // Confirm during the `setup` phase only.
  if (state.status !== 'setup') return err('Подтверждение земель доступно только в фазе setup')

  // Build the new active phase: ensure every player has at least one zone
  // bound. If `bypass` is true and a player has zero lands, fall through.
  const playersReady = state.players.every((p) => payload.bypass || p.zones.some((z) => z.land_id))
  if (!playersReady) return err('Не у всех игроков выбраны земли')

  const firstPlayerId =
    typeof state.game_state?.firstPlayerId === 'string'
      ? state.game_state.firstPlayerId
      : state.players.find((p) => (p.health ?? 0) > 0)?.player_id ?? null
  if (!firstPlayerId) return err('Не удалось определить первого игрока')

  const next: GameState = bumpVersion({
    ...state,
    status: 'active',
    current_player_id: firstPlayerId,
    started_at: state.started_at ?? new Date().toISOString(),
    turn_started_at: new Date().toISOString(),
    game_state: { ...(state.game_state ?? {}), turnPhase: 'main' },
  })
  return { state: next }
}

// Helper used by combat module — keep here to avoid a cycle.
export function cardMatchesId(card: Card, id: string): boolean {
  return (card.instanceId ?? card.id) === id
}

// Helper used by combat module.
export function findCardInZone(zone: Zone, cardId: string): Card | null {
  return zone.cards.find((c) => cardMatchesId(c, cardId)) ?? null
}

// Helper used by combat module.
export function replaceCardInZone(zone: Zone, cardId: string, mutator: (c: Card) => Card): Zone {
  return {
    ...zone,
    cards: zone.cards.map((c) => ((c.instanceId ?? c.id) === cardId ? mutator(c) : c)),
  }
}