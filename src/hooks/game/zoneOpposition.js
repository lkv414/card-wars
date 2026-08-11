/**
 * zoneOpposition.js — единая логика «кто мой сосед по зоне».
 *
 * Использует ZONE_OPPOSITION из gameMultiplayer.js, но добавляет
 * runtime-resolve по списку игроков (нужны реальные player_id, а не индексы).
 *
 * Правила:
 *   - 2 игрока:  каждая зона [0..3] бьёт все 4 зоны [0..3] оппонента.
 *   - 3-4 игр.: левые [0,1] бьют правые [2,3] соседа справа;
 *               правые [2,3] бьют левые [0,1] соседа слева.
 *
 * Используется в useAttack (валидация) и в UI (подсветка доступных целей).
 */

import { ZONE_OPPOSITION } from '../../constants/gameMultiplayer.js'
import { safePlayers } from '../../utils/safePlayer.js'

/**
 * Вернуть список { playerId, zones: [0..3] } — цели для атаки из моей зоны.
 *
 * Правила:
 *   - 2 игрока: каждая зона [0..3] бьёт все 4 зоны [0..3] оппонента (если жив).
 *   - 3-4 игр.: левые [0,1] бьют правые [2,3] следующего ЖИВОГО соседа справа;
 *               правые [2,3] бьют левые [0,1] следующего ЖИВОГО соседа слева.
 *   - Если в игре 2 живых — fallback на логику 2-player (все 4 зоны против
 *     единственного живого).
 *
 * @param {string} myPlayerId
 * @param {Array} players — game.players (с player_id)
 * @param {number} myZone — индекс моей зоны 0..3
 * @returns {Array<{ playerId: string, zones: number[] }>}
 */
export function getAttackTargets(myPlayerId, players, myZone) {
  if (!Array.isArray(players) || players.length < 2) return []

  // safePlayers фильтрует null/undefined и фиксит health → безопасная фильтрация ниже
  const safe = safePlayers(players)
  if (safe.length < 2) return []

  const playerCount = safe.length
  const aliveCount = safe.filter((p) => (p.health ?? 0) > 0).length

  // === 2-player (или 3-4 но осталось 2 живых): все 4 зоны единственного живого оппонента ===
  if (playerCount === 2 || aliveCount <= 2) {
    const opp = safe.find(
      (p) => p.player_id !== myPlayerId && (p.health ?? 0) > 0
    )
    return opp ? [{ playerId: opp.player_id, zones: [0, 1, 2, 3] }] : []
  }

  // === 3-4 player: левые/правые зоны бьют зоны следующего живого соседа ===
  const myIdx = safe.findIndex((p) => p.player_id === myPlayerId)
  if (myIdx < 0) return []
  const direction = myZone < 2 ? 1 : -1
  const opp = getNextAliveNeighbor(myPlayerId, safe, direction)
  if (!opp) return []
  const oppZones = myZone < 2 ? [2, 3] : [0, 1]
  return [{ playerId: opp.player_id, zones: oppZones }]
}

/**
 * Может ли атакующий бить эту цель?
 * @returns {boolean}
 */
export function canAttack(myPlayerId, players, fromZone, toPlayerId, toZone) {
  const targets = getAttackTargets(myPlayerId, players, fromZone)
  return targets.some(
    (t) => t.playerId === toPlayerId && t.zones.includes(toZone)
  )
}

/**
 * Сосед игрока по кругу (для UI подсветки).
 * @param {string} myPlayerId
 * @param {Array} players — game.players
 * @param {number} direction — 1 (по часовой) или -1 (против)
 * @returns {object|null}
 */
export function getNeighbor(myPlayerId, players, direction = 1) {
  if (!Array.isArray(players) || players.length < 3) return null
  const safe = safePlayers(players)
  if (safe.length < 3) return null
  const idx = safe.findIndex((p) => p.player_id === myPlayerId)
  if (idx < 0) return null
  return safe[(idx + direction + safe.length) % safe.length] || null
}

/**
 * Следующий ЖИВОЙ сосед по кругу (живой = health > 0).
 * Используется в 3-4 player: если прямой сосед мёртв, ищем дальше.
 * @returns {object|null}
 */
export function getNextAliveNeighbor(myPlayerId, players, direction = 1) {
  if (!Array.isArray(players) || players.length < 2) return null
  // safePlayers уже отфильтровал null/undefined и проставил health: number
  const safe = safePlayers(players)
  if (safe.length < 2) return null
  const idx = safe.findIndex((p) => p.player_id === myPlayerId)
  if (idx < 0) return null
  for (let i = 1; i <= safe.length; i++) {
    // (+ safe.length * 2) гарантирует неотрицательный индекс при direction=-1
    const j = (idx + direction * i + safe.length * 2) % safe.length
    const next = safe[j]
    if (next && next.player_id !== myPlayerId && (next.health ?? 0) > 0) {
      return next
    }
  }
  return null // все мертвы
}

export { ZONE_OPPOSITION }
