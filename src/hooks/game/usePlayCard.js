/**
 * usePlayCard — розыгрыш карты из руки в слот зоны (существо или строение).
 *
 * Worker (GameRoom Durable Object) — единственный авторитет. SQL-фоллбека нет:
 * действие уходит только по WebSocket, иначе оно применилось бы дважды
 * (в DO и в таблице).
 */

import { useCallback } from 'react'
import { canPlayCardToSlot, getCardSlotType } from './zoneCards'
import { clampZones } from './format'
import { getCardCost } from '../../utils/cardFields.ts'
import { applyPlayCardPatch } from '../../utils/gameStatePatch'
import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function usePlayCard(game, { patchGame, cardCatalog, transport } = {}) {
  return useCallback(
    async (cardIndex, zoneIndex, _actionCost = 1, slotType = null) => {
      if (!game?.players) return { error: 'Игра не загружена' }

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

      // Оптимистичный патч: показываем розыгрыш сразу, WS-broadcast подтвердит
      // (или store откатит по версии, если сервер не принял действие).
      if (typeof patchGame === 'function') {
        patchGame((state) =>
          applyPlayCardPatch(
            state,
            me.player_id,
            cardIndex,
            zoneIndex,
            slot,
            {
              version: (state.version ?? 0) + 1,
              actions_remaining: actionsLeft - actionCost,
              action_cost: actionCost,
              card,
            },
            cardCatalog
          )
        )
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

      return { error: 'Розыгрыш недоступен (обновите сервер)' }
    },
    [game, patchGame, cardCatalog, transport]
  )
}