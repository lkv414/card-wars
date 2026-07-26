/**
 * useFlipCard — хук для флюпа карт на поле.
 *
 * Флюп (flip) — это механика, при которой карта вместо атаки использует свою способность.
 * Флюпнутая карта поворачивается на 90 градусов и не может атаковать в этом ходу.
 *
 * БАГ-ФИКС: предыдущая версия правила players[].zones и передавала в writeGameState,
 * но writeGameState сохраняет только game_state / current_player_id / status и т.п.,
 * а НЕ players. Теперь сохраняем в game_zones явно, как usePlayCard / useAttack.
 */

import { useCallback } from 'react'
import { supabase } from '../../utils/supabase'
import { ensureGuestId } from '../../utils/guestSession'
import { CARD_STATUSES } from '../../constants/gameMultiplayer'

export function useFlipCard(game, writeGameState) {
  const flipCard = useCallback(
    async (playerIndex, zoneIndex, cardId) => {
      if (!game?.players) return { error: 'Игра не загружена' }

      await ensureGuestId()

      const player = game.players?.[playerIndex]
      if (!player) {
        return { error: 'Игрок не найден' }
      }

      const zone = player.zones?.[zoneIndex]
      if (!zone) {
        return { error: 'Зона не найдена' }
      }

      const card = (zone.cards || []).find(
        (c) => c.id === cardId || c.instanceId === cardId
      )
      if (!card) {
        return { error: 'Карта не найдена' }
      }

      if (!card.abilities?.includes('Флюп') && !card.flip_ability) {
        return { error: 'У карты нет способности Флюп' }
      }

      const newCards = (zone.cards || []).map((c) =>
        c.id === cardId || c.instanceId === cardId
          ? { ...c, status: CARD_STATUSES.flipped, flipped: true }
          : c
      )

      const newLog = [
        ...(game.game_state?.log || []),
        {
          timestamp: Date.now(),
          message: `${player.nickname || 'Игрок'} флюпнул ${card.name}`,
        },
      ]

      // Сохраняем зону + log параллельно
      const [zoneRes, gameRes] = await Promise.all([
        supabase
          .from('game_zones')
          .update({ cards: newCards })
          .eq('game_id', game.id)
          .eq('player_id', player.player_id)
          .eq('zone_position', zoneIndex + 1),
        writeGameState({ game_state: { log: newLog } }),
      ])

      const err = zoneRes.error || gameRes?.error
      if (err) {
        return { error: `Флюп не сохранился: ${err.message || err}` }
      }
      return { success: true }
    },
    [game, writeGameState]
  )

  return flipCard
}
