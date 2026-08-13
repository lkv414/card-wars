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
import { gameDebugLog, gameDebugSnapshot } from './gameDebug'

export const GAME_SYNC_EVENT = 'sync'

/** @param {string} gameId @param {object} payload */
export async function publishGameSync(gameId, payload) {
  if (!gameId || !payload) return
  try {
    gameDebugLog('sync', 'publish', { gameId, type: payload.type, version: payload.version })
    const channel = await getAblyChannel(`game:${gameId}`)
    await channel.publish(GAME_SYNC_EVENT, payload)
    gameDebugLog('sync', 'publish ok', { gameId, type: payload.type })
  } catch (err) {
    console.warn('[gameSync] publish failed:', err?.message || err)
    gameDebugLog('sync', 'publish failed', { gameId, error: err?.message || String(err) })
  }
}

/**
 * @param {object} data
 * @param {object} ctx
 */
export function applyIncomingGameSync(data, ctx) {
  const localVersion = ctx.gameVersionRef.current ?? 0
  const prev = ctx.getGame()

  gameDebugLog('sync', 'incoming', {
    type: data?.type,
    actorId: data?.actorId,
    remoteVersion: data?.version ?? 0,
    localVersion,
    snapshot: gameDebugSnapshot(prev, ctx.gameVersionRef),
  })

  if (!data || data.actorId === ctx.guestId) {
    gameDebugLog('skip', 'sync own message or empty', { actorId: data?.actorId })
    return { applied: false, reason: 'own_or_empty' }
  }

  const remoteVersion = data.version ?? 0
  if (remoteVersion > 0 && remoteVersion <= localVersion) {
    gameDebugLog('skip', 'sync stale version', { remoteVersion, localVersion })
    return { applied: false, reason: 'stale_version' }
  }

  const { getGame, commitGame, requestLoadGame, cardCatalog, guestId } = ctx

  if (data.type === 'reload') {
    gameDebugLog('sync', '→ full reload (type=reload)', { remoteVersion })
    requestLoadGame?.('ably:reload', { force: false })
    return { applied: false, reason: 'reload_event' }
  }

  if (!prev) {
    gameDebugLog('sync', '→ full reload (no local game)', { remoteVersion })
    requestLoadGame?.('ably:no-local-state')
    return { applied: false, reason: 'no_local_state' }
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
    case 'discard_from_hand':
      // Observer sees hand_count update only
      next = {
        ...prev,
        version: data.version ?? prev.version,
        players: prev.players.map((player) => {
          if (player.player_id !== data.playerId) return player
          return {
            ...player,
            hand_count: data.rpcData?.hand_count ?? player.hand_count,
          }
        }),
      }
      break
    case 'discard_from_zone':
      // Observer doesn't see the discard, but zone might be visible
      next = prev
      break
    default:
      gameDebugLog('sync', '→ full reload (unknown type)', { type: data.type })
      requestLoadGame?.('ably:unknown-type', { force: false })
      return { applied: false, reason: 'unknown_type' }
  }

  if (!next || next === prev) {
    gameDebugLog('sync', '→ full reload (patch no-op)', {
      type: data.type,
      remoteVersion,
      localVersion: prev.version,
    })
    requestLoadGame?.('ably:patch-noop')
    return { applied: false, reason: 'patch_noop' }
  }

  const nextVersion = next.version ?? prev.version ?? 0
  if (remoteVersion > 0 && nextVersion < remoteVersion) {
    gameDebugLog('sync', '→ full reload (patch version lag)', {
      nextVersion,
      remoteVersion,
    })
    requestLoadGame?.('ably:patch-version-lag')
    return { applied: false, reason: 'patch_version_lag' }
  }

  if (!commitGame(next)) {
    gameDebugLog('sync', '→ full reload (commit rejected)', {
      nextVersion,
      refVersion: ctx.gameVersionRef.current,
    })
    requestLoadGame?.('ably:commit-rejected')
    return { applied: false, reason: 'commit_rejected' }
  }

  gameDebugLog('patch', 'sync applied', {
    type: data.type,
    version: nextVersion,
    snapshot: gameDebugSnapshot(next, ctx.gameVersionRef),
  })
  return { applied: true, reason: 'patched', version: nextVersion }
}

/** Обогащает карты зоны (локальный optimistic UI). */
export function enrichZoneCardsForSync(cards, catalog) {
  if (!Array.isArray(cards) || !catalog?.size) return cards
  return cards.map((card) => enrichCard(card, catalog))
}
