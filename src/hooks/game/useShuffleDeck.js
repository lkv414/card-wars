/**
 * useShuffleDeck — перемешать руку + колоду; при пустой колоде — сброс в колоду.
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { isRpcUnavailable, rpcUnavailableMessage } from './rpcUtils'
import { ALLOW_CLIENT_FALLBACK } from '../../utils/featureFlags'

import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useShuffleDeck(game, reload, { transport } = {}) {
  return useCallback(async () => {
    if (!game?.id) return { error: 'Игра не загружена' }
    await ensureGuestId()
    const me = game.players?.find((p) => p.player_id === game.current_player_id)
    if (!me) return { error: 'Сейчас не ваш ход' }

    const ws = await runViaTransport(transport, 'shuffle_deck', {})
    const wsErr = transportError(ws)
    if (wsErr) return wsErr
    const wsOk = transportOk(ws)
    if (wsOk) return wsOk
    // Worker — единственный авторитет. SQL RPC допускается только под флагом.
    if (!ALLOW_CLIENT_FALLBACK) {
      return { error: 'Перемешивание колоды недоступно (обновите сервер)' }
    }

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
  }, [game, reload, transport])
}
