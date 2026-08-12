/**
 * useShuffleDeck — перемешать руку + колоду; при пустой колоде — сброс в колоду.
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { isRpcUnavailable, rpcUnavailableMessage } from './rpcUtils'

export function useShuffleDeck(game, reload) {
  return useCallback(async () => {
    if (!game?.id) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const me = game.players?.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }

    const { data, error: rpcErr } = await supabase.rpc('shuffle_deck', {
      p_game_id: game.id,
      p_player_id: me.player_id,
    })

    if (rpcErr) {
      if (isRpcUnavailable(rpcErr)) {
        return { error: rpcUnavailableMessage('Перемешивание колоды') }
      }
      return { error: rpcErr.message }
    }
    if (data?.error) return { error: data.error }

    if (typeof reload === 'function') await reload()
    return { success: true }
  }, [game, reload])
}
