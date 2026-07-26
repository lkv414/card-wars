/**
 * useRealtimeChannel — обёртка над Supabase Realtime с state machine.
 *
 * Состояния:
 *   - 'connecting'     — устанавливаем подписку
 *   - 'connected'      — успешно подписались (SUBSCRIBED)
 *   - 'disconnected'   — потеряли связь (CHANNEL_ERROR или CLOSED)
 *   - 'reconnecting'   — пробуем переподключиться (с exponential backoff)
 *
 * Поведение:
 *   - На mount: подписка + слушаем 'system' для SUBSCRIBED/CHANNEL_ERROR
 *   - На CLOSED/CHANNEL_ERROR: schedule reconnect (backoff 1s, 2s, 4s, 8s, max 16s)
 *   - На reconnect: removeChannel + новая подписка
 *   - При возврате на вкладку (visibilitychange) — форсированный reconnect
 *   - На unmount: removeChannel + clear timer
 *
 * @param {object} config
 * @param {string} config.channelName — имя канала (например, `game:${gameId}`)
 * @param {Array<{table: string, filter?: string, event?: string, callback: function}>} config.subscriptions
 *        Список подписок. Каждая вызывает свой callback при изменении.
 * @returns {string} status — одно из 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
 */

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../utils/supabase'

const BACKOFF_INITIAL_MS = 1000
const BACKOFF_MAX_MS = 16000

export function useRealtimeChannel({ channelName, subscriptions }) {
  const [status, setStatus] = useState('connecting')
  const channelRef = useRef(null)
  const timerRef = useRef(null)
  const attemptsRef = useRef(0)
  // refs позволяют callback'ам не триггерить пересоздание подписки
  const subsRef = useRef(subscriptions)

  useEffect(() => {
    subsRef.current = subscriptions
    if (!channelName) return undefined

    let cancelled = false

    const cleanup = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }

    const subscribe = () => {
      cleanup()
      if (cancelled) return

      setStatus(attemptsRef.current === 0 ? 'connecting' : 'reconnecting')

      const channel = supabase.channel(channelName)

      // Привязываем каждую подписку
      for (const sub of subsRef.current) {
        const opts = {
          event: sub.event || '*',
          schema: 'public',
          table: sub.table,
        }
        if (sub.filter) opts.filter = sub.filter
        channel.on('postgres_changes', opts, (payload) => {
          if (!cancelled) sub.callback?.(payload)
        })
      }

      // system events: SUBSCRIBED / CHANNEL_ERROR / CLOSED
      channel.on('system', {}, (payload) => {
        if (cancelled) return
        const ext = payload?.extension ?? payload
        const sysEvent = ext?.event ?? payload?.event
        if (sysEvent === 'SUBSCRIBED') {
          attemptsRef.current = 0
          setStatus('connected')
        } else if (sysEvent === 'CHANNEL_ERROR' || sysEvent === 'CLOSED') {
          setStatus('disconnected')
          scheduleReconnect()
        }
      })

      channel.subscribe()
      channelRef.current = channel
    }

    const scheduleReconnect = () => {
      if (cancelled) return
      attemptsRef.current += 1
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped)
      const delay = Math.min(
        BACKOFF_INITIAL_MS * 2 ** (attemptsRef.current - 1),
        BACKOFF_MAX_MS
      )
      timerRef.current = setTimeout(() => {
        if (cancelled) return
        subscribe()
      }, delay)
    }

    subscribe()

    // При возврате на вкладку — форсированный reconnect если disconnected
    const handleVisibility = () => {
      if (cancelled) return
      if (document.visibilityState === 'visible') {
        // rely on current status from closure — всегда пробуем рефреш
        attemptsRef.current = 0
        subscribe()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      cleanup()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName])

  return status
}
