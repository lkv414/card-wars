/**
 * Combat resolution — port of the legacy `resolve_lane_battle` plpgsql.
 *
 * Pure: no I/O, no Date.now, no console.log. The `endTurn` action calls
 * `resolveAttack` four times (once per lane) and accumulates the resulting
 * `BattleEvent`s.
 */

import type { BattleEvent, Card, GameState, PlayerState, Zone } from './types'
import { cardMatchesId, findCardInZone, replaceCardInZone } from './cards'
import { dispatchMechanicEvent, effectiveAttackForCombat, effectiveHealthForCombat } from './mechanics-runtime'

/**
 * Mirrors `can_player_deal_damage(attacker_order, alive_count, turn)`.
 *
 * Rules (copied from the SQL):
 *   - 2 players: first turn = no damage. After turn >= 1, attacker #1 deals.
 *   - 3 players: first turn = only the LAST (order = alive_count) deals.
 *     Subsequent turns = everyone deals.
 *   - 4 players: same as 3 but the "last" position is the second-to-last
 *     in the first turn, and the third-and-fourth deal from turn >= 1.
 */
export function canPlayerDealDamage(
  attackerOrder: number,
  aliveCount: number,
  turn: number,
): boolean {
  if (aliveCount <= 2) {
    return attackerOrder >= aliveCount || turn >= aliveCount - 1
  }
  // The canonical SQL rule starts the last player, then opens attacks to
  // everyone from the penultimate turn onward.
  return attackerOrder >= aliveCount || turn >= aliveCount - 1
}

/**
 * Pick the lane-target for an attacker in `fromZone` (1..4).
 *
 * Mirrors `get_battle_target`. With 2 alive players, the target is the
 * opponent in the same lane. With 3-4 players, the target is computed via
 * `attacker_idx ± 1` modulo alive count, and lane mapping is mirrored.
 */
export function pickBattleTarget(
  attackerId: string,
  fromZone: number,
  alivePlayers: PlayerState[],
): { defenderId: string; toZone: number } | null {
  if (fromZone < 1 || fromZone > 4) return null
  if (alivePlayers.length < 2) return null

  if (alivePlayers.length <= 2) {
    const opponent = alivePlayers.find((p) => p.player_id !== attackerId)
    if (!opponent) return null
    return { defenderId: opponent.player_id, toZone: fromZone }
  }

  const attackerIdx = alivePlayers.findIndex((p) => p.player_id === attackerId)
  if (attackerIdx === -1) return null

  // Direction: lane 1-2 → +1 (clockwise), lane 3-4 → -1 (counter-clockwise).
  const direction = fromZone <= 2 ? 1 : -1
  const targetIdx = (attackerIdx + direction + alivePlayers.length * 2) % alivePlayers.length
  const target = alivePlayers[targetIdx]
  if (!target) return null

  // Lane mapping: 1↔3, 2↔4.
  const toZone = fromZone <= 2 ? fromZone + 2 : fromZone - 2
  return { defenderId: target.player_id, toZone }
}

/**
 * Resolve a single lane battle: take the first untapped, un-flipped creature
 * with attack>0 from the attacker's `fromZone`, and apply it to the
 * defender's `toZone`. Returns the updated GameState plus a BattleEvent
 * describing what happened (or `{ skipped: true }` semantics — caller
 * checks `event.creature_killed === false && event.damage === 0`).
 */
