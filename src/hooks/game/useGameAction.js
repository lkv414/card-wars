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
import { useDiscardFromZone } from './useDiscardFromZone'
import { useDrawCard } from './useDrawCard'
import { useDrawFreeCard } from './useDrawFreeCard'
import { useShuffleDeck } from './useShuffleDeck'
import { useDiscardFromHand } from './useDiscardFromHand'

export function useGameAction(game, reload, { patchGame, cardCatalog, suppressRealtimeReload } = {}) {
  const { writeGameState, isApplying, error } = useGameState(game, reload)
  const playCard = usePlayCard(game, writeGameState, reload, { patchGame, cardCatalog })
  const attack = useAttack(game, { patchGame, suppressRealtimeReload })
  const drawCard = useDrawCard(game, reload, { patchGame, suppressRealtimeReload })
  const drawFreeCard = useDrawFreeCard(game, reload, { patchGame, suppressRealtimeReload })
  const shuffleDeck = useShuffleDeck(game, reload)
  const discardFromHand = useDiscardFromHand(game, reload, { patchGame, suppressRealtimeReload })
  const discardFromZone = useDiscardFromZone(game, writeGameState, reload, { patchGame, suppressRealtimeReload })
  const { endTurn, forfeit } = useTurnControl(game, writeGameState, reload, { patchGame, suppressRealtimeReload })
  const flipCard = useFlipCard(game, { patchGame, suppressRealtimeReload })

  return {
    playCard,
    attack,
    drawCard,
    drawFreeCard,
    shuffleDeck,
    discardFromHand,
    discardFromZone,
    endTurn,
    forfeit,
    flipCard,
    isApplying,
    error,
  }
}