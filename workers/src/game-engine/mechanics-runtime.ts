import type { Card, GameState, PlayerState, Zone } from './types'

type JsonObject = Record<string, unknown>

export type MechanicEventType =
  | 'on_enters_play'
  | 'start_of_turn'
  | 'start_of_next_turn'
  | 'end_of_turn'
  | 'on_flip'
  | 'on_creature_attacks'
  | 'on_damage_dealt'
  | 'on_damage_taken'
  | 'on_death'
  | 'on_discard'
  | 'on_draw'
  | 'on_line_change'

export interface MechanicEvent {
  type: MechanicEventType
  actorId: string
  cardId?: string
  targetCardIds?: string[]
  amount?: number
}

export interface AbilityRequest {
  actorId: string
  zonePosition: number
  cardId: string
  mechanicIndex: number
  targetCardIds?: string[]
}

export interface AbilityResult {
  state: GameState
  error?: string
  applied: boolean
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function array(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((v): v is JsonObject => Boolean(v) && typeof v === 'object' && !Array.isArray(v)) : []
}

function cardKey(card: Card): string {
  return String(card.instanceId ?? card.id)
}

function player(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((p) => p.player_id === playerId)
}

function blueprint(state: GameState, card: Card): JsonObject {
  const catalog = state.catalog?.[card.id]
  return { ...(catalog ?? {}), ...(card as JsonObject) }
}

function mechanicsFor(state: GameState, card: Card): JsonObject[] {
  const source = blueprint(state, card)
  // A catalog row must be explicitly approved by the runtime contract before
  // its mechanics can mutate a live game. Missing status is allowed only for
  // legacy/dev fixtures.
  if (source.mechanics_version !== undefined && Number(source.mechanics_version) !== 1) return []
  if (source.mechanics_status !== undefined && source.mechanics_status !== 'implemented') return []
  return array(source.mechanics)
}

function isGenericAction(action: JsonObject): boolean {
  return action.source_type !== undefined || ['manual', 'passive', 'imperative'].includes(String(action.type))
}

function isExecutableAction(action: JsonObject): boolean {
  return !isGenericAction(action) && typeof action.type === 'string'
}

function effectiveAttack(card: Card): number {
  return Number(card.attack ?? 0) + Number((card as JsonObject).attack_bonus ?? 0)
}

function effectiveHealth(card: Card): number {
  return Number(card.health ?? card.defense ?? 0) + Number((card as JsonObject).health_bonus ?? 0)
}

function allCards(state: GameState): Array<{ player: PlayerState; zone: Zone; card: Card }> {
  const out: Array<{ player: PlayerState; zone: Zone; card: Card }> = []
  for (const p of state.players) {
    for (const z of p.zones) for (const c of z.cards) out.push({ player: p, zone: z, card: c })
  }
  return out
}

function findCard(state: GameState, id: string): { player: PlayerState; zone: Zone; card: Card } | undefined {
  return allCards(state).find(({ card }) => cardKey(card) === id || card.id === id)
}

function findInPlayer(playerState: PlayerState, id: string): { zone: Zone; card: Card } | undefined {
  for (const zone of playerState.zones) {
    const card = zone.cards.find((c) => cardKey(c) === id || c.id === id)
    if (card) return { zone, card }
  }
  return undefined
}

function mutatePlayer(state: GameState, playerId: string, fn: (p: PlayerState) => PlayerState): GameState {
  return { ...state, players: state.players.map((p) => p.player_id === playerId ? fn(p) : p) }
}

function removeFromZone(playerState: PlayerState, zonePosition: number, cardId: string): { player: PlayerState; card: Card | undefined } {
  let removed: Card | undefined
  const zones = playerState.zones.map((z) => {
    if (z.zone_position !== zonePosition) return z
    const idx = z.cards.findIndex((c) => cardKey(c) === cardId || c.id === cardId)
    if (idx < 0) return z
    removed = z.cards[idx]
    return { ...z, cards: [...z.cards.slice(0, idx), ...z.cards.slice(idx + 1)] }
  })
  return { player: { ...playerState, zones }, card: removed }
}

function addToDiscard(playerState: PlayerState, card: Card | undefined): PlayerState {
  return card ? { ...playerState, discard_pile: [...(playerState.discard_pile ?? []), card] } : playerState
}

function addCardToZone(playerState: PlayerState, card: Card, zonePosition?: number): PlayerState {
  const zones = playerState.zones.map((z) => zonePosition === z.zone_position ? { ...z, cards: [...z.cards, card] } : z)
  if (zonePosition !== undefined) return { ...playerState, zones }
  const firstCreature = zones.find((z) => !z.cards.some((c) => c.card_type !== 'building' && c.card_type !== 'spell'))
  if (!firstCreature) return playerState
  return { ...playerState, zones: zones.map((z) => z === firstCreature ? { ...z, cards: [...z.cards, card] } : z) }
}

function targetCards(state: GameState, owner: PlayerState, target: string, targetIds: string[] = [], sourceCardId?: string): Array<{ player: PlayerState; zone: Zone; card: Card }> {
  if (targetIds.length) return targetIds.map((id) => findCard(state, id)).filter((v): v is { player: PlayerState; zone: Zone; card: Card } => Boolean(v))
  const source = allCards(state)
  switch (target) {
    case 'this_creature': {
      const found = findInPlayer(owner, targetIds[0] ?? sourceCardId ?? '')
      return found ? [{ player: owner, zone: found.zone, card: found.card }] : []
    }
    case 'chosen_creature':
    case 'chosen_opponent_creature':
    case 'chosen_opponent':
      return []
    case 'each_creature_yours': return source.filter(({ player: p, card }) => p.player_id === owner.player_id && card.card_type !== 'building' && card.card_type !== 'spell')
    case 'each_creature_opponent': return source.filter(({ player: p, card }) => p.player_id !== owner.player_id && card.card_type !== 'building' && card.card_type !== 'spell')
    case 'each_creature': return source.filter(({ card }) => card.card_type !== 'building' && card.card_type !== 'spell')
    case 'each_creature_adjacent': {
      const ownerCard = findInPlayer(owner, targetIds[0] ?? '')
      if (!ownerCard) return []
      return source.filter(({ card }) => card.zone_position === undefined ? false : Math.abs(Number(card.zone_position) - Number((ownerCard.card as JsonObject).zone_position ?? 0)) === 1)
    }
    case 'each_creature_in_lane': return source.filter(({ card }) => card.card_type !== 'building' && card.card_type !== 'spell')
    case 'each_creature_landscape': return source.filter(({ card }) => card.card_type !== 'building' && card.card_type !== 'spell')
    case 'each_creature_no_hand': return source.filter(({ player: p, card }) => p.player_id !== owner.player_id && card.card_type !== 'building' && card.card_type !== 'spell' && p.hand.length === 0)
    default: return []
  }
}

function conditionAllows(conditions: unknown): boolean {
  if (!Array.isArray(conditions)) return true
  return conditions.every((c) => {
    const condition = object(c)
    // cost_actions is a payment requirement handled by activateAbility, not a
    // state predicate. verb is an action label, not a condition.
    return condition.type === 'cost_actions' || condition.type === 'verb'
  })
}

function findTrigger(mechanic: JsonObject, eventType: MechanicEventType): boolean {
  return mechanic.trigger === eventType
}

function actionAmount(action: JsonObject): number {
  const value = action.amount ?? action.count
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function applyAction(state: GameState, owner: PlayerState, action: JsonObject, targetIds: string[] = [], sourceCardId?: string): GameState {
  const type = String(action.type)
  if (!isExecutableAction(action)) return state
  const target = String(action.target ?? 'none')
  const selected = targetCards(state, owner, target, targetIds, sourceCardId)
  let next = state

  switch (type) {
    case 'deal_damage': {
      const amount = actionAmount(action)
      if (selected.length) {
        for (const item of selected) {
          const hp = effectiveHealth(item.card)
          const remaining = hp - amount
          if (remaining <= 0) {
            next = mutatePlayer(next, item.player.player_id, (p) => {
              const removed = removeFromZone(p, item.zone.zone_position, cardKey(item.card))
              return addToDiscard(removed.player, removed.card)
            })
          } else {
            next = mutatePlayer(next, item.player.player_id, (p) => ({ ...p, zones: p.zones.map((z) => z.zone_position === item.zone.zone_position ? { ...z, cards: z.cards.map((c) => cardKey(c) === cardKey(item.card) ? { ...c, health: remaining } : c) } : z) }))
          }
        }
      } else if (target.includes('opponent') || target === 'chosen_opponent' || target === 'each_opponent') {
        const opponent = next.players.find((p) => p.player_id !== owner.player_id && p.health > 0)
        if (opponent) next = mutatePlayer(next, opponent.player_id, (p) => ({ ...p, health: Math.max(0, p.health - amount) }))
      }
      return next
    }
    case 'aoe_damage':
    case 'face_attack': {
      const source = sourceCardId ? findCard(state, sourceCardId)?.card : undefined
      const amount = type === 'face_attack' ? (action.amount !== undefined ? actionAmount(action) : effectiveAttack(source ?? { attack: 1 } as Card)) : actionAmount(action)
      const opponents = next.players.filter((p) => p.player_id !== owner.player_id && p.health > 0)
      for (const opponent of opponents) next = mutatePlayer(next, opponent.player_id, (p) => ({ ...p, health: Math.max(0, p.health - amount) }))
      return next
    }
    case 'heal': {
      const amount = actionAmount(action)
      const cap = Number(action.cap ?? 25)
      if (selected.length) {
        for (const item of selected) {
          const max = Number((item.card as JsonObject).base_health ?? item.card.health ?? item.card.defense ?? cap)
          const healed = Math.min(cap, max, effectiveHealth(item.card) + amount)
          next = mutatePlayer(next, item.player.player_id, (p) => ({ ...p, zones: p.zones.map((z) => z.zone_position === item.zone.zone_position ? { ...z, cards: z.cards.map((c) => cardKey(c) === cardKey(item.card) ? { ...c, health: healed } : c) } : z) }))
        }
      } else if (target === 'self') {
        next = mutatePlayer(next, owner.player_id, (p) => ({ ...p, health: Math.min(cap, p.health + amount) }))
      }
      return next
    }
    case 'draw_cards': {
      const count = actionAmount(action)
      return mutatePlayer(next, owner.player_id, (p) => {
        let hand = [...p.hand]
        let deck = [...p.deck_pile]
        for (let i = 0; i < count && deck.length; i++) hand.push(deck.shift() as Card)
        return { ...p, hand, deck_pile: deck, deck_remaining: deck.length }
      })
    }
    case 'discard_cards': {
      const count = actionAmount(action)
      if (selected.length) {
        for (const item of selected.slice(0, count)) next = mutatePlayer(next, item.player.player_id, (p) => {
          const removed = removeFromZone(p, item.zone.zone_position, cardKey(item.card))
          return addToDiscard(removed.player, removed.card)
        })
      } else if (target === 'self' || target === 'none') {
        next = mutatePlayer(next, owner.player_id, (p) => {
          const hand = [...p.hand]
          const discarded: Card[] = []
          for (let i = 0; i < count && hand.length; i++) discarded.push(hand.shift() as Card)
          return { ...p, hand, discard_pile: [...p.discard_pile, ...discarded] }
        })
      }
      return next
    }
    case 'destroy': {
      for (const item of selected.slice(0, actionAmount(action))) next = mutatePlayer(next, item.player.player_id, (p) => {
        const removed = removeFromZone(p, item.zone.zone_position, cardKey(item.card))
        return addToDiscard(removed.player, removed.card)
      })
      return next
    }
    case 'move': {
      for (const item of selected) {
        next = mutatePlayer(next, item.player.player_id, (p) => {
          const removed = removeFromZone(p, item.zone.zone_position, cardKey(item.card))
          if (!removed.card) return p
          const destination = action.destination === 'opponent_lane' ? p.zones[p.zones.length - 1]?.zone_position : undefined
          return addCardToZone(removed.player, removed.card, destination)
        })
      }
      return next
    }
    case 'return_from_discard': {
      const selectedDiscard = targetIds.map((id) => {
        const found = owner.discard_pile.find((c) => cardKey(c) === id || c.id === id)
        return found
      }).filter((c): c is Card => Boolean(c))
      for (const card of selectedDiscard) next = mutatePlayer(next, owner.player_id, (p) => ({ ...p, discard_pile: p.discard_pile.filter((c) => cardKey(c) !== cardKey(card)), hand: action.destination === 'hand' ? [...p.hand, card] : p.hand, zones: action.destination === 'hand' ? p.zones : addCardToZone(p, card).zones }))
      return next
    }
    case 'stat_buff': {
      const amount = action.amount
      const stat = String(action.stat ?? 'attack')
      for (const item of selected) next = mutatePlayer(next, item.player.player_id, (p) => ({ ...p, zones: p.zones.map((z) => z.zone_position === item.zone.zone_position ? { ...z, cards: z.cards.map((c) => cardKey(c) === cardKey(item.card) ? { ...c, [`${stat}_bonus`]: Number((c as JsonObject)[`${stat}_bonus`] ?? 0) + (typeof amount === 'string' ? 0 : Number(amount ?? 1)), [`${stat}_buff_duration`]: action.duration ?? 'persistent' } as Card : c) } : z) }))
      return next
    }
    case 'gain_actions':
      return mutatePlayer(next, owner.player_id, (p) => ({ ...p, actions_remaining: p.actions_remaining + actionAmount(action) }))
    case 'cost_reduction':
      return mutatePlayer(next, owner.player_id, (p) => ({ ...p, cost_reduction: Number((p as unknown as JsonObject).cost_reduction ?? 0) + actionAmount(action) }))
    case 'play_for_free':
      return mutatePlayer(next, owner.player_id, (p) => ({ ...p, free_play_next: true }))
    default:
      return next
  }
}

function applyMechanic(state: GameState, owner: PlayerState, mechanic: JsonObject, targetIds: string[] = [], sourceCardId?: string): GameState {
  if (!conditionAllows(mechanic.conditions)) return state
  let next = state
  for (const action of array(mechanic.actions)) next = applyAction(next, owner, action, targetIds, sourceCardId)
  return next
}

export function resolveSpell(state: GameState, actorId: string, cardId: string, targetCardIds: string[] = []): GameState {
  const owner = player(state, actorId)
  const found = owner ? findCard(state, cardId) : undefined
  if (!owner || !found || found.player.player_id !== actorId) return state
  let next = state
  for (const mechanic of mechanicsFor(next, found.card)) {
    if (!['on_enters_play', 'manual'].includes(String(mechanic.trigger))) continue
    if (array(mechanic.conditions).some((c) => c.type === 'cost_actions')) continue
    next = applyMechanic(next, owner, mechanic, targetCardIds, cardKey(found.card))
  }
  return next
}

export function dispatchMechanicEvent(state: GameState, event: MechanicEvent): GameState {
  const owner = player(state, event.actorId)
  if (!owner) return state
  let next = state
  if (event.type === 'on_draw' && event.cardId) {
    const drawn = owner.hand.find((c) => cardKey(c) === event.cardId || c.id === event.cardId)
    if (drawn) {
      for (const mechanic of mechanicsFor(next, drawn)) {
        if (findTrigger(mechanic, event.type)) next = applyMechanic(next, owner, mechanic, event.targetCardIds, cardKey(drawn))
      }
    }
  }
  for (const item of allCards(state)) {
    if (event.cardId && cardKey(item.card) !== event.cardId && item.card.id !== event.cardId) continue
    for (const mechanic of mechanicsFor(next, item.card)) {
      if (!findTrigger(mechanic, event.type)) continue
      next = applyMechanic(next, item.player, mechanic, event.targetCardIds, cardKey(item.card))
    }
  }
  return next
}

export function activateAbility(state: GameState, request: AbilityRequest): AbilityResult {
  const owner = player(state, request.actorId)
  if (!owner) return { state, error: 'Игрок не найден', applied: false }
  const found = findInPlayer(owner, request.cardId)
  if (!found) return { state, error: 'Карта не найдена в зоне', applied: false }
  const mechanics = mechanicsFor(state, found.card)
  const mechanic = mechanics[request.mechanicIndex]
  if (!mechanic) return { state, error: 'Механика не найдена', applied: false }
  if (mechanic.trigger !== 'manual') return { state, error: 'Эта механика не активируется вручную', applied: false }
  const executable = array(mechanic.actions).some(isExecutableAction)
  if (!executable) return { state, error: 'Механика пока не реализована движком', applied: false }
  const conditionCost = array(mechanic.conditions).find((c) => c.type === 'cost_actions')
  const actionCost = array(mechanic.actions).find((a) => Number.isFinite(Number(a.cost_actions)))
  const cost = Number(conditionCost?.value ?? actionCost?.cost_actions ?? 0)
  if (owner.actions_remaining < cost) return { state, error: `Недостаточно действий (нужно ${cost})`, applied: false }
  let next = owner.actions_remaining === cost ? state : mutatePlayer(state, request.actorId, (p) => ({ ...p, actions_remaining: p.actions_remaining - cost }))
  next = applyMechanic(next, owner, mechanic, request.targetCardIds, cardKey(found.card))
  return { state: next, applied: true }
}

export function effectiveAttackForCombat(card: Card): number {
  return effectiveAttack(card)
}

export function cleanupTemporaryEffects(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      zones: p.zones.map((z) => ({
        ...z,
        cards: z.cards.map((c) => {
          const out = { ...c } as JsonObject
          for (const stat of ['attack', 'defense', 'health']) {
            if (out[`${stat}_buff_duration`] === 'this_turn') {
              delete out[`${stat}_bonus`]
              delete out[`${stat}_buff_duration`]
            }
          }
          return out as Card
        }),
      })),
    })),
  }
}

export function effectiveHealthForCombat(card: Card): number {
  return effectiveHealth(card)
}