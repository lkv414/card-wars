/**
 * Синхронизация игрового состояния через Ably.
 * Client publish — fallback пока Ably Postgres connector не настроен.
 */
import { getAblyChannel } from './ablyClient'
import {
  applyPlayCardPatch,
  applyPlayCardZoneSnapshot,
  applyEndTurnPatch,
  applyFlipCardPatch,
  applyAttackPatch,
  applyDrawPatch,
} from './gameStatePatch'
import { enrichCard } from './enrichGameCards'

export const GAME_SYNC_EVENT = 'sync'

/** @param {string} gameId @param {object} payload */
export async function publishGameSync(gameId, payload) {
  if (!gameId || !payload) return
  try {
    const channel = await getAblyChannel(`game:${gameId}`)
    await channel.publish(GAME_SYNC_EVENT, payload)
  } catch (err) {
    console.warn('[gameSync] publish failed:', err?.message || err)
  }
}

/**
 * @param {object} data
 * @param {object} ctx
 * @param {string} ctx.guestId
 * @param {Map} ctx.cardCatalog
 * @param {() => object|null} ctx.getGame
 * @param {(next: object) => boolean} ctx.commitGame
 * @param {() => void} ctx.loadGame
 */
export function applyIncomingGameSync(data, ctx) {
  if (!data || data.actorId === ctx.guestId) return false

  const remoteVersion = data.version ?? 0
  const localVersion = ctx.gameVersionRef.current ?? 0
  if (remoteVersion > 0 && remoteVersion <= localVersion) return false

  const { getGame, commitGame, loadGame, cardCatalog, guestId } = ctx

  if (data.type === 'reload') {
    loadGame()
    return true
  }

  const prev = getGame()
  if (!prev) {
    loadGame()
    return true
  }

  let next = prev
  switch (data.type) {
    case 'play_card':
      next = Array.isArray(data.zoneCards)
        ? applyPlayCardZoneSnapshot(
            prev,
            data.playerId,
            data.zoneIndex,
            data.zoneCards,
            data.rpcData || {},
            cardCatalog
          )
        : applyPlayCardPatch(
            prev,
            data.playerId,
            data.cardIndex,
            data.zoneIndex,
            data.slotType,
            data.rpcData || {},
            cardCatalog
          )
      break
    case 'end_turn':
      next = applyEndTurnPatch(prev, data.rpcData || {})
      break
    case 'attack':
      next = applyAttackPatch(prev, data.rpcData || {})
      break
    case 'flip_card':
      next = applyFlipCardPatch(prev, data.playerId, data.zoneIndex, data.cardId, data.version)
      break
    case 'draw':
      next = applyDrawPatch(prev, data.playerId, data.rpcData || {}, guestId)
      break
    default:
      loadGame()
      return true
  }

  if (!next || next === prev) {
    loadGame()
    return true
  }

  const nextVersion = next.version ?? prev.version ?? 0
  if (remoteVersion > 0 && nextVersion < remoteVersion) {
    loadGame()
    return true
  }

  if (!commitGame(next)) {
    loadGame()
  }
  return true
}

/** Обогащает карты зоны (локальный optimistic UI). */
export function enrichZoneCardsForSync(cards, catalog) {
  if (!Array.isArray(cards) || !catalog?.size) return cards
  return cards.map((card) => enrichCard(card, catalog))
}
