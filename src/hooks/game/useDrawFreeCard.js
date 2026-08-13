/**
 * useDrawFreeCard — бесплатный добор 1 карты (1 раз за ход).
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { isRpcUnavailable, rpcUnavailableMessage } from './rpcUtils'
import { normalizeDrawRpcData } from '../../utils/gameStatePatch'
import { publishGameSync } from '../../utils/gameSync'

export function useDrawFreeCard(game, reload) {
  return useCallback(async () => {
    if (!game?.id) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const me = game.players?.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }

    const { data, error: rpcErr } = await supabase.rpc('draw_free_card', {
      p_game_id: game.id,
      p_player_id: me.player_id,
    })

    if (rpcErr) {
      if (isRpcUnavailable(rpcErr)) {
        return { error: rpcUnavailableMessage('Бесплатный добор') }
      }
      return { error: rpcErr.message }
    }
    if (data?.error) return { error: data.error }

    // RPC не возвращает hand — перечитываем полное состояние (как до Ably).
    if (typeof reload === 'function') {
      await reload('draw-free', { force: true })
    }

    await publishGameSync(game.id, {
      type: 'draw',
      version: data.version,
      actorId: me.player_id,
      playerId: me.player_id,
      rpcData: normalizeDrawRpcData(data),
    })

    return { success: true, draw_type: 'free' }
  }, [game, reload])
}
