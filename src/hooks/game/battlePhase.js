/** Планирование автоматической фазы боя (BATTLE!). */

import { canPlayerDealDamage, isCreatureCard } from './combat.js'
import { getZoneCreature } from './zoneCards.js'
import { getAttackTargets } from './zoneOpposition.js'
import { clampZones } from './format.js'
import { safePlayers } from '../../utils/safePlayer.js'

/** Целевая зона противника для атаки из fromZone (0-based). */
export function getBattleTargetZone(fromZone, playerCount) {
  const z = Number(fromZone) || 0
  if (playerCount === 2) return z
  return (z + 2) % 4
}

/** Существо зоны, которым можно атаковать (не повёрнуто, не перевёрнуто, attack > 0). */
export function pickAttacker(cards) {
  const creature = getZoneCreature(cards)
  if (!creature || !isCreatureCard(creature)) return null
  if (creature.tapped || creature.flipped || creature.isFlipped) return null
  const attack = Number(creature.attack ?? 0)
  if (attack <= 0) return null
  return creature
}

/**
 * Доступные цели ручной атаки из зоны fromZone (0-based), с учётом правила
 * "зона против зоны" (getAttackTargets). Для 2 игроков — все 4 зоны, для 3-4 —
 * только противостоящие.
 * @returns {Array<{ playerId: string, zones: number[] }>}
 */
export function getManualAttackTargets(game, playerId, fromZone) {
  if (!game?.players) return []
  const players = safePlayers(game.players)
  return getAttackTargets(playerId, players, fromZone)
}

/**
 * Список атак текущего игрока при BATTLE.
 * @returns {Array<{ fromZone: number, toPlayerId: string, toZone: number, cardId: string, attack: number }>}
 */
export function planBattleAttacks(game, playerId) {
  if (!game?.players) return []

  const players = safePlayers(game.players)
  const me = players.find((p) => p.player_id === playerId)
  if (!me || game.current_player_id !== playerId) return []

  const aliveCount = players.filter((p) => (p.health ?? 0) > 0).length
  if (
    !canPlayerDealDamage(me.player_order, aliveCount, game.current_turn ?? 0)
  ) {
    return []
  }

  const zones = clampZones(me.zones)
  const playerCount = players.length
  const attacks = []

  for (let fromZone = 0; fromZone < 4; fromZone++) {
    const attacker = pickAttacker(zones[fromZone])
    if (!attacker) continue

    const targets = getAttackTargets(playerId, players, fromZone)
    if (!targets.length) continue

    const toZone = getBattleTargetZone(fromZone, playerCount)
    const target = targets.find((t) => t.zones.includes(toZone))
    if (!target) continue

    attacks.push({
      fromZone,
      toPlayerId: target.playerId,
      toZone,
      cardId: attacker.id || attacker.instanceId,
      attack: Number(attacker.attack ?? 0),
    })
  }

  return attacks
}

/** Применить battle_events к UI-маркерам и flash. */
export function battleEventsToVisuals(battleEvents, myPlayerId) {
  const events = Array.isArray(battleEvents) ? battleEvents : []
  const markers = []
  let flashMe = false

  for (const ev of events) {
    const dmg = Number(ev.damage ?? ev.amount ?? 0)
    const counter = Number(ev.counter_damage ?? ev.counterDamage ?? 0)
    const face = Number(ev.face_damage ?? 0)
    const toPlayer = ev.to_player_id ?? ev.toPlayerId
    const fromPlayer = ev.from_player_id ?? ev.fromPlayerId
    const toZone = Number(ev.to_zone ?? ev.toZone ?? 0)
    const fromZone = Number(ev.from_zone ?? ev.fromZone ?? 0)
    const toZoneIdx = toZone >= 1 && toZone <= 4 ? toZone - 1 : toZone
    const fromZoneIdx = fromZone >= 1 && fromZone <= 4 ? fromZone - 1 : fromZone
    const ts = `${Date.now()}-${Math.random()}`

    if (face > 0 && toPlayer === myPlayerId) {
      flashMe = true
    }

    if (face <= 0 && dmg > 0) {
      markers.push({
        key: `hit-${toPlayer}-${toZone}-${ts}`,
        playerId: toPlayer,
        zoneIndex: toZoneIdx,
        amount: dmg,
      })
    }

    if (counter > 0 && fromPlayer) {
      markers.push({
        key: `counter-${fromPlayer}-${fromZone}-${ts}`,
        playerId: fromPlayer,
        zoneIndex: fromZoneIdx,
        amount: counter,
      })
    }
  }

  return { markers, flashMe }
}
