/**
 * usePlayCard — розыгрыш карты из руки в зону.
 *
 * Логика:
 *  1. Достать карту из hand
 *  2. Положить в zone (clampZones гарантирует 4 слота)
 *  3. Refill: добрать из deck_pile пока hand < STARTING_HAND_SIZE
 *  4. Записать в game_players (hand, deck_pile, deck_remaining)
 *  5. Записать в game_zones (cards в конкретной зоне)
 *  6. Обновить log через writeGameState
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { STARTING_HAND_SIZE } from '../../constants/game'
import { clampZones } from './format'

export function usePlayCard(game, writeGameState) {
  return useCallback(
    async (cardIndex, zoneIndex, actionCost = 1) => {
      if (!game?.players) return { error: 'Игра не загружена' }
      await ensureGuestId()
      const me = game.players.find((p) => p.player_id === game.current_player_id)
      if (!me) return { error: 'Сейчас не ваш ход' }

      const hand = [...(me.hand || [])]
      if (cardIndex < 0 || cardIndex >= hand.length) return { error: 'Неверный индекс карты' }
      const card = hand[cardIndex]
      if (card.cost > actionCost) return { error: 'Карта дороже доступного действия' }

      const newLog = [
        ...(game.game_state?.log || []),
        {
          timestamp: Date.now(),
          message: `${me.nickname || 'Игрок'} сыграл ${card.name} в зону ${zoneIndex + 1}`,
        },
      ]

      hand.splice(cardIndex, 1)
      const zones = clampZones(me.zones)
      zones[zoneIndex] = [
        ...(zones[zoneIndex] || []),
        { ...card, id: card.id || `card-${Date.now()}`, tapped: false, flipped: false },
      ]

      // Refill: добираем из deck_pile пока рука < STARTING_HAND_SIZE
      const deckPile = Array.isArray(me.deck_pile) ? [...me.deck_pile] : []
      while (hand.length < STARTING_HAND_SIZE && deckPile.length > 0) {
        hand.push(deckPile.pop())
      }
      const newDeckRemaining = deckPile.length

      // Persist hand + deck_pile + deck_remaining + zones
      await supabase
        .from('game_players')
        .update({
          hand,
          deck_pile: deckPile,
          deck_remaining: newDeckRemaining,
        })
        .eq('game_id', game.id)
        .eq('player_id', me.player_id)

      await supabase
        .from('game_zones')
        .update({ cards: zones[zoneIndex] })
        .eq('game_id', game.id)
        .eq('player_id', me.player_id)
        .eq('zone_position', zoneIndex + 1)

      return writeGameState({ game_state: { log: newLog } })
    },
    [game, writeGameState]
  )
}