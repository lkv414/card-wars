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

export function useTurnControl(game, writeGameState) {
  /**
   * End turn: switch to next player.
   * Computes simple alternation: player1 -> player2 -> player1.
   * Draw-фаза: новый активный добирает 1 карту из своего deck_pile в hand.
   */
  const endTurn = useCallback(async () => {
    if (!game?.players) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const players = game.players
    const currentIdx = players.findIndex((p) => p.player_id === game.current_player_id)
    if (currentIdx === -1) return { error: 'Активный игрок не найден' }
    const nextPlayer = players[(currentIdx + 1) % players.length]

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
   * Forfeit — сдаться. Текущий игрок проигрывает, оппонент побеждает.
   * Триггер validate_game_before_write требует winner_id при status='finished',
   * что мы обеспечиваем.
   */
  const forfeit = useCallback(async () => {
    if (!game?.players) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const me = game.players.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }
    const opponent = game.players.find((p) => p.player_id !== me.player_id)
    if (!opponent) return { error: 'Противник не найден' }

    const newLog = [
      ...(game.game_state?.log || []),
      {
        timestamp: Date.now(),
        message: `${me.nickname || 'Игрок'} сдался. Победил ${opponent.nickname || 'противник'}.`,
      },
    ]

    return writeGameState({
      status: 'finished',
      winner_id: opponent.player_id,
      current_player_id: opponent.player_id,
      ended_at: new Date().toISOString(),
      game_state: { log: newLog },
    })
  }, [game, writeGameState])

  return { endTurn, forfeit }
}