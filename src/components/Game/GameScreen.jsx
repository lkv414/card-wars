/**
 * GameScreen
 * Server-authoritative sync через Cloudflare Workers WebSocket (GameRoom DO).
 * State ownership: Zustand gameStore (src/store/gameStore.js).
 * WS-push идут через FIFO-очередь → gameStore.applyServerState.
 */
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getGuestId } from '../../utils/guestId'
import { useGameAction } from '../../hooks/game'
import { useLandSetup } from '../../hooks/game/useLandSetup'
import { useLands } from '../../hooks/useLands'
import { useCards } from '../../hooks/useCards'
import { buildCardCatalog } from '../../utils/enrichGameCards'
import { isGameWsConfigured } from '../../utils/gameWebSocket'
import { gameDebugLog } from '../../utils/gameDebug'
import { useGameStore, selectGame, selectIsApplying, selectError } from '../../store/gameStore'
import { useToasts } from '../../hooks/useToasts'
import { Toasts } from '../Shared/Toasts'

import { useGameSessionCache } from '../../hooks/game/useGameSessionCache'
import { useGameEnrichment } from '../../hooks/game/useGameEnrichment'
import { useGameLoader } from '../../hooks/game/useGameLoader'
import { useGameWsHandler } from '../../hooks/game/useGameWsHandler'

const GameBoard3D = lazy(() => import('./GameBoard3D'))

const WS_FALLBACK_LOAD_MS = 12_000