export function resolveAttack(
  state: GameState,
  attackerId: string,
  fromZone: number,
  selection: { attackerCardId?: string; defenderId?: string; toZone?: number } = {},
): { state: GameState; event: BattleEvent } {
  const attacker = state.players.find((p) => p.player_id === attackerId)
  const attackerZone = attacker?.zones.find((z) => z.zone_position === fromZone)

  if (!attacker || !attackerZone) {
    return {
      state,
      event: emptyEvent(attackerId, fromZone, '', 0),
    }
  }

  const attackerCard = selection.attackerCardId
    ? attackerZone.cards.find((c) => (c.instanceId === selection.attackerCardId || c.id === selection.attackerCardId) && !c.tapped && !c.flipped && !c.isFlipped && effectiveAttackForCombat(c) > 0) ?? null
    : pickAttackerCard(attackerZone)
  if (!attackerCard) {
    return {
      state,
      event: emptyEvent(attackerId, fromZone, '', 0),
    }
  }

  const alivePlayers = state.players
    .filter((p) => (p.health ?? 0) > 0)
    .sort((a, b) => (a.player_order ?? 0) - (b.player_order ?? 0))

  const target = selection.defenderId && selection.toZone
    ? { defenderId: selection.defenderId, toZone: selection.toZone }
    : pickBattleTarget(attackerId, fromZone, alivePlayers)
  if (!target) {
    return {
      state,
      event: emptyEvent(attackerId, fromZone, '', 0),
    }
  }

  const defender = state.players.find((p) => p.player_id === target.defenderId)
  const defenderZone = defender?.zones.find((z) => z.zone_position === target.toZone)
  const defenderCreature = pickDefenderCreature(defenderZone)

  const attack = effectiveAttackForCombat(attackerCard)
  const counterDamage = defenderCreature ? effectiveAttackForCombat(defenderCreature) : 0
  const damage = attack
  const attackerHp = effectiveHealthForCombat(attackerCard)
  const defenderHp = defenderCreature ? effectiveHealthForCombat(defenderCreature) : 0
  const attackerDies = counterDamage >= attackerHp && attackerHp > 0
  const defenderDies = defenderCreature ? attack >= defenderHp && defenderHp > 0 : false

  let nextState = state
  let creatureKilled = false
  let creatureDamaged = false
  let faceDamage = 0
  let attackerDamaged = false

  if (defenderCreature) {
    creatureKilled = defenderDies
    creatureDamaged = !defenderDies
    if (defenderDies) {
      nextState = dispatchMechanicEvent(nextState, { type: 'on_death', actorId: target.defenderId, cardId: defenderCreature.instanceId ?? defenderCreature.id })
      nextState = applyZoneMutation(nextState, target.defenderId, target.toZone, (zone) => ({
        ...zone,
        cards: zone.cards.filter((c) => (c.instanceId ?? c.id) !== (defenderCreature.instanceId ?? defenderCreature.id)),
      }))
      nextState = applyPlayerMutation(nextState, target.defenderId, (p) => ({
        ...p,
        discard_pile: [...(p.discard_pile ?? []), defenderCreature],
      }))
    } else {
      nextState = applyZoneMutation(nextState, target.defenderId, target.toZone, (zone) =>
        replaceCardInZone(zone, defenderCreature.instanceId ?? defenderCreature.id, (c) => ({ ...c, health: defenderHp - attack })),
      )
    }
      nextState = dispatchMechanicEvent(nextState, { type: 'on_damage_dealt', actorId: attackerId, cardId: attackerCard.instanceId ?? attackerCard.id, amount: attack, targetCardIds: [defenderCreature.instanceId ?? defenderCreature.id] })
    if (counterDamage > 0) {
      attackerDamaged = !attackerDies
      if (attackerDies) {
      nextState = dispatchMechanicEvent(nextState, { type: 'on_death', actorId: attackerId, cardId: attackerCard.instanceId ?? attackerCard.id })
        nextState = applyZoneMutation(nextState, attackerId, fromZone, (zone) => ({
          ...zone,
          cards: zone.cards.filter((c) => (c.instanceId ?? c.id) !== (attackerCard.instanceId ?? attackerCard.id)),
        }))
        nextState = applyPlayerMutation(nextState, attackerId, (p) => ({
          ...p,
          discard_pile: [...(p.discard_pile ?? []), attackerCard],
        }))
      } else {
        nextState = applyZoneMutation(nextState, attackerId, fromZone, (zone) =>
          replaceCardInZone(zone, attackerCard.instanceId ?? attackerCard.id, (c) => ({ ...c, health: attackerHp - counterDamage })),
        )
      }
    }
  } else {
    faceDamage = attack
    nextState = applyPlayerMutation(nextState, target.defenderId, (p) => ({
      ...p,
      health: Math.max(0, (p.health ?? 0) - attack),
    }))
  }

  // Tap the attacker if it survived counterattack.
  if (!attackerDies) {
    nextState = applyZoneMutation(nextState, attackerId, fromZone, (zone) =>
      replaceCardInZone(zone, attackerCard.instanceId ?? attackerCard.id, (c) => ({ ...c, tapped: true })),
    )
  }

  return {
    state: nextState,
    event: {
      attacker_id: attackerId,
      attacker_card_id: attackerCard.id,
      attacker_instance_id: attackerCard.instanceId ?? attackerCard.id,
      from_zone: fromZone,
      defender_id: target.defenderId,
      to_zone: target.toZone,
      damage,
      face_damage: faceDamage,
      counter_damage: counterDamage,
      attacker_killed: attackerDies,
      attacker_damaged: attackerDamaged,
      creature_killed: creatureKilled,
      creature_damaged: creatureDamaged,
    },
  }
}

/** First untapped, un-flipped creature with attack > 0 in the zone. */
function pickAttackerCard(zone: Zone): Card | null {
  return (
    zone.cards.find(
      (c) =>
        c.card_type !== 'building' &&
        c.card_type !== 'spell' &&
        !c.tapped &&
        !c.flipped &&
        !c.isFlipped &&
        effectiveAttackForCombat(c) > 0,
    ) ?? null
  )
}

/** First creature/spell-free card in the defender zone. */
function pickDefenderCreature(zone: Zone | undefined): Card | null {
  if (!zone) return null
  return (
    zone.cards.find((c) => c.card_type !== 'building' && c.card_type !== 'spell') ??
    null
  )
}

function applyZoneMutation(
  state: GameState,
  playerId: string,
  zonePos: number,
  mutator: (zone: Zone) => Zone,
): GameState {
  return {
    ...state,
    players: state.players.map((p) => {
      if (p.player_id !== playerId) return p
      return {
        ...p,
        zones: p.zones.map((z) => (z.zone_position === zonePos ? mutator(z) : z)),
      }
    }),
  }
}

function applyPlayerMutation(
  state: GameState,
  playerId: string,
  mutator: (p: PlayerState) => PlayerState,
): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.player_id === playerId ? mutator(p) : p)),
  }
}

function emptyEvent(
  attackerId: string,
  fromZone: number,
  defenderId: string,
  toZone: number,
): BattleEvent {
  return {
    attacker_id: attackerId,
    attacker_card_id: '',
    attacker_instance_id: '',
    from_zone: fromZone,
    defender_id: defenderId,
    to_zone: toZone,
    damage: 0,
    face_damage: 0,
    counter_damage: 0,
    attacker_killed: false,
    attacker_damaged: false,
    creature_killed: false,
    creature_damaged: false,
  }
}

// Re-export helpers needed by callers (avoid a circular import surface).
export { cardMatchesId, findCardInZone }