/**
 * useTurnControl — управление ходом.
 *
 * endTurn / forfeit идут через SECURITY DEFINER RPC (end_turn / forfeit_game),
 * чтобы:
 *  - обойти RLS при доборе карты следующему игроку
 *  - атомарно сменить current_player_id + version без гонки optimistic lock
 *  - не зависеть от SET LOCAL app.guest_id между HTTP-запросами
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { getGuestId } from '../../utils/guestId'

export function useTurnControl(game, writeGameState, reload) {
  const endTurn = useCallback(async () => {
    if (!game?.id) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const guestId = getGuestId()
    if (!guestId) return { error: 'Нет guest_id' }

    if (game.current_player_id && game.current_player_id !== guestId) {
      return { error: 'Сейчас не ваш ход' }
    }

    try {
      const { data, error } = await supabase.rpc('end_turn', {
        p_guest_id: guestId,
        p_game_id: game.id,
      })

      if (error) {
        return { error: error.message || 'Не удалось закончить ход' }
      }
      if (data?.error) {
        return { error: data.error }
      }

      if (typeof reload === 'function') {
        await reload()
      }
      return {
        success: true,
        version: data?.version,
        current_player_id: data?.current_player_id,
      }
    } catch (err) {
      return { error: err?.message || 'Не удалось закончить ход' }
    }
  }, [game, reload])

  const forfeit = useCallback(async () => {
    if (!game?.id) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const guestId = getGuestId()
    if (!guestId) return { error: 'Нет guest_id' }

    if (game.current_player_id && game.current_player_id !== guestId) {
      return { error: 'Сейчас не ваш ход' }
    }

    try {
      const { data, error } = await supabase.rpc('forfeit_game', {
        p_guest_id: guestId,
        p_game_id: game.id,
      })

      if (error) {
        return { error: error.message || 'Не удалось сдаться' }
      }
      if (data?.error) {
        return { error: data.error }
      }

      if (typeof reload === 'function') {
        await reload()
      }
      return { success: true, ...data }
    } catch (err) {
      return { error: err?.message || 'Не удалось сдаться' }
    }
  }, [game, reload])

  return { endTurn, forfeit }
}
