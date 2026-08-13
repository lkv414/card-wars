/**
 * Синхронизация лобби через Ably.
 * Client publish — fallback пока Ably Postgres connector не настроен; outbox дублирует когда connector live.
 */
import { getAblyChannel } from './ablyClient'

export const LOBBY_SYNC_EVENT = 'update'

/** @param {string} lobbyId @param {object} payload */
export async function publishLobbySync(lobbyId, payload) {
  if (!lobbyId || !payload) return
  try {
    const channel = await getAblyChannel(`lobby:${lobbyId}`)
    await channel.publish(LOBBY_SYNC_EVENT, payload)
  } catch (err) {
    console.warn('[lobbySync] publish failed:', err?.message || err)
  }
}

/**
 * @param {object} data
 * @param {object} handlers
 */
export function handleLobbySyncMessage(data, handlers) {
  if (!data?.type) return

  switch (data.type) {
    case 'players':
      handlers.setPlayers?.(data.players ?? [])
      break
    case 'status':
      if (data.status) handlers.setStatus?.(data.status)
      break
    case 'game_started':
      if (data.gameId) handlers.onGameStarted?.(data.gameId)
      if (data.status) handlers.setStatus?.(data.status)
      break
    case 'closed':
      handlers.onClosed?.()
      break
    default:
      break
  }
}

/**
 * @param {import('ably').PresenceMessage[]} members
 * @returns {string[]}
 */
export function presenceMemberIds(members) {
  return members.map((m) => m.clientId).filter(Boolean)
}
