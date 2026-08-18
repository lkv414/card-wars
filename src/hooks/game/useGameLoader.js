/**
 * useGameLoader — загрузка game state с защитой от race и duplicate-запросов.
 *
 * Логика:
 * - loadInFlightRef: текущая загрузка
 * - pendingReloadRef: если за время загрузки пришёл ещё один запрос,
 *   после завершения текущей загрузим ещё раз
 * - suppressReloadUntilRef: после локального действия realtime-reload
 *   подавляется на N мс, чтобы не перезатереть оптимистичный патч
 * - DUPLICATE_LOAD_MS: защита от двойной загрузки в течение короткого окна
 */
import { useCallback, useEffect, useRef } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { getGuestId } from '../../utils/guestId'
import { mapRpcGameState } from '../../utils/mapGameState'
import { enrichGameStateAsync } from '../../utils/enrichGameCards'
import { gameDebugLog } from '../../utils/gameDebug'
import { useGameStore } from '../../store/gameStore'

const DUPLICATE_LOAD_MS = 600
const DEFAULT_SUPPRESS_MS = 8_000

export function useGameLoader({ gameId, cardCatalogRef }) {
  const loadInFlightRef = useRef(null)
  const pendingReloadRef = useRef(null)
  const lastLoadMetaRef = useRef({ source: '', at: 0 })
  // requestLoadGameRef — для внутренней рекурсии (pending reload)
  const requestLoadGameRef = useRef(null)

  const loadInternal = useCallback(
    async (source = 'unknown') => {
      if (!gameId) return null
      const startedAt = performance.now()
      gameDebugLog('load', 'start', { source, gameId })

      await ensureGuestId()
      const guestId = getGuestId()

      const { data: state, error: rpcErr } = await supabase.rpc('get_player_game_state', {
        p_game_id: gameId,
        p_player_id: guestId,
      })

      if (rpcErr) throw new Error(rpcErr.message)
      if (!state) throw new Error('Игра не найдена или доступ запрещён')

      const mapped = mapRpcGameState(state)

      const catalog = cardCatalogRef.current || new Map()
      const nextGame =
        catalog.size > 0 ? await enrichGameStateAsync(mapped, catalog, supabase) : mapped

      useGameStore.getState().applyServerState(nextGame, `load:${source}`)
      gameDebugLog('load', 'done', {
        source,
        ms: Math.round(performance.now() - startedAt),
        version: state.version,
      })

      return nextGame
    },
    [gameId, cardCatalogRef],
  )

  const requestLoadGame = useCallback(
    async (source = 'unknown', { force = false } = {}) => {
      if (!gameId) return null

      const now = Date.now()
      const last = lastLoadMetaRef.current

      if (!force && source === last.source && now - last.at < DUPLICATE_LOAD_MS) {
        gameDebugLog('skip', 'load duplicate', { source, ageMs: now - last.at })
        return null
      }

      if (loadInFlightRef.current) {
        gameDebugLog('load', 'queue (in flight)', { source })
        pendingReloadRef.current = source
        await loadInFlightRef.current
        const pending = pendingReloadRef.current
        pendingReloadRef.current = null
        if (pending && requestLoadGameRef.current) {
          return requestLoadGameRef.current(pending, { force })
        }
        return null
      }

      lastLoadMetaRef.current = { source, at: now }

      const run = async () => {
        try {
          return await loadInternal(source)
        } catch (err) {
          gameDebugLog('load', 'error', { source, error: err?.message || String(err) })
          useGameStore.getState().setError(err.message || 'Не удалось загрузить игру')
          return null
        }
      }

      loadInFlightRef.current = run()
      try {
        return await loadInFlightRef.current
      } finally {
        loadInFlightRef.current = null
      }
    },
    [gameId, loadInternal],
  )

  // Сохраняем актуальную ссылку в ref для рекурсии в requestLoadGame
  useEffect(() => {
    requestLoadGameRef.current = requestLoadGame
  }, [requestLoadGame])

  /**
   * Подавить reload на ms мс.
   *
   * NOTE: с gameStore эта логика больше не нужна — store сам отбрасывает
   * stale версии. Но оставляем как no-op для обратной совместимости
   * с хуками, которые передают suppressRealtimeReload дальше.
   */
  const suppressRealtimeReload = useCallback((ms = DEFAULT_SUPPRESS_MS) => {
    gameDebugLog('suppress', `(noop) reload paused ${ms}ms — store handles via version`)
  }, [])

  return { requestLoadGame, suppressRealtimeReload }
}
