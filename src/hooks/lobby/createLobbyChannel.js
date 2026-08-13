import { getAblyChannel, releaseAblyChannel, getAblyClient, mapConnectionState, isAblyConfigured } from '../../utils/ablyClient'
import { LOBBY_SYNC_EVENT, handleLobbySyncMessage, presenceMemberIds } from '../../utils/lobbySync'
import { getGuestId } from '../../utils/guestId'
import { clearLobbySession } from '../../utils/lobbySession'
import { ensureGuestId } from '../../utils/guestSession'

/**
 * Subscribe to lobby Ably channel. Presence is best-effort (must not block sync).
 */
export function subscribeAblyLobby(id, handlers) {
  if (!id || !isAblyConfigured) return () => {}

  let cancelled = false
  let channel = null
  let connListener = null
  let presenceListener = null
  let channelReady = false

  const onMessage = (message) => {
    if (cancelled) return
    const data = message.data
    if (data?.actorId && data.actorId === getGuestId()) return
    handleLobbySyncMessage(data, {
      setPlayers: handlers.setPlayers,
      setStatus: handlers.setStatus,
      onGameStarted: handlers.onGameStarted,
      onClosed: () => {
        clearLobbySession()
        handlers.resetLobby?.()
        handlers.setDismissedMessage?.('Хост закрыл лобби')
        handlers.setStatus?.('idle')
      },
    })
  }

  const onPresenceChange = () => {
    if (cancelled || !channel) return
    channel.presence.get((err, members) => {
      if (err || cancelled) return
      handlers.onPresenceChange?.(presenceMemberIds(members ?? []))
    })
  }

  const markConnected = () => {
    if (!cancelled) handlers.onConnectionChange?.('connected')
  }

  const markDisconnected = () => {
    if (!cancelled && !channelReady) handlers.onConnectionChange?.('disconnected')
  }

  ;(async () => {
    try {
      await ensureGuestId()
      channel = await getAblyChannel(`lobby:${id}`)
      if (cancelled) return

      channel.subscribe(LOBBY_SYNC_EVENT, onMessage)
      channelReady = true
      markConnected()

      try {
        presenceListener = onPresenceChange
        channel.presence.subscribe(presenceListener)
        await channel.presence.enter({ nickname: handlers.nickname || 'Игрок' })
        onPresenceChange()
      } catch (presenceErr) {
        console.warn('[lobby] presence failed (non-fatal):', presenceErr?.message || presenceErr)
      }
    } catch (err) {
      console.warn('[lobby] Ably subscribe failed:', err?.message || err)
      markDisconnected()
    }
  })()

  try {
    const client = getAblyClient()
    connListener = (stateChange) => {
      if (cancelled) return
      const mapped = mapConnectionState(stateChange.current)
      if (mapped === 'connected' && channelReady) {
        markConnected()
      } else if (mapped === 'disconnected' || mapped === 'failed') {
        handlers.onConnectionChange?.('disconnected')
      } else if (mapped === 'connecting' && channelReady) {
        handlers.onConnectionChange?.('reconnecting')
      }
    }
    client.connection.on(connListener)
  } catch {
    /* ignore */
  }

  return () => {
    cancelled = true
    if (connListener) {
      try {
        getAblyClient().connection.off(connListener)
      } catch {
        /* ignore */
      }
    }
    if (channel) {
      try {
        channel.unsubscribe(LOBBY_SYNC_EVENT, onMessage)
        if (presenceListener) channel.presence.unsubscribe(presenceListener)
        channel.presence.leave()
      } catch {
        /* ignore */
      }
    }
    releaseAblyChannel(`lobby:${id}`)
  }
}
