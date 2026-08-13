/**
 * useDiscardFromZone — убрать карту с земли в сброс.
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId, withGuestId } from '../../utils/guestSession'
import { clampZones, normalizePlayerZoneRows, normalizeZoneCards } from './format.js'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

/**
 * applyDiscardFromZonePatch — remove card from zone and add to discard.
 */
function applyDiscardFromZonePatch(game, playerId, zoneIndex, cardId) {
  if (!game?.players) return game

  return {
    ...game,
    version: (game.version ?? 0) + 1,
    players: game.players.map((player) => {
      if (player.player_id !== playerId) return player

      const zoneRows = normalizePlayerZoneRows(player.zones)
      const zone = zoneRows[zoneIndex]
      if (!zone) return player

      const cards = normalizeZoneCards(zone)
      const card = cards.find((c) => c.id === cardId || c.instanceId === cardId)
      if (!card) return player

      const newCards = cards.filter((c) => c.id !== cardId && c.instanceId !== cardId)
      const discard = [...(player.discard_pile || []), card]

      zoneRows[zoneIndex] = { ...zone, cards: newCards }

      return {
        ...player,
        zones: zoneRows,
        discard_pile: discard,
      }
    }),
  }
}

export function useDiscardFromZone(game, _writeGameState, reload, { patchGame, transport, suppressRealtimeReload } = {}) {
  return useCallback(
    async (zoneIndex, cardId) => {
      if (!game?.players) return { error: 'Игра не загружена' }
      await ensureGuestId()
      const me = game.players.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }

      const ws = await runViaTransport(transport, 'discard_from_zone', {
        zonePosition: zoneIndex + 1,
        cardId: String(cardId),
      })
      const wsErr = transportError(ws)
      if (wsErr) return wsErr
      const wsOk = transportOk(ws)
      if (wsOk) return wsOk

      try {
        const { data, error: rpcErr } = await supabase.rpc('discard_from_zone', {
          p_game_id: game.id,
          p_player_id: me.player_id,
          p_zone_position: zoneIndex + 1,
          p_card_id: String(cardId),
        })
        if (!rpcErr && data?.success) {
          if (typeof patchGame === 'function') {
            patchGame((state) => applyDiscardFromZonePatch(state, me.player_id, zoneIndex, cardId))
          }

          // Suppress realtime reload for 4s
          if (typeof suppressRealtimeReload === 'function') {
            suppressRealtimeReload(4000)
          }

          await publishGameSync(game.id, {
            type: 'discard_from_zone',
            version: data.version,
            actorId: me.player_id,
            playerId: me.player_id,
            zoneIndex,
            cardId,
            rpcData: data,
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

      if (typeof patchGame === 'function') {
        patchGame((state) => applyDiscardFromZonePatch(state, me.player_id, zoneIndex, cardId))
      }

      if (typeof suppressRealtimeReload === 'function') {
        suppressRealtimeReload(4000)
      }

      await publishGameSync(game.id, {
        type: 'discard_from_zone',
        version: (game.version ?? 0) + 1,
        actorId: me.player_id,
        playerId: me.player_id,
        zoneIndex,
        cardId,
      })
      return { success: true }
    },
    [game, reload, patchGame, transport, suppressRealtimeReload]
  )
}
