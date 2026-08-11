/**
 * useGameAction — композитный хук для игровых действий.
 *
 * Объединяет:
 *   - useGameState (writeGameState, isApplying, error)
 *   - usePlayCard (playCard)
 *   - useAttack (attack)
 *   - useTurnControl (endTurn, forfeit)
 *
 * Обратная совместимость со старым API: { playCard, attack, endTurn, isApplying, error }.
 * Новое: добавили forfeit (Этап 3).
 *
 * Фаза 4: refill и draw-фаза встроены в playCard и endTurn.
 * Фаза 5: optimistic lock + триггеры защищают данные.
 * Фаза 6: ensureGuestId() в каждом мутирующем действии.
 */

import { useGameState } from './useGameState'
import { usePlayCard } from './usePlayCard'
import { useAttack } from './useAttack'
import { useTurnControl } from './useTurnControl'
import { useFlipCard } from './useFlipCard'

export function useGameAction(game, reload) {
  const { writeGameState, isApplying, error } = useGameState(game, reload)
    const playCard = usePlayCard(game, writeGameState, reload)
    const attack = useAttack(game, writeGameState)
    const { endTurn, forfeit } = useTurnControl(game, writeGameState, reload)
  const flipCard = useFlipCard(game, writeGameState)

  return { playCard, attack, endTurn, forfeit, flipCard, isApplying, error }
}