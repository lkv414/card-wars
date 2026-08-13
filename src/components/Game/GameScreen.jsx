/**
 * GameScreen
 * Загружает gameState из Supabase по gameId.
 * Синхронизация между игроками — Ably pub/sub (без Supabase Realtime).
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
import { useAblyChannel } from '../../hooks/useAblyChannel'
import { GAME_SYNC_EVENT, applyIncomingGameSync } from '../../utils/gameSync'
import { useToasts } from '../../hooks/useToasts'
import { Toasts } from '../Shared/Toasts'

const GameBoard3D = lazy(() => import('./GameBoard3D'))

export function GameScreen() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const guestId = getGuestId()

  const [game, setGame] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const { lands } = useLands()
  const { cards: catalogCards, loading: catalogLoading } = useCards()
  const cardCatalog = useMemo(() => buildCardCatalog(catalogCards), [catalogCards])
  const { toasts, toast, dismissToast } = useToasts()

  const landCatalog = useMemo(() => {
    const map = {}
    for (const land of lands || []) {
      if (land?.id) map[land.id] = land
    }
    return map
  }, [lands])

  const loadInFlightRef = useRef(null)
  const pendingReloadRef = useRef(false)
  const hasLoadedOnceRef = useRef(false)
  const catalogEnrichKeyRef = useRef('')
  const gameVersionRef = useRef(0)
  const gameRef = useRef(null)

  const commitGameState = useCallback(
    (nextGame) => {
      if (!nextGame) return false
      const nextVersion = nextGame.version ?? 0
      const currentVersion = gameVersionRef.current ?? 0
      if (nextVersion < currentVersion && currentVersion > 0) return false

      gameVersionRef.current = nextVersion
      gameRef.current = nextGame
      catalogEnrichKeyRef.current = `${nextGame.id}:${nextGame.version}:${cardCatalog.size}`

      if (!hasLoadedOnceRef.current) {
        setGame(nextGame)
        setLoading(false)
        hasLoadedOnceRef.current = true
      } else {
        setGame(nextGame)
      }
      return true
    },
    [cardCatalog.size]
  )

  const patchGame = useCallback(
    (patcher) => {
      setGame((prev) => {
        if (!prev) return prev
        const next = typeof patcher === 'function' ? patcher(prev) : { ...prev, ...patcher }
        if (!next || next === prev) return prev
        const v = next.version ?? prev.version ?? 0
        gameVersionRef.current = Math.max(gameVersionRef.current ?? 0, v)
        gameRef.current = next
        catalogEnrichKeyRef.current = `${next.id}:${next.version}:${cardCatalog.size}`
        return next
      })
    },
    [cardCatalog.size]
  )

  const loadGame = useCallback(async () => {
    if (!gameId) return gameRef.current

    if (loadInFlightRef.current) {
      pendingReloadRef.current = true
      await loadInFlightRef.current
      if (pendingReloadRef.current) {
        pendingReloadRef.current = false
        return loadGame()
      }
      return gameRef.current
    }

    const run = async () => {
      await ensureGuestId()
      setError(null)
      try {
        const { data: state, error: rpcErr } = await supabase.rpc('get_player_game_state', {
          p_game_id: gameId,
          p_player_id: guestId,
        })

        if (rpcErr) throw new Error(rpcErr.message)
        if (!state) throw new Error('Игра не найдена или доступ запрещён')

        const mapped = {
          id: state.id,
          lobby_id: state.lobby_id,
          status: state.status,
          current_turn: state.current_turn,
          current_player_id: state.current_player_id,
          winner_id: state.winner_id,
          game_state: state.game_state,
          actions_remaining: state.actions_remaining,
          version: state.version,
          started_at: state.started_at,
          ended_at: state.ended_at,
          players: (state.players || []).map((p) => ({
            ...p,
            actions_remaining: p.actions_remaining ?? 2,
            free_draw_used: p.free_draw_used ?? false,
            paid_draw_used: p.paid_draw_used ?? false,
            zones: Array.isArray(p.zones)
              ? p.zones
                  .sort((a, b) => a.zone_position - b.zone_position)
                  .map((z) => ({
                    zone_position: z.zone_position,
                    cards: z.cards || [],
                    land_id: z.land_id ?? null,
                    land_type: z.land_type ?? null,
                    land_name: z.land_name ?? null,
                  }))
              : [],
          })),
        }

        const nextGame = await enrichGameStateAsync(mapped, cardCatalog, supabase)
        commitGameState(nextGame)
        return nextGame
      } catch (err) {
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
  }, [gameId, guestId, cardCatalog, commitGameState])

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
    ;(async () => {
      const next = await enrichGameStateAsync(game, cardCatalog, supabase)
      if (cancelled) return
      if ((gameRef.current?.version ?? 0) > (baseVersion ?? 0)) return
      if ((next.version ?? 0) < (gameVersionRef.current ?? 0)) return
      catalogEnrichKeyRef.current = enrichKey
      commitGameState(next)
    })()

    return () => {
      cancelled = true
    }
  }, [catalogLoading, cardCatalog, game, game?.id, game?.version, commitGameState])

  const reloadAfterAction = useCallback(() => {
    loadGame()
  }, [loadGame])

  const gameActions = useMemo(
    () => ({ patchGame, cardCatalog }),
    [patchGame, cardCatalog]
  )

  const { playCard, attack, drawCard, drawFreeCard, shuffleDeck, discardFromHand, endTurn, forfeit, flipCard, discardFromZone, isApplying, error: actionError } = useGameAction(
    game,
    reloadAfterAction,
    gameActions
  )
  const { reorderLands, confirmLandSetup } = useLandSetup(game, reloadAfterAction)

  useEffect(() => {
    if (actionError) toast('error', actionError)
  }, [actionError, toast])

  const syncCommitGame = useCallback(
    (nextGame) => {
      if (!nextGame) return false
      const nextVersion = nextGame.version ?? 0
      const currentVersion = gameVersionRef.current ?? 0
      if (nextVersion > 0 && nextVersion <= currentVersion && currentVersion > 0) return false

      gameVersionRef.current = Math.max(currentVersion, nextVersion)
      gameRef.current = nextGame
      catalogEnrichKeyRef.current = `${nextGame.id}:${nextGame.version}:${cardCatalog.size}`
      setGame(nextGame)
      return true
    },
    [cardCatalog.size]
  )

  const syncCtxRef = useRef({
    guestId,
    cardCatalog,
    getGame: () => gameRef.current,
    commitGame: syncCommitGame,
    loadGame,
    gameVersionRef,
  })
  syncCtxRef.current = {
    guestId,
    cardCatalog,
    getGame: () => gameRef.current,
    commitGame: syncCommitGame,
    loadGame,
    gameVersionRef,
  }

  const handleAblySyncStable = useCallback((message) => {
    applyIncomingGameSync(message.data, syncCtxRef.current)
  }, [])

  const handleAblySubscribed = useCallback(() => {
    loadGame()
  }, [loadGame])

  const realtimeStatus = useAblyChannel({
    channelName: gameId ? `game:${gameId}` : null,
    eventName: GAME_SYNC_EVENT,
    onMessage: handleAblySyncStable,
    onSubscribed: handleAblySubscribed,
  })

  useEffect(() => {
    if (!gameId || loading) return undefined

    let cancelled = false
    const pollVersion = async () => {
      const { data } = await supabase.from('games').select('version').eq('id', gameId).maybeSingle()
      if (cancelled || !data) return
      const remoteVersion = data.version ?? 0
      const localVersion = gameVersionRef.current ?? 0
      if (remoteVersion > localVersion) {
        loadGame()
      }
    }

    pollVersion()
    const timer = setInterval(pollVersion, 2500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [gameId, loading, loadGame])

  useEffect(() => {
    if (gameId) {
      const frameId = requestAnimationFrame(() => {
        loadGame()
      })
      return () => cancelAnimationFrame(frameId)
    }
  }, [gameId, loadGame])

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
          realtimeStatus={realtimeStatus}
          isApplying={isApplying}
          actionError={actionError}
          toast={toast}
        />
      </Suspense>
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