export function GameScreen() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const guestId = getGuestId()
  const wsConfigured = isGameWsConfigured()

  // === State (lifted to Zustand store) ===
  const game = useGameStore(selectGame)
  const isApplying = useGameStore(selectIsApplying)
  const storeError = useGameStore(selectError)

  // === Local effects state ===
  const { lands } = useLands()
  const { cards: catalogCards, loading: catalogLoading } = useCards()
  const cardCatalog = useMemo(() => buildCardCatalog(catalogCards), [catalogCards])
  const cardCatalogRef = useRef(cardCatalog)
  // Обновляем ref в эффекте — не во время рендера (правило react-hooks/refs).
  useEffect(() => {
    cardCatalogRef.current = cardCatalog
  }, [cardCatalog])

  const landCatalog = useMemo(() => {
    const map = {}
    for (const land of lands || []) {
      if (land?.id) map[land.id] = land
    }
    return map
  }, [lands])

  const { toasts, toast, dismissToast } = useToasts()

  // === Hooks (extracted from original monolithic component) ===
  const { requestLoadGame, suppressRealtimeReload } = useGameLoader({ gameId, cardCatalogRef })
  useGameEnrichment({ game, cardCatalog, catalogLoading })

  const cache = useGameSessionCache()
  useEffect(() => {
    cache.onGameIdChange(gameId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  const { transport, statusLabel: connectionStatus } = useGameWsHandler({
    gameId,
    clientId: guestId,
    onError: (msg) => toast('error', msg),
  })

  // === Game actions ===
  const gameActions = useMemo(
    () => ({
      // patchGame — единая точка для optimistic UI.
      // Делегирует в useGameStore.applyOptimistic, который генерирует
      // requestId, применяет патч и ставит rollback по таймауту.
      patchGame: (patcher) => {
        const store = useGameStore.getState()
        if (!store.game) return store.game
        store.applyOptimistic((prev) => {
          if (typeof patcher === 'function') return patcher(prev)
          return { ...prev, ...patcher }
        })
        return useGameStore.getState().game
      },
      cardCatalog,
      transport,
      suppressRealtimeReload,
      reloadEnabled: !wsConfigured,
    }),
    [cardCatalog, transport, suppressRealtimeReload, wsConfigured],
  )

  const {
    playCard,
    attack,
    drawCard,
    drawFreeCard,
    shuffleDeck,
    discardFromHand,
    endTurn,
    forfeit,
    flipCard,
    discardFromZone,
    isApplying: actionApplying,
    error: actionError,
  } = useGameAction(game, requestLoadGame, gameActions)

  const { reorderLands, confirmLandSetup } = useLandSetup(game, requestLoadGame, { transport })

  const combinedIsApplying = isApplying || actionApplying
  const combinedError = actionError || storeError

  useEffect(() => {
    if (combinedError) toast('error', combinedError)
  }, [combinedError, toast])

  // === GameId change handling (cache + load) ===
  // Храним стабильные refs для requestLoadGame и cache, чтобы не
  // триггерить повторный эффект при изменении их внутренних зависимостей.
  const requestLoadGameRef = useRef(requestLoadGame)
  useEffect(() => {
    requestLoadGameRef.current = requestLoadGame
  }, [requestLoadGame])

  useEffect(() => {
    if (!gameId) return
    const cached = cache.loadFromCache(gameId)
    if (cached) {
      useGameStore.getState().applyServerState(cached, 'cache:hydrate')
      gameDebugLog('cache', 'hydrated', { gameId, version: cached?.version })
    } else {
      useGameStore.getState().clear()
      if (!wsConfigured) {
        requestLoadGameRef.current?.('mount:gameId', { force: true })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, wsConfigured])

  // === Persist game state to cache on update ===
  useEffect(() => {
    if (game?.id) cache.saveToCache(game.id, game)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game])

  // === WS fallback load: если за 12 сек нет ни одного state — load через RPC ===
  useEffect(() => {
    if (!wsConfigured || !gameId) return undefined
    const timer = setTimeout(() => {
      const v = useGameStore.getState().serverVersion
      if (v === 0) {
        gameDebugLog('ws', 'fallback load (no state yet)')
        requestLoadGameRef.current?.('ws:fallback', { force: true })
      }
    }, WS_FALLBACK_LOAD_MS)
    return () => clearTimeout(timer)
  }, [wsConfigured, gameId])

  // === Render ===
  if (!wsConfigured) {
    return (
      <main className="game-error" role="alert">
        <h1>Realtime недоступен</h1>
        <p>
          Задайте <code>VITE_GAME_WS_URL</code> (Cloudflare Workers) для multiplayer.
        </p>
        <button type="button" onClick={() => navigate('/lobby')}>← Назад в лобби</button>
      </main>
    )
  }

  if (storeError) {
    return (
      <main className="game-error" role="main" aria-live="assertive">
        <h1>Ошибка</h1>
        <p>{storeError}</p>
        <button onClick={() => navigate('/lobby')}>← Назад в лобби</button>
      </main>
    )
  }

  if (!game) {
    return (
      <div className="game-loading" role="status" aria-live="polite">
        Загружаем игру...
      </div>
    )
  }

  return (
    <>
      <Suspense
        fallback={
          <div className="game-loading" role="status" aria-live="polite">
            Загружаем 3D-сцену...
          </div>
        }
      >
        <GameBoard3D
          game={game}
          playerId={guestId}
          landCatalog={landCatalog}
          onGameEnd={() => navigate('/lobby')}
          onPlayCard={playCard}
          onAttack={attack}
          onDrawFreeCard={async () => {
            const r = await drawFreeCard()
            if (r?.error) toast('error', r.error)
            return r
          }}
          onDrawPaidCard={async () => {
            const r = await drawCard()
            if (r?.error) toast('error', r.error)
            return r
          }}
          onShuffleDeck={async () => {
            const r = await shuffleDeck()
            if (r?.error) toast('error', r.error)
            return r
          }}
          onDiscardFromHand={async (idx) => {
            const r = await discardFromHand(idx)
            if (r?.error) toast('error', r.error)
            return r
          }}
          onFlipCard={flipCard}
          onDiscardFromZone={discardFromZone}
          onEndTurn={endTurn}
          onForfeit={forfeit}
          onReorderLands={reorderLands}
          onConfirmLandSetup={confirmLandSetup}
          onSuppressRealtimeReload={suppressRealtimeReload}
          realtimeStatus={connectionStatus}
          isApplying={combinedIsApplying}
          actionError={combinedError}
          toast={toast}
        />
      </Suspense>
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
