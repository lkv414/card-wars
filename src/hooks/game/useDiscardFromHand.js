/**
 * useDiscardFromHand — сброс карты из руки в discard_pile.
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId, withGuestId } from '../../utils/guestSession'
import { isRpcUnavailable, rpcUnavailableMessage } from './rpcUtils'
import { publishGameSync } from '../../utils/gameSync'

export function useDiscardFromHand(game, reload) {
  return useCallback(
    async (cardIndex) => {
      if (!game?.id) return { error: 'Игра не загружена' }
      await ensureGuestId()
      const me = game.players?.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }

      const { data, error: rpcErr } = await supabase.rpc('discard_from_hand', {
        p_game_id: game.id,
        p_player_id: me.player_id,
        p_card_index: cardIndex,
      })

      if (!rpcErr && data?.success) {
        if (typeof reload === 'function') await reload()
        await publishGameSync(game.id, {
          type: 'reload',
          version: data.version,
          actorId: me.player_id,
        })
        return { success: true }
      }

      if (rpcErr && !isRpcUnavailable(rpcErr)) {
        return { error: rpcErr.message }
      }
      if (data?.error) return { error: data.error }
      if (rpcErr && isRpcUnavailable(rpcErr)) {
        return { error: rpcUnavailableMessage('Сброс из руки') }
      }

      // Client fallback
      const hand = me.hand || []
      if (cardIndex < 0 || cardIndex >= hand.length) {
        return { error: 'Неверный индекс карты' }
      }
      const card = hand[cardIndex]
      const newHand = hand.filter((_, i) => i !== cardIndex)
      const discard = [...(me.discard_pile || []), card]

      const { error } = await withGuestId(() =>
        supabase
          .from('game_players')
          .update({ hand: newHand, discard_pile: discard })
          .eq('game_id', game.id)
          .eq('player_id', me.player_id)
      )
      if (error) return { error: error.message }
      if (typeof reload === 'function') await reload()
      return { success: true }
    },
    [game, reload]
  )
}
