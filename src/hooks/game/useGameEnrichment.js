/**
 * useGameEnrichment — обогащение runtime-state каталогом карт.
 *
 * Логика:
 * - Если каталог ещё не загружен — пропускаем.
 * - Если в game уже все карты обогащены — пропускаем (по ключу).
 * - Если нужно догрузить — асинхронно enrichGameStateAsync + applyServerState.
 *
 * Защита от race: проверяем версию после enrich и пропускаем, если
 * параллельно пришла более новая.
 */
import { useEffect, useRef } from 'react'
import { collectMissingCardIds, enrichGameStateAsync } from '../../utils/enrichGameCards'
import { supabase } from '../../utils/supabase'
import { gameDebugLog } from '../../utils/gameDebug'
import { useGameStore } from '../../store/gameStore'

export function useGameEnrichment({ game, cardCatalog, catalogLoading }) {
  const enrichKeyRef = useRef('')
  const inflightRef = useRef(null)

  useEffect(() => {
    if (catalogLoading || !game || !cardCatalog || cardCatalog.size === 0) return
    if (!game.id) return

    const enrichKey = `${game.id}:${game.version}:${cardCatalog.size}`
    const missing = collectMissingCardIds(game, cardCatalog)
    if (missing.length === 0) {
      enrichKeyRef.current = enrichKey
      return
    }
    if (enrichKeyRef.current === enrichKey) return
    if (inflightRef.current === enrichKey) return

    let cancelled = false
    const baseVersion = game.version
    inflightRef.current = enrichKey
    gameDebugLog('enrich', 'start', { enrichKey, missing: missing.length })

    ;(async () => {
      try {
        const next = await enrichGameStateAsync(game, cardCatalog, supabase)
        if (cancelled) return

        const store = useGameStore.getState()
        if ((store.serverVersion ?? 0) > (baseVersion ?? 0)) {
          gameDebugLog('enrich', 'skip (newer server version loaded)', { baseVersion })
          return
        }
        if ((next.version ?? 0) < (store.serverVersion ?? 0)) {
          gameDebugLog('enrich', 'skip (stale)', { nextVersion: next.version })
          return
        }
        enrichKeyRef.current = enrichKey
        store.applyServerState(next, 'enrich:cards')
        gameDebugLog('enrich', 'done', { version: next.version })
      } finally {
        if (inflightRef.current === enrichKey) inflightRef.current = null
      }
    })()

    return () => {
      cancelled = true
    }
  }, [catalogLoading, cardCatalog, game, game?.id, game?.version])
}
