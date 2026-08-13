/**
 * useDiscardFromZone — убрать карту с земли в сброс.
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId, withGuestId } from '../../utils/guestSession'
import { clampZones } from './format'
import { publishGameSync } from '../../utils/gameSync'

export function useDiscardFromZone(game, _writeGameState, reload) {
  return useCallback(
    async (zoneIndex, cardId) => {
      if (!game?.players) return { error: 'Игра не загружена' }
      await ensureGuestId()
      const me = game.players.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }

      try {
        const { data, error: rpcErr } = await supabase.rpc('discard_from_zone', {
          p_game_id: game.id,
          p_player_id: me.player_id,
          p_zone_position: zoneIndex + 1,
          p_card_id: String(cardId),
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
        if (rpcErr && !/function .* does not exist/i.test(rpcErr.message || '')) {
          return { error: rpcErr.message }
        }
        if (data?.error) return { error: data.error }
      } catch (e) {
        console.warn('[useDiscardFromZone] RPC threw:', e?.message)
      }

      const zones = clampZones(me.zones)
      const zoneCards = zones[zoneIndex] || []
      const removed = zoneCards.find((c) => c.id === cardId || c.instanceId === cardId)
      if (!removed) return { error: 'Карта не найдена на земле' }

      const newZone = zoneCards.filter((c) => c.id !== cardId && c.instanceId !== cardId)
      const discard = [...(me.discard_pile || []), removed]

      const [zonesRes, playersRes] = await withGuestId(() =>
        Promise.all([
          supabase
            .from('game_zones')
            .update({ cards: newZone })
            .eq('game_id', game.id)
            .eq('player_id', me.player_id)
            .eq('zone_position', zoneIndex + 1),
          supabase
            .from('game_players')
            .update({ discard_pile: discard })
            .eq('game_id', game.id)
            .eq('player_id', me.player_id),
        ])
      )

      const err = zonesRes.error || playersRes.error
      if (err) return { error: `Сброс не сохранился: ${err.message || err}` }
      if (typeof reload === 'function') await reload()
      await publishGameSync(game.id, {
        type: 'reload',
        version: (game.version ?? 0) + 1,
        actorId: me.player_id,
      })
      return { success: true }
    },
    [game, reload]
  )
}
