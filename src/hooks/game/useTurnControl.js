/**
 * useTurnControl — управление ходом.
 *
 * Действия:
 *   - endTurn: сменить active player, draw-фаза (1 карта из deck_pile)
 *   - forfeit: сдаться (status='finished', winner_id = opponent)
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId, withGuestId } from '../../utils/guestSession'
import { safePlayer, safePlayers } from '../../utils/safePlayer'

export function useTurnControl(game, writeGameState, reload) {
  /**
   * End turn: switch to next player.
   * Computes simple alternation: player1 -> player2 -> player1.
   * Draw-фаза: новый активный добирает 1 карту из своего deck_pile в hand.
   */
  const endTurn = useCallback(async () => {
      if (!game?.players) return { error: 'Игра не загружена' }
      await ensureGuestId()

      // Пробуем атомарный RPC end_turn (миграция supabase/migrations/..._end_turn_rpc.sql).
      // Если RPC не существует (например, миграция не применена) — fallback на клиентский
      // writeGameState (менее надёжно, но работает).
      try {
        const { data, error: rpcErr } = await supabase.rpc('end_turn', {
          p_game_id: game.id,
          p_player_id: game.current_player_id,
        })
        console.log('[endTurn] RPC response:', { data, rpcErr })
        if (!rpcErr && data?.success) {
          if (writeGameState && typeof reload === 'function') {
            // Перечитаем state чтобы UI получил новую руку у нового активного
            await reload()
          }
          return { success: true }
        }
        // RPC не сработал — идём fallback'ом ниже
        if (rpcErr) {
          const msg = rpcErr.message || ''
          const isMissingFn = /function .* does not exist/i.test(msg)
          console.warn('[endTurn] RPC failed:', msg, '— fallback?', isMissingFn)
          if (!isMissingFn) {
            // Если RPC существует, но вернул реальную ошибку, не запускаем
            // клиентский fallback поверх потенциально уже изменённой игры: именно
            // это давало ложный «Конфликт версий» после нажатия кнопки.
            return { error: msg || 'Не удалось передать ход' }
          }
        } else if (!data?.success && data?.error) {
          console.warn('[endTurn] RPC returned error:', data.error)
          return { error: data.error }
        }
      } catch (e) {
        console.warn('[endTurn] RPC threw, falling back:', e?.message)
      }

      // === Fallback: клиентская логика (как раньше) ===
      const players = safePlayers(game.players)
      const currentIdx = players.findIndex((p) => p.player_id === game.current_player_id)
      if (currentIdx === -1) return { error: 'Активный игрок не найден' }
      const nextIdx = (currentIdx + 1) % players.length
      const nextPlayer = safePlayer(players, players[nextIdx]?.player_id)
      if (nextPlayer.__isFallback) return { error: 'Следующий игрок не найден' }

      const newLog = [
        ...(game.game_state?.log || []),
        {
          timestamp: Date.now(),
          message: `Ход переходит к ${nextPlayer.nickname || 'следующему'}`,
        },
      ]

      return writeGameState({
        current_player_id: nextPlayer.player_id,
        current_turn: (game.current_turn || 0) + 1,
        game_state: { log: newLog },
      })
    }, [game, writeGameState, reload])

  /**
     * Forfeit — сдаться. Текущий игрок выбывает (health=0). Игра продолжается
     * между оставшимися живыми; если остался ровно 1 — статус 'finished' и
     * winner_id = последний живой.
     * В 2-player работает как «проиграл сразу» (для обратной совместимости).
     *
     * Использует SECURITY DEFINER RPC `forfeit_game(p_guest_id, p_game_id)`.
     * RPC внутри делает set_config('app.guest_id', ...) и блокирует game
     * FOR UPDATE — атомарно. Fallback на клиентскую логику если RPC не
     * задеплоен (старая БД).
     */
    const forfeit = useCallback(async () => {
      if (!game?.players) return { error: 'Игра не загружена' }
      await ensureGuestId()
      const me = safePlayer(safePlayers(game.players), game.current_player_id)
      if (me.__isFallback) return { error: 'Сейчас не ваш ход' }

      // === RPC-путь (атомарный) ===
      try {
        const { data, error: rpcErr } = await supabase.rpc('forfeit_game', {
          p_guest_id: me.player_id,
          p_game_id: game.id,
        })
        console.log('[forfeit] RPC response:', { data, rpcErr })
        if (!rpcErr && data?.success) {
          if (writeGameState && typeof reload === 'function') await reload()
          return { success: true, finished: data.finished, winnerId: data.winner_id }
        }
        // RPC не сработал — fallback если функция просто не существует
        if (rpcErr && /function .* does not exist/i.test(rpcErr.message || '')) {
          console.warn('[forfeit] RPC not deployed — using fallback')
        } else if (rpcErr) {
          return { error: rpcErr.message }
        } else if (data?.error) {
          return { error: data.error }
        }
      } catch (e) {
        console.warn('[forfeit] RPC threw, falling back:', e?.message)
      }

      // === Fallback: клиентская логика (если RPC нет) ===
      // Помечаем сдавшегося как мёртвого (health = 0). Обёртка withGuestId
      // принудительно шлёт set_guest_id перед запросом, чтобы RLS пустил.
      const myHpRes = await withGuestId(() =>
        supabase
          .from('game_players')
          .update({ health: 0 })
          .eq('game_id', game.id)
          .eq('player_id', me.player_id)
      )
      if (myHpRes.error) return { error: myHpRes.error.message }

      // Считаем оставшихся живых (исключая меня — я только что сдался).
      const remaining = safePlayers(game.players).filter(
        (p) => p.player_id !== me.player_id && (p.health ?? 0) > 0
      )

      const newLog = [
        ...(game.game_state?.log || []),
        {
          timestamp: Date.now(),
          message: `${me?.nickname || 'Игрок'} сдался. Осталось в игре: ${remaining.length}.`,
        },
      ]

      // Если остался 1 живой — игра окончена, он победил.
      // Если 0 (только я был) — игра окончена, никто не победил (winner_id = null).
      // Если > 1 — игра продолжается; ход переходит к следующему живому.
      const patch = { game_state: { log: newLog } }
      if (remaining.length <= 1) {
        patch.status = 'finished'
        patch.winner_id = remaining[0]?.player_id || null
        patch.current_player_id = remaining[0]?.player_id || me.player_id
        patch.ended_at = new Date().toISOString()
      } else {
        const players = safePlayers(game.players)
        const myIdx = players.findIndex((p) => p.player_id === me.player_id)
        // Следующий живой по кругу. safePlayer защищает от sparse arrays.
        for (let i = 1; i <= players.length; i++) {
          const idx = (myIdx + i + players.length) % players.length
          const next = safePlayer(players, idx)
          if (next.__isFallback) continue
          if (next.player_id !== me.player_id && (next.health ?? 0) > 0) {
            patch.current_player_id = next.player_id
            patch.current_turn = (game.current_turn || 0) + 1
            break
          }
        }
      }

      return writeGameState(patch)
    }, [game, writeGameState, reload])

  return { endTurn, forfeit }
}