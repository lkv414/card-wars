/**
 * useAblyChannel — подписка на Ably-канал с state machine соединения.
 *
 * @param {object} config
 * @param {string|null} config.channelName
 * @param {string} [config.eventName='sync']
 * @param {(message: import('ably').Message) => void} [config.onMessage]
 * @returns {'connecting'|'connected'|'disconnected'|'reconnecting'}
 */
import { useEffect, useRef, useState } from 'react'
import {
  getAblyClient,
  getAblyChannel,
  releaseAblyChannel,
  mapConnectionState,
  isAblyConfigured,
} from '../utils/ablyClient'
import { ensureGuestId } from '../utils/guestSession'

export function useAblyChannel({ channelName, eventName = 'sync', onMessage, onSubscribed }) {
  const [status, setStatus] = useState(() =>
    !channelName || !isAblyConfigured ? 'disconnected' : 'connecting'
  )
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const onSubscribedRef = useRef(onSubscribed)
  onSubscribedRef.current = onSubscribed
  const statusRef = useRef('connecting')

  useEffect(() => {
    if (!channelName || !isAblyConfigured) {
      return undefined
    }

    let cancelled = false

    const updateStatus = (next) => {
      statusRef.current = next
      setStatus(next)
    }

    let client
    try {
      client = getAblyClient()
    } catch {
      updateStatus('disconnected')
      return undefined
    }

    const onConnChange = (stateChange) => {
      if (cancelled) return
      const mapped = mapConnectionState(stateChange.current)
      if (stateChange.current === 'connecting' && statusRef.current === 'disconnected') {
        updateStatus('reconnecting')
      } else {
        updateStatus(mapped)
      }
    }

    client.connection.on(onConnChange)
    updateStatus(mapConnectionState(client.connection.state))

    const handler = (message) => {
      if (!cancelled) onMessageRef.current?.(message)
    }

    ;(async () => {
      try {
        await ensureGuestId()
        const channel = await getAblyChannel(channelName)
        if (cancelled) return
        channel.subscribe(eventName, handler)
        updateStatus('connected')
        onSubscribedRef.current?.()
      } catch (err) {
        console.warn('[ably] channel subscribe failed:', channelName, err?.message || err)
        if (!cancelled) updateStatus('disconnected')
      }
    })()

    const handleVisibility = () => {
      if (cancelled) return
      if (document.visibilityState === 'visible' && statusRef.current !== 'connected') {
        client.connection.connect()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      client.connection.off(onConnChange)
      document.removeEventListener('visibilitychange', handleVisibility)
      try {
        const channel = client.channels.get(channelName)
        channel.unsubscribe(eventName, handler)
      } catch {
        /* ignore */
      }
      releaseAblyChannel(channelName)
    }
  }, [channelName, eventName])

  return status
}
