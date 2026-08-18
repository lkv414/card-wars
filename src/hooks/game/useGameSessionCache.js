/**
 * useGameSessionCache — обёртка над gameSessionCache.
 *
 * Game board переживает React Strict Mode remounts и переходы между страницами
 * благодаря in-memory кэшу в sessionStorage.
 *
 * Возвращает:
 * - loadFromCache(gameId) — взять из кэша или null
 * - saveToCache(gameId, game) — положить в кэш
 * - clearCache(gameId) — удалить из кэша
 */
import { useCallback, useRef } from 'react'
import {
  peekGameSession,
  rememberGameSession,
  forgetGameSession,
} from '../../utils/gameSessionCache'

export function useGameSessionCache() {
  // Храним ссылку на текущий gameId, чтобы можно было forget'ить
  // при смене gameId в useEffect.
  const prevGameIdRef = useRef(null)

  const loadFromCache = useCallback((gameId) => {
    return peekGameSession(gameId)
  }, [])

  const saveToCache = useCallback((gameId, game) => {
    rememberGameSession(gameId, game)
  }, [])

  const clearCache = useCallback((gameId) => {
    forgetGameSession(gameId)
  }, [])

  /**
   * Хелпер для эффекта "сменился gameId → забыть старый":
   * возвращает cleanup-функцию для useEffect.
   */
  const onGameIdChange = useCallback((gameId) => {
    const prev = prevGameIdRef.current
    prevGameIdRef.current = gameId
    if (prev && prev !== gameId) {
      forgetGameSession(prev)
    }
  }, [])

  return { loadFromCache, saveToCache, clearCache, onGameIdChange }
}
