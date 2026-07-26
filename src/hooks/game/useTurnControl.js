/**
 * useTurnControl — управление ходом.
 *
 * Действия:
 *   - endTurn: сменить active player, draw-фаза (1 карта из deck_pile)
 *   - forfeit: сдаться (status='finished', winner_id = opponent)
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { safePlayer, safePlayers } from '../../utils/safePlayer'

export function useTurnControl(game, writeGameState) {
  /**
   * End turn: switch to next player.
   * Computes simple alternation: player1 -> player2 -> player1.
   * Draw-фаза: новый активный добирает 1 карту из своего deck_pile в hand.
   */
  const endTurn = useCallback(async () => {
    if (!game?.players) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const players = safePlayers(game.players) // filter null/undefined + health: number
    const currentIdx = players.findIndex((p) => p.player_id === game.current_player_id)
    if (currentIdx === -1) return { error: 'Активный игрок не найден' }
    const nextPlayer = safePlayer(players, (currentIdx + 1) % players.length)

    // Draw-фаза: добрать 1 карту из deck_pile нового активного
    const nextDeckPile = Array.isArray(nextPlayer.deck_pile) ? [...nextPlayer.deck_pile] : []
    const nextHand = Array.isArray(nextPlayer.hand) ? [...nextPlayer.hand] : []
    const drewCard = nextDeckPile.length > 0
    if (drewCard) {
      nextHand.push(nextDeckPile.pop())
    }
    const nextDeckRemaining = nextDeckPile.length

    const newLog = [
      ...(game.game_state?.log || []),
      {
        timestamp: Date.now(),
        message: drewCard
          ? `Ход переходит к ${nextPlayer.nickname || 'следующему'} · добрал 1 карту`
          : `Ход переходит к ${nextPlayer.nickname || 'следующему'} · колода пуста`,
      },
    ]

    // Сохранить изменения руки нового активного игрока
    if (drewCard) {
      await supabase
        .from('game_players')
        .update({
          hand: nextHand,
          deck_pile: nextDeckPile,
          deck_remaining: nextDeckRemaining,
        })
        .eq('game_id', game.id)
        .eq('player_id', nextPlayer.player_id)
    }

    return writeGameState({
      current_player_id: nextPlayer.player_id,
      current_turn: (game.current_turn || 0) + 1,
      game_state: { log: newLog },
    })
  }, [game, writeGameState])

  /**
   * Forfeit — сдаться. Текущий игрок выбывает (health=0). Игра продолжается
   * между оставшимися живыми; если остался ровно 1 — статус 'finished' и
   * winner_id = последний живой.
   * В 2-player работает как «проиграл сразу» (для обратной совместимости).
   */
  const forfeit = useCallback(async () => {
    if (!game?.players) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const me = safePlayer(safePlayers(game.players), game.current_player_id)
    if (me.__isFallback) return { error: 'Сейчас не ваш ход' }

    // Помечаем сдавшегося как мёртвого (health = 0).
    const myHpRes = await supabase
      .from('game_players')
      .update({ health: 0 })
      .eq('game_id', game.id)
      .eq('player_id', me.player_id)
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
  }, [game, writeGameState])

  return { endTurn, forfeit }
}