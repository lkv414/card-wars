/**
 * useDrawCard — взять 1 карту из колоды за 1 действие.
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { isRpcUnavailable, rpcUnavailableMessage } from './rpcUtils'
import { applyDrawPatch } from '../../utils/gameStatePatch'
import { publishGameSync } from '../../utils/gameSync'
import { getGuestId } from '../../utils/guestId'

export function useDrawCard(game, reload, { patchGame } = {}) {
  return useCallback(async () => {
    if (!game?.id) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const me = game.players?.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }

    const { data, error: rpcErr } = await supabase.rpc('draw_card_for_action', {
      p_game_id: game.id,
      p_player_id: me.player_id,
    })

    if (rpcErr) {
      if (isRpcUnavailable(rpcErr)) {
        return { error: rpcUnavailableMessage('Добор карт') }
      }
      return { error: rpcErr.message }
    }
    if (data?.error) return { error: data.error }

    if (typeof patchGame === 'function') {
      patchGame((state) => applyDrawPatch(state, me.player_id, data, getGuestId()))
    }
    if (typeof reload === 'function') await reload()

    await publishGameSync(game.id, {
      type: 'draw',
      version: data.version,
      actorId: me.player_id,
      playerId: me.player_id,
      rpcData: data,
    })

    return {
      success: true,
      actions_remaining: data.actions_remaining,
      hand_count: data.hand_count,
    }
  }, [game, reload, patchGame])
}
