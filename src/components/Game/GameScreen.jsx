/**
 * GameScreen
 * Загружает gameState из Supabase по gameId и передаёт в GameBoard.
 * Подписывается на изменения games/game_zones через Realtime.
 *
 * Структура `game` для GameBoard (см. GameBoard.jsx):
 *   game = {
 *     id, lobby_id, status, current_turn, current_player_id,
 *     game_state: { status, currentTurn, currentPlayerId, turnPhase, log },
 *     players: [{ id, player_id, nickname, position, health, hand, zones,
 *                deck_remaining, player_order }],
 *   }
 */
import { lazy, Suspense, useEffect, useState, useCallback, useMemo, useRef, startTransition } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../utils/supabase'
import { getGuestId } from '../../utils/guestId'
import { ensureGuestId } from '../../utils/guestSession'
import { useGameAction } from '../../hooks/game'
import { useLandSetup } from '../../hooks/game/useLandSetup'
import { useLands } from '../../hooks/useLands'
import { useRealtimeChannel } from '../../hooks/useRealtimeChannel'
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
  const realtimeSuppressUntilRef = useRef(0)
  const reloadTimerRef = useRef(null)

  const suppressRealtimeReload = useCallback((ms = 2000) => {
    realtimeSuppressUntilRef.current = Date.now() + ms
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = null
    }
  }, [])

  const loadGame = useCallback(async () => {
    if (!gameId) return null

    if (loadInFlightRef.current) {
      pendingReloadRef.current = true
      return loadInFlightRef.current
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

        const nextGame = {
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
        if (!hasLoadedOnceRef.current) {
          setGame(nextGame)
          setLoading(false)
          hasLoadedOnceRef.current = true
        } else {
          startTransition(() => setGame(nextGame))
        }
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
      if (pendingReloadRef.current) {
        pendingReloadRef.current = false
        queueMicrotask(() => loadGame())
      }
    }
  }, [gameId, guestId])

  /** После RPC reload — не дублировать через Realtime (debounce 500ms). */
  const reloadAfterAction = useCallback(async () => {
    suppressRealtimeReload(2500)
    return loadGame()
  }, [loadGame, suppressRealtimeReload])

  const { playCard, attack, drawCard, endTurn, forfeit, flipCard, discardFromZone, isApplying, error: actionError } = useGameAction(game, reloadAfterAction)
  const { reorderLands, confirmLandSetup } = useLandSetup(game, reloadAfterAction)

  useEffect(() => {
    if (actionError) toast('error', actionError)
  }, [actionError, toast])

  // Debounced reload: одна атака правит 3 таблицы → 3 realtime callback'а.
  // Без debounce получается 3+ reload RPC подряд. С debounce (500мс) —
  // несколько событий коалесцируются в один reload.
  const debouncedLoad = useCallback(() => {
    if (Date.now() < realtimeSuppressUntilRef.current) return
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null
      if (Date.now() < realtimeSuppressUntilRef.current) return
      loadGame()
    }, 500)
  }, [loadGame])

  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
    }
  }, [])

  // Initial load при монтировании если gameId есть
  useEffect(() => {
    if (gameId) {
      // Используем requestAnimationFrame чтобы избежать синхронного setState в useEffect
      const frameId = requestAnimationFrame(() => {
        loadGame()
      })
      return () => cancelAnimationFrame(frameId)
    }
  }, [gameId, loadGame])

  // Realtime subscription (с state machine + reconnect)
  const realtimeStatus = useRealtimeChannel({
    channelName: gameId ? `game:${gameId}` : null,
    subscriptions: useMemo(() => {
      if (!gameId) return []
      const onChange = debouncedLoad
      return [
        { table: 'games', filter: `id=eq.${gameId}`, callback: onChange },
        { table: 'game_players', filter: `game_id=eq.${gameId}`, callback: onChange },
        { table: 'game_zones', filter: `game_id=eq.${gameId}`, callback: onChange },
      ]
    }, [gameId, debouncedLoad]),
  })

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
          onDrawCard={drawCard}
          onFlipCard={flipCard}
          onDiscardFromZone={discardFromZone}
          onEndTurn={endTurn}
          onReloadGame={loadGame}
          onSuppressRealtimeReload={suppressRealtimeReload}
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
