import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId, withGuestId } from '../../utils/guestSession'
import { isRpcUnavailable, rpcUnavailableMessage } from './rpcUtils'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

/**
 * applyDiscardFromHandPatch — remove card from hand and add to discard.
 */
function applyDiscardFromHandPatch(game, playerId, cardIndex) {
  if (!game?.players) return game

  return {
    ...game,
    version: (game.version ?? 0) + 1,
    players: game.players.map((player) => {
      if (player.player_id !== playerId) return player
      
      const hand = [...(player.hand || [])]
      if (cardIndex < 0 || cardIndex >= hand.length) return player
      
      const [card] = hand.splice(cardIndex, 1)
      const discard = [...(player.discard_pile || []), card]
      
      return {
        ...player,
        hand,
        discard_pile: discard,
      }
    }),
  }
}

export function useDiscardFromHand(game, reload, { patchGame, transport, suppressRealtimeReload } = {}) {
  return useCallback(
    async (cardIndex) => {
      if (!game?.id) return { error: 'Игра не загружена' }
      await ensureGuestId()
      const me = game.players?.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }

      const ws = await runViaTransport(transport, 'discard_from_hand', { cardIndex })
      const wsErr = transportError(ws)
      if (wsErr) return wsErr
      const wsOk = transportOk(ws)
      if (wsOk) return wsOk

      const { data, error: rpcErr } = await supabase.rpc('discard_from_hand', {
        p_game_id: game.id,
        p_player_id: me.player_id,
        p_card_index: cardIndex,
      })

      if (!rpcErr && data?.success) {
        if (typeof patchGame === 'function') {
          patchGame((state) => applyDiscardFromHandPatch(state, me.player_id, cardIndex))
        }

        // Suppress realtime reload for 3s to prevent flicker
        if (typeof suppressRealtimeReload === 'function') {
          suppressRealtimeReload(3000)
        }
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

      if (typeof patchGame === 'function') {
        patchGame((state) => applyDiscardFromHandPatch(state, me.player_id, cardIndex))
      }

      if (typeof suppressRealtimeReload === 'function') {
        suppressRealtimeReload(3000)
      }

      return { success: true }
    },
    [game, patchGame, transport, suppressRealtimeReload]
  )
}
