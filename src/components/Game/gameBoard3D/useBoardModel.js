/**
 * useBoardModel — derivation hook: превращает «серверную» модель игры в плоскую
 * структуру, оптимизированную для рендера 3D-поля.
 *
 * Что возвращается:
 *   - players: стабильная ссылка (после safePlayers)
 *   - myIndex, me, playerCount
 *   - zones: массив {zoneIndex, player, isOwnerMe, center, rotationY, landType, ...}
 *     в плоском виде, готовый для map-рендера
 *
 * Зоны вычисляются в одном useMemo, чтобы GameBoard3D не дёргал buildBoardZones
 * дважды и не аллоцировал промежуточные объекты.
 *
 * Карты внутри зон — это «сырые» обогащённые карты; splitZoneCards выполняется
 * отдельно в useStableZoneCards, чтобы мемоизация работала корректно по
 * identity зон-карт.
 */
import { useMemo } from 'react'

import { safePlayers, safePlayer } from '../../../utils/safePlayer'
import {
  calculateTwoPlayerBoard,
  calculatePlayerSlotPositions,
} from '../../../utils/gameObjectPlacement'
import { normalizePlayerZoneRows } from '../../../hooks/game/format'

/**
 * @param {object} game
 * @param {string} playerId
 * @param {object} landCatalog
 * @returns {{
 *   players: Array,
 *   playerCount: number,
 *   myIndex: number,
 *   me: object,
 *   zones: Array<{zoneIndex:number, player:object, isOwnerMe:boolean, center:[number,number,number], rotationY:number, landType:string|null, row:object}>
 * }}
 */
export function useBoardModel(game, playerId, landCatalog) {
  const players = useMemo(() => safePlayers(game.players), [game.players])
  const playerCount = players.length

  const myIndex = useMemo(() => {
    const idx = players.findIndex((p) => p.player_id === playerId)
    return idx === -1 && players.length > 0 ? 0 : idx
  }, [players, playerId])

  const me = useMemo(
    () => (myIndex >= 0 ? safePlayer(players, players[myIndex]?.player_id) : safePlayer([], null)),
    [players, myIndex],
  )

  const zones = useMemo(() => {
    return buildBoardZones(players, myIndex, landCatalog)
  }, [players, myIndex, landCatalog])

  return { players, playerCount, myIndex, me, zones }
}

function resolveLandType(zoneRow, landCatalog) {
  if (zoneRow?.land_type) return zoneRow.land_type
  const id = zoneRow?.land_id
  if (id && landCatalog[id]?.land_type) return landCatalog[id].land_type
  return null
}

function buildBoardZones(players, myIndex, landCatalog) {
  const playerCount = players.length
  const out = []

  if (playerCount === 2) {
    const sharedLanes = calculateTwoPlayerBoard(myIndex)
    for (const lane of sharedLanes) {
      const nearPlayer = players[lane.near.playerIndex]
      const farPlayer = players[lane.far.playerIndex]
      if (nearPlayer && (nearPlayer.health ?? 0) > 0) {
        const rows = normalizePlayerZoneRows(nearPlayer.zones)
        const row = rows[lane.near.zoneIndex] || {}
        out.push({
          zoneIndex: lane.near.zoneIndex,
          player: nearPlayer,
          isOwnerMe: true,
          center: lane.near.center,
          rotationY: lane.near.rotationY,
          landType: resolveLandType(row, landCatalog),
          row,
        })
      }
      if (farPlayer && (farPlayer.health ?? 0) > 0) {
        const rows = normalizePlayerZoneRows(farPlayer.zones)
        const row = rows[lane.far.zoneIndex] || {}
        out.push({
          zoneIndex: lane.far.zoneIndex,
          player: farPlayer,
          isOwnerMe: false,
          center: lane.far.center,
          rotationY: lane.far.rotationY,
          landType: resolveLandType(row, landCatalog),
          row,
        })
      }
    }
    return out
  }

  for (let i = 0; i < playerCount; i++) {
    if (i === myIndex) continue
    const opp = players[i]
    if (!opp || (opp.health ?? 0) <= 0) continue
    const positions = calculatePlayerSlotPositions(i, playerCount)
    for (const p of positions) {
      const rows = normalizePlayerZoneRows(opp.zones)
      const row = rows[p.zoneIndex] || {}
      out.push({
        zoneIndex: p.zoneIndex,
        player: opp,
        isOwnerMe: false,
        center: p.center,
        rotationY: p.rotationY,
        landType: resolveLandType(row, landCatalog),
        row,
      })
    }
  }

  const me = players[myIndex]
  if (me && (me.health ?? 0) > 0) {
    const myPositions = calculatePlayerSlotPositions(myIndex, playerCount)
    for (const p of myPositions) {
      const rows = normalizePlayerZoneRows(me.zones)
      const row = rows[p.zoneIndex] || {}
      out.push({
        zoneIndex: p.zoneIndex,
        player: me,
        isOwnerMe: true,
        center: p.center,
        rotationY: p.rotationY,
        landType: resolveLandType(row, landCatalog),
        row,
      })
    }
  }
  return out
}