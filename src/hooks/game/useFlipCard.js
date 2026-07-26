/**
 * useFlipCard — хук для флюпа карт на поле
 * 
 * Флюп (flip) — это механика, при которой карта вместо атаки использует свою способность.
 * Флюпнутая карта поворачивается на 90 градусов и не может атаковать в этом ходу.
 */

import { useCallback } from 'react'
import { ensureGuestId } from '../../utils/guestSession'
import { CARD_STATUSES } from '../../constants/gameMultiplayer'

export function useFlipCard(game, writeGameState) {
  const flipCard = useCallback(async (playerIndex, zoneIndex, cardId) => {
    if (!game) return
    
    await ensureGuestId()
    
    // Находим карту в указанной зоне игрока
    const player = game.players?.[playerIndex]
    if (!player) {
      console.error('Игрок не найден:', playerIndex)
      return
    }
    
    const zone = player.zones?.[zoneIndex]
    if (!zone) {
      console.error('Зона не найдена:', zoneIndex)
      return
    }
    
    const card = zone.cards?.find(c => c.id === cardId || c.instanceId === cardId)
    if (!card) {
      console.error('Карта не найдена:', cardId)
      return
    }
    
    // Проверяем, что карта может быть флюпнута
    if (!card.abilities?.includes('Флюп') && !card.flip_ability) {
      console.error('Карта не имеет способности Флюп')
      return
    }
    
    // Создаем новую версию игры с флюпнутой картой
    const newGame = {
      ...game,
      version: game.version + 1,
      players: game.players.map((p, idx) => {
        if (idx !== playerIndex) return p
        
        return {
          ...p,
          zones: p.zones.map((z, zidx) => {
            if (zidx !== zoneIndex) return z
            
            return {
              ...z,
              cards: z.cards.map(c => {
                if (c.id === cardId || c.instanceId === cardId) {
                  return {
                    ...c,
                    status: CARD_STATUSES.flipped
                  }
                }
                return c
              })
            }
          })
        }
      })
    }
    
    await writeGameState(newGame)
  }, [game, writeGameState])
  
  return flipCard
}
