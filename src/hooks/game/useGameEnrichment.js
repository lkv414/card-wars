/**
 * useGameEnrichment — обогащение runtime-state каталогом карт.
 *
 * Каталог лежит в бандле (этап 5 плана v2), поэтому обогащение синхронное
 * и локальное: никаких запросов в БД.
 *
 * Логика:
 * - Если каталог ещё не загружен — пропускаем.
 * - Если в game уже все карты обогащены — пропускаем (по ключу).
 * - Иначе применяем enrichGameState + applyServerState.
 *
 * Защита от race: если параллельно пришла более новая версия — пропускаем.
 */
import { useEffect, useRef } from 'react'
import { collectMissingCardIds, enrichGameState } from '../../utils/enrichGameCards'
import { gameDebugLog } from '../../utils/gameDebug'
import { useGameStore } from '../../store/gameStore'

export function useGameEnrichment({ game, cardCatalog, catalogLoading }) {
  const enrichKeyRef = useRef('')

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

    const store = useGameStore.getState()
    const baseVersion = game.version
    if ((store.serverVersion ?? 0) > (baseVersion ?? 0)) {
      gameDebugLog('enrich', 'skip (newer server version loaded)', { baseVersion })
      return
    }

    const next = enrichGameState(game, cardCatalog)
    enrichKeyRef.current = enrichKey
    store.applyServerState(next, 'enrich:cards')
    gameDebugLog('enrich', 'done', { version: next.version, missing: missing.length })
  }, [catalogLoading, cardCatalog, game, game?.id, game?.version])
}
