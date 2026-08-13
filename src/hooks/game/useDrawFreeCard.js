/**
 * useDrawFreeCard — бесплатный добор 1 карты (1 раз за ход).
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { isRpcUnavailable, rpcUnavailableMessage } from './rpcUtils'
import { applyDrawPatch, normalizeDrawRpcData, sanitizeDrawRpcDataForSync } from '../../utils/gameStatePatch'
import { getGuestId } from '../../utils/guestId'

import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useDrawFreeCard(game, _reload, { patchGame, transport, suppressRealtimeReload } = {}) {
  return useCallback(async () => {
    if (!game?.id) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const me = game.players?.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }

    const ws = await runViaTransport(transport, 'draw_free', {})
    const wsErr = transportError(ws)
    if (wsErr) return wsErr
    const wsOk = transportOk(ws, { draw_type: 'free' })
    if (wsOk) return wsOk

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

    const rpcData = normalizeDrawRpcData(data)
    if (typeof patchGame === 'function') {
      patchGame((state) => applyDrawPatch(state, me.player_id, rpcData, getGuestId()))
    }

    // Suppress realtime reload for 8s to avoid visual conflict with local patch
    if (typeof suppressRealtimeReload === 'function') {
      suppressRealtimeReload(8000)
    }

    return { success: true, draw_type: 'free' }
  }, [game, patchGame, transport, suppressRealtimeReload])
}
