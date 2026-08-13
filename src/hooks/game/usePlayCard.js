/**

 * usePlayCard — розыгрыш карты из руки в слот зоны (существо или строение).

 */



import { useCallback } from 'react'

import { supabase } from '../../utils/supabase'

import { ensureGuestId, withGuestId } from '../../utils/guestSession'

import { canPlayCardToSlot, getCardSlotType } from './zoneCards'

import { clampZones } from './format'

import { isRpcUnavailable } from './rpcUtils'

import { ALLOW_CLIENT_FALLBACK } from '../../utils/featureFlags'

import { getCardCost } from '../../utils/cardFields.ts'

import { applyPlayCardPatch } from '../../utils/gameStatePatch'
import { publishGameSync, enrichZoneCardsForSync } from '../../utils/gameSync'
import { runViaTransport, transportError, transportOk } from './runViaTransport'



export function usePlayCard(game, _writeGameState, _reload, { patchGame, cardCatalog, transport } = {}) {

  return useCallback(

    async (cardIndex, zoneIndex, _actionCost = 1, slotType = null) => {

      if (!game?.players) return { error: 'Игра не загружена' }

      await ensureGuestId()

      const me = game.players.find((p) => p.player_id === game.current_player_id)

      if (!me) return { error: 'Сейчас не ваш ход' }



      const hand = me.hand || []

      if (cardIndex < 0 || cardIndex >= hand.length) return { error: 'Неверный индекс карты' }

      const card = hand[cardIndex]

      const slot = slotType || getCardSlotType(card)

      const actionCost = getCardCost(card)



      const actionsLeft = me.actions_remaining ?? game.actions_remaining ?? 2

      if (actionsLeft < actionCost) {

        return { error: `Недостаточно действий (нужно ${actionCost}, осталось ${actionsLeft})` }

      }



      const zones = clampZones(me.zones)

      const zoneCards = zones[zoneIndex] || []

      if (!canPlayCardToSlot(zoneCards, card)) {

        if (slot === 'building') return { error: 'Слот строения занят или карта не подходит' }

        return { error: 'Слот существа занят или карта не подходит' }

      }



      const ws = await runViaTransport(transport, 'play_card', {
        cardIndex,
        zonePosition: zoneIndex + 1,
        slotType: slot,
      })
      const wsErr = transportError(ws)
      if (wsErr) return wsErr
      const wsOk = transportOk(ws)
      if (wsOk) return wsOk



      try {

        const baseArgs = {

          p_game_id: game.id,

          p_player_id: me.player_id,

          p_card_index: cardIndex,

          p_zone_position: zoneIndex + 1,

        }



        let data = null

        let rpcErr = null



        ;({ data, error: rpcErr } = await supabase.rpc('play_card', {

          ...baseArgs,

          p_slot_type: slot,

        }))



        if (rpcErr && isRpcUnavailable(rpcErr)) {

          ;({ data, error: rpcErr } = await supabase.rpc('play_card', baseArgs))

        }



        if (!rpcErr && data?.success) {

          const nextState = applyPlayCardPatch(

            game,

            me.player_id,

            cardIndex,

            zoneIndex,

            slot,

            data,

            cardCatalog

          )

          if (typeof patchGame === 'function') {

            patchGame(() => nextState)

          }

          const playerAfter = nextState.players.find((p) => p.player_id === me.player_id)
          const zoneSnapshot = enrichZoneCardsForSync(
            playerAfter?.zones?.[zoneIndex]?.cards ?? [],
            cardCatalog
          )
          await publishGameSync(game.id, {
            type: 'play_card',
            version: data.version,
            actorId: me.player_id,
            playerId: me.player_id,
            cardIndex,
            zoneIndex,
            slotType: slot,
            rpcData: data,
            zoneCards: zoneSnapshot,
          })

          return { success: true }

        }

        if (rpcErr) {

          if (!isRpcUnavailable(rpcErr)) {

            return { error: rpcErr.message }

          }

          if (!ALLOW_CLIENT_FALLBACK) {

            return { error: 'Розыгрыш недоступен (обновите сервер)' }

          }

          console.warn('[usePlayCard] RPC unavailable, using fallback:', rpcErr.message)

        } else if (data?.error) {

          return { error: data.error }

        }

      } catch (e) {

        if (!ALLOW_CLIENT_FALLBACK) {

          return { error: e?.message || 'Розыгрыш недоступен' }

        }

        console.warn('[usePlayCard] RPC threw:', e?.message)

      }



      if (!ALLOW_CLIENT_FALLBACK) {

        return { error: 'Розыгрыш недоступен (обновите сервер)' }

      }



      const newHand = hand.filter((_, i) => i !== cardIndex)

      const nextZones = clampZones(me.zones)

      const instanceId = card.instanceId || card.id || `card-${Date.now()}-${cardIndex}`

      nextZones[zoneIndex] = [

        ...(nextZones[zoneIndex] || []),

        { ...card, id: card.id, instanceId, tapped: false, flipped: false, slot_type: slot },

      ]

      const deckPile = Array.isArray(me.deck_pile) ? [...me.deck_pile] : []



      const [playersRes, zonesRes] = await withGuestId(() =>

        Promise.all([

          supabase

            .from('game_players')

            .update({

              hand: newHand,

              deck_pile: deckPile,

              deck_remaining: deckPile.length,

              actions_remaining: actionsLeft - actionCost,

            })

            .eq('game_id', game.id)

            .eq('player_id', me.player_id),

          supabase

            .from('game_zones')

            .update({ cards: nextZones[zoneIndex] })

            .eq('game_id', game.id)

            .eq('player_id', me.player_id)

            .eq('zone_position', zoneIndex + 1),

        ])

      )



      const err = playersRes.error || zonesRes.error

      if (err) return { error: `Розыгрыш не сохранился: ${err.message || err}` }



      const nextState = applyPlayCardPatch(

        game,

        me.player_id,

        cardIndex,

        zoneIndex,

        slot,

        { version: (game.version ?? 0) + 1, actions_remaining: actionsLeft - actionCost, card },

        cardCatalog

      )

      if (typeof patchGame === 'function') {

        patchGame(() => nextState)

      }

      await publishGameSync(game.id, {
        type: 'play_card',
        version: (game.version ?? 0) + 1,
        actorId: me.player_id,
        playerId: me.player_id,
        cardIndex,
        zoneIndex,
        slotType: slot,
        rpcData: { card, actions_remaining: actionsLeft - actionCost },
        zoneCards: enrichZoneCardsForSync(nextZones[zoneIndex], cardCatalog),
      })

      return { success: true }

    },

    [game, patchGame, cardCatalog, transport]

  )

}

