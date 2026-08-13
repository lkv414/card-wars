/**
 * GameScreen
 * Загружает gameState из Supabase по gameId.
 * Realtime: Cloudflare Workers WebSocket (если VITE_GAME_WS_URL) или Ably fallback.
 */
import { lazy, Suspense, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../utils/supabase'
import { getGuestId } from '../../utils/guestId'
import { ensureGuestId } from '../../utils/guestSession'
import { useGameAction } from '../../hooks/game'
import { useLandSetup } from '../../hooks/game/useLandSetup'
import { useLands } from '../../hooks/useLands'
import { useCards } from '../../hooks/useCards'
import { buildCardCatalog, enrichGameStateAsync, collectMissingCardIds } from '../../utils/enrichGameCards'
import { mapRpcGameState } from '../../utils/mapGameState'
import { isGameWsEnabled } from '../../utils/gameWebSocket'
import { useGameTransport, wsConnectionLabel } from '../../hooks/useGameTransport'
import { useAblyChannel } from '../../hooks/useAblyChannel'
import { GAME_SYNC_EVENT, applyIncomingGameSync } from '../../utils/gameSync'
import { gameDebugLog, gameDebugSnapshot } from '../../utils/gameDebug'
import { useToasts } from '../../hooks/useToasts'
import { Toasts } from '../Shared/Toasts'

const GameBoard3D = lazy(() => import('./GameBoard3D'))

const DUPLICATE_LOAD_MS = 600
const POLL_INTERVAL_MS = 3000

export function GameScreen() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const guestId = getGuestId()
  const wsEnabled = isGameWsEnabled()

  const [game, setGame] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const { lands } = useLands()
  const { cards: catalogCards, loading: catalogLoading } = useCards()
  const cardCatalog = useMemo(() => buildCardCatalog(catalogCards), [catalogCards])
  const cardCatalogRef = useRef(cardCatalog)
  cardCatalogRef.current = cardCatalog

  const { toasts, toast, dismissToast } = useToasts()

  const landCatalog = useMemo(() => {
    const map = {}
    for (const land of lands || []) {
      if (land?.id) map[land.id] = land
    }
    return map
  }, [lands])

  const loadInFlightRef = useRef(null)
  const pendingReloadRef = useRef(null)
  const hasLoadedOnceRef = useRef(false)
  const catalogEnrichKeyRef = useRef('')
  const gameVersionRef = useRef(0)
  const gameRef = useRef(null)
  const suppressReloadUntilRef = useRef(0)
  const lastLoadMetaRef = useRef({ source: '', at: 0, version: 0 })

  const commitGameState = useCallback(
    (nextGame, source = 'commit') => {
      if (!nextGame) return false
      const nextVersion = nextGame.version ?? 0
      const currentVersion = gameVersionRef.current ?? 0
      if (nextVersion < currentVersion && currentVersion > 0) {
        gameDebugLog('skip', 'commit rejected (stale)', {
          source,
          nextVersion,
          currentVersion,
        })
        return false
      }

      gameVersionRef.current = nextVersion
      gameRef.current = nextGame
      catalogEnrichKeyRef.current = `${nextGame.id}:${nextGame.version}:${cardCatalogRef.current.size}`

      gameDebugLog('patch', 'commitGameState', {
        source,
        from: currentVersion,
        to: nextVersion,
        snapshot: gameDebugSnapshot(nextGame, gameVersionRef),
      })

      if (!hasLoadedOnceRef.current) {
        setGame(nextGame)
        setLoading(false)
        hasLoadedOnceRef.current = true
      } else {
        setGame(nextGame)
      }
      return true
    },
    []
  )

  const patchGame = useCallback((patcher, source = 'patchGame') => {
    setGame((prev) => {
      if (!prev) return prev
      const next = typeof patcher === 'function' ? patcher(prev) : { ...prev, ...patcher }
      if (!next || next === prev) return prev
      const v = next.version ?? prev.version ?? 0
      if (v <= (gameVersionRef.current ?? 0) && (gameVersionRef.current ?? 0) > 0) {
        gameDebugLog('skip', 'patchGame stale', { source, v, ref: gameVersionRef.current })
        return prev
      }
      gameVersionRef.current = Math.max(gameVersionRef.current ?? 0, v)
      gameRef.current = next
      catalogEnrichKeyRef.current = `${next.id}:${next.version}:${cardCatalogRef.current.size}`
      gameDebugLog('patch', source, {
        version: v,
        snapshot: gameDebugSnapshot(next, gameVersionRef),
      })
      return next
    })
  }, [])

  const loadGameInternal = useCallback(
    async (source = 'unknown') => {
      if (!gameId) return gameRef.current

      const startedAt = performance.now()
      gameDebugLog('load', 'start', {
        source,
        gameId,
        before: gameDebugSnapshot(gameRef.current, gameVersionRef),
      })

      await ensureGuestId()
      setError(null)

      const { data: state, error: rpcErr } = await supabase.rpc('get_player_game_state', {
        p_game_id: gameId,
        p_player_id: guestId,
      })

      if (rpcErr) throw new Error(rpcErr.message)
      if (!state) throw new Error('Игра не найдена или доступ запрещён')

      const mapped = mapRpcGameState(state)

      const catalog = cardCatalogRef.current
      const nextGame = catalog.size > 0
        ? await enrichGameStateAsync(mapped, catalog, supabase)
        : mapped

      const prevVersion = gameVersionRef.current ?? 0
      const committed = commitGameState(nextGame, `load:${source}`)
      const ms = Math.round(performance.now() - startedAt)

      gameDebugLog('load', committed ? 'done' : 'skipped (stale)', {
        source,
        ms,
        rpcVersion: state.version,
        prevVersion,
        nextVersion: nextGame.version,
        after: gameDebugSnapshot(gameRef.current, gameVersionRef),
      })

      return nextGame
    },
    [gameId, guestId, commitGameState]
  )

  const requestLoadGame = useCallback(
    async (source = 'unknown', { force = false } = {}) => {
      if (!gameId) return gameRef.current

      const now = Date.now()
      if (!force && now < suppressReloadUntilRef.current) {
        gameDebugLog('skip', 'load suppressed', {
          source,
          until: new Date(suppressReloadUntilRef.current).toISOString(),
        })
        return gameRef.current
      }

      const last = lastLoadMetaRef.current
      if (
        !force &&
        source === last.source &&
        now - last.at < DUPLICATE_LOAD_MS &&
        (gameVersionRef.current ?? 0) === last.version
      ) {
        gameDebugLog('skip', 'load duplicate', { source, ageMs: now - last.at })
        return gameRef.current
      }

      if (loadInFlightRef.current) {
        gameDebugLog('load', 'queue (in flight)', { source, pending: pendingReloadRef.current })
        pendingReloadRef.current = source
        await loadInFlightRef.current
        const pending = pendingReloadRef.current
        pendingReloadRef.current = null
        if (pending) {
          return requestLoadGame(pending, { force })
        }
        return gameRef.current
      }

      lastLoadMetaRef.current = {
        source,
        at: now,
        version: gameVersionRef.current ?? 0,
      }

      const run = async () => {
        try {
          return await loadGameInternal(source)
        } catch (err) {
          gameDebugLog('load', 'error', { source, error: err?.message || String(err) })
          setError(err.message || 'Не удалось загрузить игру')
          setLoading(false)
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
    [gameId, loadGameInternal]
  )

  const suppressRealtimeReload = useCallback((ms = 8000) => {
    suppressReloadUntilRef.current = Date.now() + ms
    gameDebugLog('suppress', `reload paused ${ms}ms`, {
      until: new Date(suppressReloadUntilRef.current).toISOString(),
    })
  }, [])

  useEffect(() => {
    if (catalogLoading || !game || cardCatalog.size === 0) return

    const enrichKey = `${game.id}:${game.version}:${cardCatalog.size}`
    const missing = collectMissingCardIds(game, cardCatalog)
    if (missing.length === 0) {
      catalogEnrichKeyRef.current = enrichKey
      return
    }
    if (catalogEnrichKeyRef.current === enrichKey) return

    let cancelled = false
    const baseVersion = game.version
    gameDebugLog('enrich', 'start', { enrichKey, missing: missing.length })

    ;(async () => {
      const next = await enrichGameStateAsync(game, cardCatalog, supabase)
      if (cancelled) return
      if ((gameRef.current?.version ?? 0) > (baseVersion ?? 0)) {
        gameDebugLog('enrich', 'skip (newer version loaded)', { baseVersion })
        return
      }
      if ((next.version ?? 0) < (gameVersionRef.current ?? 0)) {
        gameDebugLog('enrich', 'skip (stale)', { nextVersion: next.version })
        return
      }
      catalogEnrichKeyRef.current = enrichKey
      commitGameState(next, 'enrich:cards')
      gameDebugLog('enrich', 'done', { version: next.version })
    })()

    return () => {
      cancelled = true
    }
  }, [catalogLoading, cardCatalog, game, game?.id, game?.version, commitGameState])

  const reloadAfterAction = useCallback(
    (source = 'action', opts = {}) => requestLoadGame(`action:${source}`, opts),
    [requestLoadGame]
  )

  const applyIncomingRpcState = useCallback(
    async (rawState, source = 'ws:state') => {
      if (!rawState) return
      const mapped = mapRpcGameState(rawState)
      const catalog = cardCatalogRef.current
      const nextGame =
        catalog.size > 0 ? await enrichGameStateAsync(mapped, catalog, supabase) : mapped
      commitGameState(nextGame, source)
    },
    [commitGameState]
  )

  const transport = useGameTransport(gameId, guestId, {
    onState: (raw, msg) => {
      gameDebugLog('ws', 'state', { source: msg?.requestId ? 'action' : 'push', version: raw?.version })
      applyIncomingRpcState(raw, msg?.requestId ? 'ws:action' : 'ws:push')
    },
    onError: (message) => toast('error', message),
  })

  const gameActions = useMemo(
    () => ({ patchGame, cardCatalog, transport, suppressRealtimeReload }),
    [patchGame, cardCatalog, transport, suppressRealtimeReload]
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
    isApplying,
    error: actionError,
  } = useGameAction(game, reloadAfterAction, gameActions)

  const { reorderLands, confirmLandSetup } = useLandSetup(game, reloadAfterAction, { transport })

  useEffect(() => {
    if (actionError) toast('error', actionError)
  }, [actionError, toast])

  const syncCommitGame = useCallback(
    (nextGame) => commitGameState(nextGame, 'sync:patch'),
    [commitGameState]
  )

  const syncCtxRef = useRef({})
  syncCtxRef.current = {
    guestId,
    cardCatalog,
    getGame: () => gameRef.current,
    commitGame: syncCommitGame,
    requestLoadGame,
    gameVersionRef,
  }

  const handleAblySyncStable = useCallback((message) => {
    applyIncomingGameSync(message.data, syncCtxRef.current)
  }, [])

  const handleAblySubscribed = useCallback(() => {
    if (!hasLoadedOnceRef.current) {
      requestLoadGame('ably:subscribe-initial')
      return
    }
    gameDebugLog('ably', 'subscribed (skip load — already have state)', {
      version: gameVersionRef.current,
    })
  }, [requestLoadGame])

  const realtimeStatus = useAblyChannel({
    channelName: !wsEnabled && gameId ? `game:${gameId}` : null,
    eventName: GAME_SYNC_EVENT,
    onMessage: handleAblySyncStable,
    onSubscribed: handleAblySubscribed,
  })

  const connectionStatus = wsEnabled ? wsConnectionLabel(transport.status) : realtimeStatus

  useEffect(() => {
    if (wsEnabled || !gameId || loading || !game) return undefined

    let cancelled = false
    const pollVersion = async () => {
      const { data, error: pollErr } = await supabase
        .from('games')
        .select('version')
        .eq('id', gameId)
        .maybeSingle()

      if (cancelled) return
      if (pollErr) {
        gameDebugLog('poll', 'error', { error: pollErr.message })
        return
      }

      const remoteVersion = data?.version ?? 0
      const localVersion = gameVersionRef.current ?? 0

      if (remoteVersion <= localVersion) return

      gameDebugLog('poll', 'version ahead', { remoteVersion, localVersion })
      requestLoadGame('poll:version')
    }

    pollVersion()
    const timer = setInterval(pollVersion, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [gameId, loading, game, requestLoadGame, wsEnabled])

  useEffect(() => {
    if (!wsEnabled || !gameId) return undefined
    const timer = setTimeout(() => {
      if (!hasLoadedOnceRef.current) {
        gameDebugLog('ws', 'fallback load (no state yet)')
        requestLoadGame('ws:fallback', { force: true })
      }
    }, 12_000)
    return () => clearTimeout(timer)
  }, [wsEnabled, gameId, requestLoadGame])

  useEffect(() => {
    if (!gameId) return undefined
    if (wsEnabled) {
      hasLoadedOnceRef.current = false
      gameVersionRef.current = 0
      gameRef.current = null
      return undefined
    }
    hasLoadedOnceRef.current = false
    gameVersionRef.current = 0
    gameRef.current = null

    const frameId = requestAnimationFrame(() => {
      requestLoadGame('mount:gameId', { force: true })
    })
    return () => cancelAnimationFrame(frameId)
  }, [gameId, requestLoadGame, wsEnabled])

  if (loading) {
    return <div className="game-loading" role="status" aria-live="polite">Загружаем игру...</div>
  }

  if (error) {
    return (
      <main className="game-error" role="main" aria-live="assertive">
        <h1>Ошибка</h1>
        <p>{error}</p>
        <button onClick={() => navigate('/lobby')}>← Назад в лобби</button>
      </main>
    )
  }

  if (!game) {
    return <div className="game-loading" role="status" aria-live="polite">Игра не найдена</div>
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
          isApplying={isApplying}
          actionError={actionError}
          toast={toast}
        />
      </Suspense>
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
