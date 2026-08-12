/** Правила боя (Card Wars). */

import { getZoneCreature } from './zoneCards.js'

/** Урон разрешён с player_order N, когда current_turn >= N-1 (2p: второй сразу). */
export function canPlayerDealDamage(playerOrder, playerCount, currentTurn) {
  const order = Number(playerOrder) || 1
  const count = Number(playerCount) || 2
  const turn = Number(currentTurn) || 0
  if (order >= count) return true
  return turn >= count - 1
}

export function isCreatureCard(card) {
  if (!card) return false
  const type = card.card_type || card.type
  return type !== 'building' && type !== 'spell'
}

export function getCreatureHealth(card) {
  if (!card) return 0
  return Number(card.health ?? card.defense ?? 0)
}

/** Существо умирает только если урон строго больше текущего HP. */
export function applyDamageToCreature(creature, damage) {
  const hp = getCreatureHealth(creature)
  const dmg = Number(damage) || 0
  if (dmg <= 0) {
    return { killed: false, remainingHealth: hp, faceDamage: 0, destroyed: null }
  }
  if (!creature || !isCreatureCard(creature)) {
    return { killed: false, remainingHealth: 0, faceDamage: dmg, destroyed: null }
  }
  if (dmg > hp) {
    return { killed: true, remainingHealth: 0, faceDamage: 0, destroyed: creature }
  }
  return { killed: false, remainingHealth: hp - dmg, faceDamage: 0, destroyed: null }
}

/**
 * Бой существо vs существо: урон наносится одновременно, защитник бьёт в ответ.
 */
export function resolveCreatureFight(attacker, defender) {
  const damage = Number(attacker?.attack ?? 0)
  const counterDamage = Number(defender?.attack ?? 0)
  const defenderResult = applyDamageToCreature(defender, damage)
  const attackerResult = applyDamageToCreature(attacker, counterDamage)

  return {
    damage,
    counterDamage,
    defenderResult,
    attackerResult,
    faceDamage: 0,
  }
}

/**
 * Разрешить атаку по зоне.
 * @returns {{ faceDamage: number, creatureResult: object|null, defender: object|null, counterDamage?: number, attackerResult?: object|null }}
 */
export function resolveZoneAttack(attackPower, zoneCards, attackerCreature = null) {
  const dmg = Number(attackPower) || 0
  const creature = getZoneCreature(zoneCards)

  if (!creature || !isCreatureCard(creature)) {
    return {
      faceDamage: dmg,
      creatureResult: null,
      defender: null,
      counterDamage: 0,
      attackerResult: null,
    }
  }

  if (attackerCreature && isCreatureCard(attackerCreature)) {
    const fight = resolveCreatureFight(attackerCreature, creature)
    return {
      faceDamage: 0,
      creatureResult: fight.defenderResult,
      defender: creature,
      counterDamage: fight.counterDamage,
      attackerResult: fight.attackerResult,
    }
  }

  const creatureResult = applyDamageToCreature(creature, dmg)
  return {
    faceDamage: creatureResult.faceDamage,
    creatureResult,
    defender: creature,
    counterDamage: 0,
    attackerResult: null,
  }
}

export function untapPlayerZones(zones) {
  const rows = Array.isArray(zones) ? zones : []
  return rows.map((zone) => {
    const cards = Array.isArray(zone) ? zone : zone?.cards || []
    return cards.map((c) => ({ ...c, tapped: false }))
  })
}
