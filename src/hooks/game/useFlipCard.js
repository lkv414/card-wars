/**
 * useFlipCard — флюп карт на поле.
 *
 * Worker (GameRoom Durable Object) — единственный авторитет. SQL-фоллбека нет:
 * иначе карта переворачивалась бы дважды (DO + plpgsql).
 */
import { useCallback } from 'react'
import { hasFlipAbility, getFlipCost } from './cardAbilities.js'
export { hasFlipAbility, getFlipCost } from './cardAbilities.js'

import { runViaTransport, transportError, transportOk } from './runViaTransport'

export function useFlipCard(game, { transport } = {}) {
  return useCallback(
    async (playerIndex, zoneIndex, cardId) => {
      if (!game?.players) return { error: 'Игра не загружена' }

      const player = game.players?.[playerIndex]
      if (!player) {
        return { error: 'Игрок не найден' }
      }

      const zone = player.zones?.[zoneIndex]
      if (!zone) {
        return { error: 'Зона не найдена' }
      }

      const card = (zone.cards || []).find((c) => c.id === cardId || c.instanceId === cardId)
      if (!card) {
        return { error: 'Карта не найдена' }
      }

      if (!hasFlipAbility(card)) {
        return { error: 'У карты нет способности Флюп' }
      }

      // Клиентская проверка стоимости до отправки (быстрый UX)
      const cost = getFlipCost(card)
      const actionsLeft = player.actions_remaining ?? game.actions_remaining ?? 2
      if (cost > 0 && actionsLeft < cost) {
        return { error: `Недостаточно действий (нужно ${cost}, осталось ${actionsLeft})` }
      }

      // Уже перевёрнута в этом ходу?
      if (card.flipped_this_turn) {
        return { error: 'Карта уже перевёрнута в этом ходу' }
      }

      const ws = await runViaTransport(transport, 'flip_card', {
        zonePosition: zoneIndex + 1,
        cardId: String(cardId),
      })
      const wsErr = transportError(ws)
      if (wsErr) return wsErr
      const wsOk = transportOk(ws)
      if (wsOk) return wsOk

      return { error: 'Флюп недоступен (обновите сервер)' }
    },
    [game, transport]
  )
}